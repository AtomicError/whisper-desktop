use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use futures_util::StreamExt;
use reqwest::header::{RANGE, USER_AGENT};
use reqwest::{Client, StatusCode};
use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncWriteExt, BufWriter};

const HF_WHISPER_BASE: &str = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main";
const HF_VAD_BASE: &str = "https://huggingface.co/ggml-org/whisper-vad/resolve/main";
const USER_AGENT_VALUE: &str = concat!(env!("CARGO_PKG_NAME"), "/", env!("CARGO_PKG_VERSION"));
const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
const READ_TIMEOUT: Duration = Duration::from_secs(30);
const EMIT_INTERVAL: Duration = Duration::from_millis(250);
const MAX_RETRIES: u32 = 5;
const RETRY_BASE_DELAY: Duration = Duration::from_secs(2);
/// How long delete waits for an active task to observe cancellation and
/// release its file handles (covers the post-download hash pass too).
const CANCEL_GRACE: Duration = Duration::from_secs(5);

// ---------------------------------------------------------------------------
// Model catalog — sizes and SHA-256 digests verified against the Hugging Face
// tree API (ggerganov/whisper.cpp + ggml-org/whisper-vad) on 2026-08-23.
// "small.en-tdrz" was removed: it does not exist upstream and never downloaded.
// ---------------------------------------------------------------------------

fn model_catalog(name: &str) -> Option<(u64, &'static str)> {
    let entry = match name {
        "tiny" => (77691713, "be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21"),
        "tiny-q5_1" => (32152673, "818710568da3ca15689e31a743197b520007872ff9576237bda97bd1b469c3d7"),
        "tiny-q8_0" => (43537433, "c2085835d3f50733e2ff6e4b41ae8a2b8d8110461e18821b09a15c40c42d1cca"),
        "tiny.en" => (77704715, "921e4cf8686fdd993dcd081a5da5b6c365bfde1162e72b08d75ac75289920b1f"),
        "tiny.en-q5_1" => (32166155, "c77c5766f1cef09b6b7d47f21b546cbddd4157886b3b5d6d4f709e91e66c7c2b"),
        "tiny.en-q8_0" => (43550795, "5bc2b3860aa151a4c6e7bb095e1fcce7cf12c7b020ca08dcec0c6d018bb7dd94"),
        "base" => (147951465, "60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe"),
        "base-q5_1" => (59707625, "422f1ae452ade6f30a004d7e5c6a43195e4433bc370bf23fac9cc591f01a8898"),
        "base-q8_0" => (81768585, "c577b9a86e7e048a0b7eada054f4dd79a56bbfa911fbdacf900ac5b567cbb7d9"),
        "base.en" => (147964211, "a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002"),
        "base.en-q5_1" => (59721011, "4baf70dd0d7c4247ba2b81fafd9c01005ac77c2f9ef064e00dcf195d0e2fdd2f"),
        "base.en-q8_0" => (81781811, "a4d4a0768075e13cfd7e19df3ae2dbc4a68d37d36a7dad45e8410c9a34f8c87e"),
        "small" => (487601967, "1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b"),
        "small-q5_1" => (190085487, "ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb"),
        "small-q8_0" => (264464607, "49c8fb02b65e6049d5fa6c04f81f53b867b5ec9540406812c643f177317f779f"),
        "small.en" => (487614201, "c6138d6d58ecc8322097e0f987c32f1be8bb0a18532a3f88f734d1bbf9c41e5d"),
        "small.en-q5_1" => (190098681, "bfdff4894dcb76bbf647d56263ea2a96645423f1669176f4844a1bf8e478ad30"),
        "small.en-q8_0" => (264477561, "67a179f608ea6114bd3fdb9060e762b588a3fb3bd00c4387971be4d177958067"),
        "medium" => (1533763059, "6c14d5adee5f86394037b4e4e8b59f1673b6cee10e3cf0b11bbdbee79c156208"),
        "medium-q5_0" => (539212467, "19fea4b380c3a618ec4723c3eef2eb785ffba0d0538cf43f8f235e7b3b34220f"),
        "medium-q8_0" => (823369779, "42a1ffcbe4167d224232443396968db4d02d4e8e87e213d3ee2e03095dea6502"),
        "medium.en" => (1533774781, "cc37e93478338ec7700281a7ac30a10128929eb8f427dda2e865faa8f6da4356"),
        "medium.en-q5_0" => (539225533, "76733e26ad8fe1c7a5bf7531a9d41917b2adc0f20f2e4f5531688a8c6cd88eb0"),
        "medium.en-q8_0" => (823382461, "43fa2cd084de5a04399a896a9a7a786064e221365c01700cea4666005218f11c"),
        "large-v1" => (3094623691, "7d99f41a10525d0206bddadd86760181fa920438b6b33237e3118ff6c83bb53d"),
        "large-v2" => (3094623691, "9a423fe4d40c82774b6af34115b8b935f34152246eb19e80e376071d3f999487"),
        "large-v2-q5_0" => (1080732091, "3a214837221e4530dbc1fe8d734f302af393eb30bd0ed046042ebf4baf70f6f2"),
        "large-v2-q8_0" => (1656129691, "fef54e6d898246a65c8285bfa83bd1807e27fadf54d5d4e81754c47634737e8c"),
        "large-v3" => (3095033483, "64d182b440b98d5203c4f9bd541544d84c605196c4f7b845dfa11fb23594d1e2"),
        "large-v3-q5_0" => (1081140203, "d75795ecff3f83b5faa89d1900604ad8c780abd5739fae406de19f23ecd98ad1"),
        "large-v3-turbo" => (1624555275, "1fc70f774d38eb169993ac391eea357ef47c88757ef72ee5943879b7e8e2bc69"),
        "large-v3-turbo-q5_0" => (574041195, "394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2"),
        "large-v3-turbo-q8_0" => (874188075, "317eb69c11673c9de1f0d459b253999804ec71ac4c23c17ecf7fbe24e259a1"),
        "silero-v5.1.2" => (885098, "29940d98d42b91fbd05ce489f3ecf7c72f0a42f027e4875919a28fb4c04ea2cf"),
        "silero-v6.2.0" => (885098, "2aa269b785eeb53a82983a20501ddf7c1d9c48e33ab63a41391ac6c9f7fb6987"),
        _ => return None,
    };
    Some(entry)
}

