// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod settings;
mod hardware;
mod logger;
mod builder;
mod transcribe;
mod downloader;
mod translation;
mod hardsub;
mod video_server;
mod media_preview;
pub mod ffmpeg_resolver;

use std::sync::{Arc, Mutex};
use std::path::Path;
use tauri::{AppHandle, Manager, State};

use settings::{WhisperSettings, load_settings_file, save_settings_file};
use hardware::HardwareMonitor;
use logger::AppLogs;
use builder::check_build_exists;
use transcribe::{probe_file_metadata, convert_to_wav, run_transcription, FileMetadata, TranscriptionResult, read_text_file};
use downloader::{DownloadSession, DownloadState, start_download, get_all_models_status, pause_download_model, delete_model_file};
use translation::{
    fetch_provider_models,
    translate_transcription_files,
    preview_translate_first_lines,
    cancel_preview_translate,
    store_keyring_credential,
    get_keyring_credential,
    delete_keyring_credential,
};
use hardsub::{get_system_fonts, check_hardware_encoders, get_font_render_scale, start_hardsub_task};

// Tauri Managed States
struct HardwareState(Arc<Mutex<HardwareMonitor>>);
struct LogState(Arc<AppLogs>);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionPhase {
    Idle,
    Transcribing,
    Translating,
}

pub struct TranscriptionSession {
    pub child_pid: Option<u32>,
    pub phase: SessionPhase,
    pub cancel_requested: bool,
}
pub struct TranscriptionState(pub Arc<Mutex<TranscriptionSession>>);

pub struct HardsubSession {
    pub child_pid: Option<u32>,
    pub is_running: bool,
    pub cancel_requested: bool,
}
pub struct HardsubState(pub Arc<Mutex<HardsubSession>>);

#[tauri::command]
fn load_settings() -> WhisperSettings {
    load_settings_file()
}

#[tauri::command]
fn save_settings(settings: WhisperSettings) -> Result<(), String> {
    save_settings_file(&settings)?;
    crate::ffmpeg_resolver::invalidate_ffmpeg_cache();
    Ok(())
}

#[tauri::command]
fn check_build(app: AppHandle, backend: String) -> bool {
    check_build_exists(&app, &backend)
}

#[tauri::command]
async fn probe_media_file(app: AppHandle, file_path: String) -> Result<FileMetadata, String> {
    Ok(probe_file_metadata(Some(&app), &file_path).await)
}

#[derive(serde::Serialize)]
pub struct SystemSpecs {
    pub total_ram_gb: f64,
    pub cpu_cores: usize,
    pub gpu_type: String,
}

#[tauri::command]
fn get_system_specs(hardware_state: State<'_, HardwareState>) -> SystemSpecs {
    // Reuse the HardwareMonitor's already-maintained sysinfo::System instead of
    // allocating a fresh System::new_all() + refresh_all() on every call. These
    // specs (total RAM, CPU cores) are static and already available on the monitor.
    if let Ok(monitor) = hardware_state.0.lock() {
        let (total_ram_gb, cpu_cores) = monitor.get_specs();
        SystemSpecs {
            total_ram_gb,
            cpu_cores,
            gpu_type: monitor.gpu_type.clone(),
        }
    } else {
        SystemSpecs {
            total_ram_gb: 8.0,
            cpu_cores: 4,
            gpu_type: "unknown".to_string(),
        }
    }
}

#[tauri::command]
async fn convert_media_file(
    app: AppHandle,
    state: State<'_, LogState>,
    session_state: State<'_, TranscriptionState>,
    file_path: String,
) -> Result<String, String> {
    let logs = state.0.clone();
    let session = session_state.0.clone();
    convert_to_wav(app, logs, session, file_path).await
}

#[tauri::command]
async fn start_transcription_task(
    app: AppHandle,
    log_state: State<'_, LogState>,
    session_state: State<'_, TranscriptionState>,
    settings: WhisperSettings,
    wav_path: String,
    duration_sec: f64,
) -> Result<TranscriptionResult, String> {
    let logs = log_state.0.clone();
    let session = session_state.0.clone();
    run_transcription(app, logs, session, settings, wav_path, duration_sec).await
}

