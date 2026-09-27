fn sync_fonts() {
    let manifest_dir = match std::env::var("CARGO_MANIFEST_DIR") {
        Ok(dir) => std::path::PathBuf::from(dir),
        Err(_) => return,
    };
    let src_fonts = manifest_dir.join("resources").join("fonts");
    if !src_fonts.is_dir() {
        return;
    }

    println!("cargo:rerun-if-changed={}", src_fonts.to_string_lossy());

    let out_dir = match std::env::var("OUT_DIR") {
        Ok(dir) => std::path::PathBuf::from(dir),
        Err(_) => return,
    };
    // OUT_DIR is target/{debug|release}/build/<pkg>/out
    // Traverse up to target/{debug|release}
    let mut current = out_dir.as_path();
    while let Some(parent) = current.parent() {
        if let Some(parent_name) = parent.file_name().and_then(|n| n.to_str()) {
            if parent_name == "target" {
                let dest_fonts = current.join("resources").join("fonts");
                let _ = std::fs::create_dir_all(&dest_fonts);
                if let Ok(entries) = std::fs::read_dir(&src_fonts) {
                    for entry in entries.flatten() {
                        let path = entry.path();
                        if let Some(file_name) = path.file_name() {
                            let dest_file = dest_fonts.join(file_name);
                            let _ = std::fs::copy(&path, &dest_file);
                        }
                    }
                }
                break;
            }
        }
        current = parent;
    }
}

fn main() {
    sync_fonts();
    tauri_build::build()
}
