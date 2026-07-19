use tauri::{AppHandle, Manager};

pub fn check_build_exists(app: &AppHandle, backend: &str) -> bool {
    let dir_name = backend.to_lowercase();
    let bin_name = format!("whisper-cli-{}", dir_name);
    
    // Check in resource directory
    if let Ok(path) = app.path().resolve(format!("resources/{}", bin_name), tauri::path::BaseDirectory::Resource) {
        if path.exists() {
            return true;
        }
    }
    
    // Check in dev directory
    let dev_path = std::env::current_dir()
        .unwrap_or_default()
        .join("src-tauri")
        .join("resources")
        .join(&bin_name);
        
    dev_path.exists()
}