#[tauri::command]
async fn cancel_transcription(session_state: State<'_, TranscriptionState>) -> Result<(), String> {
    let pid_to_kill = {
        let mut lock = session_state.0.lock().map_err(|e| format!("Lock error: {}", e))?;
        if lock.phase == SessionPhase::Idle {
            return Err("No active transcription or translation session".to_string());
        }
        lock.cancel_requested = true;
        lock.child_pid
    };

    if let Some(pid) = pid_to_kill {
        // Graceful escalation: ask the process to terminate gracefully first (SIGTERM / taskkill),
        // then escalate to hard-kill (SIGKILL / taskkill /F) if the session does not transition to Idle.
        const GRACE_DURATION: std::time::Duration = std::time::Duration::from_millis(1500);

        #[cfg(unix)]
        {
            // Terminate the process group (-PID) and individual PID using POSIX '--' argument separator
            let _ = tokio::process::Command::new("kill")
                .args(["-TERM", "--", &format!("-{}", pid), &pid.to_string()])
                .status()
                .await;
        }

        #[cfg(windows)]
        {
            let mut cmd = tokio::process::Command::new("taskkill");
            cmd.creation_flags(0x08000000);
            let _ = cmd
                .args(["/T", "/PID", &pid.to_string()])
                .status()
                .await;
        }

        // Poll session state instead of raw PID to avoid zombie process traps on Unix
        // and localized string parsing bugs from `tasklist` on non-English Windows.
        let deadline = std::time::Instant::now() + GRACE_DURATION;
        let mut session_ended = false;

        while std::time::Instant::now() < deadline {
            tokio::time::sleep(std::time::Duration::from_millis(75)).await;
            if let Ok(lock) = session_state.0.lock() {
                if lock.phase == SessionPhase::Idle {
                    session_ended = true;
                    break;
                }
            }
        }

        if !session_ended {
            // The child may have exited during the grace window and its PID been
            // recycled by an unrelated process. Only hard-kill if the process
            // still exists AND still belongs to our session (phase not Idle).
            let pid_still_ours = if let Ok(lock) = session_state.0.lock() {
                lock.phase != SessionPhase::Idle && lock.child_pid == Some(pid)
            } else {
                false
            };

            #[cfg(unix)]
            let process_alive = {
                // kill -0 is POSIX-compliant across Linux, macOS, and BSD
                tokio::process::Command::new("kill")
                    .args(["-0", &pid.to_string()])
                    .status()
                    .await
                    .map(|s| s.success())
                    .unwrap_or(false)
            };

            #[cfg(unix)]
            if pid_still_ours && process_alive {
                let _ = tokio::process::Command::new("kill")
                    .args(["-KILL", "--", &format!("-{}", pid), &pid.to_string()])
                    .status()
                    .await;
            }

            #[cfg(windows)]
            if pid_still_ours {
                let mut cmd = tokio::process::Command::new("taskkill");
                cmd.creation_flags(0x08000000);
                let _ = cmd
                    .args(["/F", "/T", "/PID", &pid.to_string()])
                    .status()
                    .await;
            }
        }
    }

    Ok(())
}

#[tauri::command]
async fn cancel_hardsub_task(
    state: State<'_, HardsubState>,
    log_state: State<'_, LogState>,
    app: AppHandle,
) -> Result<(), String> {
    let pid_to_kill = {
        let mut session = state.0.lock().map_err(|e| format!("Lock error: {}", e))?;
        if !session.is_running {
            return Ok(());
        }
        session.cancel_requested = true;
        session.child_pid
    };

    if let Some(pid) = pid_to_kill {
        log_state.0.log(&app, "Hardsub", &format!("Cancellation requested for hardsub task (PID: {})", pid));
        #[cfg(unix)]
        {
            let _ = tokio::process::Command::new("kill")
                .args(["-TERM", "--", &format!("-{}", pid), &pid.to_string()])
                .status()
                .await;
        }
        #[cfg(windows)]
        {
            let mut cmd = tokio::process::Command::new("taskkill");
            cmd.creation_flags(0x08000000);
            let _ = cmd
                .args(["/F", "/T", "/PID", &pid.to_string()])
                .status()
                .await;
        }
    }
    Ok(())
}

#[tauri::command]
fn get_logs(state: State<'_, LogState>) -> String {
    state.0.get_all()
}

#[tauri::command]
fn clear_logs(state: State<'_, LogState>) {
    state.0.clear();
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelScanResult {
    pub trans_models: Vec<String>,
    pub vad_models: Vec<String>,
}

const MAX_SCAN_DEPTH: usize = 8;

fn walk_models_dir(
    dir: &Path,
    root: &Path,
    backend: &str,
    depth: usize,
    visited: &mut std::collections::HashSet<std::path::PathBuf>,
    trans_models: &mut Vec<String>,
    vad_models: &mut Vec<String>,
) {
    if depth > MAX_SCAN_DEPTH {
        return;
    }

    if let Ok(canonical) = dir.canonicalize() {
        if !visited.insert(canonical) {
            return; // Symlink loop or already visited directory
        }
    }

    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            let file_type = match entry.file_type() {
                Ok(ft) => ft,
                Err(_) => continue,
            };

            let is_dir = file_type.is_dir() || (file_type.is_symlink() && path.is_dir());
            let is_file = file_type.is_file() || (file_type.is_symlink() && path.is_file());

            // Recurse into directories (symlinks checked via canonical visited set)
            if is_dir {
                let dir_name = path.file_name().unwrap_or_default().to_string_lossy();
                // Avoid recursing into hidden directories or huge dependency/build directories
                if !dir_name.starts_with('.') && dir_name != "node_modules" && dir_name != "target" && dir_name != "build" {
                    walk_models_dir(&path, root, backend, depth + 1, visited, trans_models, vad_models);
                }
            } else if is_file {
                let filename = path.file_name().unwrap_or_default().to_string_lossy();
                if filename.ends_with(".bin") && (filename.contains("ggml-") || filename.contains("silero")) {
                    let rel_path = path.strip_prefix(root)
                        .unwrap_or(&path)
                        .to_string_lossy()
                        .replace('\\', "/");
                        
                    if filename.contains("silero") {
                        vad_models.push(rel_path);
                    } else if !filename.contains("-openvino.bin") {
                        if backend == "OpenVINO" {
                            let base_name = filename.strip_suffix(".bin").unwrap_or(&filename);
                            let ov_encoder_name = format!("{}-encoder-openvino.bin", base_name);
                            if let Some(parent) = path.parent() {
                                let ov_encoder_path = parent.join(ov_encoder_name);
                                if ov_encoder_path.exists() {
                                    trans_models.push(rel_path);
                                }
                            }
                        } else {
                            trans_models.push(rel_path);
                        }
                    }
                }
            }
        }
    }
}