pub fn get_models_list() -> Vec<&'static str> {
    vec![
        "tiny", "tiny-q5_1", "tiny-q8_0", "tiny.en", "tiny.en-q5_1", "tiny.en-q8_0",
        "base", "base-q5_1", "base-q8_0", "base.en", "base.en-q5_1", "base.en-q8_0",
        "small", "small-q5_1", "small-q8_0", "small.en", "small.en-q5_1", "small.en-q8_0",
        "medium", "medium-q5_0", "medium-q8_0", "medium.en", "medium.en-q5_0", "medium.en-q8_0",
        "large-v1", "large-v2", "large-v2-q5_0", "large-v2-q8_0",
        "large-v3", "large-v3-q5_0", "large-v3-turbo", "large-v3-turbo-q5_0", "large-v3-turbo-q8_0",
        "silero-v5.1.2", "silero-v6.2.0",
    ]
}

/// Single canonical normalization shared by every entry point.
pub fn normalize_model_name(raw: &str) -> String {
    let mut name = raw.trim().to_lowercase();
    if let Some(stripped) = name.strip_prefix("ggml-") {
        name = stripped.to_string();
    }
    if let Some(stripped) = name.strip_suffix(".bin") {
        name = stripped.to_string();
    }
    name
}

/// Reject path separators, traversal sequences, and OS-invalid characters.
fn is_safe_model_name(name: &str) -> bool {
    !name.is_empty()
        && !name.starts_with('.')
        && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
}

