use std::path::Path;
use std::process::Stdio;
use tokio::process::Command;
use std::sync::{Arc, Mutex};
use std::collections::HashMap;
use tauri::{AppHandle, Emitter, State};
use std::fs;

// Managed state for downloads
pub struct DownloadSession {
    pub active_downloads: HashMap<String, u32>, // model_name -> child_pid
    pub paused_downloads: std::collections::HashSet<String>, // model_name
}

impl DownloadSession {
    pub fn new() -> Self {
        DownloadSession {
            active_downloads: HashMap::new(),
            paused_downloads: std::collections::HashSet::new(),
        }
    }
}

pub struct DownloadState(pub Arc<Mutex<DownloadSession>>);

// Helper to get expected sizes of the models in bytes
pub fn get_expected_model_size(model_name: &str) -> u64 {
    let lowered = model_name.trim().to_lowercase();
    let name = lowered
        .strip_prefix("ggml-")
        .unwrap_or(&lowered)
        .strip_suffix(".bin")
        .unwrap_or(&lowered)
        .to_string();

    match name.as_str() {
        "tiny" => 77830103,
        "tiny-q5_1" => 32505856,
        "tiny-q8_0" => 44040192,
        "tiny.en" => 77830103,
        "tiny.en-q5_1" => 32505856,
        "tiny.en-q8_0" => 44040192,
        "base" => 148103423,
        "base-q5_1" => 59768832,
        "base-q8_0" => 81788928,
        "base.en" => 148103423,
        "base.en-q5_1" => 59768832,
        "base.en-q8_0" => 81788928,
        "small" => 487704917,
        "small-q5_1" => 189792256,
        "small-q8_0" => 264241152,
        "small.en" => 487704917,
        "small.en-q5_1" => 189792256,
        "small.en-q8_0" => 264241152,
        "small.en-tdrz" => 487587840,
        "medium" => 1529183923,
        "medium-q5_0" => 538968064,
        "medium-q8_0" => 823132160,
        "medium.en" => 1529183923,
        "medium.en-q5_0" => 538968064,
        "medium.en-q8_0" => 823132160,
        "large-v1" => 3095027337,
        "large-v2" => 3095027337,
        "large-v2-q5_0" => 1181116006,
        "large-v2-q8_0" => 1610612736,
        "large-v3" => 3095027337,
        "large-v3-q5_0" => 1181116006,
        "large-v3-turbo" => 1610612736,
        "large-v3-turbo-q5_0" => 573566976,
        "large-v3-turbo-q8_0" => 874516480,
        "silero-v5.1.2" => 1048576,
        "silero-v6.2.0" => 1048576,
        _ => 0,
    }
}

#[derive(serde::Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ModelStatus {
    pub name: String,
    pub status: String, // "Downloaded", "Downloading", "Paused", "Not Downloaded"
    pub size_bytes: u64,
    pub downloaded_bytes: u64,
    pub progress: f64, // 0.0 to 1.0
}

#[derive(serde::Serialize, Clone)]
pub struct ModelDownloadProgress {
    pub model_name: String,
    pub progress: f64, // 0.0 to 1.0
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub speed_bps: f64,
    pub active: bool,
    pub is_paused: bool,
    pub error: Option<String>,
}

pub fn get_models_list() -> Vec<&'static str> {
    vec![
        "tiny", "tiny-q5_1", "tiny-q8_0", "tiny.en", "tiny.en-q5_1", "tiny.en-q8_0",
        "base", "base-q5_1", "base-q8_0", "base.en", "base.en-q5_1", "base.en-q8_0",
        "small", "small-q5_1", "small-q8_0", "small.en", "small.en-q5_1", "small.en-q8_0", "small.en-tdrz",
        "medium", "medium-q5_0", "medium-q8_0", "medium.en", "medium.en-q5_0", "medium.en-q8_0",
        "large-v1", "large-v2", "large-v2-q5_0", "large-v2-q8_0",
        "large-v3", "large-v3-q5_0", "large-v3-turbo", "large-v3-turbo-q5_0", "large-v3-turbo-q8_0",
        "silero-v5.1.2", "silero-v6.2.0",
    ]
}

