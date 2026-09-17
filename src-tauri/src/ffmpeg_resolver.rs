use std::path::{Path, PathBuf};
use std::io::Read;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};
use std::sync::RwLock;
use serde::{Serialize, Deserialize};
use tauri::Manager;

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FFmpegStatus {
    pub configured_source: String, // "bundled" or "system"
    pub resolved_path: String,
    pub is_available: bool,
    pub version: String,
    pub error_message: Option<String>,
}

#[derive(Default, Clone)]
struct BinaryCache {
    ffmpeg_exec_path: Option<PathBuf>,
    ffprobe_exec_path: Option<PathBuf>,
}

static CACHED_BINARIES: RwLock<Option<BinaryCache>> = RwLock::new(None);

/// Clears the cached binary paths so next execution re-evaluates the latest settings.
pub fn invalidate_ffmpeg_cache() {
    if let Ok(mut lock) = CACHED_BINARIES.write() {
        *lock = None;
    }
}

/// Checks whether a given path is an executable and not a dummy placeholder (<100KB)
fn is_valid_bundled_binary(p: &Path) -> bool {
    if !p.exists() || !p.is_file() {
        return false;
    }
    if let Ok(meta) = std::fs::metadata(p) {
        if meta.len() > 100_000 {
            return true;
        }
    }
    false
}

/// Finds the bundled binary path in Tauri resource dir, dev environment, or adjacent to exe.
fn find_bundled_binary(app: Option<&tauri::AppHandle>, binary_name: &str) -> Option<PathBuf> {
    let exe_suffix = std::env::consts::EXE_SUFFIX;
    let full_name = if binary_name.ends_with(exe_suffix) || exe_suffix.is_empty() {
        binary_name.to_string()
    } else {
        format!("{}{}", binary_name, exe_suffix)
    };

    // 1. Tauri resource dir
    if let Some(app_handle) = app {
        if let Ok(path) = app_handle.path().resolve(format!("resources/{}", full_name), tauri::path::BaseDirectory::Resource) {
            if is_valid_bundled_binary(&path) {
                return Some(path);
            }
        }
        if let Ok(path) = app_handle.path().resolve(&full_name, tauri::path::BaseDirectory::Resource) {
            if is_valid_bundled_binary(&path) {
                return Some(path);
            }
        }
    }

    // 2. Dev environment (src-tauri/resources or resources)
    if let Ok(cwd) = std::env::current_dir() {
        let dev_path = cwd.join("src-tauri").join("resources").join(&full_name);
        if is_valid_bundled_binary(&dev_path) {
            return Some(dev_path);
        }
        let direct_dev_path = cwd.join("resources").join(&full_name);
        if is_valid_bundled_binary(&direct_dev_path) {
            return Some(direct_dev_path);
        }
    }

    // 3. Next to running executable
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(parent) = exe_path.parent() {
            let next_to_exe = parent.join(&full_name);
            if is_valid_bundled_binary(&next_to_exe) {
                return Some(next_to_exe);
            }
            let res_sub = parent.join("resources").join(&full_name);
            if is_valid_bundled_binary(&res_sub) {
                return Some(res_sub);
            }
        }
    }

    None
}

// Drain both pipes concurrently: a verbose/broken executable must neither block
// discovery on a full pipe nor retain unbounded output. Reap before returning.
fn binary_version_output(binary: &Path) -> Option<Vec<u8>> {
    let mut child = Command::new(binary)
        .arg("-version")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn().ok()?;
    fn drain(mut pipe: impl Read) -> Vec<u8> {
        let mut retained = Vec::new();
        let mut buffer = [0u8; 4096];
        while let Ok(count) = pipe.read(&mut buffer) {
            if count == 0 { break; }
            let keep = count.min((64 * 1024usize).saturating_sub(retained.len()));
            retained.extend_from_slice(&buffer[..keep]);
        }
        retained
    }
    let stdout = child.stdout.take()?;
    let stderr = child.stderr.take()?;
    let out = std::thread::spawn(move || drain(stdout));
    let err = std::thread::spawn(move || drain(stderr));
    let deadline = Instant::now() + Duration::from_secs(5);
    let success = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status.success(),
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(20)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                break false;
            }
        }
    };
    let output = out.join().ok();
    let _ = err.join();
    if success { output } else { None }
}

/// Checks if a system binary exists in PATH and extracts its version in a single sub-process invocation.
fn find_system_binary_with_version(binary_name: &str) -> Option<(PathBuf, String)> {
    if let Some(output) = binary_version_output(Path::new(binary_name)) {
        let out_str = String::from_utf8_lossy(&output);
        let ver = out_str.lines().next().unwrap_or("Unknown version").trim().to_string();
        return Some((PathBuf::from(binary_name), ver));
    }
    None
}

/// Checks if a system binary is executable in PATH without extra version formatting.
fn find_system_binary(binary_name: &str) -> Option<PathBuf> {
    find_system_binary_with_version(binary_name).map(|(path, _)| path)
}

/// Extracts version string from a working binary path.
fn extract_binary_version(bin_path: &Path) -> String {
    if let Some(output) = binary_version_output(bin_path) {
        let out_str = String::from_utf8_lossy(&output);
        if let Some(first_line) = out_str.lines().next() {
            return first_line.trim().to_string();
        }
    }
    "Unknown version".to_string()
}