fn model_url(clean_name: &str) -> String {
    if clean_name.starts_with("silero-") {
        format!("{HF_VAD_BASE}/ggml-{clean_name}.bin?download=true")
    } else {
        format!("{HF_WHISPER_BASE}/ggml-{clean_name}.bin")
    }
}

// ---------------------------------------------------------------------------
// State & Concurrency primitives
// ---------------------------------------------------------------------------

pub struct DownloadHandle {
    pub cancelled: AtomicBool,
    /// Set by the owning task right after its terminal event, so file-bound
    /// commands (delete) can wait until every file handle is released.
    pub done: AtomicBool,
}

impl DownloadHandle {
    fn new() -> Self {
        DownloadHandle {
            cancelled: AtomicBool::new(false),
            done: AtomicBool::new(false),
        }
    }
}

pub struct DownloadSession {
    pub active: HashMap<String, Arc<DownloadHandle>>,
}

impl DownloadSession {
    pub fn new() -> Self {
        DownloadSession {
            active: HashMap::new(),
        }
    }
}

pub struct DownloadState(pub Arc<Mutex<DownloadSession>>);

fn lock_session(session: &Mutex<DownloadSession>) -> std::sync::MutexGuard<'_, DownloadSession> {
    session.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn register_download(
    session: &Arc<Mutex<DownloadSession>>,
    name: &str,
) -> Result<Arc<DownloadHandle>, String> {
    let mut lock = lock_session(session);
    if lock.active.contains_key(name) {
        return Err(format!("A download for '{name}' is already in progress."));
    }
    let handle = Arc::new(DownloadHandle::new());
    lock.active.insert(name.to_string(), handle.clone());
    Ok(handle)
}

fn unregister_if_owned(
    session: &Arc<Mutex<DownloadSession>>,
    name: &str,
    handle: &Arc<DownloadHandle>,
) {
    let mut lock = lock_session(session);
    if lock.active.get(name).is_some_and(|h| Arc::ptr_eq(h, handle)) {
        lock.active.remove(name);
    }
}

// ---------------------------------------------------------------------------
// Event payloads
// ---------------------------------------------------------------------------

#[derive(Serialize, Clone, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum Phase {
    Starting,
    Downloading,
    Paused,
    Completed,
    Failed,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ModelDownloadProgress {
    pub model_name: String,
    pub phase: Phase,
    pub progress: f64,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub speed_bps: f64,
    pub error: Option<String>,
}

fn emit_progress(app: &AppHandle, payload: ModelDownloadProgress) {
    let _ = app.emit("model-download-status", payload);
}

fn make_payload(
    model_name: &str,
    phase: Phase,
    downloaded_bytes: u64,
    total_bytes: u64,
    speed_bps: f64,
    error: Option<String>,
) -> ModelDownloadProgress {
    let progress = match phase {
        Phase::Completed => 1.0,
        _ if total_bytes > 0 => {
            let cap = if phase == Phase::Downloading { 0.99 } else { 1.0 };
            (downloaded_bytes as f64 / total_bytes as f64).min(cap)
        }
        _ => 0.0,
    };
    ModelDownloadProgress {
        model_name: model_name.to_string(),
        phase,
        progress,
        downloaded_bytes,
        total_bytes,
        speed_bps,
        error,
    }
}

// ---------------------------------------------------------------------------
// Grid status types
// ---------------------------------------------------------------------------

#[derive(PartialEq)]
enum ModelState {
    NotDownloaded,
    Downloading,
    Paused,
    Downloaded,
}