pub async fn run_model_download(
    app: AppHandle,
    download_state: Arc<Mutex<DownloadSession>>,
    models_dir: String,
    model_name: String,
) -> Result<(), String> {
    let models_dir_path = Path::new(&models_dir);
    if !models_dir_path.exists() {
        fs::create_dir_all(models_dir_path)
            .map_err(|e| format!("Failed to create models directory: {}", e))?;
    }

    let clean_name = model_name
        .strip_prefix("ggml-")
        .unwrap_or(&model_name)
        .strip_suffix(".bin")
        .unwrap_or(&model_name)
        .to_string();

    let target_filename = format!("ggml-{}.bin", clean_name);
    let target_path = models_dir_path.join(&target_filename);
    let tmp_path = models_dir_path.join(format!("{}.tmp", target_filename));

    let mut exists = target_path.exists();
    if !exists {
        let legacy_target = models_dir_path.join("models").join(&target_filename);
        if legacy_target.exists() {
            exists = true;
        }
    }

    if exists {
        return Err(format!("Model ggml-{}.bin already exists locally.", clean_name));
    }

    let url = if clean_name.starts_with("silero-") {
        format!(
            "https://huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-{}.bin?download=true",
            clean_name
        )
    } else {
        format!(
            "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-{}.bin",
            clean_name
        )
    };

    // Spawning curl with range support (-C -) and auto-retry to handle network drops
    let mut child = Command::new("curl")
        .args([
            "-C",
            "-",
            "-L",
            "--retry",
            "8",
            "--retry-delay",
            "3",
            "-o",
            tmp_path.to_str().ok_or("Invalid temp model path")?,
            &url,
        ])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("Failed to spawn curl: {}", e))?;

    let pid = child.id().ok_or("Failed to get curl PID")?;

    {
        if let Ok(mut lock) = download_state.lock() {
            lock.active_downloads.insert(clean_name.clone(), pid);
        }
    }

    let expected_size = get_expected_model_size(&clean_name);

    // Emit initial status
    let _ = app.emit(
        "model-download-status",
        ModelDownloadProgress {
            model_name: clean_name.clone(),
            progress: 0.0,
            downloaded_bytes: 0,
            total_bytes: expected_size,
            speed_bps: 0.0,
            active: true,
            is_paused: false,
            error: None,
        },
    );

    let initial_bytes = fs::metadata(&tmp_path).map(|m| m.len()).unwrap_or(0);

    // Live progress emitter loop in Rust while curl is executing
    let app_handle = app.clone();
    let name_clone = clean_name.clone();
    let tmp_path_clone = tmp_path.clone();
    let download_state_clone = download_state.clone();

    let monitor_handle = tokio::spawn(async move {
        let mut last_bytes = initial_bytes;
        let mut last_time = std::time::Instant::now();

        loop {
            tokio::time::sleep(tokio::time::Duration::from_millis(300)).await;

            let is_still_active = if let Ok(lock) = download_state_clone.lock() {
                lock.active_downloads.contains_key(&name_clone)
            } else {
                false
            };

            if !is_still_active {
                break;
            }

            if let Ok(meta) = fs::metadata(&tmp_path_clone) {
                let current_bytes = meta.len();
                let now = std::time::Instant::now();
                let elapsed_secs = now.duration_since(last_time).as_secs_f64();

                let progress = if expected_size > 0 {
                    (current_bytes as f64 / expected_size as f64).min(0.99)
                } else {
                    0.0
                };

                let speed_bps = if elapsed_secs > 0.1 && current_bytes > last_bytes {
                    (current_bytes - last_bytes) as f64 / elapsed_secs
                } else {
                    0.0
                };

                let _ = app_handle.emit(
                    "model-download-status",
                    ModelDownloadProgress {
                        model_name: name_clone.clone(),
                        progress,
                        downloaded_bytes: current_bytes,
                        total_bytes: expected_size,
                        speed_bps,
                        active: true,
                        is_paused: false,
                        error: None,
                    },
                );

                if current_bytes > last_bytes {
                    last_bytes = current_bytes;
                    last_time = now;
                }
            }
        }
    });

    // Wait for curl to finish
    let status = child.wait().await.map_err(|e| format!("curl failed: {}", e))?;
    monitor_handle.abort();

    let was_paused = if let Ok(mut lock) = download_state.lock() {
        lock.active_downloads.remove(&clean_name);
        lock.paused_downloads.remove(&clean_name)
    } else {
        false
    };

    if status.success() {
        // Rename temp file to final destination
        fs::rename(&tmp_path, &target_path)
            .map_err(|e| format!("Failed to finalize model download file: {}", e))?;

        let _ = app.emit(
            "model-download-status",
            ModelDownloadProgress {
                model_name: clean_name.clone(),
                progress: 1.0,
                downloaded_bytes: expected_size,
                total_bytes: expected_size,
                speed_bps: 0.0,
                active: false,
                is_paused: false,
                error: None,
            },
        );
        Ok(())
    } else if was_paused {
        let _ = app.emit(
            "model-download-status",
            ModelDownloadProgress {
                model_name: clean_name.clone(),
                progress: 0.0,
                downloaded_bytes: 0,
                total_bytes: expected_size,
                speed_bps: 0.0,
                active: false,
                is_paused: true,
                error: None,
            },
        );
        Ok(())
    } else {
        // Do NOT remove temporary file on failure so it can be resumed
        let error_msg = format!("curl exited with code {:?}", status.code());
        let _ = app.emit(
            "model-download-status",
            ModelDownloadProgress {
                model_name: clean_name.clone(),
                progress: 0.0,
                downloaded_bytes: 0,
                total_bytes: expected_size,
                speed_bps: 0.0,
                active: false,
                is_paused: false,
                error: Some(error_msg.clone()),
            },
        );
        Err(error_msg)
    }
}

