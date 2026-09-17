use std::collections::HashMap;
use std::future::Future;
use std::io::{self, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::fs::File;
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{Notify, Semaphore};
use tokio::task::{JoinHandle, JoinSet};
use tokio::time::{timeout, timeout_at, Instant};
use tokio_util::sync::CancellationToken;

#[derive(Clone, Copy)]
struct ServerConfig {
  header_bytes: usize,
  header_count: usize,
  header_timeout: Duration,
  inactivity_timeout: Duration,
}

impl Default for ServerConfig {
  fn default() -> Self {
    Self {
      header_bytes: 16 * 1024,
      header_count: 64,
      header_timeout: Duration::from_secs(10),
      inactivity_timeout: Duration::from_secs(30),
    }
  }
}

pub(crate) struct MediaResource {
  path: PathBuf,
  mime: String,
  cancel: CancellationToken,
  // A reader lease retains this owner until its file handle is closed.
  _owner: Option<Arc<tempfile::TempDir>>,
  readers: AtomicUsize,
  settled: Notify,
}

impl MediaResource {
  async fn wait_for_readers(&self) {
    loop {
      let notified = self.settled.notified();
      tokio::pin!(notified);
      notified.as_mut().enable();
      if self.readers.load(Ordering::Acquire) == 0 {
        return;
      }
      notified.await;
    }
  }
}

struct ReaderLease(Arc<MediaResource>);

impl Drop for ReaderLease {
  fn drop(&mut self) {
    if self.0.readers.fetch_sub(1, Ordering::AcqRel) == 1 {
      self.0.settled.notify_waiters();
    }
  }
}

struct Shared {
  resources: Mutex<HashMap<String, Arc<MediaResource>>>,
  cancel: CancellationToken,
  config: ServerConfig,
}

impl Shared {
  fn lease(&self, route: &str) -> Option<ReaderLease> {
    let resources = self.resources.lock().unwrap_or_else(|e| e.into_inner());
    let resource = resources.get(route)?;
    if self.cancel.is_cancelled() || resource.cancel.is_cancelled() {
      return None;
    }
    resource.readers.fetch_add(1, Ordering::AcqRel);
    Some(ReaderLease(Arc::clone(resource)))
  }
}

pub(crate) struct MediaServer {
  origin: String,
  shared: Arc<Shared>,
  listener: tokio::sync::Mutex<Option<JoinHandle<()>>>,
}

impl MediaServer {
  pub(crate) async fn start() -> Result<Self, String> {
    Self::start_with_config(ServerConfig::default()).await
  }

  async fn start_with_config(config: ServerConfig) -> Result<Self, String> {
    let listener = TcpListener::bind("127.0.0.1:0")
      .await
      .map_err(|e| format!("Failed to start local media server: {e}"))?;
    let address = listener.local_addr().map_err(|e| e.to_string())?;
    let shared = Arc::new(Shared {
      resources: Mutex::new(HashMap::new()),
      cancel: CancellationToken::new(),
      config,
    });
    let task_shared = Arc::clone(&shared);
    let task = tokio::spawn(async move {
      // Unexpected task exit invalidates registrations and initialization too.
      let _cancel_on_exit = task_shared.cancel.clone().drop_guard();
      accept_connections(listener, task_shared).await;
    });
    Ok(Self {
      origin: format!("http://{address}"),
      shared,
      listener: tokio::sync::Mutex::new(Some(task)),
    })
  }

  pub(crate) async fn register(
    &self,
    path: PathBuf,
    mime: String,
    owner: Option<Arc<tempfile::TempDir>>,
  ) -> Result<String, String> {
    if mime.is_empty() || !mime.bytes().all(|b| (32..127).contains(&b)) {
      return Err("Invalid media MIME type".into());
    }
    let path = tokio::fs::canonicalize(path).await.map_err(|e| format!("Cannot resolve media file: {e}"))?;
    let file = File::open(&path).await.map_err(|e| format!("Cannot open media file: {e}"))?;
    let metadata = file.metadata().await.map_err(|e| format!("Cannot inspect media file: {e}"))?;
    if !metadata.is_file() {
      return Err("Media source is not a regular file".into());
    }
    drop(file);
    let resource = Arc::new(MediaResource {
      path,
      mime,
      cancel: self.shared.cancel.child_token(),
      _owner: owner,
      readers: AtomicUsize::new(0),
      settled: Notify::new(),
    });
    loop {
      let mut random = [0u8; 32];
      getrandom::fill(&mut random).map_err(|e| format!("Cannot create media capability: {e}"))?;
      const HEX: &[u8; 16] = b"0123456789abcdef";
      let mut route = String::with_capacity(71);
      route.push_str("/media/");
      for byte in random {
        route.push(HEX[(byte >> 4) as usize] as char);
        route.push(HEX[(byte & 15) as usize] as char);
      }
      let mut resources = self.shared.resources.lock().unwrap_or_else(|e| e.into_inner());
      if self.shared.cancel.is_cancelled() {
        return Err("Media server has stopped".into());
      }
      if let std::collections::hash_map::Entry::Vacant(entry) = resources.entry(route.clone()) {
        entry.insert(resource);
        return Ok(format!("{}{route}", self.origin));
      }
    }
  }

  pub(crate) async fn revoke(&self, url: &str) {
    let Some(route) = url.strip_prefix(&self.origin).filter(|route| route.starts_with("/media/")) else {
      return;
    };
    // Keep a cancelled entry while waiting, so concurrent revoke calls also wait.
    let resource = {
      let resources = self.shared.resources.lock().unwrap_or_else(|e| e.into_inner());
      let Some(resource) = resources.get(route) else { return; };
      resource.cancel.cancel();
      Arc::clone(resource)
    };
    resource.wait_for_readers().await;
    let mut resources = self.shared.resources.lock().unwrap_or_else(|e| e.into_inner());
    if resources.get(route).is_some_and(|current| Arc::ptr_eq(current, &resource)) {
      resources.remove(route);
    }
  }

  pub(crate) async fn shutdown(&self) {
    self.shared.cancel.cancel();
    // Serialize shutdown callers through connection settlement and map cleanup.
    let mut task = self.listener.lock().await;
    if let Some(task) = task.take() {
      let _ = task.await;
    }
    self.shared.resources.lock().unwrap_or_else(|e| e.into_inner()).clear();
  }
}

impl Drop for MediaServer {
  fn drop(&mut self) {
    self.shared.cancel.cancel();
  }
}

async fn accept_connections(listener: TcpListener, shared: Arc<Shared>) {
  let permits = Arc::new(Semaphore::new(32));
  let mut connections = JoinSet::new();
  loop {
    tokio::select! {
      biased;
      _ = shared.cancel.cancelled() => break,
      _ = connections.join_next(), if !connections.is_empty() => {},
      accepted = listener.accept() => match accepted {
        Ok((stream, _)) => {
          let accepted_at = Instant::now();
          let Ok(permit) = Arc::clone(&permits).try_acquire_owned() else {
            drop(stream);
            continue;
          };
          let shared = Arc::clone(&shared);
          connections.spawn(async move {
            let _permit = permit;
            handle_connection(stream, shared, accepted_at).await;
          });
        }
        Err(_) => {
          tokio::select! {
            _ = shared.cancel.cancelled() => break,
            _ = tokio::time::sleep(Duration::from_millis(100)) => {},
          }
        }
      },
    }
  }
  drop(listener);
  while connections.join_next().await.is_some() {}
}

struct Request {
  method: String,
  route: String,
  range: Option<String>,
}

#[derive(Debug, PartialEq, Eq)]
enum HeaderError {
  BadRequest,
  TooLarge,
  Closed,
}

// httparse owns the grammar; only interpret method/headers after Complete.
fn parse_headers(bytes: &[u8], count: usize) -> Result<Option<Request>, HeaderError> {
  let mut headers = vec![httparse::EMPTY_HEADER; count];
  let mut parsed = httparse::Request::new(&mut headers);
  match parsed.parse(bytes) {
    Ok(httparse::Status::Partial) => return Ok(None),
    Ok(httparse::Status::Complete(_)) => {},
    Err(httparse::Error::TooManyHeaders) => return Err(HeaderError::TooLarge),
    Err(_) => return Err(HeaderError::BadRequest),
  }
  let mut range = None;
  let mut range_count = 0;
  let mut if_range = false;
  for header in parsed.headers.iter() {
    if header.name.eq_ignore_ascii_case("transfer-encoding") {
      return Err(HeaderError::BadRequest);
    }
    if header.name.eq_ignore_ascii_case("content-length") {
      let value = std::str::from_utf8(header.value).map_err(|_| HeaderError::BadRequest)?.trim();
      if parse_decimal(value) != Some(0) {
        return Err(HeaderError::BadRequest);
      }
    }
    if header.name.eq_ignore_ascii_case("range") {
      range_count += 1;
      range = std::str::from_utf8(header.value).ok().map(|value| value.trim().to_owned());
    }
    if header.name.eq_ignore_ascii_case("if-range") {
      if_range = true;
    }
  }
  Ok(Some(Request {
    method: parsed.method.ok_or(HeaderError::BadRequest)?.to_owned(),
    route: parsed.path.ok_or(HeaderError::BadRequest)?.to_owned(),
    range: if if_range || range_count != 1 { None } else { range },
  }))
}

async fn read_request(stream: &mut TcpStream, shared: &Shared, accepted_at: Instant) -> Result<Request, HeaderError> {
  let config = shared.config;
  let read = async {
    let mut bytes = Vec::with_capacity(config.header_bytes);
    let mut buffer = [0u8; 2048];
    loop {
      if let Some(request) = parse_headers(&bytes, config.header_count)? {
        return Ok(request);
      }
      let available = config.header_bytes.saturating_sub(bytes.len()).min(buffer.len());
      if available == 0 {
        return Err(HeaderError::TooLarge);
      }
      let count = stream.read(&mut buffer[..available]).await.map_err(|_| HeaderError::Closed)?;
      if count == 0 {
        return Err(HeaderError::Closed);
      }
      bytes.extend_from_slice(&buffer[..count]);
    }
  };
  tokio::select! {
    biased;
    _ = shared.cancel.cancelled() => Err(HeaderError::Closed),
    result = timeout_at(accepted_at + config.header_timeout, read) => result.unwrap_or(Err(HeaderError::Closed)),
  }
}

async fn operation<T>(shared: &Shared, resource: &CancellationToken, future: impl Future<Output = io::Result<T>>) -> io::Result<T> {
  tokio::select! {
    biased;
    _ = shared.cancel.cancelled() => Err(io::ErrorKind::Interrupted.into()),
    _ = resource.cancelled() => Err(io::ErrorKind::Interrupted.into()),
    result = timeout(shared.config.inactivity_timeout, future) => result.unwrap_or_else(|_| Err(io::ErrorKind::TimedOut.into())),
  }
}

async fn write_bytes(stream: &mut TcpStream, mut bytes: &[u8], shared: &Shared, cancel: &CancellationToken) -> io::Result<()> {
  while !bytes.is_empty() {
    let count = operation(shared, cancel, stream.write(bytes)).await?;
    if count == 0 {
      return Err(io::ErrorKind::WriteZero.into());
    }
    bytes = &bytes[count..];
  }
  Ok(())
}

fn response_headers(status: &str, length: u64, extra: &str) -> String {
  format!(
    "HTTP/1.1 {status}\r\nContent-Length: {length}\r\nConnection: close\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, HEAD, OPTIONS\r\nAccess-Control-Allow-Headers: Range, Content-Type, Accept, Origin, User-Agent, If-Range\r\nAccess-Control-Expose-Headers: Content-Range, Content-Length, Accept-Ranges\r\n{extra}\r\n"
  )
}

async fn empty_response(stream: &mut TcpStream, shared: &Shared, cancel: &CancellationToken, status: &str, extra: &str) {
  let _ = write_bytes(stream, response_headers(status, 0, extra).as_bytes(), shared, cancel).await;
}

fn file_error(error: &io::Error) -> &'static str {
  match error.kind() {
    io::ErrorKind::NotFound => "404 Not Found",
    io::ErrorKind::PermissionDenied => "403 Forbidden",
    _ => "500 Internal Server Error",
  }
}