impl ModelState {
    fn as_str(&self) -> &'static str {
        match self {
            ModelState::NotDownloaded => "Not Downloaded",
            ModelState::Downloading => "Downloading",
            ModelState::Paused => "Paused",
            ModelState::Downloaded => "Downloaded",
        }
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ModelStatus {
    pub name: String,
    pub status: String,
    pub size_bytes: u64,
    pub downloaded_bytes: u64,
    pub progress: f64,
}

// ---------------------------------------------------------------------------
// Download pipeline with synchronous registration & robust background streaming
// ---------------------------------------------------------------------------

pub fn start_download(
    app: AppHandle,
    download_state: Arc<Mutex<DownloadSession>>,
    models_dir: String,
    model_name: String,
) -> Result<(), String> {
    let clean_name = normalize_model_name(&model_name);

    // Pre-spawn failures return Err only: the invoke promise already rejects
    // and the frontend notifies + reloads, so an extra Failed event here
    // would produce duplicate notifications.
    if !is_safe_model_name(&clean_name) {
        return Err(format!("Invalid model name '{}'.", model_name));
    }

    let Some((expected_size, expected_hash)) = model_catalog(&clean_name) else {
        return Err(format!("Unknown model '{clean_name}': not in the supported catalog."));
    };

    // Synchronous registration before async task dispatch eliminates the spawn-vs-pause race window.
    let handle = register_download(&download_state, &clean_name)?;

    // tauri::async_runtime provides the tokio context — plain tokio::spawn
    // panics inside sync commands because they run on the webview protocol
    // thread outside any runtime.
    tauri::async_runtime::spawn(async move {
        let result = download_inner(
            &app,
            &handle,
            Path::new(&models_dir),
            &clean_name,
            expected_size,
            expected_hash,
        )
        .await;

        unregister_if_owned(&download_state, &clean_name, &handle);

        let was_cancelled = handle.cancelled.load(Ordering::Acquire);
        let bytes_so_far = match &result {
            Ok(n) => *n,
            Err(_) => partial_bytes(Path::new(&models_dir), &clean_name),
        };

        let terminal = if was_cancelled {
            make_payload(&clean_name, Phase::Paused, bytes_so_far, expected_size, 0.0, None)
        } else {
            match &result {
                Ok(_) => make_payload(&clean_name, Phase::Completed, expected_size, expected_size, 0.0, None),
                Err(e) => make_payload(&clean_name, Phase::Failed, bytes_so_far, expected_size, 0.0, Some(e.clone())),
            }
        };
        emit_progress(&app, terminal);

        handle.done.store(true, Ordering::Release);
    });

    Ok(())
}

async fn download_inner(
    app: &AppHandle,
    handle: &Arc<DownloadHandle>,
    models_dir: &Path,
    clean_name: &str,
    expected_size: u64,
    expected_hash: &'static str,
) -> Result<u64, String> {
    tokio::fs::create_dir_all(models_dir)
        .await
        .map_err(|e| format!("Failed to create models directory: {e}"))?;

    let bin_path = models_dir.join(format!("ggml-{clean_name}.bin"));
    let legacy_bin = models_dir.join("models").join(format!("ggml-{clean_name}.bin"));

    if (bin_path.exists() && bin_path.metadata().map(|m| m.len() == expected_size).unwrap_or(false))
        || (legacy_bin.exists() && legacy_bin.metadata().map(|m| m.len() == expected_size).unwrap_or(false))
    {
        return Err(format!("Model ggml-{clean_name}.bin already exists locally."));
    }

    let tmp_new = models_dir.join(format!("ggml-{clean_name}.bin.tmp"));
    let tmp_legacy = models_dir.join("models").join(format!("ggml-{clean_name}.bin.tmp"));

    let len_of = |p: &Path| p.metadata().map(|m| m.len()).unwrap_or(0);
    let (tmp_path, mut downloaded) = match (len_of(&tmp_new), len_of(&tmp_legacy)) {
        (0, 0) => (tmp_new, 0),
        (n, l) if l > n => (tmp_legacy, l),
        (n, _) => (tmp_new, n),
    };

    if expected_size > 0 && downloaded == expected_size {
        return finalize(&tmp_path, &bin_path, expected_size, expected_hash).await;
    }

    let client = Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .read_timeout(READ_TIMEOUT)
        .user_agent(USER_AGENT_VALUE)
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))?;

    let url = model_url(clean_name);

    emit_progress(app, make_payload(clean_name, Phase::Starting, downloaded, expected_size, 0.0, None));

    let mut consecutive_failures: u32 = 0;
    loop {
        consecutive_failures += 1;
        downloaded = len_of(&tmp_path);

        let mut request = client.get(&url).header(USER_AGENT, USER_AGENT_VALUE);
        if downloaded > 0 && (expected_size == 0 || downloaded < expected_size) {
            request = request.header(RANGE, format!("bytes={downloaded}-"));
        }

        let response = match request.send().await {
            Ok(r) => r,
            Err(e) => {
                if handle.cancelled.load(Ordering::Relaxed) {
                    return Ok(downloaded);
                }
                if consecutive_failures >= MAX_RETRIES {
                    return Err(format!("Network connection failed after {consecutive_failures} attempts: {e}"));
                }
                tokio::time::sleep(RETRY_BASE_DELAY * consecutive_failures).await;
                continue;
            }
        };

        let mut writer = match response.status() {
            StatusCode::PARTIAL_CONTENT => BufWriter::new(open_append(&tmp_path).await?),
            StatusCode::OK => {
                downloaded = 0;
                BufWriter::new(open_truncate(&tmp_path).await?)
            }
            StatusCode::RANGE_NOT_SATISFIABLE => {
                // Wipe invalid partial download and retry from 0
                let attempted_offset = downloaded;
                let _ = tokio::fs::remove_file(&tmp_path).await;
                if consecutive_failures >= MAX_RETRIES {
                    return Err(format!(
                        "Server rejected resume at {attempted_offset} bytes and retry limit reached."
                    ));
                }
                tokio::time::sleep(RETRY_BASE_DELAY * consecutive_failures).await;
                continue;
            }
            s => {
                return Err(format!(
                    "HTTP {} from model server{}",
                    s.as_u16(),
                    if s.is_server_error() { " — try again later" } else { "" }
                ));
            }
        };

        let total_bytes = match (response.status(), response.content_length()) {
            (StatusCode::PARTIAL_CONTENT, Some(len)) => len + downloaded,
            (_, Some(len)) => len.max(downloaded),
            (_, None) => expected_size,
        };

        emit_progress(app, make_payload(clean_name, Phase::Downloading, downloaded, total_bytes, 0.0, None));

        let mut stream = response.bytes_stream();
        let mut last_emit = Instant::now();
        let mut window_start = last_emit;
        let mut window_bytes: u64 = 0;
        let mut network_error: Option<String> = None;

        while let Some(item) = stream.next().await {
            if handle.cancelled.load(Ordering::Relaxed) {
                break;
            }
            match item {
                Ok(chunk) => {
                    writer
                        .write_all(&chunk)
                        .await
                        .map_err(|e| format!("Failed to write model data: {e}"))?;
                    downloaded += chunk.len() as u64;
                    window_bytes += chunk.len() as u64;
                    // Reset consecutive failures counter whenever valid progress is actively made
                    consecutive_failures = 0;
                }
                Err(e) => {
                    network_error = Some(e.to_string());
                    break;
                }
            }

            let now = Instant::now();
            if now.duration_since(last_emit) >= EMIT_INTERVAL {
                let elapsed = now.duration_since(window_start).as_secs_f64();
                let speed = if elapsed > 0.0 { window_bytes as f64 / elapsed } else { 0.0 };
                emit_progress(app, make_payload(clean_name, Phase::Downloading, downloaded, total_bytes, speed, None));
                last_emit = now;
                window_start = now;
                window_bytes = 0;
            }
        }

        writer.flush().await.map_err(|e| format!("Failed to flush model data: {e}"))?;

        if handle.cancelled.load(Ordering::Relaxed) {
            return Ok(downloaded);
        }

        if let Some(e) = network_error {
            if consecutive_failures >= MAX_RETRIES {
                return Err(format!("Network stream interrupted after {consecutive_failures} attempts: {e}"));
            }
            tokio::time::sleep(RETRY_BASE_DELAY * consecutive_failures).await;
            continue;
        }

        break; // Clean stream EOF
    }

    if expected_size > 0 && downloaded != expected_size {
        return Err(format!("Incomplete download: {downloaded}/{expected_size} bytes."));
    }

    finalize(&tmp_path, &bin_path, expected_size, expected_hash).await
}

