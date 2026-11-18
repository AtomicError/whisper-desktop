use std::path::{Path, PathBuf};
use std::io::Read;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};
use std::sync::RwLock;
use serde::{Serialize, Deserialize};

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct WhisperStatus {
    pub configured_source: String, // "bundled" or "system"
    pub resolved_path: String,
    pub is_available: bool,
    pub version: String,
    pub available_backends: Vec<String>,
    pub error_message: Option<String>,
}

#[derive(Default, Clone)]
struct WhisperCache {
    status: Option<WhisperStatus>,
    system_cli_path: Option<PathBuf>,
    system_backends: Option<Vec<String>>,
}

static CACHED_WHISPER: RwLock<Option<WhisperCache>> = RwLock::new(None);

/// Clears the cached whisper resolution so next execution re-evaluates latest settings/system state.
pub fn invalidate_whisper_cache() {
    if let Ok(mut lock) = CACHED_WHISPER.write() {
        *lock = None;
    }
}

struct ChildDropGuard(Option<std::process::Child>);
impl Drop for ChildDropGuard {
    fn drop(&mut self) {
        if let Some(mut child) = self.0.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

/// Helper to drain output pipes concurrently with a bounded limit and timeout.
fn drain_pipe(mut pipe: impl Read) -> Vec<u8> {
    let mut retained = Vec::new();
    let mut buffer = [0u8; 4096];
    while let Ok(count) = pipe.read(&mut buffer) {
        if count == 0 {
            break;
        }
        let keep = count.min((64 * 1024usize).saturating_sub(retained.len()));
        retained.extend_from_slice(&buffer[..keep]);
    }
    retained
}

/// Executes a binary with arguments, draining stdout and stderr within a timeout.
fn run_command_with_timeout(binary: &Path, args: &[&str], timeout_secs: u64) -> Option<(Vec<u8>, Vec<u8>, bool)> {
    #[cfg(target_os = "windows")]
    use std::os::windows::process::CommandExt;

    let mut cmd = Command::new(binary);
    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000);
    #[cfg(target_os = "linux")]
    if binary.components().count() == 1 || !binary.to_string_lossy().contains(".mount_") {
        crate::sanitize_host_command(&mut cmd);
    }

    cmd.args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let spawned = cmd.spawn().ok()?;
    let mut guard = ChildDropGuard(Some(spawned));

    let stdout = guard.0.as_mut().unwrap().stdout.take()?;
    let stderr = guard.0.as_mut().unwrap().stderr.take()?;

    let out_thread = std::thread::spawn(move || drain_pipe(stdout));
    let err_thread = std::thread::spawn(move || drain_pipe(stderr));

    let deadline = Instant::now() + Duration::from_secs(timeout_secs);
    let mut timed_out = false;
    let success = loop {
        match guard.0.as_mut().unwrap().try_wait() {
            Ok(Some(status)) => break status.success(),
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(20)),
            _ => {
                timed_out = true;
                break false;
            }
        }
    };

    if timed_out {
        if let Some(mut child) = guard.0.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }

    let stdout_bytes = out_thread.join().unwrap_or_default();
    let stderr_bytes = err_thread.join().unwrap_or_default();

    if let Some(mut child) = guard.0.take() {
        let _ = child.wait();
    }

    Some((stdout_bytes, stderr_bytes, success))
}

/// Checks if a system binary exists in PATH without version probing.
pub fn find_system_binary(binary_name: &str) -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    let full_name = if binary_name.ends_with(".exe") {
        binary_name.to_string()
    } else {
        format!("{}.exe", binary_name)
    };
    #[cfg(not(target_os = "windows"))]
    let full_name = binary_name.to_string();

    let mut search_dirs = Vec::new();

    if let Ok(paths) = std::env::var("PATH") {
        for dir in std::env::split_paths(&paths) {
            search_dirs.push(dir);
        }
    }

    // Common user/system paths often absent from minimal GUI desktop environments
    #[cfg(unix)]
    {
        if let Ok(home) = std::env::var("HOME") {
            let home_p = PathBuf::from(home);
            search_dirs.push(home_p.join(".local/bin"));
            search_dirs.push(home_p.join(".cargo/bin"));
        }
        search_dirs.push(PathBuf::from("/usr/local/bin"));
        search_dirs.push(PathBuf::from("/usr/bin"));
        #[cfg(target_os = "macos")]
        {
            search_dirs.push(PathBuf::from("/opt/homebrew/bin"));
        }
    }

    for dir in search_dirs {
        let candidate = dir.join(&full_name);
        if candidate.is_file() {
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                if let Ok(meta) = candidate.metadata() {
                    if meta.permissions().mode() & 0o111 != 0 {
                        return Some(candidate);
                    }
                }
            }
            #[cfg(not(unix))]
            return Some(candidate);
        }
    }
    None
}

