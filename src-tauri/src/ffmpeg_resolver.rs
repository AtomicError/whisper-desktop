use std::path::{Path, PathBuf};
use tauri::Manager;

/// Resolves the absolute path to `ffmpeg` or `ffprobe`.
/// Search priority:
/// 1. Bundled in Tauri resources (`resources/ffmpeg` or `resources/ffprobe`).
/// 2. Local development path (`src-tauri/resources/ffmpeg`).
/// 3. Adjacent to running executable (`./resources/ffmpeg` or `./ffmpeg`).
/// 4. System PATH (`ffmpeg` or `ffprobe`).
pub fn resolve_binary_path(app: Option<&tauri::AppHandle>, binary_name: &str) -> PathBuf {
    let exe_suffix = std::env::consts::EXE_SUFFIX;
    let full_name = if binary_name.ends_with(exe_suffix) || exe_suffix.is_empty() {
        binary_name.to_string()
    } else {
        format!("{}{}", binary_name, exe_suffix)
    };

    let is_valid_executable = |p: &Path| -> bool {
        if !p.exists() || !p.is_file() {
            return false;
        }
        // Valid executable should not be an empty placeholder (which is usually < 1KB)
        if let Ok(meta) = std::fs::metadata(p) {
            if meta.len() > 100_000 {
                return true;
            }
        }
        false
    };

    // 1. Check in Tauri resource directory
    if let Some(app_handle) = app {
        if let Ok(path) = app_handle.path().resolve(format!("resources/{}", full_name), tauri::path::BaseDirectory::Resource) {
            if is_valid_executable(&path) {
                return path;
            }
        }
        if let Ok(path) = app_handle.path().resolve(&full_name, tauri::path::BaseDirectory::Resource) {
            if is_valid_executable(&path) {
                return path;
            }
        }
    }

    // 2. Check in Dev environment (src-tauri/resources)
    if let Ok(cwd) = std::env::current_dir() {
        let dev_path = cwd.join("src-tauri").join("resources").join(&full_name);
        if is_valid_executable(&dev_path) {
            return dev_path;
        }
        let direct_dev_path = cwd.join("resources").join(&full_name);
        if is_valid_executable(&direct_dev_path) {
            return direct_dev_path;
        }
    }

    // 3. Check next to running executable
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(parent) = exe_path.parent() {
            let next_to_exe = parent.join(&full_name);
            if is_valid_executable(&next_to_exe) {
                return next_to_exe;
            }
            let res_sub = parent.join("resources").join(&full_name);
            if is_valid_executable(&res_sub) {
                return res_sub;
            }
        }
    }

    // 4. Fallback to system PATH
    PathBuf::from(binary_name)
}

pub fn get_ffmpeg_path(app: Option<&tauri::AppHandle>) -> PathBuf {
    resolve_binary_path(app, "ffmpeg")
}

pub fn get_ffprobe_path(app: Option<&tauri::AppHandle>) -> PathBuf {
    resolve_binary_path(app, "ffprobe")
}
