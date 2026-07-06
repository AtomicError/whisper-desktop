use std::path::Path;
use std::process::Stdio;
use tokio::process::Command;
use tokio::io::{AsyncBufReadExt, BufReader};
use std::sync::Arc;
use std::fs;
use regex::Regex;
use tauri::{AppHandle, Emitter};

use crate::logger::AppLogs;

#[derive(serde::Serialize, Clone)]
pub struct BuildProgress {
    pub progress: f64, // 0.0 to 1.0
    pub message: String,
    pub active: bool,
    pub error: Option<String>,
}

pub fn check_build_exists(clone_dir: &str, backend: &str) -> bool {
    let dir_name = backend.to_lowercase();
    let build_dir_name = format!("build-{}", dir_name);
    let root = Path::new(clone_dir);
    
    let path1 = root.join(&build_dir_name).join("bin").join("whisper-cli");
    let path2 = root.join(&build_dir_name).join("whisper-cli");
    
    path1.exists() || path2.exists()
}

pub async fn run_git_clone_or_update(
    app: AppHandle,
    logs: Arc<AppLogs>,
    clone_dir: String,
) -> Result<(), String> {
    let path = Path::new(&clone_dir);
    logs.log(&app, "Build", &format!("Checking whisper.cpp repository at: {:?}", path));

    let git_dir = path.join(".git");

    if !git_dir.exists() {
        logs.log(&app, "Build", "Repository not initialized. Initializing git clone...");
        
        if !path.exists() {
            fs::create_dir_all(path).map_err(|e| format!("Failed to create clone directory: {}", e))?;
        }
        
        let mut child = Command::new("git")
            .args([
                "clone",
                "https://github.com/ggml-org/whisper.cpp.git",
                ".",
            ])
            .current_dir(path)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to start git clone: {}", e))?;
            
        stream_command_output(app.clone(), logs.clone(), &mut child, "Build").await?;
        logs.log(&app, "Build", "Cloning completed successfully!");
    } else {
        logs.log(&app, "Build", "whisper.cpp repository already exists. Checking for local changes...");
        
        let status_output = std::process::Command::new("git")
            .args(["status", "--porcelain"])
            .current_dir(path)
            .output();

        let has_changes = match status_output {
            Ok(out) => !out.stdout.is_empty(),
            Err(_) => false,
        };

        if has_changes {
            logs.log(&app, "Build", "Local changes/downloads detected in the repository. Stashing unstaged files...");
            let mut stash_child = Command::new("git")
                .args(["stash"])
                .current_dir(path)
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
                .map_err(|e| format!("Failed to start git stash: {}", e))?;
            let _ = stream_command_output(app.clone(), logs.clone(), &mut stash_child, "Build").await;

            logs.log(&app, "Build", "Running git pull...");
            let mut pull_child = Command::new("git")
                .args(["pull"])
                .current_dir(path)
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
                .map_err(|e| format!("Failed to start git pull: {}", e))?;
            let pull_result = stream_command_output(app.clone(), logs.clone(), &mut pull_child, "Build").await;

            logs.log(&app, "Build", "Restoring local changes/downloads...");
            let mut pop_child = Command::new("git")
                .args(["stash", "pop"])
                .current_dir(path)
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
                .map_err(|e| format!("Failed to start git stash pop: {}", e))?;
            let _ = stream_command_output(app.clone(), logs.clone(), &mut pop_child, "Build").await;

            pull_result?;
        } else {
            logs.log(&app, "Build", "Running git pull...");
            let mut child = Command::new("git")
                .args(["pull"])
                .current_dir(path)
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
                .map_err(|e| format!("Failed to start git pull: {}", e))?;
            stream_command_output(app.clone(), logs.clone(), &mut child, "Build").await?;
        }
        
        logs.log(&app, "Build", "Repository updated successfully!");
    }
    
    Ok(())
}

async fn run_compilation_inner(
    app: AppHandle,
    logs: Arc<AppLogs>,
    clone_dir: String,
    backend: String,
) -> Result<(), String> {
    let root = Path::new(&clone_dir);
    if !root.exists() {
        return Err("whisper.cpp directory does not exist! Clone it first.".to_string());
    }
    
    let dir_name = backend.to_lowercase();
    let build_dir_name = format!("build-{}", dir_name);
    let build_dir = root.join(&build_dir_name);
    
    logs.log(&app, "Build", &format!("Cleaning build directory: {:?}", build_dir));
    let _ = fs::remove_dir_all(&build_dir);
    
    // Set up Cmake config arguments
    let mut config_args = vec![
        "-B".to_string(),
        build_dir.to_str().ok_or("Invalid build path")?.to_string(),
        "-DCMAKE_BUILD_TYPE=Release".to_string(),
    ];
    
    match backend.as_str() {
        "Vulkan" => config_args.push("-DGGML_VULKAN=ON".to_string()),
        "OpenVINO" => config_args.push("-DWHISPER_OPENVINO=1".to_string()),
        "CUDA" => config_args.push("-DGGML_CUDA=ON".to_string()),
        _ => {} // Standard CPU uses no extra flags
    }
    
    config_args.push(clone_dir.clone());
    
    // 1. CMake Configure
    logs.log(&app, "Build", &format!("Configuring build: cmake {}", config_args.join(" ")));
    app.emit("build-status", BuildProgress {
        progress: 0.0,
        message: "Configuring build (CMake)...".to_string(),
        active: true,
        error: None,
    }).unwrap();
    
    let mut child = Command::new("cmake")
        .args(&config_args)
        .current_dir(root)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start cmake configure: {}", e))?;
        
    stream_command_output(app.clone(), logs.clone(), &mut child, "Build").await?;
    
    // 2. CMake Build
    logs.log(&app, "Build", "Starting compilation...");
    app.emit("build-status", BuildProgress {
        progress: 0.05,
        message: "Compiling code...".to_string(),
        active: true,
        error: None,
    }).unwrap();
    
    let build_args = [
        "--build",
        build_dir.to_str().ok_or("Invalid build path")?,
        "-j",
        "--config",
        "Release",
    ];
    
    let mut child = Command::new("cmake")
        .args(build_args)
        .current_dir(root)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start cmake build: {}", e))?;
        
    stream_compilation_progress(app.clone(), logs.clone(), &mut child).await?;
    
    Ok(())
}