/// Parses the version string from `whisper-cli --version` or `--help`.
fn parse_whisper_version(stdout: &[u8], stderr: &[u8]) -> String {
    let mut combined = String::from_utf8_lossy(stdout).to_string();
    if combined.trim().is_empty() {
        combined = String::from_utf8_lossy(stderr).to_string();
    }

    for line in combined.lines() {
        let line_trimmed = line.trim();
        if let Some(rest) = line_trimmed.strip_prefix("whisper.cpp version:") {
            let ver = rest.trim();
            if !ver.is_empty() {
                return if ver.starts_with('v') || ver.starts_with('V') {
                    ver.to_string()
                } else {
                    format!("v{}", ver)
                };
            }
        }
    }

    if let Some(first_line) = combined.lines().next() {
        let trimmed = first_line.trim();
        if !trimmed.is_empty() && trimmed.len() < 40 {
            return trimmed.to_string();
        }
    }

    "Ready".to_string()
}

/// Finds the system `whisper-cli` binary and extracts its version.
pub fn find_system_whisper_with_version() -> Option<(PathBuf, String)> {
    let cli_path = find_system_binary("whisper-cli")?;
    let (stdout, stderr, _) = run_command_with_timeout(&cli_path, &["--version"], 4)
        .unwrap_or_else(|| (Vec::new(), Vec::new(), false));

    let version = parse_whisper_version(&stdout, &stderr);
    Some((cli_path, version))
}

/// Probes `whisper-bench --help` to detect dynamically loaded backends (Vulkan, OpenVINO, CUDA).
fn probe_backends_via_bench(cli_path: &Path, backends: &mut Vec<String>) {
    let bench_path = cli_path.parent().map(|p| p.join("whisper-bench"))
        .filter(|p| p.is_file())
        .or_else(|| find_system_binary("whisper-bench"));

    if let Some(bench) = bench_path {
        if let Some((stdout, stderr, _)) = run_command_with_timeout(&bench, &["--help"], 3) {
            let out_str = String::from_utf8_lossy(&stdout);
            let err_str = String::from_utf8_lossy(&stderr);
            let combined = format!("{} {}", out_str, err_str);

            if combined.contains("loaded Vulkan backend") || combined.contains("ggml_vulkan:") {
                add_backend_if_missing(backends, "Vulkan");
            }
            if combined.contains("loaded OPENVINO backend") || combined.contains("OpenVINO: using device") {
                add_backend_if_missing(backends, "OpenVINO");
            }
            if combined.contains("loaded CUDA backend") || combined.contains("ggml_cuda:") {
                add_backend_if_missing(backends, "CUDA");
            }
        }
    }
}

/// Scans standard GGML plugin directories for dynamic backend modules (e.g. `/usr/lib/ggml/libggml-*.so` or `ggml-*.dll`).
fn probe_backends_via_filesystem(cli_path: &Path, backends: &mut Vec<String>) {
    let mut search_dirs = vec![
        PathBuf::from("/usr/lib/ggml"),
        PathBuf::from("/usr/local/lib/ggml"),
        PathBuf::from("/usr/lib64/ggml"),
        PathBuf::from("/usr/lib/x86_64-linux-gnu/ggml"),
        PathBuf::from("/usr/lib/aarch64-linux-gnu/ggml"),
        PathBuf::from("/opt/homebrew/lib/ggml"),
    ];

    if let Some(parent) = cli_path.parent() {
        search_dirs.push(parent.to_path_buf());
        search_dirs.push(parent.join("ggml"));
        search_dirs.push(parent.join("../lib/ggml"));
    }

    if let Ok(env_path) = std::env::var("GGML_BACKEND_PATH") {
        for p in std::env::split_paths(&env_path) {
            search_dirs.push(p);
        }
    }

    for dir in search_dirs {
        if !dir.is_dir() {
            continue;
        }
        if let Ok(entries) = std::fs::read_dir(dir) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                let lower = name.to_lowercase();
                if lower.contains("ggml-vulkan") {
                    add_backend_if_missing(backends, "Vulkan");
                } else if lower.contains("ggml-openvino") {
                    add_backend_if_missing(backends, "OpenVINO");
                } else if lower.contains("ggml-cuda") {
                    add_backend_if_missing(backends, "CUDA");
                }
            }
        }
    }
}