async fn open_append(path: &Path) -> Result<tokio::fs::File, String> {
    tokio::fs::OpenOptions::new()
        .append(true)
        .create(true)
        .open(path)
        .await
        .map_err(|e| format!("Failed to open partial file {}: {e}", path.display()))
}

async fn open_truncate(path: &Path) -> Result<tokio::fs::File, String> {
    tokio::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .open(path)
        .await
        .map_err(|e| format!("Failed to create file {}: {e}", path.display()))
}

async fn finalize(
    tmp_path: &Path,
    bin_path: &Path,
    expected_size: u64,
    expected_hash: &str,
) -> Result<u64, String> {
    let tmp_owned = tmp_path.to_path_buf();
    let (actual_len, actual_hash) =
        tokio::task::spawn_blocking(move || verify_file(&tmp_owned))
            .await
            .map_err(|e| format!("Verification task failed: {e}"))??;

    if actual_hash != expected_hash {
        let _ = std::fs::remove_file(tmp_path);
        return Err(format!(
            "Checksum mismatch for {} (corrupted download discarded). Please retry.",
            bin_path.display()
        ));
    }

    if expected_size > 0 && actual_len != expected_size {
        let _ = std::fs::remove_file(tmp_path);
        return Err(format!(
            "Size mismatch for {}: got {actual_len}, expected {expected_size}.",
            bin_path.display()
        ));
    }

    // Windows compatibility: Remove destination if already existing before rename
    if bin_path.exists() {
        let _ = tokio::fs::remove_file(bin_path).await;
    }

    // Attempt atomic rename, fallback to copy + unlink for cross-device mount boundaries
    if tokio::fs::rename(tmp_path, bin_path).await.is_err() {
        tokio::fs::copy(tmp_path, bin_path)
            .await
            .map_err(|e| format!("Failed to copy model to final destination: {e}"))?;
        let _ = tokio::fs::remove_file(tmp_path).await;
    }

    // Clean up any remaining legacy temporary file
    let legacy_tmp = bin_path.parent().map(|p| p.join("models").join(tmp_path.file_name().unwrap_or_default()));
    if let Some(leg) = legacy_tmp {
        if leg != tmp_path && leg.exists() {
            let _ = tokio::fs::remove_file(leg).await;
        }
    }

    Ok(actual_len)
}

