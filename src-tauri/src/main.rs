mod settings;
mod hardware;
mod logger;
mod builder;
mod transcribe;
mod downloader;
mod translation;
mod hardsub;
mod video_server;

use std::sync::{Arc, Mutex};
use std::path::Path;
use tauri::{AppHandle, State};

use settings::{WhisperSettings, load_settings_file, save_settings_file, load_app_settings, save_app_settings};
use hardware::{HardwareMonitor, SystemStats};
use logger::AppLogs;
use builder::check_build_exists;
use transcribe::{probe_file_metadata, convert_to_wav, run_transcription, FileMetadata, TranscriptionResult, read_text_file};
use downloader::{DownloadSession, DownloadState, run_model_download, get_expected_model_size, get_all_models_status, pause_download_model, delete_model_file};
use translation::{
    fetch_provider_models,
    translate_transcription_files,
    preview_translate_first_lines,
    store_keyring_credential,
    get_keyring_credential,
    delete_keyring_credential,
};
use hardsub::{get_system_fonts, check_hardware_encoders, start_hardsub_task};

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

#[tauri::command]
fn get_system_stats(state: State<'_, HardwareState>) -> SystemStats {
    if let Ok(mut monitor) = state.0.lock() {
        monitor.get_stats()
    } else {
        SystemStats {
            cpu: 0.0,
            ram: "0GB / 0GB".to_string(),
            gpu: "N/A".to_string(),
        }
    }
}

#[tauri::command]
fn load_settings() -> WhisperSettings {
    load_settings_file()
}

#[tauri::command]
fn save_settings(settings: WhisperSettings) -> Result<(), String> {
    save_settings_file(&settings)
}

#[tauri::command]
fn apply_preset(preset: String) -> Result<WhisperSettings, String> {
    let mut app_settings = load_app_settings();
    app_settings.active_preset = preset.to_lowercase();
    save_app_settings(&app_settings)?;
    Ok(app_settings.get_active())
}

#[tauri::command]
fn check_build(app: AppHandle, backend: String) -> bool {
    check_build_exists(&app, &backend)
}

#[tauri::command]
fn probe_media_file(file_path: String) -> FileMetadata {
    probe_file_metadata(&file_path)
}

#[derive(serde::Serialize)]
pub struct SystemSpecs {
    pub total_ram_gb: f64,
    pub cpu_cores: usize,
    pub gpu_type: String,
}

#[tauri::command]
fn get_system_specs(hardware_state: State<'_, HardwareState>) -> SystemSpecs {
    use sysinfo::System;
    let mut sys = System::new_all();
    sys.refresh_all();
    
    let total_ram_gb = sys.total_memory() as f64 / 1024.0 / 1024.0 / 1024.0;
    let cpu_cores = sys.cpus().len();
    
    let gpu_type = if let Ok(monitor) = hardware_state.0.lock() {
        monitor.gpu_type.clone()
    } else {
        "unknown".to_string()
    };
    
    SystemSpecs {
        total_ram_gb,
        cpu_cores,
        gpu_type,
    }
}