/// Probes dynamic linking dependencies via ldd on Linux as a fallback for statically/custom linked binaries.
#[cfg(target_os = "linux")]
fn probe_backends_via_ldd(cli_path: &Path, backends: &mut Vec<String>) {
    if let Some((stdout, _, true)) = run_command_with_timeout(Path::new("ldd"), &[&cli_path.to_string_lossy()], 3) {
        let out_str = String::from_utf8_lossy(&stdout);
        if out_str.contains("libvulkan.so") {
            add_backend_if_missing(backends, "Vulkan");
        }
        if out_str.contains("libcudart.so") || out_str.contains("libcublas.so") {
            add_backend_if_missing(backends, "CUDA");
        }
        if out_str.contains("libopenvino.so") {
            add_backend_if_missing(backends, "OpenVINO");
        }
    }
}

#[inline]
fn add_backend_if_missing(list: &mut Vec<String>, backend: &str) {
    if !list.iter().any(|b| b.eq_ignore_ascii_case(backend)) {
        list.push(backend.to_string());
    }
}

/// Detects all supported backends for system `whisper-cli`.
pub fn detect_system_backends(cli_path: &Path) -> Vec<String> {
    // 1. Standard (CPU) is always available when whisper-cli exists
    let mut backends = vec!["Standard".to_string()];

    // 2. Multi-tier backend discovery
    probe_backends_via_bench(cli_path, &mut backends);
    probe_backends_via_filesystem(cli_path, &mut backends);

    #[cfg(target_os = "linux")]
    probe_backends_via_ldd(cli_path, &mut backends);

    backends
}

/// Checks whether a specific backend is available on the system.
pub fn is_system_backend_available(backend: &str) -> bool {
    if let Ok(lock) = CACHED_WHISPER.read() {
        if let Some(ref cache) = *lock {
            if let Some(ref backends) = cache.system_backends {
                return backends.iter().any(|b| b.eq_ignore_ascii_case(backend));
            }
        }
    }

    if let Some((cli_path, _)) = find_system_whisper_with_version() {
        let backends = detect_system_backends(&cli_path);
        let available = backends.iter().any(|b| b.eq_ignore_ascii_case(backend));

        if let Ok(mut lock) = CACHED_WHISPER.write() {
            let mut cache = lock.clone().unwrap_or_default();
            cache.system_cli_path = Some(cli_path);
            cache.system_backends = Some(backends);
            *lock = Some(cache);
        }

        available
    } else {
        false
    }
}

/// Resolves the whisper binary for execution based on active settings.
pub fn resolve_whisper_binary_for_execution(
    _app: Option<&tauri::AppHandle>,
    backend: &str,
) -> Result<PathBuf, String> {
    let settings = crate::settings::load_settings_file();
    let source = settings.whisper_source.to_lowercase();

    if source == "system" {
        // Fast-path O(1): check cached resolution first
        if let Ok(lock) = CACHED_WHISPER.read() {
            if let Some(ref cache) = *lock {
                if let (Some(ref cli_path), Some(ref backends)) = (&cache.system_cli_path, &cache.system_backends) {
                    if backends.iter().any(|b| b.eq_ignore_ascii_case(backend)) {
                        return Ok(cli_path.clone());
                    }
                }
            }
        }

        if let Some((cli_path, _)) = find_system_whisper_with_version() {
            let backends = detect_system_backends(&cli_path);
            if !backends.iter().any(|b| b.eq_ignore_ascii_case(backend)) {
                return Err(format!(
                    "System whisper-cli does not support the '{backend}' backend. Installed backends: [{}]. Please install the required ggml backend package (e.g. 'ggml-vulkan', 'ggml-openvino', 'ggml-cuda') or select an available backend.",
                    backends.join(", ")
                ));
            }

            if let Ok(mut lock) = CACHED_WHISPER.write() {
                let mut cache = lock.clone().unwrap_or_default();
                cache.system_cli_path = Some(cli_path.clone());
                cache.system_backends = Some(backends);
                *lock = Some(cache);
            }

            Ok(cli_path)
        } else {
            Err("System whisper-cli is not found in PATH or not executable. Please install 'whisper-cpp' on your operating system or switch to 'Internal' in Configuration.".to_string())
        }
    } else {
        Err("Bundled mode must be resolved through app resources.".to_string())
    }
}