#[tauri::command]
async fn scan_models(models_dir: String, backend: String) -> Result<ModelScanResult, String> {
    // Directory walk can be slow on large/NFS models dirs — keep it off the IPC thread
    tokio::task::spawn_blocking(move || {
        let mut trans_models = Vec::new();
        let mut vad_models = Vec::new();
        let mut visited = std::collections::HashSet::new();

        let root = Path::new(&models_dir);
        let models_dir_path = root;

        if models_dir_path.exists() && models_dir_path.is_dir() {
            walk_models_dir(models_dir_path, root, &backend, 0, &mut visited, &mut trans_models, &mut vad_models);
        }

        trans_models.sort();
        vad_models.sort();

        ModelScanResult { trans_models, vad_models }
    })
    .await
    .map_err(|e| format!("model scan failed: {}", e))
}

use tauri_plugin_dialog::DialogExt;

pub const AUDIO_EXTENSIONS: &[&str] = &[
    "mp3", "wav", "m4a", "aac", "flac", "ogg", "opus", "wma", "amr", "3ga", "aiff", "aif", "caf", "ape", "alac", "ac3", "dts", "oga",
];

pub const VIDEO_EXTENSIONS: &[&str] = &[
    "mp4", "mkv", "avi", "mov", "flv", "webm", "m4v", "wmv", "ts", "mts", "m2ts", "3gp", "3g2", "mpeg", "mpg", "vob", "ogv", "f4v",
];

pub const SUBTITLE_EXTENSIONS: &[&str] = &[
    "srt", "vtt", "ass", "ssa", "sub", "lrc",
];

fn get_filter_variants(exts: &[&str]) -> Vec<String> {
    let mut v = Vec::with_capacity(exts.len() * 2);
    for &e in exts {
        v.push(e.to_lowercase());
        v.push(e.to_uppercase());
    }
    v
}

#[tauri::command]
async fn select_file(app: AppHandle) -> Option<String> {
    let video_variants = get_filter_variants(VIDEO_EXTENSIONS);
    let video_refs: Vec<&str> = video_variants.iter().map(|s| s.as_str()).collect();

    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .add_filter("Video Files (*.mp4, *.mkv, *.webm, ...)", &video_refs)
        .add_filter("All Files (*)", &["*"])
        .pick_file(move |file| {
            let _ = tx.send(file);
        });
    match rx.await {
        Ok(Some(file_path)) => file_path.into_path().ok().map(|p| p.to_string_lossy().to_string()),
        Ok(None) => None,
        Err(e) => {
            eprintln!("[Dialog Error] select_file channel error: {}", e);
            None
        }
    }
}

#[tauri::command]
async fn select_subtitle_file(app: AppHandle) -> Option<String> {
    let sub_variants = get_filter_variants(SUBTITLE_EXTENSIONS);
    let sub_refs: Vec<&str> = sub_variants.iter().map(|s| s.as_str()).collect();

    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .add_filter("Subtitle Files (*.srt, *.vtt, *.ass, ...)", &sub_refs)
        .add_filter("All Files (*)", &["*"])
        .pick_file(move |file| {
            let _ = tx.send(file);
        });
    match rx.await {
        Ok(Some(file_path)) => file_path.into_path().ok().map(|p| p.to_string_lossy().to_string()),
        Ok(None) => None,
        Err(e) => {
            eprintln!("[Dialog Error] select_subtitle_file channel error: {}", e);
            None
        }
    }
}

