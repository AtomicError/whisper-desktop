use std::collections::{HashMap, HashSet, VecDeque};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use std::time::{Duration, SystemTime};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::AsyncReadExt;
use tokio::sync::{Mutex, Semaphore};
use tokio::time::Instant;
use tokio_util::sync::CancellationToken;
use crate::video_server::{mime_for_path, MediaServer};

const MAX_REQUEST_ID: u64 = 9_007_199_254_740_991;
const JSON_LIMIT: usize = 8 * 1024 * 1024;
const DIAGNOSTIC_LIMIT: usize = 64 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SourceInfo {
    pub width: u32,
    pub height: u32,
    pub display_width: f64,
    pub display_height: f64,
    pub duration_sec: Option<f64>,
    pub video_stream_index: u32,
    pub audio_stream_index: Option<u32>,
    pub start_time_sec: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum PreviewErrorCode {
    Cancelled, SourceMissing, SourceInvalid, ToolsUnavailable, ProbeFailed,
    EncoderUnavailable, ConversionFailed, StorageFailed, StaleRequest, NoCompatiblePreview,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PreviewError {
    pub code: PreviewErrorCode,
    pub detail: String,
}

impl PreviewError {
    fn new(code: PreviewErrorCode, detail: impl Into<String>) -> Self {
        let detail = detail.into();
        Self { code, detail: detail.chars().take(DIAGNOSTIC_LIMIT).collect() }
    }
    fn cancelled() -> Self { Self::new(PreviewErrorCode::Cancelled, "Preview cancelled") }
}

type Result<T, E = PreviewError> = std::result::Result<T, E>;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
enum Stage { Direct, Remux, Mp4, Webm }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PreviewCandidate {
    request_id: u64,
    candidate_id: String,
    url: String,
    stage: Stage,
    source: Option<SourceInfo>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PreviewProgress {
    request_id: u64,
    stage: &'static str,
    progress: Option<f64>,
}

#[derive(Debug, Clone)]
pub(crate) struct ProbedSource {
    pub source: SourceInfo,
    pub rotation_degrees: i32,
    video_codec: String,
    profile: String,
    pixel_format: String,
    level: u32,
    transfer: String,
    field_order: String,
    frame_rate: Option<f64>,
    audio_codec: String,
    audio_profile: String,
    audio_channels: u32,
    audio_sample_rate: u32,
}

#[derive(Hash, PartialEq, Eq)]
struct ProbeKey { path: PathBuf, size: u64, modified: SystemTime }

struct SessionData {
    candidate: Option<PreviewCandidate>,
    original_url: Option<String>,
    directory: Option<Arc<tempfile::TempDir>>,
    attempted: HashSet<Stage>,
}

struct Session {
    request_id: u64,
    path: PathBuf,
    cancel: CancellationToken,
    // Holding this lease owns any process and publication. Release cancels first,
    // then waits here, so child reaping and HTTP readers precede directory removal.
    operation: Mutex<SessionData>,
}

impl Session {
    fn claim_candidate(&self, candidate_id: &str) -> Result<tokio::sync::MutexGuard<'_, SessionData>> {
        let data = self.operation.try_lock().map_err(|_| PreviewError::new(PreviewErrorCode::StaleRequest, "Preview operation already pending"))?;
        check_cancel(&self.cancel)?;
        if !data.candidate.as_ref().is_some_and(|c| c.candidate_id == candidate_id) {
            return Err(PreviewError::new(PreviewErrorCode::StaleRequest, "Preview candidate is stale"));
        }
        Ok(data)
    }
}

#[derive(Default)]
struct Sessions { latest: u64, sessions: HashMap<u64, Arc<Session>> }

pub(crate) struct PreviewState {
    server: Arc<MediaServer>,
    sessions: Mutex<Sessions>,
    probes: Mutex<HashMap<ProbeKey, ProbedSource>>,
    probe_leases: tokio::sync::RwLock<()>,
    conversion: Semaphore,
    root: PathBuf,
    shutdown: CancellationToken,
}

impl PreviewState {
    pub(crate) fn new(server: Arc<MediaServer>, root: PathBuf) -> Self {
        Self { server, sessions: Mutex::new(Sessions::default()), probes: Mutex::new(HashMap::new()),
            probe_leases: tokio::sync::RwLock::new(()), conversion: Semaphore::new(1), root, shutdown: CancellationToken::new() }
    }

    async fn create_session(&self, request_id: u64, path: PathBuf) -> Result<(Arc<Session>, Vec<Arc<Session>>)> {
        let mut state = self.sessions.lock().await;
        if self.shutdown.is_cancelled() { return Err(PreviewError::cancelled()); }
        if request_id == 0 || request_id > MAX_REQUEST_ID || request_id <= state.latest {
            return Err(PreviewError::new(PreviewErrorCode::StaleRequest, "Preview request is stale or invalid"));
        }
        state.latest = request_id;
        let older: Vec<_> = state.sessions.values().cloned().collect();
        for session in &older { session.cancel.cancel(); }
        let session = Arc::new(Session { request_id, path, cancel: self.shutdown.child_token(),
            operation: Mutex::new(SessionData { candidate: None, original_url: None, directory: None, attempted: HashSet::new() }) });
        state.sessions.insert(request_id, session.clone());
        Ok((session, older))
    }

    async fn release_session(&self, session: &Arc<Session>) {
        session.cancel.cancel();
        let mut data = session.operation.lock().await;
        if let Some(candidate) = data.candidate.take() { self.server.revoke(&candidate.url).await; }
        if let Some(url) = data.original_url.take() { self.server.revoke(&url).await; }
        data.directory.take();
        let mut state = self.sessions.lock().await;
        if state.sessions.get(&session.request_id).is_some_and(|s| Arc::ptr_eq(s, session)) {
            state.sessions.remove(&session.request_id);
        }
    }

    async fn begin(&self, request_id: u64, path: PathBuf) -> Result<PreviewCandidate> {
        let (session, older) = self.create_session(request_id, path).await?;
        for old in older { self.release_session(&old).await; }
        let result = async {
            let mut data = session.operation.lock().await;
            check_cancel(&session.cancel)?;
            let path = canonical_source(&session.path).await?.path;
            check_cancel(&session.cancel)?;
            let id = candidate_id_new()?;
            let url = self.server.register(path.clone(), mime_for_path(&path).into(), None).await
                .map_err(|e| PreviewError::new(PreviewErrorCode::SourceInvalid, e))?;
            if session.cancel.is_cancelled() {
                self.server.revoke(&url).await;
                return Err(PreviewError::cancelled());
            }
            let candidate = PreviewCandidate { request_id, candidate_id: id, url: url.clone(), stage: Stage::Direct, source: None };
            data.original_url = Some(url);
            data.attempted.insert(Stage::Direct);
            data.candidate = Some(candidate.clone());
            Ok(candidate)
        }.await;
        if result.is_err() { self.release_session(&session).await; }
        result
    }

    async fn release(&self, request_id: u64) {
        let session = {
            let mut state = self.sessions.lock().await;
            // A release can reach IPC before its begin. The high-water mark is a
            // cancellation tombstone without an unbounded set of old request IDs.
            if request_id <= MAX_REQUEST_ID { state.latest = state.latest.max(request_id); }
            state.sessions.get(&request_id).cloned()
        };
        if let Some(session) = session { self.release_session(&session).await; }
    }

    pub(crate) async fn shutdown(&self) {
        self.shutdown.cancel();
        let sessions: Vec<_> = self.sessions.lock().await.sessions.values().cloned().collect();
        for session in sessions { self.release_session(&session).await; }
        // Standalone metadata requests also own children; do not let app exit
        // race their bounded pipe drain and reap.
        let _probes_settled = self.probe_leases.write().await;
        self.probes.lock().await.clear();
    }

    async fn probe(&self, app: &AppHandle, path: &Path, cancel: CancellationToken) -> Result<ProbedSource> {
        let _lease = self.probe_leases.read().await;
        check_cancel(&self.shutdown)?;
        check_cancel(&cancel)?;
        let key = canonical_source(path).await?;
        if let Some(cached) = self.probes.lock().await.get(&key).cloned() { return Ok(cached); }
        let binary = resolve_tool(app, false, &cancel).await?;
        let source = probe_with_binary(&binary, &key.path, cancel.clone()).await?;
        check_cancel(&cancel)?;
        let mut cache = self.probes.lock().await;
        cache.retain(|old, _| old.path != key.path);
        if cache.len() >= 32 { cache.clear(); }
        cache.insert(key, source.clone());
        Ok(source)
    }

    async fn advance(&self, app: &AppHandle, request_id: u64, candidate_id: &str, mp4: bool, webm: bool) -> Result<PreviewCandidate> {
        let session = self.sessions.lock().await.sessions.get(&request_id).cloned()
            .ok_or_else(|| PreviewError::new(PreviewErrorCode::StaleRequest, "Preview session no longer exists"))?;
        // Duplicate error events must not queue another conversion.
        let mut data = session.claim_candidate(candidate_id)?;
        if let Some(previous) = data.candidate.take() {
            if previous.stage != Stage::Direct {
                self.server.revoke(&previous.url).await;
                if let Some(directory) = &data.directory {
                    let extension = if previous.stage == Stage::Webm { "webm" } else { "mp4" };
                    let _ = tokio::fs::remove_file(directory.path().join(format!("candidate.{extension}"))).await;
                }
            }
        }
        emit(app, request_id, "probing", None);
        let source = self.probe(app, &session.path, session.cancel.clone()).await?;
        let ffmpeg = resolve_tool(app, true, &session.cancel).await?;
        let ffprobe = resolve_tool(app, false, &session.cancel).await?;
        let input = canonical_source(&session.path).await?.path;
        let _permit = tokio::select! {
            _ = session.cancel.cancelled() => return Err(PreviewError::cancelled()),
            permit = self.conversion.acquire() => permit.map_err(|_| PreviewError::cancelled())?,
        };
        if data.directory.is_none() {
            tokio::fs::create_dir_all(&self.root).await.map_err(storage_error)?;
            let directory = tempfile::Builder::new().prefix("session-").tempdir_in(&self.root).map_err(storage_error)?;
            data.directory = Some(Arc::new(directory));
        }
        let directory = data.directory.as_ref().unwrap().clone();
        let capabilities = capabilities_with_binary(&ffmpeg, session.cancel.clone()).await?;
        let stages = stages_for(&source, mp4, webm);
        let mut last_error = PreviewError::new(PreviewErrorCode::NoCompatiblePreview, "No compatible preview remains");
        for stage in stages {
            if !data.attempted.insert(stage) { continue; }
            check_cancel(&session.cancel)?;
            let extension = if stage == Stage::Webm { "webm" } else { "mp4" };
            let partial = directory.path().join(format!("candidate.partial.{extension}"));
            let finalized = directory.path().join(format!("candidate.{extension}"));
            let stage_name = match stage { Stage::Remux => "remux", Stage::Mp4 => "mp4", Stage::Webm => "webm", Stage::Direct => unreachable!() };
            emit(app, request_id, stage_name, Some(0.0));
            if let Err(error) = capabilities.require(stage, &source) {
                last_error = error;
                continue;
            }
            let result = async {
                prepare_artifact(&ffmpeg, &ffprobe, &input, &partial, &finalized, stage, &source, &capabilities, session.cancel.clone(), |progress, finalizing| {
                    emit(app, request_id, if finalizing { "finalizing" } else { stage_name }, progress);
                }).await?;
                let id = candidate_id_new()?;
                let url = self.server.register(finalized.clone(), mime_for_path(&finalized).into(), Some(directory.clone())).await
                    .map_err(|e| PreviewError::new(PreviewErrorCode::StorageFailed, e))?;
                if session.cancel.is_cancelled() {
                    self.server.revoke(&url).await;
                    return Err(PreviewError::cancelled());
                }
                Ok(PreviewCandidate { request_id, candidate_id: id, url, stage, source: Some(source.source.clone()) })
            }.await;
            match result {
                Ok(candidate) => { data.candidate = Some(candidate.clone()); return Ok(candidate); }
                Err(error) => {
                    let _ = tokio::fs::remove_file(&partial).await;
                    let _ = tokio::fs::remove_file(&finalized).await;
                    if error.code == PreviewErrorCode::Cancelled { return Err(error); }
                    last_error = error;
                }
            }
        }
        if matches!(last_error.code, PreviewErrorCode::ToolsUnavailable | PreviewErrorCode::EncoderUnavailable | PreviewErrorCode::StorageFailed) {
            Err(last_error)
        } else {
            Err(PreviewError::new(PreviewErrorCode::NoCompatiblePreview, last_error.detail))
        }
    }
}

fn check_cancel(cancel: &CancellationToken) -> Result<()> {
    if cancel.is_cancelled() { Err(PreviewError::cancelled()) } else { Ok(()) }
}

fn candidate_id_new() -> Result<String> {
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes).map_err(|e| PreviewError::new(PreviewErrorCode::StorageFailed, e.to_string()))?;
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut id = String::with_capacity(32);
    for byte in bytes {
        id.push(HEX[(byte >> 4) as usize] as char);
        id.push(HEX[(byte & 15) as usize] as char);
    }
    Ok(id)
}

fn emit(app: &AppHandle, request_id: u64, stage: &'static str, progress: Option<f64>) {
    let _ = app.emit("hardsub-preview-progress", PreviewProgress { request_id, stage, progress });
}

fn storage_error(error: std::io::Error) -> PreviewError { PreviewError::new(PreviewErrorCode::StorageFailed, error.to_string()) }

async fn canonical_source(path: &Path) -> Result<ProbeKey> {
    let path = tokio::fs::canonicalize(path).await.map_err(|e| PreviewError::new(
        if e.kind() == std::io::ErrorKind::NotFound { PreviewErrorCode::SourceMissing } else { PreviewErrorCode::SourceInvalid }, e.to_string()))?;
    let file = tokio::fs::File::open(&path).await.map_err(|e| PreviewError::new(PreviewErrorCode::SourceInvalid, e.to_string()))?;
    let metadata = file.metadata().await.map_err(|e| PreviewError::new(PreviewErrorCode::SourceInvalid, e.to_string()))?;
    if !metadata.is_file() { return Err(PreviewError::new(PreviewErrorCode::SourceInvalid, "Source is not a regular file")); }
    let modified = metadata.modified().map_err(|e| PreviewError::new(PreviewErrorCode::SourceInvalid, e.to_string()))?;
    Ok(ProbeKey { path, size: metadata.len(), modified })
}

async fn resolve_tool(app: &AppHandle, ffmpeg: bool, cancel: &CancellationToken) -> Result<PathBuf> {
    let app = app.clone();
    let mut task = tokio::task::spawn_blocking(move || {
        if ffmpeg { crate::ffmpeg_resolver::ensure_ffmpeg_available(Some(&app)) }
        else { crate::ffmpeg_resolver::ensure_ffprobe_available(Some(&app)) }
    });
    tokio::select! {
        _ = cancel.cancelled() => {
            // Resolver calls are bounded. Retain ownership until their version
            // child is reaped rather than detaching a blocking subprocess.
            let _ = task.await;
            Err(PreviewError::cancelled())
        },
        result = &mut task => result.map_err(|e| PreviewError::new(PreviewErrorCode::ToolsUnavailable, e.to_string()))?
            .map_err(|e| PreviewError::new(PreviewErrorCode::ToolsUnavailable, e)),
    }
}

#[tauri::command]
pub(crate) async fn begin_hardsub_preview(_app: AppHandle, state: State<'_, PreviewState>, request_id: u64, source_path: String) -> Result<PreviewCandidate> {
    state.begin(request_id, PathBuf::from(source_path)).await
}

#[tauri::command]
pub(crate) async fn advance_hardsub_preview(app: AppHandle, state: State<'_, PreviewState>, request_id: u64, candidate_id: String, mp4_supported: bool, webm_supported: bool) -> Result<PreviewCandidate> {
    state.advance(&app, request_id, &candidate_id, mp4_supported, webm_supported).await
}

#[tauri::command]
pub(crate) async fn release_hardsub_preview(state: State<'_, PreviewState>, request_id: u64) -> std::result::Result<(), String> {
    state.release(request_id).await;
    Ok(())
}

#[tauri::command]
pub(crate) async fn probe_hardsub_source(app: AppHandle, source_path: String) -> Result<SourceInfo> {
    let state = app.state::<PreviewState>();
    Ok(state.probe(&app, Path::new(&source_path), state.shutdown.child_token()).await?.source)
}

pub(crate) async fn probe_source_metadata(app: &AppHandle, path: &Path, cancel: CancellationToken) -> Result<ProbedSource> {
    app.state::<PreviewState>().probe(app, path, cancel).await
}

fn number(value: &Value) -> Option<f64> {
    value.as_f64().or_else(|| value.as_str()?.parse().ok()).filter(|n| n.is_finite())
}
fn rational(value: &Value) -> Option<f64> {
    let text = value.as_str()?;
    let (a, b) = text.split_once('/').or_else(|| text.split_once(':'))?;
    let result = a.parse::<f64>().ok()? / b.parse::<f64>().ok()?;
    (result.is_finite() && result > 0.0).then_some(result)
}
fn uint(value: &Value) -> u32 { number(value).filter(|n| *n >= 0.0 && *n <= u32::MAX as f64).unwrap_or(0.0) as u32 }
fn text(value: &Value) -> String { value.as_str().unwrap_or("").to_owned() }

fn parse_probe(bytes: &[u8]) -> Result<ProbedSource> {
    let root: Value = serde_json::from_slice(bytes).map_err(|e| PreviewError::new(PreviewErrorCode::ProbeFailed, e.to_string()))?;
    let streams = root["streams"].as_array().ok_or_else(|| PreviewError::new(PreviewErrorCode::SourceInvalid, "No media streams"))?;
    let video = streams.iter().filter(|s| s["codec_type"] == "video" && uint(&s["disposition"]["attached_pic"]) == 0 && uint(&s["width"]) > 0 && uint(&s["height"]) > 0)
        .max_by_key(|s| (u64::from(uint(&s["width"])) * u64::from(uint(&s["height"])), std::cmp::Reverse(uint(&s["index"]))))
        .ok_or_else(|| PreviewError::new(PreviewErrorCode::SourceInvalid, "Source has no real video stream"))?;
    let audio = streams.iter().filter(|s| s["codec_type"] == "audio")
        .max_by_key(|s| (uint(&s["channels"]), std::cmp::Reverse(uint(&s["index"]))));
    let width = uint(&video["width"]);
    let height = uint(&video["height"]);
    let sar = rational(&video["sample_aspect_ratio"]).unwrap_or(1.0);
    let rotation = video["side_data_list"].as_array().and_then(|side| side.iter().find_map(|s| number(&s["rotation"])))
        .or_else(|| number(&video["tags"]["rotate"])).unwrap_or(0.0);
    let rotation_degrees = (rotation.round() as i32).rem_euclid(360);
    let angle = rotation.to_radians();
    let display_width = (width as f64 * sar * angle.cos().abs() + height as f64 * angle.sin().abs()).max(1.0);
    let display_height = (width as f64 * sar * angle.sin().abs() + height as f64 * angle.cos().abs()).max(1.0);
    if !display_width.is_finite() || !display_height.is_finite() { return Err(PreviewError::new(PreviewErrorCode::SourceInvalid, "Invalid display geometry")); }
    let start_time_sec = number(&root["format"]["start_time"]).or_else(|| number(&video["start_time"])).unwrap_or(0.0);
    // Matroska DURATION tags are stream end timestamps, including a nonzero
    // origin. FFmpeg's normalized output duration is the span from that origin.
    let tagged_span = if root["format"]["format_name"].as_str().is_some_and(|name| name.split(',').any(|part| part == "matroska" || part == "webm")) {
        [Some(video), audio].into_iter().flatten()
            .filter_map(|stream| stream["tags"]["DURATION"].as_str())
            .filter_map(|tag| progress_time(&format!("out_time={tag}")))
            .map(|end| end - start_time_sec).filter(|span| *span > 0.0)
            .reduce(f64::max)
    } else { None };
    let duration_sec = tagged_span.or_else(|| number(&root["format"]["duration"]).filter(|n| *n > 0.0))
        .or_else(|| number(&video["duration"]).filter(|n| *n > 0.0));
    let empty = Value::Null;
    let audio_value = audio.unwrap_or(&empty);
    Ok(ProbedSource {
        source: SourceInfo { width, height, display_width, display_height, duration_sec, video_stream_index: uint(&video["index"]), audio_stream_index: audio.map(|s| uint(&s["index"])), start_time_sec },
        rotation_degrees, video_codec: text(&video["codec_name"]), profile: text(&video["profile"]), pixel_format: text(&video["pix_fmt"]), level: uint(&video["level"]),
        transfer: text(&video["color_transfer"]), field_order: text(&video["field_order"]),
        frame_rate: rational(&video["avg_frame_rate"]).or_else(|| rational(&video["r_frame_rate"])),
        audio_codec: text(&audio_value["codec_name"]), audio_profile: text(&audio_value["profile"]), audio_channels: uint(&audio_value["channels"]), audio_sample_rate: uint(&audio_value["sample_rate"]),
    })
}

async fn probe_with_binary(binary: &Path, path: &Path, cancel: CancellationToken) -> Result<ProbedSource> {
    let arguments = vec!["-v".into(), "error".into(), "-show_format".into(), "-show_streams".into(), "-of".into(), "json".into(), path.as_os_str().to_owned()];
    let output = run_process(binary, &arguments, cancel, ProcessMode::Probe, |_, _| {}).await?;
    parse_probe(&output)
}

#[derive(Clone, Copy)]
enum ProcessMode { Probe, Encode(Option<f64>) }

fn progress_time(line: &str) -> Option<f64> {
    let (key, value) = line.trim().split_once('=')?;
    if key == "out_time_us" { return value.parse::<f64>().ok().map(|v| v / 1_000_000.0).filter(|v| v.is_finite() && *v >= 0.0); }
    if key != "out_time" { return None; }
    let mut fields = value.split(':');
    let hours = fields.next()?.parse::<f64>().ok()?;
    let minutes = fields.next()?.parse::<f64>().ok()?;
    let seconds = fields.next()?.parse::<f64>().ok()?;
    if fields.next().is_some() { return None; }
    let value = hours * 3600.0 + minutes * 60.0 + seconds;
    (value.is_finite() && value >= 0.0).then_some(value)
}

async fn run_process(binary: &Path, arguments: &[std::ffi::OsString], cancel: CancellationToken, mode: ProcessMode, mut progress: impl FnMut(Option<f64>, bool)) -> Result<Vec<u8>> {
    check_cancel(&cancel)?;
    let error_code = match mode { ProcessMode::Probe => PreviewErrorCode::ProbeFailed, ProcessMode::Encode(_) => PreviewErrorCode::ConversionFailed };
    let mut child = tokio::process::Command::new(binary).args(arguments).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped()).kill_on_drop(true).spawn()
        .map_err(|e| PreviewError::new(error_code.clone(), e.to_string()))?;
    let mut stdout = child.stdout.take().expect("piped stdout");
    let mut stderr = child.stderr.take().expect("piped stderr");
    let mut out_buffer = [0u8; 8192];
    let mut err_buffer = [0u8; 8192];
    let mut output = Vec::new();
    let mut diagnostic = VecDeque::with_capacity(DIAGNOSTIC_LIMIT);
    let mut line = Vec::new();
    let mut diagnostic_line = Vec::new();
    let mut out_done = false;
    let mut err_done = false;
    let mut status = None;
    let started = Instant::now();
    let mut active_at = started;
    let mut emitted_at = started - Duration::from_millis(150);
    let mut highest = 0.0f64;
    let mut finalizing = false;
    let result = loop {
        if out_done && err_done && status.is_some() { break Ok(()); }
        let deadline = match mode { ProcessMode::Probe => started + Duration::from_secs(30), ProcessMode::Encode(_) => active_at + Duration::from_secs(120) };
        tokio::select! {
            _ = cancel.cancelled() => break Err(PreviewError::cancelled()),
            _ = tokio::time::sleep_until(deadline), if !finalizing => break Err(PreviewError::new(error_code.clone(), "Media process timed out")),
            waited = child.wait(), if status.is_none() => match waited {
                Ok(value) => status = Some(value),
                Err(e) => break Err(PreviewError::new(error_code.clone(), e.to_string())),
            },
            read = stdout.read(&mut out_buffer), if !out_done => match read {
                Ok(0) => out_done = true,
                Ok(count) => {
                    active_at = Instant::now();
                    match mode {
                        ProcessMode::Probe => {
                            if output.len() + count > JSON_LIMIT { break Err(PreviewError::new(PreviewErrorCode::ProbeFailed, "Probe JSON exceeds 8 MiB")); }
                            output.extend_from_slice(&out_buffer[..count]);
                        }
                        ProcessMode::Encode(duration) => {
                            let mut overflow = false;
                            for byte in &out_buffer[..count] {
                                if *byte == b'\n' {
                                    if let Some(time) = progress_time(&String::from_utf8_lossy(&line)) {
                                        let fraction = duration.map(|d| (time / d).clamp(0.0, 0.99));
                                        if let Some(value) = fraction { highest = highest.max(value); }
                                        // Only the explicit faststart second-pass notice
                                        // disables inactivity timing, never duration estimates.
                                        if emitted_at.elapsed() >= Duration::from_millis(150) {
                                            progress(fraction.map(|_| highest), finalizing);
                                            emitted_at = Instant::now();
                                        }
                                    }
                                    line.clear();
                                } else {
                                    line.push(*byte);
                                    if line.len() > 8192 { overflow = true; break; }
                                }
                            }
                            if overflow { break Err(PreviewError::new(error_code.clone(), "Media progress line exceeds 8 KiB")); }
                        }
                    }
                }
                Err(e) => break Err(PreviewError::new(error_code.clone(), e.to_string())),
            },
            read = stderr.read(&mut err_buffer), if !err_done => match read {
                Ok(0) => err_done = true,
                Ok(count) => {
                    active_at = Instant::now();
                    for byte in &err_buffer[..count] {
                        if *byte == b'\n' || *byte == b'\r' {
                            if matches!(mode, ProcessMode::Encode(_)) && diagnostic_line.windows(b"Starting second pass: moving the moov atom".len()).any(|w| w == b"Starting second pass: moving the moov atom") {
                                finalizing = true;
                                if emitted_at.elapsed() >= Duration::from_millis(150) {
                                    progress(None, true);
                                    emitted_at = Instant::now();
                                }
                            }
                            diagnostic_line.clear();
                        } else if diagnostic_line.len() < 8192 {
                            diagnostic_line.push(*byte);
                        }
                        if diagnostic.len() == DIAGNOSTIC_LIMIT { diagnostic.pop_front(); }
                        diagnostic.push_back(*byte);
                    }
                }
                Err(e) => break Err(PreviewError::new(error_code.clone(), e.to_string())),
            },
        }
    };
    if result.is_err() {
        let _ = child.kill().await;
        let _ = child.wait().await;
        return result.map(|_| output);
    }
    if !status.expect("child reaped").success() {
        let bytes: Vec<_> = diagnostic.into_iter().collect();
        return Err(PreviewError::new(error_code, String::from_utf8_lossy(&bytes).into_owned()));
    }
    check_cancel(&cancel)?;
    Ok(output)
}

