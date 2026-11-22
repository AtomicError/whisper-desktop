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
    pub bundled_available: bool,
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

fn collect_fallback_binary_dirs(search_dirs: &mut Vec<PathBuf>) {
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

    #[cfg(target_os = "windows")]
    {
        if let Ok(local_app) = std::env::var("LOCALAPPDATA") {
            let local_p = PathBuf::from(local_app);
            search_dirs.push(local_p.join("Microsoft").join("WinGet").join("Links"));
            search_dirs.push(local_p.join("Microsoft").join("WindowsApps"));
        }
        if let Ok(user_profile) = std::env::var("USERPROFILE") {
            search_dirs.push(PathBuf::from(user_profile).join("scoop").join("shims"));
        }
        if let Ok(choco) = std::env::var("ChocolateyInstall") {
            search_dirs.push(PathBuf::from(choco).join("bin"));
        } else {
            search_dirs.push(PathBuf::from(r"C:\ProgramData\chocolatey\bin"));
        }
        search_dirs.push(PathBuf::from(r"C:\Program Files\FFmpeg\bin"));
        search_dirs.push(PathBuf::from(r"C:\ffmpeg\bin"));
        search_dirs.push(PathBuf::from(r"C:\Program Files\whisper.cpp\bin"));
    }
}

/// Checks if a system binary exists in PATH or standard OS install directories.
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
    collect_fallback_binary_dirs(&mut search_dirs);

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

fn parse_backend_output(text: &str, backends: &mut Vec<String>) {
    if text.contains("loaded Vulkan backend") || text.contains("ggml_vulkan:") {
        add_backend_if_missing(backends, "Vulkan");
    }
    if text.contains("loaded OPENVINO backend")
        || text.contains("OpenVINO: using device")
        || text.contains("--ov-e-device")
    {
        add_backend_if_missing(backends, "OpenVINO");
    }
    if text.contains("loaded CUDA backend") || text.contains("ggml_cuda:") {
        add_backend_if_missing(backends, "CUDA");
    }
}

/// Probes `whisper-cli --help` output for runtime-loaded or compiled-in backends.
fn probe_backends_via_cli_help(cli_path: &Path, backends: &mut Vec<String>) {
    if let Some((stdout, stderr, _)) = run_command_with_timeout(cli_path, &["--help"], 5) {
        let out_str = String::from_utf8_lossy(&stdout);
        let err_str = String::from_utf8_lossy(&stderr);
        parse_backend_output(&format!("{} {}", out_str, err_str), backends);
    }
}

fn collect_cli_parent_dirs(cli_path: &Path) -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Some(parent) = cli_path.parent() {
        dirs.push(parent.to_path_buf());
    }
    if let Ok(canonical) = std::fs::canonicalize(cli_path) {
        if let Some(real_parent) = canonical.parent() {
            let real_buf = real_parent.to_path_buf();
            if !dirs.contains(&real_buf) {
                dirs.push(real_buf);
            }
        }
    }
    dirs
}

fn push_unique_path(list: &mut Vec<PathBuf>, path: PathBuf) {
    if !list.contains(&path) {
        list.push(path);
    }
}

/// Probes `whisper-bench --help` to detect dynamically loaded backends (Vulkan, OpenVINO, CUDA).
fn probe_backends_via_bench(cli_path: &Path, backends: &mut Vec<String>) {
    let bench_name = format!("whisper-bench{}", std::env::consts::EXE_SUFFIX);
    let bench_path = collect_cli_parent_dirs(cli_path)
        .into_iter()
        .map(|p| p.join(&bench_name))
        .find(|p| p.is_file())
        .or_else(|| find_system_binary("whisper-bench"));

    if let Some(bench) = bench_path {
        if let Some((stdout, stderr, _)) = run_command_with_timeout(&bench, &["--help"], 6) {
            let out_str = String::from_utf8_lossy(&stdout);
            let err_str = String::from_utf8_lossy(&stderr);
            parse_backend_output(&format!("{} {}", out_str, err_str), backends);
        }
    }
}