#[tauri::command]
async fn select_files(app: AppHandle) -> Option<Vec<String>> {
    let audio_variants = get_filter_variants(AUDIO_EXTENSIONS);
    let video_variants = get_filter_variants(VIDEO_EXTENSIONS);
    let mut all_media_variants = Vec::with_capacity(audio_variants.len() + video_variants.len());
    all_media_variants.extend(audio_variants.clone());
    all_media_variants.extend(video_variants.clone());

    let all_media_refs: Vec<&str> = all_media_variants.iter().map(|s| s.as_str()).collect();
    let audio_refs: Vec<&str> = audio_variants.iter().map(|s| s.as_str()).collect();
    let video_refs: Vec<&str> = video_variants.iter().map(|s| s.as_str()).collect();

    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .add_filter("All Media (*.mp3, *.wav, *.mp4, *.mkv, *.opus, ...)", &all_media_refs)
        .add_filter("Audio Files (*.mp3, *.wav, *.m4a, *.opus, *.flac, ...)", &audio_refs)
        .add_filter("Video Files (*.mp4, *.mkv, *.mov, *.webm, ...)", &video_refs)
        .add_filter("All Files (*)", &["*"])
        .pick_files(move |files| {
            let _ = tx.send(files);
        });
    match rx.await {
        Ok(Some(files)) => Some(files.into_iter().filter_map(|p| p.into_path().ok()).map(|p| p.to_string_lossy().to_string()).collect()),
        Ok(None) => None,
        Err(e) => {
            eprintln!("[Dialog Error] select_files channel error: {}", e);
            None
        }
    }
}

#[tauri::command]
async fn select_directory(app: AppHandle) -> Option<String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .pick_folder(move |dir| {
            let _ = tx.send(dir);
        });
    rx.await.ok().flatten().and_then(|p| p.into_path().ok()).map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
async fn verify_directory_writable(dir_path: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let p = std::path::Path::new(&dir_path);
        if !p.exists() {
            std::fs::create_dir_all(p)
                .map_err(|e| format!("Failed to create directory '{}': {}", dir_path, e))?;
        }
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let test_file = p.join(format!(".whisper_perm_test_{}_{}", std::process::id(), nonce));
        std::fs::write(&test_file, b"ok")
            .map_err(|e| format!("Directory '{}' is not writable: {}", dir_path, e))?;
        let _ = std::fs::remove_file(&test_file);
        Ok(())
    })
    .await
    .map_err(|e| format!("Directory check failed: {e}"))?
}



#[tauri::command]
fn read_text_file_content(file_path: String) -> Result<String, String> {
    let path = std::path::Path::new(&file_path);
    let allowed_exts = ["txt", "srt", "vtt", "lrc", "ass"];
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
    if !allowed_exts.contains(&ext) {
        return Err("File type not allowed".into());
    }
    let canonical = path.canonicalize().map_err(|_| "Invalid file path".to_string())?;
    read_text_file(canonical.to_string_lossy().to_string())
}

/// A file's size on disk, in bytes, for the subtitle card's readout. The card used to
/// measure the decoded text it had loaded, which counts characters rather than bytes — a
/// Persian subtitle is mostly two-byte characters in UTF-8, so it was reported at about
/// half its size. Only the file knows how many bytes it holds; how the text happened to
/// be decoded (a UTF-16 file, a BOM the reader strips) does not change that.
#[tauri::command]
fn get_file_size(file_path: String) -> Result<u64, String> {
    std::fs::metadata(&file_path)
        .map(|meta| meta.len())
        .map_err(|e| format!("Failed to read the file's size: {e}"))
}

#[tauri::command]
fn write_text_file_content(file_path: String, content: String) -> Result<(), String> {
    let path = std::path::Path::new(&file_path);
    let allowed_exts = ["txt", "srt", "vtt", "lrc", "ass"];
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
    if !allowed_exts.contains(&ext) {
        return Err("File type not allowed for writing".into());
    }
    // Atomic write: stage into a sibling .tmp file then rename over the target,
    // so a crash or disk-full mid-write cannot truncate the user's transcript.
    let tmp_path = path.with_file_name({
        let mut name = path.file_name().unwrap_or_default().to_os_string();
        name.push(format!(".tmp.{}", std::process::id()));
        name
    });
    std::fs::write(&tmp_path, content)
        .map_err(|e| format!("Failed to write temp file {}: {}", tmp_path.display(), e))?;
    match std::fs::rename(&tmp_path, path) {
        Ok(()) => Ok(()),
        Err(e) => {
            let _ = std::fs::remove_file(&tmp_path);
            Err(format!("Failed to save file {}: {}", path.display(), e))
        }
    }
}

#[tauri::command]
fn start_download_model_task(
    app: AppHandle,
    download_state: State<'_, DownloadState>,
    models_dir: String,
    model_name: String,
) -> Result<(), String> {
    start_download(app, download_state.0.clone(), models_dir, model_name)
}

#[tauri::command]
fn get_ffmpeg_status(app: AppHandle, source: Option<String>) -> crate::ffmpeg_resolver::FFmpegStatus {
    crate::ffmpeg_resolver::get_current_ffmpeg_status(Some(&app), source)
}

#[tauri::command]
fn copy_to_clipboard(app: AppHandle, text: String) -> Result<(), String> {
    use tauri_plugin_clipboard_manager::ClipboardExt;
    app.clipboard()
        .write_text(text)
        .map_err(|e| format!("Failed to copy to clipboard: {}", e))
}