#[tauri::command]
async fn convert_media_file(
    app: AppHandle,
    state: State<'_, LogState>,
    file_path: String,
) -> Result<String, String> {
    let logs = state.0.clone();
    convert_to_wav(app, logs, file_path).await
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
fn cancel_transcription(session_state: State<'_, TranscriptionState>) -> Result<(), String> {
    let pid_to_kill = {
        let mut lock = session_state.0.lock().map_err(|e| format!("Lock error: {}", e))?;
        if lock.phase == SessionPhase::Idle {
            return Err("No active transcription or translation session".to_string());
        }
        lock.cancel_requested = true;
        lock.child_pid.take()
    };

    match pid_to_kill {
        Some(pid) => {
            let status = std::process::Command::new("kill")
                .arg("-9")
                .arg(pid.to_string())
                .status();

            match status {
                Ok(s) if s.success() => Ok(()),
                Ok(s) => Err(format!("Kill command returned exit code: {:?}", s.code())),
                Err(e) => Err(format!("Failed to execute kill command: {}", e)),
            }
        }
        None => Ok(()),
    }
}

#[tauri::command]
fn copy_to_clipboard(text: String) -> Result<(), String> {
    use std::io::Write;

    let try_copy = |cmd: &str, args: &[&str]| -> Result<(), String> {
        let mut child = std::process::Command::new(cmd)
            .args(args)
            .stdin(std::process::Stdio::piped())
            .spawn()
            .map_err(|e| format!("spawn {} failed: {}", cmd, e))?;
        if let Some(mut stdin) = child.stdin.take() {
            stdin.write_all(text.as_bytes())
                .map_err(|e| format!("write to {} stdin failed: {}", cmd, e))?;
        }
        let status = child.wait()
            .map_err(|e| format!("wait for {} failed: {}", cmd, e))?;
        if !status.success() {
            return Err(format!("{} exited with {:?}", cmd, status.code()));
        }
        Ok(())
    };

    for (cmd, args) in [("wl-copy", &[] as &[&str]), ("xclip", &["-selection", "clipboard"]), ("xsel", &["--clipboard", "--input"])] {
        if try_copy(cmd, args).is_ok() {
            return Ok(());
        }
    }

    Err("All clipboard tools (wl-copy, xclip, xsel) failed or are not installed.".to_string())
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

fn walk_models_dir(
    dir: &Path,
    root: &Path,
    backend: &str,
    trans_models: &mut Vec<String>,
    vad_models: &mut Vec<String>,
) {
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                let dir_name = path.file_name().unwrap_or_default().to_string_lossy();
                // Avoid recursing into hidden directories or huge dependency/build directories
                if !dir_name.starts_with('.') && dir_name != "node_modules" && dir_name != "target" && dir_name != "build" {
                    walk_models_dir(&path, root, backend, trans_models, vad_models);
                }
            } else if path.is_file() {
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
                            let ov_encoder_path = path.parent().expect("file path has parent").join(ov_encoder_name);
                            if ov_encoder_path.exists() {
                                trans_models.push(rel_path);
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
fn scan_models(models_dir: String, backend: String) -> ModelScanResult {
    let mut trans_models = Vec::new();
    let mut vad_models = Vec::new();
    
    let root = Path::new(&models_dir);
    let models_dir_path = root;
    
    if models_dir_path.exists() && models_dir_path.is_dir() {
        walk_models_dir(models_dir_path, root, &backend, &mut trans_models, &mut vad_models);
    }
    
    if trans_models.is_empty() {
        trans_models.push("No trans models found".to_string());
    }
    if vad_models.is_empty() {
        vad_models.push("No VAD models found".to_string());
    }
    
    trans_models.sort();
    vad_models.sort();
    
    ModelScanResult { trans_models, vad_models }
}

use tauri_plugin_dialog::DialogExt;

#[tauri::command]
async fn select_file(app: AppHandle) -> Option<String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .add_filter("Video Files (*.mp4, *.mkv, *.webm)", &["mp4", "mkv", "avi", "mov", "flv", "webm", "m4v", "MP4", "MKV", "WEBM", "MOV", "AVI", "FLV"])
        .add_filter("All Files (*)", &["*"])
        .pick_file(move |file| {
            let _ = tx.send(file);
        });
    rx.await.ok().flatten().and_then(|p| p.into_path().ok()).map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
async fn select_subtitle_file(app: AppHandle) -> Option<String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .add_filter("Subtitle Files (*.srt, *.vtt, *.ass)", &["srt", "vtt", "ass", "ssa", "sub", "SRT", "VTT", "ASS", "SSA", "SUB"])
        .add_filter("All Files (*)", &["*"])
        .pick_file(move |file| {
            let _ = tx.send(file);
        });
    rx.await.ok().flatten().and_then(|p| p.into_path().ok()).map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
async fn select_files(app: AppHandle) -> Option<Vec<String>> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .add_filter("Audio/Video", &["mp4", "mkv", "avi", "mov", "flv", "webm", "m4v", "mp3", "wav", "ogg", "m4a", "flac", "aac", "wma"])
        .pick_files(move |files| {
            let _ = tx.send(files);
        });
    rx.await.ok().flatten()
        .map(|files| files.into_iter().filter_map(|p| p.into_path().ok()).map(|p| p.to_string_lossy().to_string()).collect())
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
    std::fs::write(path, content).map_err(|e| e.to_string())
}

#[tauri::command]
async fn start_download_model_task(
    app: AppHandle,
    download_state: State<'_, DownloadState>,
    models_dir: String,
    model_name: String,
) -> Result<(), String> {
    let state = download_state.0.clone();
    tokio::spawn(async move {
        if let Err(e) = run_model_download(app, state, models_dir, model_name).await {
            eprintln!("[download] model download failed: {}", e);
        }
    });
    Ok(())
}

#[tauri::command]
fn get_model_download_progress(models_dir: String, model_name: String) -> Result<f64, String> {
    let lowered = model_name.to_lowercase();
    let clean_name = lowered
        .strip_prefix("ggml-")
        .unwrap_or(&lowered)
        .strip_suffix(".bin")
        .unwrap_or(&lowered)
        .to_string();

    let models_dir_path = Path::new(&models_dir);
    let target_path = models_dir_path.join(format!("ggml-{}.bin", clean_name));
    let tmp_path = models_dir_path.join(format!("ggml-{}.bin.tmp", clean_name));

    let mut target_exists = target_path.exists();
    let mut tmp_exists = tmp_path.exists();
    let mut active_tmp = tmp_path;

    if !target_exists {
        let legacy_target = models_dir_path.join("models").join(format!("ggml-{}.bin", clean_name));
        if legacy_target.exists() {
            target_exists = true;
        }
    }

    if target_exists {
        return Ok(1.0);
    }

    if !tmp_exists {
        let legacy_tmp = models_dir_path.join("models").join(format!("ggml-{}.bin.tmp", clean_name));
        if legacy_tmp.exists() {
            tmp_exists = true;
            active_tmp = legacy_tmp;
        }
    }

    if !tmp_exists {
        return Ok(0.0);
    }

    if let Ok(meta) = std::fs::metadata(&active_tmp) {
        let current_size = meta.len();
        let expected_size = get_expected_model_size(&clean_name);
        if expected_size > 0 {
            let progress = current_size as f64 / expected_size as f64;
            return Ok(progress.min(0.99)); // Cap at 99% until renamed to .bin
        }
    }

    Ok(0.0)
}

fn main() {
    // Resolve WebKit subprocess ICU dependency loading crashes inside the AppImage environment.
    if std::env::var("APPIMAGE").is_ok() {
        std::env::set_var("WEBKIT_DISABLE_SANDBOX", "1");
        
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

    let hardware_monitor = Arc::new(Mutex::new(HardwareMonitor::new()));
    let app_logs = Arc::new(AppLogs::new());
    let transcription_session = Arc::new(Mutex::new(TranscriptionSession {
        child_pid: None,
        phase: SessionPhase::Idle,
        cancel_requested: false,
    }));
    let download_session = Arc::new(Mutex::new(DownloadSession::new()));
    
    tauri::Builder::default()
        .setup(|app| {
            #[cfg(target_os = "linux")]
            {
                use tauri::Manager;
                use webkit2gtk::{WebViewExt, PermissionRequestExt};
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.with_webview(|webview| {
                        let webview = webview.inner();
                        webview.connect_permission_request(|_webview, req| {
                            req.allow();
                            true
                        });
                    });
                }
            }
            Ok(())
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(HardwareState(hardware_monitor))
        .manage(LogState(app_logs))
        .manage(TranscriptionState(transcription_session))
        .manage(DownloadState(download_session))
        .invoke_handler(tauri::generate_handler![
            get_system_stats,
            load_settings,
            save_settings,
            apply_preset,
            check_build,
            probe_media_file,
            convert_media_file,
            start_transcription_task,
            cancel_transcription,
            copy_to_clipboard,
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
            get_model_download_progress,
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
            start_hardsub_task,
            video_server::get_media_stream_url
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