#[derive(Default)]
struct Capabilities {
    encoders: HashSet<String>,
    muxers: HashSet<String>,
    filters: HashSet<String>,
}

impl Capabilities {
    fn require(&self, stage: Stage, source: &ProbedSource) -> Result<()> {
        let muxer = if stage == Stage::Webm { "webm" } else { "mp4" };
        if !self.muxers.contains(muxer) {
            return Err(PreviewError::new(PreviewErrorCode::ToolsUnavailable, format!("FFmpeg muxer unavailable: {muxer}")));
        }
        let mut encoders = Vec::new();
        if stage == Stage::Mp4 { encoders.push("libx264"); }
        if stage == Stage::Webm { encoders.push("libvpx-vp9"); }
        let copy_audio = source.audio_codec == "aac" && source.audio_profile == "LC" && source.audio_channels <= 2 && source.audio_sample_rate <= 48000;
        if source.source.audio_stream_index.is_some() {
            if stage == Stage::Webm { encoders.push("libopus"); }
            else if !copy_audio { encoders.push("aac"); }
        }
        for encoder in encoders {
            if !self.encoders.contains(encoder) {
                return Err(PreviewError::new(PreviewErrorCode::EncoderUnavailable, format!("FFmpeg encoder unavailable: {encoder}")));
            }
        }
        if stage != Stage::Remux {
            let mut filters = vec!["scale", "setsar", "format"];
            if is_hdr(source) { filters.extend(["zscale", "tonemap"]); }
            if source.frame_rate.is_some_and(|fps| fps > 30.0) { filters.push("fps"); }
            if !matches!(source.field_order.as_str(), "progressive" | "unknown" | "") { filters.push("bwdif"); }
            for filter in filters {
                if !self.filters.contains(filter) {
                    return Err(PreviewError::new(PreviewErrorCode::ToolsUnavailable, format!("FFmpeg filter unavailable: {filter}")));
                }
            }
        }
        Ok(())
    }
}