/// Resolves the binary for task execution (WAV conversion, probing, hardsubbing) with thread-safe in-memory caching
/// and automatic graceful fallback to system PATH if bundled is chosen but missing.
pub fn resolve_binary_for_execution(app: Option<&tauri::AppHandle>, binary_name: &str) -> Result<PathBuf, String> {
    // 1. Check in-memory cache first for zero-overhead O(1) repeated lookups
    if let Ok(lock) = CACHED_BINARIES.read() {
        if let Some(ref cache) = *lock {
            let cached_path = match binary_name {
                "ffmpeg" => cache.ffmpeg_exec_path.as_ref(),
                "ffprobe" => cache.ffprobe_exec_path.as_ref(),
                _ => None,
            };
            if let Some(p) = cached_path {
                // Verify that cached path is either a system command or still exists on disk
                if p.components().count() == 1 || p.exists() {
                    return Ok(p.clone());
                }
            }
        }
    }

    let settings = crate::settings::load_settings_file();
    let source = settings.ffmpeg_source.to_lowercase();

    let resolved_path = if source == "system" {
        if let Some(sys_path) = find_system_binary(binary_name) {
            sys_path
        } else {
            return Err(format!(
                "System {} is not found in PATH or not executable. Please install {} on your operating system or switch to 'Internal' in Configuration.",
                binary_name, binary_name
            ));
        }
    } else {
        // "bundled" mode (default)
        if let Some(bundled_path) = find_bundled_binary(app, binary_name) {
            bundled_path
        } else if let Some(sys_path) = find_system_binary(binary_name) {
            // Graceful fallback to system PATH so conversions/hardsubbing never fail
            sys_path
        } else {
            return Err(format!(
                "{} could not be found (neither internal standalone in resources nor in system PATH). Please install FFmpeg on your operating system.",
                binary_name
            ));
        }
    };

    // 2. Store in cache
    if let Ok(mut lock) = CACHED_BINARIES.write() {
        let mut cache = lock.clone().unwrap_or_default();
        if binary_name == "ffmpeg" {
            cache.ffmpeg_exec_path = Some(resolved_path.clone());
        } else if binary_name == "ffprobe" {
            cache.ffprobe_exec_path = Some(resolved_path.clone());
        }
        *lock = Some(cache);
    }

    Ok(resolved_path)
}

pub fn get_ffmpeg_path(app: Option<&tauri::AppHandle>) -> PathBuf {
    match resolve_binary_for_execution(app, "ffmpeg") {
        Ok(p) => p,
        Err(_) => PathBuf::from("ffmpeg"),
    }
}

pub fn get_ffprobe_path(app: Option<&tauri::AppHandle>) -> PathBuf {
    match resolve_binary_for_execution(app, "ffprobe") {
        Ok(p) => p,
        Err(_) => PathBuf::from("ffprobe"),
    }
}

pub fn ensure_ffmpeg_available(app: Option<&tauri::AppHandle>) -> Result<PathBuf, String> {
    resolve_binary_for_execution(app, "ffmpeg")
}

pub fn ensure_ffprobe_available(app: Option<&tauri::AppHandle>) -> Result<PathBuf, String> {
    resolve_binary_for_execution(app, "ffprobe")
}

/// Returns the live FFmpeg status for UI telemetry without executing unnecessary duplicate sub-processes.
pub fn get_current_ffmpeg_status(app: Option<&tauri::AppHandle>, source_override: Option<String>) -> FFmpegStatus {
    let configured_source = match &source_override {
        Some(s) if !s.is_empty() => s.to_lowercase(),
        _ => {
            let settings = crate::settings::load_settings_file();
            if settings.ffmpeg_source.is_empty() {
                "bundled".to_string()
            } else {
                settings.ffmpeg_source.to_lowercase()
            }
        }
    };

    if configured_source == "system" {
        if let Some((path, version)) = find_system_binary_with_version("ffmpeg") {
            FFmpegStatus {
                configured_source,
                resolved_path: path.display().to_string(),
                is_available: true,
                version,
                error_message: None,
            }
        } else {
            FFmpegStatus {
                configured_source,
                resolved_path: "Not Found".to_string(),
                is_available: false,
                version: "N/A".to_string(),
                error_message: Some("System FFmpeg was not found in PATH or not executable.".to_string()),
            }
        }
    } else {
        // "bundled" mode (default)
        if let Some(bundled_path) = find_bundled_binary(app, "ffmpeg") {
            let version = extract_binary_version(&bundled_path);
            FFmpegStatus {
                configured_source,
                resolved_path: bundled_path.display().to_string(),
                is_available: true,
                version,
                error_message: None,
            }
        } else if let Some((path, version)) = find_system_binary_with_version("ffmpeg") {
            // Gracefully report working fallback to system FFmpeg matching runtime execution
            FFmpegStatus {
                configured_source,
                resolved_path: path.display().to_string(),
                is_available: true,
                version,
                error_message: None,
            }
        } else {
            FFmpegStatus {
                configured_source,
                resolved_path: "Not Found".to_string(),
                is_available: false,
                version: "N/A".to_string(),
                error_message: Some("FFmpeg could not be found (neither internal standalone in resources nor in system PATH).".to_string()),
            }
        }
    }
}
