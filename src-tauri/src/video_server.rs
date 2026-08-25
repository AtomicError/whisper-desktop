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
  use std::collections::hash_map::RandomState;
  use std::hash::{BuildHasher, Hasher};
  use std::time::{SystemTime, UNIX_EPOCH};

  #[cfg(unix)]
  {
    if let Ok(mut f) = std::fs::File::open("/dev/urandom") {
      use std::io::Read;
      let mut buf = [0u8; 32];
      if f.read_exact(&mut buf).is_ok() {
        return buf.iter().map(|b| format!("{:02x}", b)).collect();
      }
    }
  }

  let mut hasher1 = RandomState::new().build_hasher();
  let mut hasher2 = RandomState::new().build_hasher();
  let mut hasher3 = RandomState::new().build_hasher();
  let mut hasher4 = RandomState::new().build_hasher();

  let nanos = SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .map(|d| d.as_nanos())
    .unwrap_or(0);

  hasher1.write_u128(nanos);
  hasher1.write_u32(std::process::id());
  hasher2.write_u64(hasher1.finish());
  hasher3.write_u64(hasher2.finish());
  hasher4.write_u64(hasher3.finish());

  format!("{:016x}{:016x}{:016x}{:016x}", hasher1.finish(), hasher2.finish(), hasher3.finish(), hasher4.finish())
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
          loop {
            let mut buffer = [0u8; 8192];
            let n = match stream.read(&mut buffer).await {
              Ok(n) if n > 0 => n,
              _ => break,
            };
            let req_str = String::from_utf8_lossy(&buffer[..n]);

            let mut lines = req_str.lines();
            let first_line = lines.next().unwrap_or("");
            let mut parts = first_line.split_whitespace();
            let method = parts.next().unwrap_or("GET").to_uppercase();
            let raw_uri = parts.next().unwrap_or("/");

            // Handle CORS preflight OPTIONS request
            if method == "OPTIONS" {
              let cors_preflight = "HTTP/1.1 204 No Content\r\n\
Access-Control-Allow-Origin: *\r\n\
Access-Control-Allow-Methods: GET, HEAD, OPTIONS\r\n\
Access-Control-Allow-Headers: Range, Content-Type, Accept, Origin, User-Agent\r\n\
Access-Control-Expose-Headers: Content-Range, Content-Length, Accept-Ranges\r\n\
Access-Control-Max-Age: 86400\r\n\
Connection: keep-alive\r\n\r\n";
              if stream.write_all(cors_preflight.as_bytes()).await.is_err() {
                break;
              }
              continue;
            }

            let mut raw_range_header: Option<String> = None;
            let mut should_close = false;
            for line in lines {
              if let Some((header_name, header_val)) = line.split_once(':') {
                let name = header_name.trim();
                let val = header_val.trim();
                if name.eq_ignore_ascii_case("range") {
                  if let Some(rest) = val.strip_prefix("bytes=") {
                    raw_range_header = Some(rest.trim().to_string());
                  }
                } else if name.eq_ignore_ascii_case("connection") && val.eq_ignore_ascii_case("close") {
                  should_close = true;
                }
              }
            }

            // Extract query parameters from request URI line (e.g. GET /video?path=...&token=... HTTP/1.1)
            let mut path_param = String::new();
            let mut token_param = String::new();
            if let Some((_, query)) = raw_uri.split_once('?') {
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

            // Capability check: unknown callers get a generic rejection with CORS headers.
            let expected_token = SERVER_TOKEN
              .lock()
              .unwrap_or_else(|e| e.into_inner())
              .clone();
            if token_param.is_empty()
              || expected_token.as_deref() != Some(token_param.as_str())
            {
              let forbidden = "HTTP/1.1 403 Forbidden\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n";
              let _ = stream.write_all(forbidden.as_bytes()).await;
              break;
            }

            if path_param.is_empty() {
              let bad_req = "HTTP/1.1 400 Bad Request\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n";
              let _ = stream.write_all(bad_req.as_bytes()).await;
              break;
            }

            let file_path = std::path::PathBuf::from(&path_param);

            // Security hardening: verify file exists, is a regular file, and matches allowed media extension
            let ext = file_path
              .extension()
              .and_then(|e| e.to_str())
              .unwrap_or("")
              .to_lowercase();

            const ALLOWED_MEDIA_EXTS: &[&str] = &[
              "mp4", "m4v", "mkv", "webm", "mov", "avi", "ts", "mts", "m2ts", "flv", "f4v", "wmv", "ogv", "3gp", "3g2",
              "mp3", "wav", "ogg", "oga", "opus", "flac", "aac", "m4a",
            ];

            if !ALLOWED_MEDIA_EXTS.contains(&ext.as_str()) || !file_path.is_file() {
              let forbidden = "HTTP/1.1 403 Forbidden\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n";
              let _ = stream.write_all(forbidden.as_bytes()).await;
              break;
            }

            let mut file = match File::open(&file_path).await {
              Ok(f) => f,
              Err(_) => {
                let not_found = "HTTP/1.1 404 Not Found\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n";
                let _ = stream.write_all(not_found.as_bytes()).await;
                break;
              }
            };

            let file_len = match file.metadata().await {
              Ok(m) => m.len(),
              Err(_) => {
                let internal_err = "HTTP/1.1 500 Internal Server Error\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n";
                let _ = stream.write_all(internal_err.as_bytes()).await;
                break;
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
              "ts" | "mts" | "m2ts" => "video/mp2t",
              "flv" | "f4v" => "video/x-flv",
              "wmv" => "video/x-ms-wmv",
              "ogv" => "video/ogg",
              "3gp" => "video/3gpp",
              "3g2" => "video/3gpp2",
              "mp3" => "audio/mpeg",
              "wav" => "audio/wav",
              "ogg" | "oga" => "audio/ogg",
              "opus" => "audio/opus",
              "flac" => "audio/flac",
              "aac" => "audio/aac",
              "m4a" => "audio/mp4",
              _ => "application/octet-stream",
            };

            let conn_header = if should_close { "close" } else { "keep-alive" };

            // Parse RFC 7233 Range headers
            let (start, end, is_range) = if let Some(ref range_str) = raw_range_header {
              let parts: Vec<&str> = range_str.split('-').collect();
              if parts.is_empty() {
                (0, if file_len > 0 { file_len - 1 } else { 0 }, false)
              } else if parts[0].is_empty() {
                // Suffix range: bytes=-500 (last 500 bytes)
                if parts.len() > 1 && !parts[1].is_empty() {
                  if let Ok(suffix_len) = parts[1].trim().parse::<u64>() {
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
                let s_opt = parts[0].trim().parse::<u64>().ok();
                let e_opt = if parts.len() > 1 && !parts[1].trim().is_empty() {
                  parts[1].trim().parse::<u64>().ok()
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
                  "HTTP/1.1 416 Range Not Satisfiable\r\n\
Content-Range: bytes */{}\r\n\
Access-Control-Allow-Origin: *\r\n\
Connection: {}\r\n\r\n",
                  file_len, conn_header
                );
                let _ = stream.write_all(header_416.as_bytes()).await;
                if should_close { break; } else { continue; }
              }

              let clamped_end = end.min(file_len - 1);
              let content_length = clamped_end - start + 1;

              let header = format!(
                "HTTP/1.1 206 Partial Content\r\n\
Content-Type: {}\r\n\
Content-Length: {}\r\n\
Content-Range: bytes {}-{}/{}\r\n\
Accept-Ranges: bytes\r\n\
Access-Control-Allow-Origin: *\r\n\
Access-Control-Allow-Methods: GET, HEAD, OPTIONS\r\n\
Access-Control-Allow-Headers: Range, Content-Type, Accept, Origin\r\n\
Access-Control-Expose-Headers: Content-Range, Content-Length, Accept-Ranges\r\n\
Connection: {}\r\n\r\n",
                mime_type, content_length, start, clamped_end, file_len, conn_header
              );

              if stream.write_all(header.as_bytes()).await.is_err() {
                break;
              }

              if method == "HEAD" {
                if should_close { break; } else { continue; }
              }

              if file.seek(SeekFrom::Start(start)).await.is_err() {
                break;
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

              if remaining > 0 || should_close {
                break;
              }
            } else {
              let header = format!(
                "HTTP/1.1 200 OK\r\n\
Content-Type: {}\r\n\
Content-Length: {}\r\n\
Accept-Ranges: bytes\r\n\
Access-Control-Allow-Origin: *\r\n\
Access-Control-Allow-Methods: GET, HEAD, OPTIONS\r\n\
Access-Control-Allow-Headers: Range, Content-Type, Accept, Origin\r\n\
Access-Control-Expose-Headers: Content-Range, Content-Length, Accept-Ranges\r\n\
Connection: {}\r\n\r\n",
                mime_type, file_len, conn_header
              );

              if stream.write_all(header.as_bytes()).await.is_err() {
                break;
              }

              if method == "HEAD" {
                if should_close { break; } else { continue; }
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

              if remaining > 0 || should_close {
                break;
              }
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