/// Returns the live Whisper status for UI telemetry and settings without duplicate sub-processes.
pub fn get_current_whisper_status(
    _app: Option<&tauri::AppHandle>,
    source_override: Option<String>,
) -> WhisperStatus {
    let configured_source = match &source_override {
        Some(s) if !s.is_empty() => s.to_lowercase(),
        _ => {
            let settings = crate::settings::load_settings_file();
            if settings.whisper_source.is_empty() {
                "bundled".to_string()
            } else {
                settings.whisper_source.to_lowercase()
            }
        }
    };

    if let Ok(lock) = CACHED_WHISPER.read() {
        if let Some(ref cache) = *lock {
            if let Some(ref st) = cache.status {
                if st.configured_source == configured_source {
                    return st.clone();
                }
            }
        }
    }

    let status = if configured_source == "system" {
        if let Some((cli_path, version)) = find_system_whisper_with_version() {
            let backends = detect_system_backends(&cli_path);
            WhisperStatus {
                configured_source,
                resolved_path: cli_path.display().to_string(),
                is_available: true,
                version,
                available_backends: backends,
                error_message: None,
            }
        } else {
            WhisperStatus {
                configured_source,
                resolved_path: "Not Found".to_string(),
                is_available: false,
                version: "N/A".to_string(),
                available_backends: Vec::new(),
                error_message: Some("System whisper-cli was not found in PATH or is not executable.".to_string()),
            }
        }
    } else {
        // "bundled" mode
        let mut bundled_backends = Vec::new();
        for b in &["Standard", "Vulkan", "OpenVINO", "CUDA"] {
            // Note: bundled checks are executed by builder::check_build_exists
            bundled_backends.push(b.to_string());
        }

        WhisperStatus {
            configured_source,
            resolved_path: "Internal Resources".to_string(),
            is_available: true,
            version: "v1.9.5".to_string(),
            available_backends: bundled_backends,
            error_message: None,
        }
    };

    if let Ok(mut lock) = CACHED_WHISPER.write() {
        let mut cache = lock.clone().unwrap_or_default();
        if status.is_available && status.configured_source == "system" {
            cache.system_cli_path = Some(PathBuf::from(&status.resolved_path));
            cache.system_backends = Some(status.available_backends.clone());
        }
        cache.status = Some(status.clone());
        *lock = Some(cache);
    }

    status
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_whisper_version_standard_formats() {
        let stdout = b"whisper.cpp version: 1.9.5-dev\n";
        assert_eq!(parse_whisper_version(stdout, &[]), "v1.9.5-dev");

        let stdout_v = b"whisper.cpp version: v2.0.0\n";
        assert_eq!(parse_whisper_version(stdout_v, &[]), "v2.0.0");

        let stderr = b"usage: whisper-cli\nwhisper.cpp version: 1.8.2\n";
        assert_eq!(parse_whisper_version(&[], stderr), "v1.8.2");
    }

    #[test]
    fn test_parse_whisper_version_fallback() {
        let empty: &[u8] = b"";
        assert_eq!(parse_whisper_version(empty, empty), "Ready");

        let single = b"whisper-cli custom build\n";
        assert_eq!(parse_whisper_version(single, empty), "whisper-cli custom build");
    }

    #[test]
    fn test_add_backend_if_missing_deduplication() {
        let mut backends = vec!["Standard".to_string(), "Vulkan".to_string()];
        add_backend_if_missing(&mut backends, "vulkan"); // case insensitive duplicate
        assert_eq!(backends.len(), 2);

        add_backend_if_missing(&mut backends, "OpenVINO");
        assert_eq!(backends.len(), 3);
        assert_eq!(backends[2], "OpenVINO");
    }

    #[test]
    fn test_invalidate_whisper_cache() {
        if let Ok(mut lock) = CACHED_WHISPER.write() {
            let mut cache = WhisperCache::default();
            cache.system_cli_path = Some(PathBuf::from("/usr/bin/whisper-cli"));
            *lock = Some(cache);
        }

        assert!(CACHED_WHISPER.read().unwrap().is_some());
        invalidate_whisper_cache();
        assert!(CACHED_WHISPER.read().unwrap().is_none());
    }

    #[test]
    fn test_get_current_whisper_status_bundled() {
        let status = get_current_whisper_status(None, Some("bundled".to_string()));
        assert_eq!(status.configured_source, "bundled");
        assert!(status.is_available);
        assert!(status.available_backends.contains(&"Standard".to_string()));
    }
}