fn verify_file(path: &PathBuf) -> Result<(u64, String), String> {
    use std::io::Read;
    let mut file =
        std::fs::File::open(path).map_err(|e| format!("Failed to open downloaded file: {e}"))?;
    let len = file.metadata().map(|m| m.len()).unwrap_or(0);
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 256 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|e| format!("Failed to read downloaded file: {e}"))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    let hex: String = hasher.finalize().iter().map(|b| format!("{b:02x}")).collect();
    Ok((len, hex))
}

fn partial_bytes(models_dir: &Path, clean_name: &str) -> u64 {
    let tmp = models_dir.join(format!("ggml-{clean_name}.bin.tmp"));
    let legacy_tmp = models_dir.join("models").join(format!("ggml-{clean_name}.bin.tmp"));
    tmp.metadata()
        .or_else(|_| legacy_tmp.metadata())
        .map(|m| m.len())
        .unwrap_or(0)
}

// ---------------------------------------------------------------------------
// Tauri command entry points
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn get_all_models_status(
    download_state: State<'_, DownloadState>,
    models_dir: String,
) -> Result<Vec<ModelStatus>, String> {
    let session = download_state.0.clone();
    tokio::task::spawn_blocking(move || get_all_models_status_sync(&session, &models_dir))
        .await
        .map_err(|e| format!("model status scan failed: {e}"))?
}