async fn capabilities_with_binary(binary: &Path, cancel: CancellationToken) -> Result<Capabilities> {
    let mut capabilities = Capabilities::default();
    for (flag, names) in [("-encoders", &mut capabilities.encoders), ("-muxers", &mut capabilities.muxers), ("-filters", &mut capabilities.filters)] {
        let args = ["-hide_banner".into(), flag.into()];
        let bytes = run_process(binary, &args, cancel.clone(), ProcessMode::Probe, |_, _| {}).await
            .map_err(|error| if error.code == PreviewErrorCode::Cancelled { error } else { PreviewError::new(PreviewErrorCode::ToolsUnavailable, error.detail) })?;
        for line in String::from_utf8_lossy(&bytes).lines() {
            let mut columns = line.split_whitespace();
            if let (Some(flags), Some(name)) = (columns.next(), columns.next()) {
                if flags.chars().all(|c| c == '.' || c.is_ascii_uppercase()) {
                    names.extend(name.split(',').map(str::to_owned));
                }
            }
        }
    }
    Ok(capabilities)
}

async fn prepare_artifact(
    ffmpeg: &Path, ffprobe: &Path, input: &Path, partial: &Path, finalized: &Path,
    stage: Stage, source: &ProbedSource, capabilities: &Capabilities,
    cancel: CancellationToken, mut progress: impl FnMut(Option<f64>, bool),
) -> Result<ProbedSource> {
    capabilities.require(stage, source)?;
    let arguments = conversion_arguments(input, partial, stage, source)?;
    run_process(ffmpeg, &arguments, cancel.clone(), ProcessMode::Encode(source.source.duration_sec), &mut progress).await?;
    check_cancel(&cancel)?;
    progress(None, true);
    let prepared = probe_with_binary(ffprobe, partial, cancel.clone()).await?;
    validate_prepared(source, &prepared)?;
    publish_file(partial, finalized, &cancel).await?;
    Ok(prepared)
}

