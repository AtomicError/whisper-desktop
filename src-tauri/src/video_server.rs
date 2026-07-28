use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::sync::Mutex;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

static SERVER_PORT: Mutex<Option<u16>> = Mutex::new(None);

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

pub async fn ensure_media_server_started() -> u16 {
  {
    let guard = SERVER_PORT.lock().unwrap();
    if let Some(port) = *guard {
      return port;
    }
  }

  let listener = TcpListener::bind("127.0.0.1:0")
    .await
    .expect("Failed to bind local HTTP media streaming server");
  let port = listener.local_addr().unwrap().port();

  {
    let mut guard = SERVER_PORT.lock().unwrap();
    *guard = Some(port);
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
          let mut path_param = String::new();
          let mut range_start: Option<u64> = None;
          let mut range_end: Option<u64> = None;

          for line in req_str.lines() {
            if line.to_lowercase().starts_with("range: bytes=") {
              let range_val = line[13..].trim();
              let parts: Vec<&str> = range_val.split('-').collect();
              if !parts[0].is_empty() {
                range_start = parts[0].parse().ok();
              }
              if parts.len() > 1 && !parts[1].is_empty() {
                range_end = parts[1].parse().ok();
              }
            }
          }

          if let Some(start_idx) = first_line.find("path=") {
            let sub = &first_line[start_idx + 5..];
            let end_idx = sub.find(' ').unwrap_or(sub.len());
            let raw_path = &sub[..end_idx];
            path_param = percent_decode(raw_path);
          }

          if path_param.is_empty() {
            let _ = stream.write_all(b"HTTP/1.1 400 Bad Request\r\n\r\n").await;
            return;
          }

          let file_path = std::path::PathBuf::from(&path_param);
          let mut file = match File::open(&file_path) {
            Ok(f) => f,
            Err(_) => {
              let _ = stream.write_all(b"HTTP/1.1 404 Not Found\r\n\r\n").await;
              return;
            }
          };

          let file_len = file.metadata().map(|m| m.len()).unwrap_or(0);
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
            _ => "video/mp4",
          };

          let start = range_start.unwrap_or(0);
          let end = range_end.unwrap_or(if file_len > 0 { file_len - 1 } else { 0 });
          let content_length = if file_len > 0 && end >= start {
            end - start + 1
          } else {
            0
          };

          let header = if range_start.is_some() {
            format!(
              "HTTP/1.1 206 Partial Content\r\nContent-Type: {}\r\nContent-Length: {}\r\nContent-Range: bytes {}-{}/{}\r\nAccept-Ranges: bytes\r\nAccess-Control-Allow-Origin: *\r\n\r\n",
              mime_type, content_length, start, end, file_len
            )
          } else {
            format!(
              "HTTP/1.1 200 OK\r\nContent-Type: {}\r\nContent-Length: {}\r\nAccept-Ranges: bytes\r\nAccess-Control-Allow-Origin: *\r\n\r\n",
              mime_type, file_len
            )
          };

          if stream.write_all(header.as_bytes()).await.is_err() {
            return;
          }

          if file.seek(SeekFrom::Start(start)).is_err() {
            return;
          }

          let mut remaining = content_length;
          let mut chunk = [0u8; 65536];
          while remaining > 0 {
            let to_read = std::cmp::min(remaining as usize, chunk.len());
            let n = match file.read(&mut chunk[..to_read]) {
              Ok(n) if n > 0 => n,
              _ => break,
            };
            if stream.write_all(&chunk[..n]).await.is_err() {
              break;
            }
            remaining -= n as u64;
          }
        });
      }
    }
  });

  port
}

#[tauri::command]
pub async fn get_media_stream_url(path: String) -> Result<String, String> {
  let port = ensure_media_server_started().await;
  let encoded_path = urlencoding_simple(&path);
  Ok(format!("http://127.0.0.1:{}/video?path={}", port, encoded_path))
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