pub(crate) fn ensure_directory_exists_if_folder(file_path: &str) {
    let path = std::path::Path::new(file_path);
    if !path.exists() && (path.extension().is_none() || file_path.contains("whisper.cpp") || file_path.ends_with('/') || file_path.ends_with('\\')) {
        let _ = std::fs::create_dir_all(path);
    }
}

#[cfg(target_os = "linux")]
pub fn get_clean_host_ld_library_path() -> Option<String> {
    if let Ok(orig_ld) = std::env::var("LD_LIBRARY_PATH_ORIG") {
        if !orig_ld.trim().is_empty() {
            return Some(orig_ld);
        } else {
            return None;
        }
    }
    if let Ok(current_ld) = std::env::var("LD_LIBRARY_PATH") {
        let appdir = std::env::var("APPDIR").unwrap_or_default();
        let cleaned: Vec<&str> = current_ld
            .split(':')
            .filter(|part| {
                if part.is_empty() {
                    return false;
                }
                if !appdir.is_empty() && part.starts_with(&appdir) {
                    return false;
                }
                if part.contains(".mount_") {
                    return false;
                }
                true
            })
            .collect();
        if !cleaned.is_empty() {
            return Some(cleaned.join(":"));
        }
    }
    None
}

#[cfg(target_os = "linux")]
pub const HOST_REMOVED_ENV_VARS: &[&str] = &[
    "GIO_MODULE_DIR",
    "GSETTINGS_SCHEMA_DIR",
    "GST_PLUGIN_SYSTEM_PATH",
    "GST_PLUGIN_SCANNER",
    "GST_PLUGIN_PATH",
    "GST_PLUGIN_SYSTEM_PATH_1_0",
    "GDK_PIXBUF_MODULE_FILE",
];

#[cfg(target_os = "linux")]
pub fn sanitize_host_command(cmd: &mut std::process::Command) {
    if let Some(ld) = get_clean_host_ld_library_path() {
        cmd.env("LD_LIBRARY_PATH", ld);
    } else {
        cmd.env_remove("LD_LIBRARY_PATH");
    }

    for var in HOST_REMOVED_ENV_VARS {
        cmd.env_remove(var);
    }
}

#[cfg(target_os = "linux")]
fn open_in_linux_file_manager(target_path: &str) -> bool {
    let p = std::path::Path::new(target_path);
    let is_file = p.is_file();
    let parent_dir = if is_file {
        p.parent().unwrap_or(p).to_string_lossy().to_string()
    } else {
        target_path.to_string()
    };

    // 1. Try standard freedesktop openers.
    // If target is a file, xdg-open/gio open opens it in the default text editor/player.
    // If target is a directory, xdg-open/gio open opens it in the default file manager.
    let standard_openers: &[(&str, &[&str])] = &[
        ("xdg-open", &[target_path]),
        ("gio", &["open", target_path]),
    ];

    for (bin, args) in standard_openers {
        let mut cmd = std::process::Command::new(bin);
        cmd.args(*args);
        sanitize_host_command(&mut cmd);
        cmd.stdin(std::process::Stdio::null());
        cmd.stdout(std::process::Stdio::null());
        cmd.stderr(std::process::Stdio::null());

        if let Ok(mut child) = cmd.spawn() {
            std::thread::sleep(std::time::Duration::from_millis(60));
            if let Ok(Some(status)) = child.try_wait() {
                if status.success() {
                    return true;
                }
            } else {
                return true;
            }
        }
    }

    // 2. Fallback to direct file manager binaries.
    let fallback_managers: Vec<(&str, Vec<&str>)> = if is_file {
        vec![
            ("nautilus", vec!["--select", target_path]),
            ("dolphin", vec!["--select", target_path]),
            ("thunar", vec![&parent_dir]),
            ("pcmanfm", vec![&parent_dir]),
        ]
    } else {
        vec![
            ("nautilus", vec![&parent_dir]),
            ("dolphin", vec![&parent_dir]),
            ("thunar", vec![&parent_dir]),
            ("pcmanfm", vec![&parent_dir]),
        ]
    };

    for (bin, args) in fallback_managers {
        let mut cmd = std::process::Command::new(bin);
        cmd.args(&args);
        sanitize_host_command(&mut cmd);
        cmd.stdin(std::process::Stdio::null());
        cmd.stdout(std::process::Stdio::null());
        cmd.stderr(std::process::Stdio::null());

        if let Ok(mut child) = cmd.spawn() {
            std::thread::sleep(std::time::Duration::from_millis(60));
            if let Ok(Some(status)) = child.try_wait() {
                if status.success() {
                    return true;
                }
            } else {
                return true;
            }
        }
    }

    false
}

#[tauri::command]
fn open_file_in_editor(app: AppHandle, file_path: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    ensure_directory_exists_if_folder(&file_path);

    #[cfg(target_os = "linux")]
    {
        if open_in_linux_file_manager(&file_path) {
            return Ok(());
        }
    }

    app.opener()
        .open_path(&file_path, None::<&str>)
        .map_err(|e| format!("Failed to open file in editor: {}", e))
}