pub async fn run_compilation(
    app: AppHandle,
    logs: Arc<AppLogs>,
    clone_dir: String,
    backend: String,
) -> Result<(), String> {
    let res = run_compilation_inner(app.clone(), logs.clone(), clone_dir.clone(), backend.clone()).await;
    if let Err(e) = res {
        let mut err_msg = e.clone();
        if backend == "Vulkan" {
            err_msg = format!(
                "{} (Vulkan SDK/Headers might be missing. Please install dependencies:\n\
                - Ubuntu/Debian: sudo apt update && sudo apt install libvulkan-dev vulkan-tools\n\
                - Arch Linux: sudo pacman -Syu vulkan-devel vulkan-tools\n\
                - Fedora: sudo dnf install vulkan-loader-devel vulkan-tools)",
                e
            );
        }
        logs.log(&app, "Build", &format!("Build failed: {}", err_msg));
        let _ = app.emit("build-status", BuildProgress {
            progress: 0.0,
            message: format!("Build failed! Check logs for details."),
            active: false,
            error: Some(err_msg.clone()),
        });
        return Err(err_msg);
    }
    
    logs.log(&app, "Build", &format!("Success! {} build completed.", backend));
    app.emit("build-status", BuildProgress {
        progress: 1.0,
        message: format!("Build finished! ready to use."),
        active: false,
        error: None,
    }).unwrap();
    
    Ok(())
}

async fn stream_command_output(
    app: AppHandle,
    logs: Arc<AppLogs>,
    child: &mut tokio::process::Child,
    category: &str,
) -> Result<(), String> {
    let stdout = child.stdout.take().ok_or("Failed to capture stdout")?;
    let stderr = child.stderr.take().ok_or("Failed to capture stderr")?;
    
    let mut stdout_reader = BufReader::new(stdout).lines();
    let mut stderr_reader = BufReader::new(stderr).lines();
    
    loop {
        tokio::select! {
            line = stdout_reader.next_line() => {
                match line {
                    Ok(Some(l)) => logs.log(&app, category, &l),
                    Ok(None) => break,
                    Err(_) => {}
                }
            }
            line = stderr_reader.next_line() => {
                match line {
                    Ok(Some(l)) => logs.log(&app, category, &l),
                    _ => {}
                }
            }
        }
    }
    
    let status = child.wait().await.map_err(|e| format!("Wait failed: {}", e))?;
    if !status.success() {
        return Err(format!("Command failed with exit status code: {:?}", status.code()));
    }
    
    Ok(())
}

async fn stream_compilation_progress(
    app: AppHandle,
    logs: Arc<AppLogs>,
    child: &mut tokio::process::Child,
) -> Result<(), String> {
    let stdout = child.stdout.take().ok_or("Failed to capture stdout")?;
    let stderr = child.stderr.take().ok_or("Failed to capture stderr")?;
    
    let mut stdout_reader = BufReader::new(stdout).lines();
    let mut stderr_reader = BufReader::new(stderr).lines();
    
    let pct_regex = Regex::new(r"\[\s*(\d+)%\]").unwrap();
    let ninja_regex = Regex::new(r"\[\s*(\d+)/(\d+)\]").unwrap();
    
    loop {
        tokio::select! {
            line = stdout_reader.next_line() => {
                match line {
                    Ok(Some(l)) => {
                        logs.log(&app, "Build", &l);
                        
                        // Check for [%] formats (CMake / Make)
                        if let Some(caps) = pct_regex.captures(&l) {
                            if let Some(pct_match) = caps.get(1) {
                                if let Ok(pct_val) = pct_match.as_str().parse::<f64>() {
                                    let progress = pct_val / 100.0;
                                    let _ = app.emit("build-status", BuildProgress {
                                        progress,
                                        message: format!("Compiling: {:.0}%", pct_val),
                                        active: true,
                                        error: None,
                                    });
                                }
                            }
                        }
                        
                        // Check for [x/y] formats (Ninja / Make)
                        if let Some(caps) = ninja_regex.captures(&l) {
                            if let (Some(curr_match), Some(total_match)) = (caps.get(1), caps.get(2)) {
                                if let (Ok(curr), Ok(total)) = (curr_match.as_str().parse::<f64>(), total_match.as_str().parse::<f64>()) {
                                    if total > 0.0 {
                                        let progress = curr / total;
                                        let _ = app.emit("build-status", BuildProgress {
                                            progress,
                                            message: format!("Compiling files: {}/{}", curr, total),
                                            active: true,
                                            error: None,
                                        });
                                    }
                                }
                            }
                        }
                    }
                    Ok(None) => break,
                    Err(_) => {}
                }
            }
            line = stderr_reader.next_line() => {
                match line {
                    Ok(Some(l)) => logs.log(&app, "Build", &l),
                    _ => {}
                }
            }
        }
    }
    
    let status = child.wait().await.map_err(|e| format!("Wait failed: {}", e))?;
    if !status.success() {
        return Err(format!("Compilation failed with exit status code: {:?}", status.code()));
    }
    
    Ok(())
}