#[tauri::command]
pub fn get_all_models_status(
    download_state: State<'_, DownloadState>,
    models_dir: String,
) -> Result<Vec<ModelStatus>, String> {
    let models_dir_path = Path::new(&models_dir);
    let active_downloads = if let Ok(lock) = download_state.0.lock() {
        lock.active_downloads.clone()
    } else {
        HashMap::new()
    };

    let mut result = Vec::new();
    let list = get_models_list();

    for m in list {
        let bin_name = format!("ggml-{}.bin", m);
        let tmp_name = format!("{}.tmp", bin_name);

        let bin_path = models_dir_path.join(&bin_name);
        let tmp_path = models_dir_path.join(&tmp_name);

        let expected_size = get_expected_model_size(m);
        let is_active = active_downloads.contains_key(m);

        let mut bin_exists = bin_path.exists();
        let mut tmp_exists = tmp_path.exists();
        let mut active_tmp_path = tmp_path.clone();

        if !bin_exists {
            let legacy_bin = models_dir_path.join("models").join(&bin_name);
            if legacy_bin.exists() {
                bin_exists = true;
            }
        }
        if !tmp_exists {
            let legacy_tmp = models_dir_path.join("models").join(&tmp_name);
            if legacy_tmp.exists() {
                tmp_exists = true;
                active_tmp_path = legacy_tmp;
            }
        }

        let mut status = "Not Downloaded".to_string();
        let mut downloaded_bytes = 0;
        let mut progress = 0.0;

        if bin_exists {
            status = "Downloaded".to_string();
            downloaded_bytes = expected_size;
            progress = 1.0;
        } else if tmp_exists {
            if let Ok(meta) = fs::metadata(&active_tmp_path) {
                downloaded_bytes = meta.len();
                if expected_size > 0 {
                    progress = downloaded_bytes as f64 / expected_size as f64;
                    progress = progress.min(0.99); // Cap temporary progress at 99%
                }
            }
            if is_active {
                status = "Downloading".to_string();
            } else {
                status = "Paused".to_string();
            }
        }

        result.push(ModelStatus {
            name: m.to_string(),
            status,
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
    let clean_name = model_name
        .strip_prefix("ggml-")
        .unwrap_or(&model_name)
        .strip_suffix(".bin")
        .unwrap_or(&model_name)
        .to_string();

    let pid_to_kill = if let Ok(mut lock) = download_state.0.lock() {
        lock.paused_downloads.insert(clean_name.clone());
        lock.active_downloads.get(&clean_name).copied()
    } else {
        None
    };

    if let Some(pid) = pid_to_kill {
        // Kill the curl process
        let status = std::process::Command::new("kill")
            .arg("-9")
            .arg(pid.to_string())
            .status();

        match status {
            Ok(s) if s.success() => {
                if let Ok(mut lock) = download_state.0.lock() {
                    lock.active_downloads.remove(&clean_name);
                }
                Ok(())
            }
            Ok(s) => Err(format!("Kill command returned exit code: {:?}", s.code())),
            Err(e) => Err(format!("Failed to execute kill command: {}", e)),
        }
    } else {
        Err("No active download session found to pause.".to_string())
    }
}

#[tauri::command]
pub fn delete_model_file(models_dir: String, model_name: String) -> Result<(), String> {
    let clean_name = model_name
        .strip_prefix("ggml-")
        .unwrap_or(&model_name)
        .strip_suffix(".bin")
        .unwrap_or(&model_name)
        .to_string();

    let models_dir_path = Path::new(&models_dir);
    let bin_path = models_dir_path.join(format!("ggml-{}.bin", clean_name));
    let tmp_path = models_dir_path.join(format!("ggml-{}.bin.tmp", clean_name));
    
    let legacy_bin = models_dir_path.join("models").join(format!("ggml-{}.bin", clean_name));
    let legacy_tmp = models_dir_path.join("models").join(format!("ggml-{}.bin.tmp", clean_name));

    if bin_path.exists() {
        fs::remove_file(&bin_path)
            .map_err(|e| format!("Failed to delete bin file: {}", e))?;
    } else if legacy_bin.exists() {
        fs::remove_file(&legacy_bin)
            .map_err(|e| format!("Failed to delete legacy bin file: {}", e))?;
    }

    if tmp_path.exists() {
        fs::remove_file(&tmp_path)
            .map_err(|e| format!("Failed to delete tmp file: {}", e))?;
    } else if legacy_tmp.exists() {
        fs::remove_file(&legacy_tmp)
            .map_err(|e| format!("Failed to delete legacy tmp file: {}", e))?;
    }

    Ok(())
}
