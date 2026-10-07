use std::fs::File;
use std::io::Read;
use std::path::Path;
use tauri::{AppHandle, Manager};

use crate::transcribe::compute_bin_candidate_rel_paths;

#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;

const MIN_BINARY_SIZE_BYTES: u64 = 100_000;

fn has_valid_binary_header(path: &Path) -> bool {
    let mut file = match File::open(path) {
        Ok(f) => f,
        Err(_) => return false,
    };
    let mut header = [0u8; 4];
    if file.read_exact(&mut header).is_err() {
        return false;
    }

    // Check executable magic header corresponding to target OS
    #[cfg(target_os = "linux")]
    {
        // Linux ELF: 0x7F 'E' 'L' 'F'
        header == [0x7F, b'E', b'L', b'F']
    }

    #[cfg(target_os = "windows")]
    {
        // Windows PE / DOS MZ: 'M' 'Z'
        header[0] == b'M' && header[1] == b'Z'
    }

    #[cfg(target_os = "macos")]
    {
        // macOS Mach-O 32/64-bit and Universal Fat binaries
        matches!(
            header,
            [0xFE, 0xED, 0xFA, 0xCE]
                | [0xFE, 0xED, 0xFA, 0xCF]
                | [0xCE, 0xFA, 0xED, 0xFE]
                | [0xCF, 0xFA, 0xED, 0xFE]
                | [0xCA, 0xFE, 0xBA, 0xBE]
                | [0xBE, 0xBA, 0xFE, 0xCA]
        )
    }

    #[cfg(not(any(target_os = "linux", target_os = "windows", target_os = "macos")))]
    {
        let is_elf = header == [0x7F, b'E', b'L', b'F'];
        let is_pe = header[0] == b'M' && header[1] == b'Z';
        let is_macho = matches!(
            header,
            [0xFE, 0xED, 0xFA, 0xCE]
                | [0xFE, 0xED, 0xFA, 0xCF]
                | [0xCE, 0xFA, 0xED, 0xFE]
                | [0xCF, 0xFA, 0xED, 0xFE]
                | [0xCA, 0xFE, 0xBA, 0xBE]
                | [0xBE, 0xBA, 0xFE, 0xCA]
        );
        is_elf || is_pe || is_macho
    }
}

pub fn is_valid_executable(path: &Path) -> bool {
    let meta = match std::fs::metadata(path) {
        Ok(m) => m,
        Err(_) => return false,
    };

    if !meta.is_file() || meta.len() < MIN_BINARY_SIZE_BYTES {
        return false;
    }

    #[cfg(unix)]
    {
        if meta.permissions().mode() & 0o111 == 0 {
            return false;
        }
    }

    has_valid_binary_header(path)
}

pub fn check_build_exists(app: &AppHandle, backend: &str) -> bool {
    let exe_ext = std::env::consts::EXE_SUFFIX;
    let candidates = compute_bin_candidate_rel_paths(backend, exe_ext);

    for candidate in &candidates {
        let cand_str = candidate.to_string_lossy();

        // 1. Check in Tauri resource directory
        if app
            .path()
            .resolve(format!("resources/{}", cand_str), tauri::path::BaseDirectory::Resource)
            .is_ok_and(|path| is_valid_executable(&path))
        {
            return true;
        }
        if app
            .path()
            .resolve(&*cand_str, tauri::path::BaseDirectory::Resource)
            .is_ok_and(|path| is_valid_executable(&path))
        {
            return true;
        }

        // 2. Check next to running executable (Portable / Standalone mode)
        if let Ok(exe_path) = std::env::current_exe() {
            if let Some(parent) = exe_path.parent() {
                let res_sub = parent.join("resources").join(candidate);
                if is_valid_executable(&res_sub) {
                    return true;
                }
                let next_to_exe = parent.join(candidate);
                if is_valid_executable(&next_to_exe) {
                    return true;
                }
            }
        }

        // 3. Check in dev directory (both root and src-tauri relative)
        if let Ok(cwd) = std::env::current_dir() {
            let dev_path_sub = cwd.join("src-tauri").join("resources").join(candidate);
            if is_valid_executable(&dev_path_sub) {
                return true;
            }
            let dev_path_direct = cwd.join("resources").join(candidate);
            if is_valid_executable(&dev_path_direct) {
                return true;
            }
        }

        // 4. Check cached binary in app_cache_dir (e.g. Linux / AppImage)
        if let Ok(cache_dir) = app.path().app_cache_dir() {
            let cached_sub = cache_dir.join(candidate);
            if is_valid_executable(&cached_sub) {
                return true;
            }
            if let Some(file_name) = candidate.file_name() {
                let cached_flat = cache_dir.join(file_name);
                if is_valid_executable(&cached_flat) {
                    return true;
                }
            }
        }
    }

    false
}