fn stages_for(source: &ProbedSource, mp4: bool, webm: bool) -> Vec<Stage> {
    let mut stages = Vec::with_capacity(3);
    let s = &source.source;
    let fits = (s.width <= 3840 && s.height <= 2160) || (s.width <= 2160 && s.height <= 3840);
    if mp4 && source.video_codec == "h264" && matches!(source.pixel_format.as_str(), "yuv420p" | "yuvj420p") && !is_hdr(source)
        && source.field_order == "progressive" && matches!(source.profile.as_str(), "Baseline" | "Constrained Baseline" | "Main" | "High") && source.level > 0 && source.level <= 52 && fits {
        stages.push(Stage::Remux);
    }
    if mp4 { stages.push(Stage::Mp4); }
    if webm || !mp4 { stages.push(Stage::Webm); }
    stages
}

fn is_hdr(source: &ProbedSource) -> bool { matches!(source.transfer.as_str(), "smpte2084" | "arib-std-b67") }

fn conversion_arguments(input: &Path, output: &Path, stage: Stage, source: &ProbedSource) -> Result<Vec<std::ffi::OsString>> {
    let mut args: Vec<std::ffi::OsString> = ["-hide_banner", "-nostdin", "-y", "-progress", "pipe:1", "-nostats", "-i"].into_iter().map(Into::into).collect();
    args.push(input.as_os_str().to_owned());
    let mut options = vec!["-map".to_owned(), format!("0:{}", source.source.video_stream_index)];
    if let Some(index) = source.source.audio_stream_index { options.extend(["-map".into(), format!("0:{index}")]); }
    options.extend(["-sn".into(), "-dn".into()]);
    if stage == Stage::Remux { options.extend(["-c:v".into(), "copy".into()]); }
    else {
        let s = &source.source;
        let (max_w, max_h): (f64, f64) = if s.display_width >= s.display_height { (1280.0, 720.0) } else { (720.0, 1280.0) };
        let factor = (max_w / s.display_width).min(max_h / s.display_height).min(1.0);
        let width = ((s.display_width * factor / 2.0).floor() as u32 * 2).max(2);
        let height = ((s.display_height * factor / 2.0).floor() as u32 * 2).max(2);
        let mut filters = Vec::new();
        if !matches!(source.field_order.as_str(), "progressive" | "unknown" | "") { filters.push("bwdif=mode=send_frame:parity=auto:deint=interlaced".to_owned()); }
        if is_hdr(source) { filters.push("zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv".into()); }
        filters.push(format!("scale={width}:{height},setsar=1,format=yuv420p"));
        if source.frame_rate.is_some_and(|fps| fps > 30.0) { filters.push("fps=30".into()); }
        options.extend(["-vf".into(), filters.join(","), "-fps_mode".into(), "vfr".into(), "-metadata:s:v:0".into(), "rotate=0".into()]);
        if is_hdr(source) { options.extend(["-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709"].into_iter().map(str::to_owned)); }
        if stage == Stage::Mp4 { options.extend(["-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p", "-profile:v", "baseline", "-level:v", "3.1", "-g", "60", "-bf", "0"].into_iter().map(str::to_owned)); }
        else { options.extend(["-c:v", "libvpx-vp9", "-deadline", "realtime", "-cpu-used", "6", "-crf", "35", "-b:v", "0", "-row-mt", "1", "-g", "60"].into_iter().map(str::to_owned)); }
    }
    if source.source.audio_stream_index.is_some() {
        if stage != Stage::Webm && source.audio_codec == "aac" && source.audio_profile == "LC" && source.audio_channels <= 2 && source.audio_sample_rate <= 48000 {
            options.extend(["-c:a", "copy"].into_iter().map(str::to_owned));
        } else {
            options.extend(["-c:a", if stage == Stage::Webm { "libopus" } else { "aac" }, "-b:a", if stage == Stage::Webm { "128k" } else { "160k" }, "-ac", "2", "-ar", "48000"].into_iter().map(str::to_owned));
        }
    }
    if stage == Stage::Webm { options.extend(["-f", "webm"].into_iter().map(str::to_owned)); }
    else { options.extend(["-movflags", "+faststart", "-f", "mp4"].into_iter().map(str::to_owned)); }
    args.extend(options.into_iter().map(Into::into));
    args.push(output.as_os_str().to_owned());
    Ok(args)
}

