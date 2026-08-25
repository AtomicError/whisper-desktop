mod settings;
mod hardware;
mod logger;
mod builder;
mod transcribe;
mod downloader;
mod translation;
mod hardsub;
mod video_server;
pub mod ffmpeg_resolver;

use std::sync::{Arc, Mutex};
use std::path::Path;
use tauri::{AppHandle, State};

use settings::{WhisperSettings, load_settings_file, save_settings_file};
use hardware::{HardwareMonitor, SystemStats};
use logger::AppLogs;
use builder::check_build_exists;
use transcribe::{probe_file_metadata, convert_to_wav, run_transcription, FileMetadata, TranscriptionResult, read_text_file};
use downloader::{DownloadSession, DownloadState, start_download, get_all_models_status, pause_download_model, delete_model_file};
use translation::{
    fetch_provider_models,
    translate_transcription_files,
    preview_translate_first_lines,
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
async fn get_system_stats(state: State<'_, HardwareState>) -> Result<SystemStats, String> {
    // Clone the Arc out and drop the State borrow immediately so we don't hold
    // Tauri's managed-state reference. get_stats() refreshes sysinfo and polls
    // the GPU (which can spawn nvidia-smi or scan /proc/*/fdinfo/*), so run it
    // on a blocking thread to avoid stalling the async runtime and other IPC calls.
    let monitor = state.0.clone();
    let stats = tokio::task::spawn_blocking(move || match monitor.lock() {
        Ok(mut monitor) => monitor.get_stats(),
        Err(_) => SystemStats {
            cpu: 0.0,
            ram: "0GB / 0GB".to_string(),
            gpu: "N/A".to_string(),
        },
    })
    .await
    .map_err(|e| format!("system stats task failed: {}", e))?;

    // A panicking worker is recoverable: report degraded zeroed stats rather than
    // surfacing an error that would throw on the frontend's HUD poll.
    Ok(stats)
}

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
            let _ = tokio::process::Command::new("taskkill")
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
                let _ = tokio::process::Command::new("taskkill")
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
            let _ = tokio::process::Command::new("taskkill")
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
                        .to_string();
                        
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

#[tauri::command]
fn open_file_in_editor(app: AppHandle, file_path: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_path(&file_path, None::<&str>)
        .map_err(|e| format!("Failed to open file in editor: {}", e))
}

fn main() {
    #[cfg(target_os = "linux")]
    {
        // Resolve WebKit subprocess ICU dependency loading crashes inside the AppImage environment.
        if std::env::var("APPIMAGE").is_ok() {
            std::env::set_var("WEBKIT_DISABLE_SANDBOX", "1");
            
            // Prevent WebKitGTK double-DPI scaling on modern Linux distributions (e.g. Arch/Wayland)
            // when GDK_SCALE is not explicitly configured by the user.
            if std::env::var("GDK_SCALE").is_err() {
                std::env::set_var("GDK_DPI_SCALE", "1.0");
            }
            
            if let Ok(appdir) = std::env::var("APPDIR") {
                let shared_lib_path = format!("{}/shared/lib", appdir);
                let usr_lib_path = format!("{}/usr/lib/x86_64-linux-gnu", appdir);
                if let Ok(existing_paths) = std::env::var("LD_LIBRARY_PATH") {
                    std::env::set_var("LD_LIBRARY_PATH", format!("{}:{}:{}", shared_lib_path, usr_lib_path, existing_paths));
                } else {
                    std::env::set_var("LD_LIBRARY_PATH", format!("{}:{}", shared_lib_path, usr_lib_path));
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

    tauri::Builder::default()
        .setup(move |_app| {
            let logs_for_sink = app_logs_for_sink.clone();
            let handle_for_sink = _app.handle().clone();
            settings::register_log_sink(Arc::new(move |message| {
                logs_for_sink.log(&handle_for_sink, "Settings", message);
            }));

            #[cfg(target_os = "linux")]
            {
                use tauri::Manager;
                use webkit2gtk::{WebViewExt, PermissionRequestExt};
                if let Some(window) = _app.get_webview_window("main") {
                    let _ = window.with_webview(|webview| {
                        let webview = webview.inner();
                        webview.connect_permission_request(|_webview, req| {
                            req.allow();
                            true
                        });
                        webview.set_zoom_level(1.0);
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
            get_system_stats,
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
            read_text_file_content,
            write_text_file_content,
            start_download_model_task,
            get_all_models_status,
            pause_download_model,
            delete_model_file,
            get_system_specs,
            fetch_provider_models,
            translate_transcription_files,
            preview_translate_first_lines,
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
            video_server::get_media_stream_url
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