async fn handle_connection(mut stream: TcpStream, shared: Arc<Shared>, accepted_at: Instant) {
  let request = match read_request(&mut stream, &shared, accepted_at).await {
    Ok(request) => request,
    Err(HeaderError::Closed) => return,
    Err(error) => {
      let status = if error == HeaderError::TooLarge { "431 Request Header Fields Too Large" } else { "400 Bad Request" };
      empty_response(&mut stream, &shared, &shared.cancel, status, "").await;
      return;
    }
  };
  if !matches!(request.method.as_str(), "GET" | "HEAD" | "OPTIONS") {
    empty_response(&mut stream, &shared, &shared.cancel, "405 Method Not Allowed", "Allow: GET, HEAD, OPTIONS\r\n").await;
    return;
  }
  let Some(lease) = shared.lease(&request.route) else {
    empty_response(&mut stream, &shared, &shared.cancel, "404 Not Found", "").await;
    return;
  };
  if request.method == "OPTIONS" {
    empty_response(&mut stream, &shared, &lease.0.cancel, "204 No Content", "").await;
    return;
  }
  // The lease outlives this entire scope, including the open file.
  serve_file(&mut stream, &shared, &lease.0, request).await;
}

async fn serve_file(stream: &mut TcpStream, shared: &Shared, resource: &MediaResource, request: Request) {
  let mut file = match operation(shared, &resource.cancel, File::open(&resource.path)).await {
    Ok(file) => file,
    Err(error) => {
      empty_response(stream, shared, &resource.cancel, file_error(&error), "").await;
      return;
    }
  };
  let metadata = match operation(shared, &resource.cancel, file.metadata()).await {
    Ok(metadata) if metadata.is_file() => metadata,
    Ok(_) => {
      empty_response(stream, shared, &resource.cancel, "403 Forbidden", "").await;
      return;
    }
    Err(error) => {
      empty_response(stream, shared, &resource.cancel, file_error(&error), "").await;
      return;
    }
  };
  let length = metadata.len();
  let selection = select_range(if request.method == "HEAD" { None } else { request.range.as_deref() }, length);
  let (status, start, count, content_range) = match selection {
    RangeSelection::Full => ("200 OK", 0, length, String::new()),
    RangeSelection::Partial { start, end } => (
      "206 Partial Content", start, end - start + 1,
      format!("Content-Range: bytes {start}-{end}/{length}\r\n"),
    ),
    RangeSelection::Unsatisfiable => {
      empty_response(stream, shared, &resource.cancel, "416 Range Not Satisfiable", &format!("Content-Range: bytes */{length}\r\n")).await;
      return;
    }
  };
  if start != 0 && operation(shared, &resource.cancel, file.seek(SeekFrom::Start(start))).await.is_err() {
    empty_response(stream, shared, &resource.cancel, "500 Internal Server Error", "").await;
    return;
  }
  let extra = format!("Content-Type: {}\r\nAccept-Ranges: bytes\r\n{content_range}", resource.mime);
  if write_bytes(stream, response_headers(status, count, &extra).as_bytes(), shared, &resource.cancel).await.is_err() || request.method == "HEAD" {
    return;
  }
  let mut remaining = count;
  let mut buffer = [0u8; 64 * 1024];
  while remaining > 0 {
    let size = remaining.min(buffer.len() as u64) as usize;
    let count = match operation(shared, &resource.cancel, file.read(&mut buffer[..size])).await {
      Ok(0) | Err(_) => return,
      Ok(count) => count,
    };
    if write_bytes(stream, &buffer[..count], shared, &resource.cancel).await.is_err() {
      return;
    }
    remaining -= count as u64;
  }
}

