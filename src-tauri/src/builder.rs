use std::fs::File;
use std::io::Read;
use std::path::Path;
use tauri::{AppHandle, Manager};

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
    let dir_name = backend.to_lowercase();
    let exe_ext = std::env::consts::EXE_SUFFIX;
    let bin_name = format!("whisper-cli-{}{}", dir_name, exe_ext);

    // 1. Check in Tauri resource directory
    if app
        .path()
        .resolve(format!("resources/{}", bin_name), tauri::path::BaseDirectory::Resource)
        .is_ok_and(|path| is_valid_executable(&path))
    {
        return true;
    }
    if app
        .path()
        .resolve(&bin_name, tauri::path::BaseDirectory::Resource)
        .is_ok_and(|path| is_valid_executable(&path))
    {
        return true;
    }

    // 2. Check in dev directory (both root and src-tauri relative)
    if let Ok(cwd) = std::env::current_dir() {
        let dev_path_sub = cwd.join("src-tauri").join("resources").join(&bin_name);
        if is_valid_executable(&dev_path_sub) {
            return true;
        }
        let dev_path_direct = cwd.join("resources").join(&bin_name);
        if is_valid_executable(&dev_path_direct) {
            return true;
        }
    }

    // 3. Check next to running executable
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(parent) = exe_path.parent() {
            let next_to_exe = parent.join(&bin_name);
            if is_valid_executable(&next_to_exe) {
                return true;
            }
            let res_sub = parent.join("resources").join(&bin_name);
            if is_valid_executable(&res_sub) {
                return true;
            }
        }
    }

    false
}