fn get_all_models_status_sync(
    download_state: &Arc<Mutex<DownloadSession>>,
    models_dir: &str,
) -> Result<Vec<ModelStatus>, String> {
    let dir = Path::new(models_dir);
    let active_models: std::collections::HashSet<String> =
        lock_session(download_state).active.keys().cloned().collect();

    let is_valid_bin = |p: &Path, expected: u64| -> bool {
        p.metadata().map(|m| m.len() == expected).unwrap_or(false)
    };

    let mut result = Vec::new();
    for m in get_models_list() {
        let Some((expected_size, _)) = model_catalog(m) else {
            continue;
        };

        let is_active = active_models.contains(m);
        let (state, downloaded_bytes) = if is_valid_bin(&dir.join(format!("ggml-{m}.bin")), expected_size)
            || is_valid_bin(&dir.join("models").join(format!("ggml-{m}.bin")), expected_size)
        {
            (ModelState::Downloaded, expected_size)
        } else {
            let partial = partial_bytes(dir, m);
            if is_active {
                (ModelState::Downloading, partial)
            } else if partial > 0 {
                (ModelState::Paused, partial)
            } else {
                (ModelState::NotDownloaded, 0)
            }
        };

        let progress = match state {
            ModelState::Downloaded => 1.0,
            _ if expected_size > 0 => downloaded_bytes as f64 / expected_size as f64,
            _ => 0.0,
        };
        let progress = progress.min(if state == ModelState::Downloading || state == ModelState::Paused { 0.99 } else { 1.0 });

        result.push(ModelStatus {
            name: m.to_string(),
            status: state.as_str().to_string(),
            size_bytes: expected_size,
            downloaded_bytes,
            progress,
        });
    }

    Ok(result)
}

#[tauri::command]
pub fn pause_download_model(
    download_state: State<'_, DownloadState>,
    model_name: String,
) -> Result<(), String> {
    let clean_name = normalize_model_name(&model_name);
    let handle = {
        let lock = lock_session(&download_state.0);
        lock.active.get(&clean_name).cloned()
    };
    match handle {
        Some(h) => {
            h.cancelled.store(true, Ordering::Release);
            Ok(())
        }
        None => Err("No active download session found to pause.".to_string()),
    }
}

/// Deletes both current and legacy layouts unconditionally, so a leftover copy
/// in the old location can no longer make Delete look broken. Cancels an
/// active download first and waits for the owning task to release its file
/// handles — required on Windows, where deleting an open file fails with a
/// sharing violation.
#[tauri::command]
pub async fn delete_model_file(
    download_state: State<'_, DownloadState>,
    models_dir: String,
    model_name: String,
) -> Result<(), String> {
    let clean_name = normalize_model_name(&model_name);
    if !is_safe_model_name(&clean_name) {
        return Err(format!("Invalid model name '{}'.", model_name));
    }

    // Cancel and wait for the owning task to finish before touching its files.
    let handle = {
        let lock = lock_session(&download_state.0);
        lock.active.get(&clean_name).cloned()
    };
    if let Some(h) = handle {
        h.cancelled.store(true, Ordering::Release);
        let deadline = Instant::now() + CANCEL_GRACE;
        while !h.done.load(Ordering::Acquire) && Instant::now() < deadline {
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
    }

    let dir = Path::new(&models_dir);
    let candidates = [
        dir.join(format!("ggml-{clean_name}.bin")),
        dir.join("models").join(format!("ggml-{clean_name}.bin")),
        dir.join(format!("ggml-{clean_name}.bin.tmp")),
        dir.join("models").join(format!("ggml-{clean_name}.bin.tmp")),
    ];

    let mut last_error = None;
    for path in candidates {
        match tokio::fs::remove_file(&path).await {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => last_error = Some((path, e)),
        }
    }

    match last_error {
        None => Ok(()),
        Some((path, e)) => Err(format!("Failed to delete {}: {e}", path.display())),
    }
}