fn validate_prepared(original: &ProbedSource, prepared: &ProbedSource) -> Result<()> {
    if original.source.audio_stream_index.is_some() && prepared.source.audio_stream_index.is_none() {
        return Err(PreviewError::new(PreviewErrorCode::ConversionFailed, "Prepared preview lost the audio stream"));
    }
    if let (Some(a), Some(b)) = (original.source.duration_sec, prepared.source.duration_sec) {
        let tolerance = original.frame_rate.map(|fps| 2.0 / fps).unwrap_or(0.25).max(0.25);
        if (a - b).abs() > tolerance { return Err(PreviewError::new(PreviewErrorCode::ConversionFailed, "Prepared duration differs from source")); }
    }
    Ok(())
}

async fn publish_file(partial: &Path, finalized: &Path, cancel: &CancellationToken) -> Result<()> {
    check_cancel(cancel)?;
    let metadata = tokio::fs::metadata(partial).await.map_err(storage_error)?;
    if !metadata.is_file() || metadata.len() == 0 { return Err(PreviewError::new(PreviewErrorCode::ConversionFailed, "Prepared preview is empty")); }
    check_cancel(cancel)?;
    tokio::fs::rename(partial, finalized).await.map_err(storage_error)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn fixture_source() -> ProbedSource {
        parse_probe(&serde_json::to_vec(&json!({"format":{"duration":"8", "start_time":"0"}, "streams":[
            {"index":0,"codec_type":"video","codec_name":"h264","width":640,"height":360,
             "pix_fmt":"yuv420p","profile":"High","level":31,"field_order":"progressive","avg_frame_rate":"30/1"},
            {"index":1,"codec_type":"audio","codec_name":"aac","profile":"LC","channels":2,"sample_rate":"48000"}
        ]})).unwrap()).unwrap()
    }

    #[test]
    fn probe_selects_real_streams_and_oriented_sar_geometry() {
        let probe = parse_probe(&serde_json::to_vec(&json!({"format":{"duration":"N/A","start_time":"1.25"},"streams":[
            {"index":0,"codec_type":"video","width":8000,"height":8000,"disposition":{"attached_pic":1}},
            {"index":4,"codec_type":"video","width":720,"height":576,"sample_aspect_ratio":"16:15",
             "side_data_list":[{"rotation":90}],"tags":{"rotate":"180"},"avg_frame_rate":"25/1"},
            {"index":5,"codec_type":"video","width":720,"height":576},
            {"index":3,"codec_type":"audio","channels":2},
            {"index":8,"codec_type":"audio","channels":6},
            {"index":7,"codec_type":"audio","channels":6}
        ]})).unwrap()).unwrap();
        assert_eq!(probe.source.video_stream_index, 4);
        assert_eq!(probe.source.audio_stream_index, Some(7));
        assert!((probe.source.display_width - 576.0).abs() < 0.001);
        assert!((probe.source.display_height - 768.0).abs() < 0.001);
        assert_eq!(probe.rotation_degrees, 90);
        assert_eq!(probe.source.duration_sec, None);
        assert_eq!(probe.source.start_time_sec, 1.25);
        assert_eq!(parse_probe(b"broken").unwrap_err().code, PreviewErrorCode::ProbeFailed);
        assert_eq!(parse_probe(br#"{"streams":[{"codec_type":"audio"}]}"#).unwrap_err().code, PreviewErrorCode::SourceInvalid);
    }

    #[test]
    fn prepared_validation_rejects_lost_audio_and_duration_drift() {
        let original = fixture_source();
        let mut prepared = original.clone();
        prepared.source.duration_sec = Some(8.2);
        assert!(validate_prepared(&original, &prepared).is_ok());
        prepared.source.duration_sec = Some(8.4);
        assert_eq!(validate_prepared(&original, &prepared).unwrap_err().code, PreviewErrorCode::ConversionFailed);
        prepared.source.duration_sec = Some(8.0);
        prepared.source.audio_stream_index = None;
        assert_eq!(validate_prepared(&original, &prepared).unwrap_err().code, PreviewErrorCode::ConversionFailed);
    }

    #[test]
    fn progress_uses_microseconds_without_magnitude_guessing() {
        assert_eq!(progress_time("out_time_us=1500000"), Some(1.5));
        assert_eq!(progress_time("out_time=01:02:03.5"), Some(3723.5));
        assert_eq!(progress_time("out_time_ms=1500000"), None);
        assert_eq!(progress_time("out_time_us=NaN"), None);
    }

    async fn fixture_state() -> (tempfile::TempDir, PreviewState, PathBuf) {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("original.mkv");
        tokio::fs::write(&path, b"original bytes").await.unwrap();
        let server = Arc::new(MediaServer::start().await.unwrap());
        let state = PreviewState::new(server, directory.path().join("cache"));
        (directory, state, path)
    }

    async fn response_status(url: &str) -> reqwest::StatusCode {
        reqwest::get(url).await.unwrap().status()
    }

    #[tokio::test]
    async fn newest_request_revokes_old_source_and_release_is_scoped() {
        let (_directory, state, path) = fixture_state().await;
        let a = state.begin(10, path.clone()).await.unwrap();
        assert_eq!(response_status(&a.url).await, reqwest::StatusCode::OK);
        let b = state.begin(12, path.clone()).await.unwrap();
        let current_session = state.sessions.lock().await.sessions.get(&12).cloned().unwrap();
        assert!(matches!(current_session.claim_candidate(&a.candidate_id), Err(PreviewError { code: PreviewErrorCode::StaleRequest, .. })));
        let candidate_lease = current_session.claim_candidate(&b.candidate_id).unwrap();
        assert!(matches!(current_session.claim_candidate(&b.candidate_id), Err(PreviewError { code: PreviewErrorCode::StaleRequest, .. })));
        drop(candidate_lease);
        assert_eq!(state.begin(11, path.clone()).await.unwrap_err().code, PreviewErrorCode::StaleRequest);
        assert_eq!(response_status(&a.url).await, reqwest::StatusCode::NOT_FOUND);
        state.release(10).await;
        assert_eq!(response_status(&b.url).await, reqwest::StatusCode::OK);
        state.release(12).await;
        state.release(12).await;
        assert_eq!(response_status(&b.url).await, reqwest::StatusCode::NOT_FOUND);
        state.release(14).await;
        assert_eq!(state.begin(14, path.clone()).await.unwrap_err().code, PreviewErrorCode::StaleRequest);
        assert_eq!(tokio::fs::read(&path).await.unwrap(), b"original bytes");
        state.shutdown().await;
        state.server.shutdown().await;
    }

    #[tokio::test]
    async fn missing_source_returns_typed_error_without_registration() {
        let (_directory, state, path) = fixture_state().await;
        tokio::fs::remove_file(&path).await.unwrap();
        let error = state.begin(1, path).await.unwrap_err();
        assert_eq!(error.code, PreviewErrorCode::SourceMissing);
        assert!(state.sessions.lock().await.sessions.is_empty());
        state.server.shutdown().await;
    }

    #[tokio::test]
    async fn release_waits_for_owned_operation_before_deleting_directory() {
        let (_directory, state, path) = fixture_state().await;
        let state = Arc::new(state);
        let (session, _) = state.create_session(1, path).await.unwrap();
        let mut lease = session.operation.lock().await;
        let temp = tempfile::tempdir().unwrap();
        let temp_path = temp.path().to_owned();
        lease.directory = Some(Arc::new(temp));
        let releasing = state.clone();
        let task = tokio::spawn(async move { releasing.release(1).await; });
        session.cancel.cancelled().await;
        assert!(temp_path.exists());
        assert!(!task.is_finished());
        drop(lease);
        task.await.unwrap();
        assert!(!temp_path.exists());
        state.server.shutdown().await;
    }

    #[tokio::test]
    async fn publication_is_atomic_and_cancelled_output_is_never_published() {
        let directory = tempfile::tempdir().unwrap();
        let partial = directory.path().join("candidate.partial.mp4");
        let finalized = directory.path().join("candidate.mp4");
        tokio::fs::write(&partial, b"completed media").await.unwrap();
        let cancel = CancellationToken::new();
        cancel.cancel();
        assert_eq!(publish_file(&partial, &finalized, &cancel).await.unwrap_err().code, PreviewErrorCode::Cancelled);
        assert!(!finalized.exists());
        publish_file(&partial, &finalized, &CancellationToken::new()).await.unwrap();
        assert!(!partial.exists());
        assert_eq!(tokio::fs::read(&finalized).await.unwrap(), b"completed media");
    }

    #[cfg(target_os = "linux")]
    #[tokio::test]
    async fn cancelling_fixture_child_reaps_before_directory_removal() {
        use std::os::unix::fs::PermissionsExt;
        let directory = tempfile::tempdir().unwrap();
        let script = directory.path().join("fixture");
        let pid_file = directory.path().join("pid");
        // A fixture-owned executable replaces itself with sleep, so its pid is
        // exactly the child owned/reaped by run_process, not an unrelated process.
        tokio::fs::write(&script, b"#!/bin/sh\nprintf '%s' \"$$\" > \"$1\"\nexec sleep 60\n").await.unwrap();
        std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o700)).unwrap();
        let arguments = vec![pid_file.as_os_str().to_owned()];
        let cancel = CancellationToken::new();
        let child_cancel = cancel.clone();
        let task = tokio::spawn(async move { run_process(&script, &arguments, child_cancel, ProcessMode::Encode(None), |_, _| {}).await });
        let pid = tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                if let Ok(value) = tokio::fs::read_to_string(&pid_file).await {
                    if let Ok(pid) = value.parse::<u32>() { break pid; }
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        }).await.unwrap();
        cancel.cancel();
        let error = tokio::time::timeout(Duration::from_secs(5), task).await.unwrap().unwrap().unwrap_err();
        assert_eq!(error.code, PreviewErrorCode::Cancelled);
        assert!(!PathBuf::from(format!("/proc/{pid}")).exists());
        directory.close().unwrap();
    }

    #[tokio::test]
    #[ignore = "Requires real ffmpeg/ffprobe with libx264, AAC, VP9 and Opus"]
    async fn ffmpeg_preview_matrix() {
        let ffmpeg = Path::new("ffmpeg");
        let ffprobe = Path::new("ffprobe");
        let directory = tempfile::tempdir().unwrap();
        let capabilities = capabilities_with_binary(ffmpeg, CancellationToken::new()).await.expect("FFmpeg capability discovery");
        for (name, bytes) in [("empty.mp4", &b""[..]), ("corrupt.mp4", &b"not video"[..])] {
            let path = directory.path().join(name);
            tokio::fs::write(&path, bytes).await.unwrap();
            assert_eq!(probe_with_binary(ffprobe, &path, CancellationToken::new()).await.unwrap_err().code, PreviewErrorCode::ProbeFailed);
        }
        let missing_encoder = Capabilities { muxers: capabilities.muxers.clone(), filters: capabilities.filters.clone(), encoders: HashSet::new() };
        let partial = directory.path().join("unavailable.partial.mp4");
        let finalized = directory.path().join("unavailable.mp4");
        let error = prepare_artifact(ffmpeg, ffprobe, &directory.path().join("missing"), &partial, &finalized,
            Stage::Mp4, &fixture_source(), &missing_encoder, CancellationToken::new(), |_, _| {}).await.unwrap_err();
        assert_eq!(error.code, PreviewErrorCode::EncoderUnavailable);
        assert!(!partial.exists() && !finalized.exists());
        for (name, video_codec, audio_codec, expected_stage) in [
            ("h264-aac.mkv", "libx264", "aac", Stage::Remux),
            ("h264-pcm.mkv", "libx264", "pcm_s16le", Stage::Remux),
            ("ffv1-pcm.mkv", "ffv1", "pcm_s16le", Stage::Mp4),
            ("direct.mp4", "libx264", "aac", Stage::Remux),
            ("silent.mkv", "ffv1", "pcm_s16le", Stage::Mp4),
            ("sar.mkv", "ffv1", "pcm_s16le", Stage::Mp4),
            ("portrait.mkv", "ffv1", "pcm_s16le", Stage::Mp4),
            ("vfr.mkv", "ffv1", "pcm_s16le", Stage::Mp4),
            ("offset.mkv", "ffv1", "pcm_s16le", Stage::Mp4),
            ("start.mkv", "ffv1", "pcm_s16le", Stage::Mp4),
            ("rotated.mp4", "libx264", "aac", Stage::Remux),
            ("cover.mp4", "libx264", "aac", Stage::Remux),
            ("interlaced.mkv", "ffv1", "pcm_s16le", Stage::Mp4),
            ("pq.mkv", "ffv1", "pcm_s16le", Stage::Mp4),
            ("hlg.mkv", "ffv1", "pcm_s16le", Stage::Mp4),
        ] {
            let input = directory.path().join(name);
            let mut fixture: Vec<std::ffi::OsString> = ["-hide_banner", "-nostdin", "-y", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=30:duration=8", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=8", "-map", "0:v", "-map", "1:a", "-c:v", video_codec, "-pix_fmt", "yuv420p", "-c:a", audio_codec].into_iter().map(Into::into).collect();
            match name {
                "silent.mkv" => { fixture = ["-hide_banner", "-nostdin", "-y", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=30:duration=8", "-c:v", "ffv1"].into_iter().map(Into::into).collect(); }
                "sar.mkv" => fixture.extend(["-vf", "setsar=2"].into_iter().map(Into::into)),
                "portrait.mkv" => fixture.extend(["-vf", "transpose=1"].into_iter().map(Into::into)),
                "vfr.mkv" => fixture.extend(["-vf", "select='if(lt(t,4),not(mod(n,2)),1)'", "-fps_mode", "vfr"].into_iter().map(Into::into)),
                "offset.mkv" => fixture.extend(["-af", "asetpts=PTS+0.25/TB"].into_iter().map(Into::into)),
                "start.mkv" => fixture.extend(["-output_ts_offset", "2"].into_iter().map(Into::into)),
                "interlaced.mkv" => fixture.extend(["-vf", "setfield=tff"].into_iter().map(Into::into)),
                "pq.mkv" | "hlg.mkv" => fixture.extend(["-pix_fmt", "yuv420p10le", "-color_primaries", "bt2020", "-colorspace", "bt2020nc", "-color_trc", if name == "pq.mkv" { "smpte2084" } else { "arib-std-b67" }].into_iter().map(Into::into)),
                _ => {}
            }
            fixture.push(input.as_os_str().to_owned());
            run_process(ffmpeg, &fixture, CancellationToken::new(), ProcessMode::Encode(Some(8.0)), |_, _| {}).await.expect("real fixture generation requires configured codecs");
            if matches!(name, "rotated.mp4" | "cover.mp4") {
                let base = directory.path().join("base.mp4");
                tokio::fs::rename(&input, &base).await.unwrap();
                let mut args: Vec<std::ffi::OsString> = vec!["-hide_banner".into(), "-nostdin".into(), "-y".into(), "-i".into(), base.as_os_str().to_owned()];
                if name == "rotated.mp4" {
                    args.splice(3..3, ["-display_rotation:v:0".into(), "90".into()]);
                    args.extend(["-map", "0", "-c", "copy"].into_iter().map(Into::into));
                } else {
                    args.extend(["-f", "lavfi", "-i", "color=size=640x360:duration=0.04", "-map", "0", "-map", "1:v", "-c", "copy", "-c:v:1", "mjpeg", "-disposition:v:1", "attached_pic"].into_iter().map(Into::into));
                }
                args.push(input.as_os_str().to_owned());
                run_process(ffmpeg, &args, CancellationToken::new(), ProcessMode::Probe, |_, _| {}).await.unwrap();
            }
            let original_bytes = tokio::fs::read(&input).await.unwrap();
            let source = probe_with_binary(ffprobe, &input, CancellationToken::new()).await.unwrap();
            if name == "rotated.mp4" { assert_eq!(source.rotation_degrees, 90); }
            if name == "cover.mp4" { assert_eq!(source.source.width, 320); }
            assert_eq!(stages_for(&source, false, true), vec![Stage::Webm]);
            assert_eq!(stages_for(&source, true, true)[0], expected_stage, "{name}");
            if name == "direct.mp4" {
                let server = Arc::new(MediaServer::start().await.unwrap());
                let state = PreviewState::new(server.clone(), directory.path().join("direct-cache"));
                let candidate = state.begin(1, input.clone()).await.unwrap();
                assert_eq!(candidate.stage, Stage::Direct);
                assert_eq!(reqwest::get(&candidate.url).await.unwrap().bytes().await.unwrap().as_ref(), original_bytes);
                state.release(1).await;
                server.shutdown().await;
            }
            for stage in [expected_stage, Stage::Webm] {
                let extension = if stage == Stage::Webm { "webm" } else { "mp4" };
                let partial = directory.path().join(format!("{name}.partial.{extension}"));
                let final_path = directory.path().join(format!("{name}.{extension}"));
                let started = Instant::now();
                let prepared = prepare_artifact(ffmpeg, ffprobe, &input, &partial, &final_path, stage, &source, &capabilities, CancellationToken::new(), |progress, _| {
                    assert!(progress.is_none_or(|value| (0.0..1.0).contains(&value)));
                }).await.unwrap();
                if stage == Stage::Remux {
                    let mut hashes = Vec::new();
                    for path in [&input, &final_path] {
                        let args = vec!["-v".into(), "error".into(), "-i".into(), path.as_os_str().to_owned(),
                            "-map".into(), "0:v:0".into(), "-an".into(), "-f".into(), "framemd5".into(), "pipe:1".into()];
                        let output = run_process(ffmpeg, &args, CancellationToken::new(), ProcessMode::Probe, |_, _| {}).await.unwrap();
                        hashes.push(String::from_utf8(output).unwrap().lines().filter(|line| !line.starts_with('#'))
                            .map(|line| line.rsplit(',').next().unwrap().trim().to_owned()).collect::<Vec<_>>());
                    }
                    assert_eq!(hashes[0], hashes[1], "remux changed decoded video: {name}");
                }
                assert_eq!(prepared.video_codec, if stage == Stage::Webm { "vp9" } else { "h264" });
                if source.source.audio_stream_index.is_some() {
                    assert_eq!(prepared.audio_codec, if stage == Stage::Webm { "opus" } else { "aac" });
                } else { assert!(prepared.source.audio_stream_index.is_none()); }
                if source.source.audio_stream_index.is_some() {
                    let mut offsets = Vec::new();
                    for path in [&input, &final_path] {
                        let args = vec!["-v".into(), "error".into(), "-show_streams".into(), "-of".into(), "json".into(), path.as_os_str().to_owned()];
                        let output = run_process(ffprobe, &args, CancellationToken::new(), ProcessMode::Probe, |_, _| {}).await.unwrap();
                        let root: Value = serde_json::from_slice(&output).unwrap();
                        let streams = root["streams"].as_array().unwrap();
                        let start = |kind| streams.iter().find(|stream| stream["codec_type"] == kind).and_then(|stream| number(&stream["start_time"])).unwrap();
                        offsets.push(start("audio") - start("video"));
                    }
                    assert!((offsets[0] - offsets[1]).abs() <= 1.0 / 30.0, "A/V offset changed: {name} {stage:?} {offsets:?}");
                }
                let source_aspect = source.source.display_width / source.source.display_height;
                let prepared_aspect = prepared.source.display_width / prepared.source.display_height;
                assert!((source_aspect - prepared_aspect).abs() < 0.02, "{name} aspect changed");
                let timeline = |path: &Path| {
                    let selected = if path == input { source.source.video_stream_index } else { prepared.source.video_stream_index };
                    let mut args: Vec<std::ffi::OsString> = ["-v", "error", "-select_streams", &selected.to_string(), "-show_frames", "-show_entries", "frame=best_effort_timestamp_time", "-of", "json"].into_iter().map(Into::into).collect();
                    args.push(path.as_os_str().to_owned());
                    args
                };
                let original_frames: Value = serde_json::from_slice(&run_process(ffprobe, &timeline(&input), CancellationToken::new(), ProcessMode::Probe, |_, _| {}).await.unwrap()).unwrap();
                let prepared_frames: Value = serde_json::from_slice(&run_process(ffprobe, &timeline(&final_path), CancellationToken::new(), ProcessMode::Probe, |_, _| {}).await.unwrap()).unwrap();
                let original_times: Vec<_> = original_frames["frames"].as_array().unwrap().iter().filter_map(|f| number(&f["best_effort_timestamp_time"])).map(|t| t - source.source.start_time_sec).collect();
                let prepared_times: Vec<_> = prepared_frames["frames"].as_array().unwrap().iter().filter_map(|f| number(&f["best_effort_timestamp_time"])).map(|t| t - prepared.source.start_time_sec).collect();
                for marker in [1.0, 3.0, 6.0] {
                    let a = original_times.iter().find(|t| **t >= marker).unwrap();
                    let b = prepared_times.iter().find(|t| **t >= marker).unwrap();
                    assert!((a - b).abs() <= 1.0 / 15.0 + 0.002, "{name} {stage:?} marker {marker}: {a} != {b}");
                }
                assert!(!partial.exists());
                assert_eq!(tokio::fs::read(&input).await.unwrap(), original_bytes);
                eprintln!("fixture={name} stage={stage:?} preparation={:.3}s duration={:?}", started.elapsed().as_secs_f64(), prepared.source.duration_sec);
            }
        }
    }
}