fn match_backend_filename(lower: &str, backends: &mut Vec<String>) {
    if lower.contains("ggml-vulkan") {
        add_backend_if_missing(backends, "Vulkan");
    } else if lower.contains("ggml-openvino") {
        add_backend_if_missing(backends, "OpenVINO");
    } else if lower.contains("ggml-cuda") || lower.contains("cublas64_") || lower.contains("cudart64_") {
        add_backend_if_missing(backends, "CUDA");
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
    let mut broad_lib_dirs = vec![
        PathBuf::from("/usr/lib"),
        PathBuf::from("/usr/lib64"),
        PathBuf::from("/usr/local/lib"),
        PathBuf::from("/usr/lib/x86_64-linux-gnu"),
        PathBuf::from("/usr/lib/aarch64-linux-gnu"),
    ];

    for parent in collect_cli_parent_dirs(cli_path) {
        push_unique_path(&mut search_dirs, parent.clone());
        push_unique_path(&mut search_dirs, parent.join("ggml"));
        push_unique_path(&mut search_dirs, parent.join("../lib/ggml"));
        push_unique_path(&mut search_dirs, parent.join("../lib64/ggml"));
        push_unique_path(&mut broad_lib_dirs, parent.join("../lib"));
        push_unique_path(&mut broad_lib_dirs, parent.join("../lib64"));
    }

    if let Ok(env_path) = std::env::var("GGML_BACKEND_PATH") {
        for p in std::env::split_paths(&env_path) {
            push_unique_path(&mut search_dirs, p);
        }
    }

    scan_plugin_dirs(&search_dirs, backends);
    check_direct_plugins(&broad_lib_dirs, backends);
}

fn scan_plugin_dirs(search_dirs: &[PathBuf], backends: &mut Vec<String>) {
    for dir in search_dirs {
        if !dir.is_dir() {
            continue;
        }
        if let Ok(entries) = std::fs::read_dir(dir) {
            for entry in entries.flatten() {
                let lower = entry.file_name().to_string_lossy().to_ascii_lowercase();
                match_backend_filename(&lower, backends);
            }
        }
    }
}

fn check_direct_plugins(broad_lib_dirs: &[PathBuf], backends: &mut Vec<String>) {
    const DIRECT_PLUGINS: &[(&str, &str)] = &[
        ("libggml-vulkan.so", "Vulkan"),
        ("libggml-openvino.so", "OpenVINO"),
        ("libggml-cuda.so", "CUDA"),
        ("ggml-vulkan.dll", "Vulkan"),
        ("ggml-openvino.dll", "OpenVINO"),
        ("ggml-cuda.dll", "CUDA"),
    ];

    for dir in broad_lib_dirs {
        if !dir.is_dir() {
            continue;
        }
        for (file, backend) in DIRECT_PLUGINS {
            if dir.join(file).is_file() {
                add_backend_if_missing(backends, backend);
            }
        }
    }
}

#[cfg(any(target_os = "windows", test))]
fn contains_ascii_ignore_case(haystack: &[u8], needle: &[u8]) -> bool {
    if needle.is_empty() || haystack.len() < needle.len() {
        return false;
    }
    haystack
        .windows(needle.len())
        .any(|win| win.eq_ignore_ascii_case(needle))
}

/// Scans PE imports/embedded DLL names on Windows to detect linked GPU backends.
#[cfg(target_os = "windows")]
fn probe_backends_via_windows_imports(cli_path: &Path, backends: &mut Vec<String>) {
    const MAX_PE_SCAN_BYTES: u64 = 64 * 1024 * 1024;
    let Ok(meta) = std::fs::metadata(cli_path) else {
        return;
    };
    if meta.len() > MAX_PE_SCAN_BYTES {
        return;
    }
    let Ok(bytes) = std::fs::read(cli_path) else {
        return;
    };
    if contains_ascii_ignore_case(&bytes, b"ggml-vulkan.dll")
        || contains_ascii_ignore_case(&bytes, b"vulkan-1.dll")
    {
        add_backend_if_missing(backends, "Vulkan");
    }
    if contains_ascii_ignore_case(&bytes, b"ggml-cuda.dll")
        || contains_ascii_ignore_case(&bytes, b"cublas64_")
        || contains_ascii_ignore_case(&bytes, b"cudart64_")
    {
        add_backend_if_missing(backends, "CUDA");
    }
    if contains_ascii_ignore_case(&bytes, b"ggml-openvino.dll")
        || contains_ascii_ignore_case(&bytes, b"openvino.dll")
    {
        add_backend_if_missing(backends, "OpenVINO");
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

    // 2. Multi-tier backend discovery (filesystem plugins first, then CLI/bench/linkage probes)
    probe_backends_via_filesystem(cli_path, &mut backends);
    probe_backends_via_cli_help(cli_path, &mut backends);
    probe_backends_via_bench(cli_path, &mut backends);

    #[cfg(target_os = "linux")]
    probe_backends_via_ldd(cli_path, &mut backends);

    #[cfg(target_os = "windows")]
    probe_backends_via_windows_imports(cli_path, &mut backends);

    backends
}

fn read_valid_cached_system_cli() -> Option<(PathBuf, Vec<String>)> {
    let stale = {
        let lock = CACHED_WHISPER.read().ok()?;
        let cache = lock.as_ref()?;
        match (&cache.system_cli_path, &cache.system_backends) {
            (Some(cli_path), Some(backends)) if cli_path.is_file() => {
                return Some((cli_path.clone(), backends.clone()));
            }
            (Some(_), _) => true,
            _ => false,
        }
    };
    if stale {
        invalidate_whisper_cache();
    }
    None
}

fn read_valid_cached_status(configured_source: &str, bundled_available: bool) -> Option<WhisperStatus> {
    let stale = {
        let lock = CACHED_WHISPER.read().ok()?;
        let cache = lock.as_ref()?;
        let st = cache.status.as_ref()?;
        if st.is_available
            && st.configured_source == configured_source
            && st.bundled_available == bundled_available
        {
            if st.configured_source != "system" || Path::new(&st.resolved_path).is_file() {
                return Some(st.clone());
            }
            true
        } else {
            false
        }
    };
    if stale {
        invalidate_whisper_cache();
    }
    None
}

/// Checks whether a specific backend is available on the system.
pub fn is_system_backend_available(backend: &str) -> bool {
    if let Some((_, backends)) = read_valid_cached_system_cli() {
        return backends.iter().any(|b| b.eq_ignore_ascii_case(backend));
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

/// Resolves the system whisper binary for execution, respecting an explicit source override
/// (e.g. an in-memory fallback to `"system"`) when not forced by an unbundled build.
pub fn resolve_whisper_binary_for_execution(
    _app: Option<&tauri::AppHandle>,
    backend: &str,
    source_override: Option<&str>,
) -> Result<PathBuf, String> {
    let unbundled = crate::settings::is_unbundled_build();
    let source = if unbundled {
        "system".to_string()
    } else if let Some(override_src) = source_override.filter(|s| !s.trim().is_empty()) {
        override_src.to_lowercase()
    } else {
        crate::settings::load_settings_file().whisper_source.to_lowercase()
    };

    if source != "system" {
        return Err("Bundled mode must be resolved through app resources.".to_string());
    }

    if let Some((cli_path, backends)) = read_valid_cached_system_cli() {
        if backends.iter().any(|b| b.eq_ignore_ascii_case(backend)) {
            return Ok(cli_path);
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
    } else if unbundled {
        Err("System whisper-cli was not found in PATH or standard install directories. Please install 'whisper-cpp' on your operating system.".to_string())
    } else {
        Err("System whisper-cli is not found in PATH or not executable. Please install 'whisper-cpp' on your operating system or switch to 'Internal' in Configuration.".to_string())
    }
}

fn resolve_whisper_status_source(unbundled: bool, source_override: &Option<String>) -> String {
    if unbundled {
        return "system".to_string();
    }
    match source_override {
        Some(s) if !s.is_empty() => s.to_lowercase(),
        _ => {
            let settings = crate::settings::load_settings_file();
            if settings.whisper_source.is_empty() {
                "bundled".to_string()
            } else {
                settings.whisper_source.to_lowercase()
            }
        }
    }
}

/// Returns the live Whisper status for UI telemetry and settings without duplicate sub-processes.
pub fn get_current_whisper_status(
    app: Option<&tauri::AppHandle>,
    source_override: Option<String>,
) -> WhisperStatus {
    let unbundled = crate::settings::is_unbundled_build();
    let configured_source = resolve_whisper_status_source(unbundled, &source_override);
    let bundled_available = match app {
        Some(a) => crate::builder::has_any_bundled_backend(a),
        None => !unbundled,
    };

    if let Some(cached) = read_valid_cached_status(&configured_source, bundled_available) {
        return cached;
    }

    let status = if configured_source == "system" {
        if let Some((cli_path, version)) = find_system_whisper_with_version() {
            let backends = detect_system_backends(&cli_path);
            WhisperStatus {
                configured_source,
                resolved_path: cli_path.display().to_string(),
                is_available: true,
                bundled_available,
                version,
                available_backends: backends,
                error_message: None,
            }
        } else {
            WhisperStatus {
                configured_source,
                resolved_path: "Not Found".to_string(),
                is_available: false,
                bundled_available,
                version: "N/A".to_string(),
                available_backends: Vec::new(),
                error_message: Some("System whisper-cli was not found in PATH or standard install directories.".to_string()),
            }
        }
    } else {
        // "bundled" mode (only reachable in bundled builds)
        let bundled_backends: Vec<String> = match app {
            Some(a) => ["Standard", "Vulkan", "OpenVINO", "CUDA"]
                .iter()
                .filter(|b| crate::builder::has_bundled_binary(a, b))
                .map(|b| (*b).to_string())
                .collect(),
            None => vec![
                "Standard".to_string(),
                "Vulkan".to_string(),
                "OpenVINO".to_string(),
                "CUDA".to_string(),
            ],
        };
        let is_available = !bundled_backends.is_empty();

        WhisperStatus {
            configured_source,
            resolved_path: if is_available { "Internal Resources".to_string() } else { "Not Bundled".to_string() },
            is_available,
            bundled_available,
            version: if is_available { "v1.9.5".to_string() } else { "N/A".to_string() },
            available_backends: bundled_backends,
            error_message: if is_available {
                None
            } else {
                Some("Bundled Whisper binaries are not present in this installation. Switch to System mode.".to_string())
            },
        }
    };

    if let Ok(mut lock) = CACHED_WHISPER.write() {
        let mut cache = lock.clone().unwrap_or_default();
        if status.configured_source == "system" {
            if status.is_available {
                cache.system_cli_path = Some(PathBuf::from(&status.resolved_path));
                cache.system_backends = Some(status.available_backends.clone());
            } else {
                cache.system_cli_path = None;
                cache.system_backends = None;
            }
        }
        cache.status = Some(status.clone());
        *lock = Some(cache);
    }

    status
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    static TEST_CACHE_LOCK: Mutex<()> = Mutex::new(());

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
        let _guard = TEST_CACHE_LOCK.lock().unwrap();
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
    fn test_get_current_whisper_status_respects_build_mode() {
        let _guard = TEST_CACHE_LOCK.lock().unwrap();
        invalidate_whisper_cache();
        let status = get_current_whisper_status(None, Some("bundled".to_string()));
        if crate::settings::is_unbundled_build() {
            assert_eq!(status.configured_source, "system");
            assert!(!status.bundled_available);
        } else {
            assert_eq!(status.configured_source, "bundled");
            assert!(status.bundled_available);
            assert!(status.is_available);
            assert!(status.available_backends.contains(&"Standard".to_string()));
        }
    }

    #[test]
    fn test_contains_ascii_ignore_case_and_parse_backend_output() {
        assert!(contains_ascii_ignore_case(b"foo GGML-Vulkan.DLL bar", b"ggml-vulkan.dll"));
        assert!(!contains_ascii_ignore_case(b"cpu only", b"cublas64_"));

        let mut backends = vec!["Standard".to_string()];
        parse_backend_output("usage: --ov-e-device CPU", &mut backends);
        assert!(backends.contains(&"OpenVINO".to_string()));
    }

    #[test]
    fn test_stale_cache_is_evicted_when_cached_cli_disappears() {
        let _guard = TEST_CACHE_LOCK.lock().unwrap();
        invalidate_whisper_cache();

        let missing_path = std::env::temp_dir().join(format!(
            "whisper_missing_cli_test_{}_{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        let missing_str = missing_path.display().to_string();

        if let Ok(mut lock) = CACHED_WHISPER.write() {
            let mut cache = WhisperCache::default();
            cache.system_cli_path = Some(missing_path.clone());
            cache.system_backends = Some(vec!["Standard".to_string(), "Vulkan".to_string()]);
            cache.status = Some(WhisperStatus {
                configured_source: "system".to_string(),
                resolved_path: missing_str,
                is_available: true,
                bundled_available: false,
                version: "v1.9.5".to_string(),
                available_backends: vec!["Standard".to_string(), "Vulkan".to_string()],
                error_message: None,
            });
            *lock = Some(cache);
        }

        assert!(read_valid_cached_system_cli().is_none());
        assert!(read_valid_cached_status("system", false).is_none());
        assert!(CACHED_WHISPER.read().unwrap().is_none());
    }

    #[test]
    fn test_resolve_whisper_binary_respects_source_override() {
        let _guard = TEST_CACHE_LOCK.lock().unwrap();
        invalidate_whisper_cache();

        let res = resolve_whisper_binary_for_execution(None, "Standard", Some("bundled"));
        if crate::settings::is_unbundled_build() {
            // Unbundled build always forces system resolution regardless of override
            if let Err(err) = res {
                assert!(!err.contains("Bundled mode must be resolved through app resources"));
            }
        } else {
            assert_eq!(
                res.unwrap_err(),
                "Bundled mode must be resolved through app resources."
            );
        }
    }

    #[cfg(unix)]
    #[test]
    fn test_probe_backends_via_filesystem_follows_symlink_parent_dir() {
        let temp_dir = tempfile::tempdir().unwrap();
        let real_bin_dir = temp_dir.path().join("opt").join("bin");
        let link_bin_dir = temp_dir.path().join("local").join("bin");
        std::fs::create_dir_all(&real_bin_dir).unwrap();
        std::fs::create_dir_all(&link_bin_dir).unwrap();

        let real_cli = real_bin_dir.join("whisper-cli");
        let plugin_so = real_bin_dir.join("libggml-vulkan.so");
        std::fs::write(&real_cli, b"cli").unwrap();
        std::fs::write(&plugin_so, b"so").unwrap();

        let link_cli = link_bin_dir.join("whisper-cli");
        std::os::unix::fs::symlink(&real_cli, &link_cli).unwrap();

        let mut backends = vec!["Standard".to_string()];
        probe_backends_via_filesystem(&link_cli, &mut backends);
        assert!(backends.contains(&"Vulkan".to_string()));
    }
}

