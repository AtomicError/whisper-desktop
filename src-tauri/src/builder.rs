use tauri::{AppHandle, Manager};

pub fn check_build_exists(app: &AppHandle, backend: &str) -> bool {
    let dir_name = backend.to_lowercase();
    let bin_name = format!("whisper-cli-{}", dir_name);
    
    let is_valid_executable = |path: &std::path::Path| -> bool {
        if !path.exists() {
            return false;
        }
        if let Ok(meta) = std::fs::metadata(path) {
            // A compiled whisper-cli binary is usually several MBs.
            // Placeholder files are ~39 bytes.
            if meta.len() < 100_000 {
                return false;
            }
            return true;
        }
        false
    };
    
    // Check in resource directory
    if let Ok(path) = app.path().resolve(format!("resources/{}", bin_name), tauri::path::BaseDirectory::Resource) {
        if is_valid_executable(&path) {
            return true;
        }
    }
    
    // Check in dev directory
    let dev_path = std::env::current_dir()
        .unwrap_or_default()
        .join("src-tauri")
        .join("resources")
        .join(&bin_name);
        
    is_valid_executable(&dev_path)
}