#[derive(Debug, PartialEq, Eq)]
enum RangeSelection {
  Full,
  Partial { start: u64, end: u64 },
  Unsatisfiable,
}

fn parse_decimal(value: &str) -> Option<u64> {
  if value.is_empty() || !value.bytes().all(|byte| byte.is_ascii_digit()) {
    return None;
  }
  value.parse().ok()
}

fn select_range(value: Option<&str>, file_len: u64) -> RangeSelection {
  let Some(value) = value.and_then(|value| value.strip_prefix("bytes=")) else { return RangeSelection::Full; };
  let Some((start, end)) = value.split_once('-') else { return RangeSelection::Full; };
  if start.is_empty() {
    let Some(suffix) = parse_decimal(end) else { return RangeSelection::Full; };
    if file_len == 0 || suffix == 0 {
      return RangeSelection::Unsatisfiable;
    }
    return RangeSelection::Partial { start: file_len.saturating_sub(suffix), end: file_len - 1 };
  }
  let Some(start) = parse_decimal(start) else { return RangeSelection::Full; };
  let end = if end.is_empty() {
    None
  } else {
    let Some(end) = parse_decimal(end) else { return RangeSelection::Full; };
    if end < start {
      return RangeSelection::Full;
    }
    Some(end)
  };
  if file_len == 0 || start >= file_len {
    return RangeSelection::Unsatisfiable;
  }
  RangeSelection::Partial { start, end: end.unwrap_or(file_len - 1).min(file_len - 1) }
}