#[tauri::command]
fn exit_app(app: AppHandle) {
    app.exit(0);
}

#[tauri::command]
fn hide_to_tray(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        window.hide().map_err(|e| format!("Failed to hide window: {}", e))
    } else {
        Ok(())
    }
}

#[tauri::command]
fn set_window_zoom(window: tauri::WebviewWindow, scale: f64) -> Result<(), String> {
    if !scale.is_finite() || scale <= 0.0 {
        return Err("Scale must be a positive finite number".to_string());
    }
    window.set_zoom(scale).map_err(|e| format!("Failed to set webview zoom: {}", e))
}

fn main() {
    #[cfg(target_os = "linux")]
    {
        // Preserve original host LD_LIBRARY_PATH before AppImage modifications
        if let Ok(orig_ld) = std::env::var("LD_LIBRARY_PATH") {
            if std::env::var("LD_LIBRARY_PATH_ORIG").is_err() {
                std::env::set_var("LD_LIBRARY_PATH_ORIG", orig_ld);
            }
        }

        // Prevent WebKitGTK double-DPI scaling on modern Linux distributions (e.g. Arch/Wayland)
        // when GDK_SCALE is not explicitly configured by the user.
        if std::env::var("GDK_SCALE").is_err() && std::env::var("GDK_DPI_SCALE").is_err() {
            std::env::set_var("GDK_DPI_SCALE", "1.0");
        }

        // Prevent WebKitGTK DMA-BUF renderer compositing glitches and texture ghosting on Linux / VMs
        if std::env::var("WEBKIT_DISABLE_DMABUF_RENDERER").is_err() {
            std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        }

        // Resolve WebKit subprocess and GStreamer dependencies inside AppImage environment.
        if let Ok(appdir) = std::env::var("APPDIR") {
            if std::env::var("WEBKIT_DISABLE_SANDBOX").is_err() {
                std::env::set_var("WEBKIT_DISABLE_SANDBOX", "1");
            }

            let mut ld_paths = vec![format!("{}/shared/lib", appdir)];
            let usr_lib_x86 = format!("{}/usr/lib/x86_64-linux-gnu", appdir);
            let usr_lib_arm = format!("{}/usr/lib/aarch64-linux-gnu", appdir);
            let usr_lib_generic = format!("{}/usr/lib", appdir);

            if std::path::Path::new(&usr_lib_x86).is_dir() {
                ld_paths.push(usr_lib_x86);
            }
            if std::path::Path::new(&usr_lib_arm).is_dir() {
                ld_paths.push(usr_lib_arm);
            }
            if std::path::Path::new(&usr_lib_generic).is_dir() {
                ld_paths.push(usr_lib_generic);
            }

            let joined_ld = ld_paths.join(":");
            if let Ok(existing_paths) = std::env::var("LD_LIBRARY_PATH") {
                std::env::set_var("LD_LIBRARY_PATH", format!("{}:{}", joined_ld, existing_paths));
            } else {
                std::env::set_var("LD_LIBRARY_PATH", joined_ld);
            }

            // Configure bundled GStreamer plugins inside the AppImage to isolate strictly from host plugins
            let bundled_gst_dirs = [
                format!("{}/usr/lib/gstreamer-1.0", appdir),
                format!("{}/usr/lib/x86_64-linux-gnu/gstreamer-1.0", appdir),
                format!("{}/usr/lib/aarch64-linux-gnu/gstreamer-1.0", appdir),
            ];
            let existing_bundled_gst: Vec<String> = bundled_gst_dirs
                .into_iter()
                .filter(|p| std::path::Path::new(p).is_dir())
                .collect();

            if !existing_bundled_gst.is_empty() {
                let joined_bundled = existing_bundled_gst.join(":");
                std::env::set_var("GST_PLUGIN_SYSTEM_PATH_1_0", &joined_bundled);
                std::env::set_var("GST_PLUGIN_PATH_1_0", &joined_bundled);

                // Clean up only stale registry files whose PID is no longer alive in /proc
                let temp_dir = std::env::temp_dir();
                if let Ok(entries) = std::fs::read_dir(&temp_dir) {
                    for entry in entries.flatten() {
                        let path = entry.path();
                        if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                            if let Some(pid_str) = name.strip_prefix("whisper_appimage_gst_registry_").and_then(|s| s.strip_suffix(".bin")) {
                                if let Ok(pid) = pid_str.parse::<i32>() {
                                    let proc_path = format!("/proc/{}", pid);
                                    if !std::path::Path::new(&proc_path).exists() {
                                        let _ = std::fs::remove_file(path);
                                    }
                                }
                            }
                        }
                    }
                }

                // Set a clean isolated registry in standard temp directory
                let mut registry_path = temp_dir;
                registry_path.push(format!("whisper_appimage_gst_registry_{}.bin", std::process::id()));
                std::env::set_var("GST_REGISTRY_1_0", registry_path.to_string_lossy().as_ref());

                // Look for bundled gst-plugin-scanner (supports both x86_64 and aarch64)
                let scanner_candidates = [
                    format!("{}/usr/lib/gstreamer1.0/gstreamer-1.0/gst-plugin-scanner", appdir),
                    format!("{}/usr/lib/x86_64-linux-gnu/gstreamer1.0/gstreamer-1.0/gst-plugin-scanner", appdir),
                    format!("{}/usr/lib/x86_64-linux-gnu/gstreamer-1.0/gst-plugin-scanner", appdir),
                    format!("{}/usr/lib/aarch64-linux-gnu/gstreamer1.0/gstreamer-1.0/gst-plugin-scanner", appdir),
                    format!("{}/usr/lib/aarch64-linux-gnu/gstreamer-1.0/gst-plugin-scanner", appdir),
                    format!("{}/usr/libexec/gstreamer-1.0/gst-plugin-scanner", appdir),
                    format!("{}/usr/lib/gstreamer-1.0/gst-plugin-scanner", appdir),
                ];
                for scanner in &scanner_candidates {
                    if std::path::Path::new(scanner).is_file() {
                        std::env::set_var("GST_PLUGIN_SCANNER_1_0", scanner);
                        std::env::set_var("GST_PLUGIN_SCANNER", scanner);
                        break;
                    }
                }
            } else {
                // If AppImage has no bundled media plugins, empty the system path to prevent symbol clashes with host
                std::env::set_var("GST_PLUGIN_SYSTEM_PATH_1_0", "");
            }
        } else {
            // Native host execution (dev mode, deb, rpm):
            // Configure GStreamer plugin search paths on host Linux to ensure WebKitGTK
            // can resolve audio/video sinks (autoaudiosink, pulsesink, pipewiresink)
            let default_gst_plugin_dirs = [
                "/usr/lib/x86_64-linux-gnu/gstreamer-1.0",
                "/usr/lib64/gstreamer-1.0",
                "/usr/lib/gstreamer-1.0",
                "/usr/local/lib/gstreamer-1.0",
                "/usr/lib/i386-linux-gnu/gstreamer-1.0",
                "/usr/lib/aarch64-linux-gnu/gstreamer-1.0",
            ];
            let existing_gst_dirs: Vec<String> = default_gst_plugin_dirs
                .iter()
                .filter(|p| std::path::Path::new(p).is_dir())
                .map(|s| s.to_string())
                .collect();

            if !existing_gst_dirs.is_empty() {
                let joined = existing_gst_dirs.join(":");
                if let Ok(existing_sys) = std::env::var("GST_PLUGIN_SYSTEM_PATH_1_0") {
                    if !existing_sys.contains(&joined) {
                        std::env::set_var("GST_PLUGIN_SYSTEM_PATH_1_0", format!("{}:{}", existing_sys, joined));
                    }
                } else {
                    std::env::set_var("GST_PLUGIN_SYSTEM_PATH_1_0", &joined);
                }
                if let Ok(existing_path) = std::env::var("GST_PLUGIN_PATH_1_0") {
                    if !existing_path.contains(&joined) {
                        std::env::set_var("GST_PLUGIN_PATH_1_0", format!("{}:{}", existing_path, joined));
                    }
                } else {
                    std::env::set_var("GST_PLUGIN_PATH_1_0", &joined);
                }
            }
        }
    }

    let hardware_monitor = Arc::new(Mutex::new(HardwareMonitor::new()));
    let app_logs = Arc::new(AppLogs::new());
    let transcription_session = Arc::new(Mutex::new(TranscriptionSession {
        child_pid: None,
        phase: SessionPhase::Idle,
        cancel_requested: false,
    }));
    let hardsub_session = Arc::new(Mutex::new(HardsubSession {
        child_pid: None,
        is_running: false,
        cancel_requested: false,
    }));
    let download_session = Arc::new(Mutex::new(DownloadSession::new()));
    let app_logs_for_sink = app_logs.clone();

    let app = tauri::Builder::default()
        .setup(move |_app| {
            let media_server = Arc::new(tauri::async_runtime::block_on(video_server::MediaServer::start())
                .map_err(std::io::Error::other)?);
            let preview_root = _app.path().app_cache_dir()?.join("hardsub-preview");
            if preview_root.exists() {
                let _ = std::fs::remove_dir_all(&preview_root);
            }
            _app.manage(media_preview::PreviewState::new(media_server.clone(), preview_root));
            _app.manage(media_server);
            let logs_for_sink = app_logs_for_sink.clone();
            let handle_for_sink = _app.handle().clone();
            settings::register_log_sink(Arc::new(move |message| {
                logs_for_sink.log(&handle_for_sink, "Settings", message);
            }));

            // Setup System Tray Icon and Context Menu
            use tauri::{
                menu::{Menu, MenuItem},
                tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
                Manager,
            };

            let show_item = MenuItem::with_id(_app, "show", "Open Whisper Desktop", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(_app, "quit", "Quit Application", true, None::<&str>)?;
            let tray_menu = Menu::with_items(_app, &[&show_item, &quit_item])?;

            if let Some(icon) = _app.default_window_icon() {
                let _tray = TrayIconBuilder::new()
                    .icon(icon.clone())
                    .tooltip("Whisper Desktop")
                    .menu(&tray_menu)
                    .show_menu_on_left_click(false)
                    .on_menu_event(|app, event| match event.id.as_ref() {
                        "show" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.unminimize();
                                let _ = window.set_focus();
                            }
                        }
                        "quit" => {
                            app.exit(0);
                        }
                        _ => {}
                    })
                    .on_tray_icon_event(|tray, event| {
                        if let TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        } = event
                        {
                            let app = tray.app_handle();
                            if let Some(window) = app.get_webview_window("main") {
                                if window.is_visible().unwrap_or(false) {
                                    let _ = window.set_focus();
                                } else {
                                    let _ = window.show();
                                    let _ = window.unminimize();
                                    let _ = window.set_focus();
                                }
                            }
                        }
                    })
                    .build(_app)?;
            }

            let initial_settings = load_settings_file();
            let initial_scale = initial_settings.ui_scale;
            if let Some(window) = _app.get_webview_window("main") {
                if (initial_scale - 1.0).abs() > 0.001 {
                    let _ = window.set_zoom(initial_scale);
                }
            }

            #[cfg(target_os = "linux")]
            {
                use webkit2gtk::{WebViewExt, PermissionRequestExt, SettingsExt};
                if let Some(window) = _app.get_webview_window("main") {
                    let _ = window.with_webview(move |webview| {
                        let webview = webview.inner();
                        webview.connect_permission_request(|_webview, req| {
                            req.allow();
                            true
                        });
                        webview.set_zoom_level(initial_scale);
                        if let Some(settings) = webview.settings() {
                            settings.set_enable_smooth_scrolling(false);
                        }
                    });
                }
            }
            Ok(())
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .manage(HardwareState(hardware_monitor))
        .manage(LogState(app_logs))
        .manage(TranscriptionState(transcription_session))
        .manage(HardsubState(hardsub_session))
        .manage(DownloadState(download_session))
        .invoke_handler(tauri::generate_handler![
            load_settings,
            save_settings,
            check_build,
            probe_media_file,
            convert_media_file,
            start_transcription_task,
            cancel_transcription,
            cancel_hardsub_task,
            get_logs,
            clear_logs,
            scan_models,
            select_file,
            select_subtitle_file,
            select_files,
            select_directory,
            verify_directory_writable,
            read_text_file_content,
            get_file_size,
            write_text_file_content,
            start_download_model_task,
            get_all_models_status,
            pause_download_model,
            delete_model_file,
            get_system_specs,
            fetch_provider_models,
            translate_transcription_files,
            preview_translate_first_lines,
            cancel_preview_translate,
            store_keyring_credential,
            get_keyring_credential,
            delete_keyring_credential,
            get_system_fonts,
            check_hardware_encoders,
            get_font_render_scale,
            start_hardsub_task,
            get_ffmpeg_status,
            copy_to_clipboard,
            open_file_in_editor,
            exit_app,
            hide_to_tray,
            set_window_zoom,
            media_preview::begin_hardsub_preview,
            media_preview::advance_hardsub_preview,
            media_preview::release_hardsub_preview,
            media_preview::probe_hardsub_source,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");
    // 0 = running, 1 = draining, 2 = drained. Repeated quit requests must
    // remain prevented until both preview children and media readers settle.
    let exit_state = Arc::new(std::sync::atomic::AtomicU8::new(0));
    app.run(move |app, event| {
        if let tauri::RunEvent::ExitRequested { api, .. } = event {
            use std::sync::atomic::Ordering;
            if exit_state.load(Ordering::Acquire) == 2 { return; }
            api.prevent_exit();
            if exit_state.compare_exchange(0, 1, Ordering::AcqRel, Ordering::Acquire).is_err() { return; }
            let app = app.clone();
            let exit_state = exit_state.clone();
            tauri::async_runtime::spawn(async move {
                app.state::<media_preview::PreviewState>().shutdown().await;
                app.state::<Arc<video_server::MediaServer>>().shutdown().await;
                exit_state.store(2, Ordering::Release);
                app.exit(0);
            });
        }
    });
}

#[cfg(test)]
mod main_tests {
    use super::*;

    #[test]
    fn test_ensure_directory_exists_if_folder() {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let temp_dir = std::env::temp_dir().join(format!("whisper_main_test_folder_{}", nonce));
        let path_str = temp_dir.to_string_lossy().to_string();

        assert!(!temp_dir.exists());
        ensure_directory_exists_if_folder(&path_str);
        assert!(temp_dir.exists() && temp_dir.is_dir());

        let _ = std::fs::remove_dir_all(&temp_dir);
    }
}
