use std::io::SeekFrom;
use std::sync::Mutex;
use tokio::fs::File;
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};
use tokio::net::TcpListener;

static SERVER_PORT: Mutex<Option<u16>> = Mutex::new(None);

/// Per-session random token required in every media URL. Prevents other local
/// processes / web pages from using the server as an arbitrary file reader.
static SERVER_TOKEN: Mutex<Option<String>> = Mutex::new(None);

fn percent_decode(s: &str) -> String {
  let mut bytes = Vec::new();
  let mut i = 0;
  let b = s.as_bytes();
  while i < b.len() {
    if b[i] == b'%' && i + 2 < b.len() {
      if let Ok(val) = u8::from_str_radix(std::str::from_utf8(&b[i + 1..i + 3]).unwrap_or(""), 16) {
        bytes.push(val);
        i += 3;
        continue;
      }
    }
    bytes.push(b[i]);
    i += 1;
  }
  String::from_utf8_lossy(&bytes).to_string()
}

fn random_token() -> String {
  use std::time::{SystemTime, UNIX_EPOCH};
  let nanos = SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .map(|d| d.as_nanos())
    .unwrap_or(0);
  format!("{:x}-{:x}", nanos, std::process::id())
}

pub async fn ensure_media_server_started() -> Result<u16, String> {
  {
    let guard = SERVER_PORT.lock().unwrap_or_else(|e| e.into_inner());
    let token_guard = SERVER_TOKEN.lock().unwrap_or_else(|e| e.into_inner());
    if let (Some(port), Some(_)) = (*guard, &*token_guard) {
      return Ok(port);
    }
  }

  let listener = TcpListener::bind("127.0.0.1:0")
    .await
    .map_err(|e| format!("Failed to start local media server: {e}"))?;
  let port = listener
    .local_addr()
    .map_err(|e| format!("Failed to start local media server: {e}"))?
    .port();

  {
    let mut guard = SERVER_PORT.lock().unwrap_or_else(|e| e.into_inner());
    *guard = Some(port);
  }
  {
    let mut guard = SERVER_TOKEN.lock().unwrap_or_else(|e| e.into_inner());
    if guard.is_none() {
      *guard = Some(random_token());
    }
  }

  tokio::spawn(async move {
    loop {
      if let Ok((mut stream, _)) = listener.accept().await {
        tokio::spawn(async move {
          let mut buffer = [0u8; 4096];
          let n = match stream.read(&mut buffer).await {
            Ok(n) if n > 0 => n,
            _ => return,
          };
          let req_str = String::from_utf8_lossy(&buffer[..n]);

          let first_line = req_str.lines().next().unwrap_or("");
          let mut raw_range_header: Option<String> = None;

          for line in req_str.lines() {
            if line.to_lowercase().starts_with("range: bytes=") {
              raw_range_header = Some(line[13..].trim().to_string());
            }
          }

          // Extract query parameters from request URI line (e.g. GET /video?path=...&token=... HTTP/1.1)
          let mut path_param = String::new();
          let mut token_param = String::new();
          if let Some(uri) = first_line.split_whitespace().nth(1) {
            if let Some((_, query)) = uri.split_once('?') {
              for pair in query.split('&') {
                if let Some((key, val)) = pair.split_once('=') {
                  match key {
                    "path" => path_param = percent_decode(val),
                    "token" => token_param = val.to_string(),
                    _ => {}
                  }
                }
              }
            }
          }

          // Capability check: unknown callers get a generic rejection.
          let expected_token = SERVER_TOKEN
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone();
          if token_param.is_empty()
            || expected_token.as_deref() != Some(token_param.as_str())
          {
            let _ = stream.write_all(b"HTTP/1.1 403 Forbidden\r\n\r\n").await;
            return;
          }

          if path_param.is_empty() {
            let _ = stream.write_all(b"HTTP/1.1 400 Bad Request\r\n\r\n").await;
            return;
          }

          let file_path = std::path::PathBuf::from(&path_param);
          let mut file = match File::open(&file_path).await {
            Ok(f) => f,
            Err(_) => {
              let _ = stream.write_all(b"HTTP/1.1 404 Not Found\r\n\r\n").await;
              return;
            }
          };

          let file_len = match file.metadata().await {
            Ok(m) => m.len(),
            Err(_) => {
              let _ = stream.write_all(b"HTTP/1.1 500 Internal Server Error\r\n\r\n").await;
              return;
            }
          };

          let ext = file_path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_lowercase();

          let mime_type = match ext.as_str() {
            "mp4" | "m4v" => "video/mp4",
            "mkv" => "video/x-matroska",
            "webm" => "video/webm",
            "mov" => "video/quicktime",
            "avi" => "video/x-msvideo",
            "mp3" => "audio/mpeg",
            "wav" => "audio/wav",
            "ogg" | "oga" => "audio/ogg",
            "opus" => "audio/opus",
            "flac" => "audio/flac",
            "aac" => "audio/aac",
            "m4a" => "audio/mp4",
            _ => "application/octet-stream",
          };

          // Parse RFC 7233 Range headers
          let (start, end, is_range) = if let Some(ref range_str) = raw_range_header {
            let parts: Vec<&str> = range_str.split('-').collect();
            if parts.is_empty() {
              (0, if file_len > 0 { file_len - 1 } else { 0 }, false)
            } else if parts[0].is_empty() {
              // Suffix range: bytes=-500 (last 500 bytes)
              if parts.len() > 1 && !parts[1].is_empty() {
                if let Ok(suffix_len) = parts[1].parse::<u64>() {
                  let s = file_len.saturating_sub(suffix_len);
                  let e = if file_len > 0 { file_len - 1 } else { 0 };
                  (s, e, true)
                } else {
                  (0, if file_len > 0 { file_len - 1 } else { 0 }, false)
                }
              } else {
                (0, if file_len > 0 { file_len - 1 } else { 0 }, false)
              }
            } else {
              // Range: bytes=start-end or bytes=start-
              let s_opt = parts[0].parse::<u64>().ok();
              let e_opt = if parts.len() > 1 && !parts[1].is_empty() {
                parts[1].parse::<u64>().ok()
              } else {
                None
              };

              match s_opt {
                Some(s) => {
                  let e = e_opt.unwrap_or(if file_len > 0 { file_len - 1 } else { 0 });
                  (s, e, true)
                }
                None => (0, if file_len > 0 { file_len - 1 } else { 0 }, false),
              }
            }
          } else {
            (0, if file_len > 0 { file_len - 1 } else { 0 }, false)
          };

          if is_range {
            if file_len == 0 || start >= file_len || start > end {
              let header_416 = format!(
                "HTTP/1.1 416 Range Not Satisfiable\r\nContent-Range: bytes */{}\r\n\r\n",
                file_len
              );
              let _ = stream.write_all(header_416.as_bytes()).await;
              return;
            }

            let clamped_end = end.min(file_len - 1);
            let content_length = clamped_end - start + 1;

            let header = format!(
              "HTTP/1.1 206 Partial Content\r\nContent-Type: {}\r\nContent-Length: {}\r\nContent-Range: bytes {}-{}/{}\r\nAccept-Ranges: bytes\r\n\r\n",
              mime_type, content_length, start, clamped_end, file_len
            );

            if stream.write_all(header.as_bytes()).await.is_err() {
              return;
            }

            if file.seek(SeekFrom::Start(start)).await.is_err() {
              return;
            }

            let mut remaining = content_length;
            let mut chunk = [0u8; 65536];
            while remaining > 0 {
              let to_read = std::cmp::min(remaining as usize, chunk.len());
              let n = match file.read(&mut chunk[..to_read]).await {
                Ok(n) if n > 0 => n,
                _ => break,
              };
              if stream.write_all(&chunk[..n]).await.is_err() {
                break;
              }
              remaining -= n as u64;
            }
          } else {
            let header = format!(
              "HTTP/1.1 200 OK\r\nContent-Type: {}\r\nContent-Length: {}\r\nAccept-Ranges: bytes\r\n\r\n",
              mime_type, file_len
            );

            if stream.write_all(header.as_bytes()).await.is_err() {
              return;
            }

            let mut remaining = file_len;
            let mut chunk = [0u8; 65536];
            while remaining > 0 {
              let to_read = std::cmp::min(remaining as usize, chunk.len());
              let n = match file.read(&mut chunk[..to_read]).await {
                Ok(n) if n > 0 => n,
                _ => break,
              };
              if stream.write_all(&chunk[..n]).await.is_err() {
                break;
              }
              remaining -= n as u64;
            }
          }
        });
      }
    }
  });

  Ok(port)
}

#[tauri::command]
pub async fn get_media_stream_url(path: String) -> Result<String, String> {
  let port = ensure_media_server_started().await?;
  let token = SERVER_TOKEN
    .lock()
    .unwrap_or_else(|e| e.into_inner())
    .clone()
    .ok_or("Media server not initialized")?;
  let encoded_path = urlencoding_simple(&path);
  Ok(format!(
    "http://127.0.0.1:{}/video?path={}&token={}",
    port, encoded_path, token
  ))
}

fn urlencoding_simple(s: &str) -> String {
  let mut result = String::new();
  for b in s.bytes() {
    match b {
      b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' | b'/' => {
        result.push(b as char);
      }
      _ => {
        result.push_str(&format!("%{:02X}", b));
      }
    }
  }
  result
}