pub(crate) fn mime_for_path(path: &Path) -> &'static str {
  match path.extension().and_then(|ext| ext.to_str()).unwrap_or("").to_ascii_lowercase().as_str() {
    "mp4" | "m4v" => "video/mp4",
    "mkv" => "video/x-matroska",
    "webm" => "video/webm",
    "mov" => "video/quicktime",
    "avi" => "video/x-msvideo",
    "ts" | "mts" | "m2ts" => "video/mp2t",
    "mpeg" | "mpg" | "vob" => "video/mpeg",
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
  }
}


#[cfg(test)]
mod tests {
  use super::*;
  use std::io::Write as _;

  fn short_config() -> ServerConfig {
    ServerConfig {
      header_timeout: Duration::from_millis(500),
      inactivity_timeout: Duration::from_millis(300),
      ..ServerConfig::default()
    }
  }

  async fn spawn_server() -> (Arc<MediaServer>, String) {
    spawn_server_with(ServerConfig::default()).await
  }

  async fn spawn_server_with(config: ServerConfig) -> (Arc<MediaServer>, String) {
    let server = MediaServer::start_with_config(config).await.expect("server starts");
    let origin = server.origin.clone();
    (Arc::new(server), origin)
  }

  async fn connect(origin: &str) -> tokio::net::TcpStream {
    tokio::net::TcpStream::connect(origin.trim_start_matches("http://")).await.unwrap()
  }

