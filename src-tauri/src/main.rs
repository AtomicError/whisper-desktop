mod settings;
mod hardware;
mod logger;
mod builder;
mod transcribe;
mod downloader;

use std::sync::{Arc, Mutex};
use std::path::Path;
use tauri::{AppHandle, State};

use settings::{WhisperSettings, load_settings_file, save_settings_file, load_app_settings, save_app_settings};
use hardware::{HardwareMonitor, SystemStats};
use logger::AppLogs;
use builder::{check_build_exists, run_git_clone_or_update, run_compilation};
use transcribe::{probe_file_metadata, convert_to_wav, run_transcription, FileMetadata, TranscriptionResult, read_text_file};
use downloader::{DownloadSession, DownloadState, run_model_download, get_expected_model_size, get_all_models_status, pause_download_model, delete_model_file};

// Tauri Managed States
struct HardwareState(Arc<Mutex<HardwareMonitor>>);
struct LogState(Arc<AppLogs>);

pub struct TranscriptionSession {
    pub child_pid: Option<u32>,
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
fn check_build(clone_dir: String, backend: String) -> bool {
    check_build_exists(&clone_dir, &backend)
}

#[tauri::command]
async fn start_git_operations(
    app: AppHandle,
    state: State<'_, LogState>,
    clone_dir: String,
) -> Result<(), String> {
    let logs = state.0.clone();
    // Spawn task to prevent blocking the Tauri thread
    tokio::spawn(async move {
        let _ = run_git_clone_or_update(app, logs, clone_dir).await;
    });
    Ok(())
}

#[tauri::command]
async fn start_compilation_task(
    app: AppHandle,
    state: State<'_, LogState>,
    clone_dir: String,
    backend: String,
) -> Result<(), String> {
    let logs = state.0.clone();
    tokio::spawn(async move {
        let _ = run_compilation(app, logs, clone_dir, backend).await;
    });
    Ok(())
}

#[tauri::command]
async fn start_multi_compilations(
    app: AppHandle,
    state: State<'_, LogState>,
    clone_dir: String,
    backends: Vec<String>,
) -> Result<(), String> {
    let logs = state.0.clone();
    tokio::spawn(async move {
        for b in backends {
            let res = run_compilation(app.clone(), logs.clone(), clone_dir.clone(), b).await;
            if res.is_err() {
                break;
            }
        }
    });
    Ok(())
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
    let mut pid_to_kill = None;
    if let Ok(lock) = session_state.0.lock() {
        pid_to_kill = lock.child_pid;
    }
    
    if let Some(pid) = pid_to_kill {
        let status = std::process::Command::new("kill")
            .arg("-9")
            .arg(pid.to_string())
            .status();
            
        match status {
            Ok(s) if s.success() => {
                if let Ok(mut lock) = session_state.0.lock() {
                    lock.child_pid = None;
                }
                Ok(())
            }
            Ok(s) => Err(format!("Kill command returned exit code: {:?}", s.code())),
            Err(e) => Err(format!("Failed to execute kill command: {}", e)),
        }
    } else {
        Err("No active transcription session found to cancel.".to_string())
    }
}

#[tauri::command]
fn copy_to_clipboard(text: String) -> Result<(), String> {
    // 1. Try wl-copy first (Wayland native)
    if let Ok(mut child) = std::process::Command::new("wl-copy")
        .stdin(std::process::Stdio::piped())
        .spawn()
    {
        use std::io::Write;
        if let Some(mut stdin) = child.stdin.take() {
            let _ = stdin.write_all(text.as_bytes());
        }
        let _ = child.wait();
        return Ok(());
    }

    // 2. Try xclip (X11)
    if let Ok(mut child) = std::process::Command::new("xclip")
        .args(["-selection", "clipboard"])
        .stdin(std::process::Stdio::piped())
        .spawn()
    {
        use std::io::Write;
        if let Some(mut stdin) = child.stdin.take() {
            let _ = stdin.write_all(text.as_bytes());
        }
        let _ = child.wait();
        return Ok(());
    }

    // 3. Try xsel (X11)
    if let Ok(mut child) = std::process::Command::new("xsel")
        .args(["--clipboard", "--input"])
        .stdin(std::process::Stdio::piped())
        .spawn()
    {
        use std::io::Write;
        if let Some(mut stdin) = child.stdin.take() {
            let _ = stdin.write_all(text.as_bytes());
        }
        let _ = child.wait();
        return Ok(());
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
                walk_models_dir(&path, root, backend, trans_models, vad_models);
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
                            let ov_encoder_path = path.parent().unwrap().join(ov_encoder_name);
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
fn scan_models(clone_dir: String, backend: String) -> ModelScanResult {
    let mut trans_models = Vec::new();
    let mut vad_models = Vec::new();
    
    let root = Path::new(&clone_dir);
    let models_dir = root.join("models");
    
    if models_dir.exists() && models_dir.is_dir() {
        walk_models_dir(&models_dir, root, &backend, &mut trans_models, &mut vad_models);
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

#[tauri::command]
fn select_file() -> Option<String> {
    rfd::FileDialog::new()
        .add_filter("Audio/Video", &["mp4", "mkv", "avi", "mov", "flv", "webm", "m4v", "mp3", "wav", "ogg", "m4a", "flac", "aac", "wma"])
        .pick_file()
        .map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
fn select_files() -> Option<Vec<String>> {
    rfd::FileDialog::new()
        .add_filter("Audio/Video", &["mp4", "mkv", "avi", "mov", "flv", "webm", "m4v", "mp3", "wav", "ogg", "m4a", "flac", "aac", "wma"])
        .pick_files()
        .map(|paths| paths.into_iter().map(|p| p.to_string_lossy().to_string()).collect())
}

#[tauri::command]
fn select_directory() -> Option<String> {
    rfd::FileDialog::new()
        .pick_folder()
        .map(|p| p.to_string_lossy().to_string())
}


#[tauri::command]
fn read_text_file_content(file_path: String) -> Result<String, String> {
    read_text_file(file_path)
}

#[tauri::command]
async fn start_download_model_task(
    app: AppHandle,
    download_state: State<'_, DownloadState>,
    clone_dir: String,
    model_name: String,
) -> Result<(), String> {
    let state = download_state.0.clone();
    tokio::spawn(async move {
        let _ = run_model_download(app, state, clone_dir, model_name).await;
    });
    Ok(())
}

#[tauri::command]
fn get_model_download_progress(clone_dir: String, model_name: String) -> Result<f64, String> {
    let clean_name = model_name
        .strip_prefix("ggml-")
        .unwrap_or(&model_name)
        .strip_suffix(".bin")
        .unwrap_or(&model_name)
        .to_string();

    let models_dir = Path::new(&clone_dir).join("models");
    let target_path = models_dir.join(format!("ggml-{}.bin", clean_name));
    let tmp_path = models_dir.join(format!("ggml-{}.bin.tmp", clean_name));

    if target_path.exists() {
        return Ok(1.0);
    }

    if !tmp_path.exists() {
        return Ok(0.0);
    }

    if let Ok(meta) = std::fs::metadata(&tmp_path) {
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
    let transcription_session = Arc::new(Mutex::new(TranscriptionSession { child_pid: None }));
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
            start_git_operations,
            start_compilation_task,
            start_multi_compilations,
            probe_media_file,
            convert_media_file,
            start_transcription_task,
            cancel_transcription,
            copy_to_clipboard,
            get_logs,
            clear_logs,
            scan_models,
            select_file,
            select_files,
            select_directory,
            read_text_file_content,
            start_download_model_task,
            get_model_download_progress,
            get_all_models_status,
            pause_download_model,
            delete_model_file,
            get_system_specs
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