  async fn raw_request(origin: &str, raw: &[u8]) -> (u16, String, Vec<u8>) {
    let mut stream = connect(origin).await;
    stream.write_all(raw).await.unwrap();
    let mut bytes = Vec::new();
    loop {
      let mut chunk = [0u8; 4096];
      let count = stream.read(&mut chunk).await.expect("response read");
      if count == 0 { break; }
      bytes.extend_from_slice(&chunk[..count]);
    }
    let split = bytes.windows(4).position(|window| window == b"\r\n\r\n").expect("header terminator");
    let head = String::from_utf8_lossy(&bytes[..split]).to_string();
    let status: u16 = head[9..12].parse().unwrap();
    (status, head, bytes[split + 4..].to_vec())
  }

  async fn write_fixture(path: &Path, data: &[u8]) {
    let mut file = std::fs::File::create(path).expect("fixture file");
    file.write_all(data).expect("fixture write");
  }

  #[tokio::test]
  async fn full_get_returns_200_with_exact_bytes() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("clip.mp4");
    write_fixture(&path, b"0123456789").await;
    let (server, origin) = spawn_server().await;
    let url = server.register(path, "video/mp4".into(), None).await.unwrap();
    let route = url.strip_prefix(&origin).unwrap();
    let raw = format!("GET {route} HTTP/1.1\r\nHost: t\r\n\r\n");
    let (status, head, body) = raw_request(&origin, raw.as_bytes()).await;
    assert_eq!(status, 200);
    assert_eq!(body, b"0123456789");
    assert!(head.contains("Content-Length: 10"));
    assert!(head.contains("Content-Type: video/mp4"));
    assert!(head.contains("Connection: close"));
    server.shutdown().await;
  }

  #[tokio::test]
  async fn head_sends_metadata_without_body() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("clip.mp4");
    write_fixture(&path, b"0123456789").await;
    let (server, origin) = spawn_server().await;
    let url = server.register(path, "video/mp4".into(), None).await.unwrap();
    let route = url.strip_prefix(&origin).unwrap();
    let raw = format!("HEAD {route} HTTP/1.1\r\nHost: t\r\n\r\n");
    let (status, head, body) = raw_request(&origin, raw.as_bytes()).await;
    assert_eq!(status, 200);
    assert!(head.contains("Content-Length: 10"));
    assert!(body.is_empty());
    server.shutdown().await;
  }

  #[tokio::test]
  async fn byte_ranges_select_closed_open_and_suffix_forms() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("clip.mp4");
    write_fixture(&path, b"0123456789").await;
    let (server, origin) = spawn_server().await;
    let url = server.register(path, "video/mp4".into(), None).await.unwrap();
    let route = url.strip_prefix(&origin).unwrap();

    let cases: &[(&str, &[u8], &str)] = &[
      ("bytes=2-4", b"234", "Content-Range: bytes 2-4/10"),
      ("bytes=5-", b"56789", "Content-Range: bytes 5-9/10"),
      ("bytes=-3", b"789", "Content-Range: bytes 7-9/10"),
      ("bytes=8-50", b"89", "Content-Range: bytes 8-9/10"),
    ];
    for (range, expected, content_range) in cases {
      let raw = format!("GET {route} HTTP/1.1\r\nHost: t\r\nRange: {range}\r\n\r\n");
      let (status, head, body) = raw_request(&origin, raw.as_bytes()).await;
      assert_eq!(status, 206, "range {range}");
      assert_eq!(body, *expected, "range {range}");
      assert!(head.contains(content_range), "range {range}: {head}");
    }
    server.shutdown().await;
  }

  #[tokio::test]
  async fn unsatisfiable_and_ignored_ranges_follow_contract() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("clip.mp4");
    write_fixture(&path, b"0123456789").await;
    let (server, origin) = spawn_server().await;
    let url = server.register(path, "video/mp4".into(), None).await.unwrap();
    let route = url.strip_prefix(&origin).unwrap();

    for range in ["bytes=10-12", "bytes=-0", "bytes=0-"] {
      // bytes=0- over a ten-byte file is satisfiable; only the first two are 416.
      let raw = format!("GET {route} HTTP/1.1\r\nHost: t\r\nRange: {range}\r\n\r\n");
      let (status, head, body) = raw_request(&origin, raw.as_bytes()).await;
      if range == "bytes=0-" {
        assert_eq!(status, 206);
        assert_eq!(body, b"0123456789");
      } else {
        assert_eq!(status, 416, "range {range}");
        assert!(head.contains(&format!("Content-Range: bytes */10")), "{head}");
        assert!(body.is_empty(), "416 must have a zero body");
      }
    }

    // Reversed, malformed and multi-range requests fall back to a full 200.
    for range in ["bytes=9-2", "bytes=x-y", "bytes=0-2,5-7", "items=0-2", "bytes=0-1\r\nRange: bytes=3-4"] {
      let raw = format!("GET {route} HTTP/1.1\r\nHost: t\r\nRange: {range}\r\n\r\n");
      let (status, _, body) = raw_request(&origin, raw.as_bytes()).await;
      assert_eq!(status, 200, "range {range}");
      assert_eq!(body, b"0123456789", "range {range}");
    }

    // If-Range is unsupported: presence ignores Range entirely.
    let raw = format!("GET {route} HTTP/1.1\r\nHost: t\r\nRange: bytes=0-2\r\nIf-Range: \"x\"\r\n\r\n");
    let (status, _, body) = raw_request(&origin, raw.as_bytes()).await;
    assert_eq!(status, 200);
    assert_eq!(body, b"0123456789");
    server.shutdown().await;
  }

  #[tokio::test]
  async fn empty_file_serves_200_and_rejects_ranges() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("empty.mp4");
    write_fixture(&path, b"").await;
    let (server, origin) = spawn_server().await;
    let url = server.register(path, "video/mp4".into(), None).await.unwrap();
    let route = url.strip_prefix(&origin).unwrap();

    let raw = format!("GET {route} HTTP/1.1\r\nHost: t\r\n\r\n");
    let (status, head, body) = raw_request(&origin, raw.as_bytes()).await;
    assert_eq!(status, 200);
    assert!(head.contains("Content-Length: 0"));
    assert!(body.is_empty());

    let raw = format!("GET {route} HTTP/1.1\r\nHost: t\r\nRange: bytes=0-1\r\n\r\n");
    let (status, head, _) = raw_request(&origin, raw.as_bytes()).await;
    assert_eq!(status, 416);
    assert!(head.contains("Content-Range: bytes */0"));
    server.shutdown().await;
  }

  #[tokio::test]
  async fn options_and_methods_follow_route_policy() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("clip.mp4");
    write_fixture(&path, b"data").await;
    let (server, origin) = spawn_server().await;
    let url = server.register(path, "video/mp4".into(), None).await.unwrap();
    let route = url.strip_prefix(&origin).unwrap();

    let raw = format!("OPTIONS {route} HTTP/1.1\r\nHost: t\r\n\r\n");
    let (status, _, body) = raw_request(&origin, raw.as_bytes()).await;
    assert_eq!(status, 204);
    assert!(body.is_empty());

    let raw = format!("POST {route} HTTP/1.1\r\nHost: t\r\n\r\n");
    let (status, head, _) = raw_request(&origin, raw.as_bytes()).await;
    assert_eq!(status, 405);
    assert!(head.contains("Allow: GET, HEAD, OPTIONS"));

    let raw = format!("DELETE {route} HTTP/1.1\r\nHost: t\r\n\r\n");
    let (status, _, _) = raw_request(&origin, raw.as_bytes()).await;
    assert_eq!(status, 405);

    let raw = "GET /media/0000000000000000000000000000000000000000000000000000000000000000 HTTP/1.1\r\nHost: t\r\n\r\n";
    let (status, _, _) = raw_request(&origin, raw.as_bytes()).await;
    assert_eq!(status, 404);

    let raw = format!("GET {route} HTTP/1.1\r\nHost: t\r\nContent-Length: 5\r\n\r\nhello");
    let (status, _, _) = raw_request(&origin, raw.as_bytes()).await;
    assert_eq!(status, 400);
    server.shutdown().await;
  }

  #[tokio::test]
  async fn missing_registered_file_returns_404() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("gone.mp4");
    write_fixture(&path, b"data").await;
    let (server, origin) = spawn_server().await;
    let url = server.register(path, "video/mp4".into(), None).await.unwrap();
    let route = url.strip_prefix(&origin).unwrap();
    std::fs::remove_file(dir.path().join("gone.mp4")).unwrap();
    let raw = format!("GET {route} HTTP/1.1\r\nHost: t\r\n\r\n");
    let (status, _, _) = raw_request(&origin, raw.as_bytes()).await;
    assert_eq!(status, 404);
    server.shutdown().await;
  }

  #[tokio::test]
  async fn revocation_blocks_new_readers_and_frees_entry() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("clip.mp4");
    let data = vec![9u8; 8 * 1024 * 1024];
    write_fixture(&path, &data).await;
    let (server, origin) = spawn_server().await;
    let url = server.register(path, "video/mp4".into(), None).await.unwrap();
    let route = url.strip_prefix(&origin).unwrap();

    // Start a real transfer that cannot complete: 8 MiB against a socket
    // whose buffers are never drained, so the reader lease is provably
    // still held when revocation is requested.
    let mut stream = connect(&origin).await;
    let raw = format!("GET {route} HTTP/1.1\r\nHost: t\r\n\r\n");
    stream.write_all(raw.as_bytes()).await.unwrap();
    let mut chunk = [0u8; 16];
    stream.read(&mut chunk).await.unwrap();

    let revoked = tokio::spawn({
      let server = Arc::clone(&server);
      let url = url.clone();
      async move { server.revoke(&url).await }
    });
    // Revocation cancels the active transfer and settles only after the
    // reader lease is gone; then the capability is gone for new readers.
    tokio::time::timeout(Duration::from_secs(5), revoked).await
      .expect("revoke settles despite active transfer")
      .expect("revoke succeeds");
    drop(stream);

    let raw = format!("GET {route} HTTP/1.1\r\nHost: t\r\n\r\n");
    let (status, _, _) = raw_request(&origin, raw.as_bytes()).await;
    assert_eq!(status, 404);
    server.shutdown().await;
  }

  #[tokio::test]
  async fn incremental_request_completes_only_after_full_headers() {
    // Feed a valid request in tiny delayed chunks; the server must not
    // respond before the complete header block arrives.
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("clip.mp4");
    write_fixture(&path, b"z").await;
    let (server, origin) = spawn_server().await;
    let url = server.register(path, "video/mp4".into(), None).await.unwrap();
    let route = url.strip_prefix(&origin).unwrap();
    let request = format!("GET {route} HTTP/1.1\r\nHost: t\r\n\r\n").into_bytes();

    let mut stream = connect(&origin).await;
    for byte in request {
      stream.write_all(&[byte]).await.unwrap();
      tokio::time::sleep(Duration::from_millis(5)).await;
    }
    let mut bytes = Vec::new();
    tokio::time::timeout(Duration::from_secs(5), async {
      loop {
        let mut chunk = [0u8; 1024];
        let count = stream.read(&mut chunk).await.unwrap();
        if count == 0 { break; }
        bytes.extend_from_slice(&chunk[..count]);
      }
    }).await.expect("complete request gets a response");
    assert!(bytes.starts_with(b"HTTP/1.1 200"));
    server.shutdown().await;
  }

  #[tokio::test]
  async fn header_limits_reject_oversized_requests() {
    let (server, origin) = spawn_server_with(ServerConfig {
      header_count: 2,
      ..short_config()
    }).await;
    let raw = "GET /media/x HTTP/1.1\r\nA: 1\r\nB: 2\r\nC: 3\r\n\r\n";
    let (status, _, _) = raw_request(&origin, raw.as_bytes()).await;
    assert_eq!(status, 431);
    server.shutdown().await;
  }

  #[tokio::test]
  async fn header_deadline_closes_silent_connections() {
    let (server, origin) = spawn_server_with(short_config()).await;
    let mut stream = connect(&origin).await;
    // Send only the request line, never the terminator, and stay silent.
    stream.write_all(b"GET / HTTP/1.1\r\n").await.unwrap();
    let started = std::time::Instant::now();
    let mut bytes = Vec::new();
    let count = tokio::time::timeout(Duration::from_secs(5), stream.read_to_end(&mut bytes)).await;
    assert!(count.is_ok(), "connection closes at deadline");
    assert_eq!(count.unwrap().unwrap(), 0);
    assert!(started.elapsed() < Duration::from_secs(5), "closed by header timeout, not test timeout");
    server.shutdown().await;
  }

  #[test]
  fn range_parser_follows_full_partial_unsatisfiable_contract() {
    let len = 10;
    assert_eq!(select_range(None, len), RangeSelection::Full);
    assert_eq!(select_range(Some("items=0-2"), len), RangeSelection::Full);
    assert_eq!(select_range(Some("bytes=0-2"), len), RangeSelection::Partial { start: 0, end: 2 });
    assert_eq!(select_range(Some("bytes=5-99"), len), RangeSelection::Partial { start: 5, end: 9 });
    assert_eq!(select_range(Some("bytes=5-"), len), RangeSelection::Partial { start: 5, end: 9 });
    assert_eq!(select_range(Some("bytes=-4"), len), RangeSelection::Partial { start: 6, end: 9 });
    assert_eq!(select_range(Some("bytes=-10"), len), RangeSelection::Partial { start: 0, end: 9 });
    assert_eq!(select_range(Some("bytes=9-2"), len), RangeSelection::Full);
    assert_eq!(select_range(Some("bytes=10-"), len), RangeSelection::Unsatisfiable);
    assert_eq!(select_range(Some("bytes=-0"), len), RangeSelection::Unsatisfiable);
    assert_eq!(select_range(Some("bytes=0-2,5-7"), len), RangeSelection::Full);
    assert_eq!(select_range(Some("bytes=0-2"), 0), RangeSelection::Unsatisfiable);
    assert_eq!(select_range(Some("bytes=-5"), 0), RangeSelection::Unsatisfiable);
    // Overflowed numbers are treated as malformed, never as another range.
    assert_eq!(select_range(Some("bytes=99999999999999999999999-"), len), RangeSelection::Full);
  }

  #[test]
  fn mime_classification_covers_video_and_audio_names() {
    assert_eq!(mime_for_path(Path::new("a.MP4")), "video/mp4");
    assert_eq!(mime_for_path(Path::new("movie.vob")), "video/mpeg");
    assert_eq!(mime_for_path(Path::new("song.flac")), "audio/flac");
    assert_eq!(mime_for_path(Path::new("unknown.xyz")), "application/octet-stream");
    assert_eq!(mime_for_path(Path::new("noext")), "application/octet-stream");
  }
}
