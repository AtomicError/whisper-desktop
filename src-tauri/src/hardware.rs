use sysinfo::{CpuRefreshKind, MemoryRefreshKind, RefreshKind, System};
use std::process::Command;
#[cfg(target_os = "linux")]
use std::path::Path;

pub struct HardwareMonitor {
    sys: System,
    pub gpu_type: String,
}

const BYTES_TO_GB: f64 = 1024.0 * 1024.0 * 1024.0;

impl HardwareMonitor {
    pub fn new() -> Self {
        let mut sys = System::new_with_specifics(
            RefreshKind::new()
                .with_cpu(CpuRefreshKind::everything())
                .with_memory(MemoryRefreshKind::everything()),
        );
        sys.refresh_cpu_usage();
        sys.refresh_memory();
        
        let gpu_type = detect_gpu_type();
        
        HardwareMonitor {
            sys,
            gpu_type,
        }
    }

    /// Returns static system specs (total RAM, CPU core count) from the monitor's
    /// already-maintained `sysinfo::System`, avoiding a fresh allocation + full
    /// refresh on every call. These values don't change at runtime, so the
    /// monitor's existing state is sufficient.
    pub fn get_specs(&self) -> (f64, usize) {
        let total_ram_gb = self.sys.total_memory() as f64 / BYTES_TO_GB;
        let cpu_cores = self.sys.cpus().len();
        (total_ram_gb, cpu_cores)
    }
}

fn detect_gpu_type() -> String {
    // 1. Check for nvidia-smi (works on Windows & Linux)
    if Command::new("nvidia-smi").arg("-L").output().map(|o| o.status.success()).unwrap_or(false) {
        return "nvidia".to_string();
    }

    #[cfg(target_os = "macos")]
    {
        "apple_silicon".to_string()
    }
    
    #[cfg(target_os = "linux")]
    {
        // 2. Check for AMD gpu sysfs path in cards 0-2
        for card in ["card0", "card1", "card2"] {
            let path = format!("/sys/class/drm/{}/device/gpu_busy_percent", card);
            if Path::new(&path).exists() {
                return "amd".to_string();
            }
        }
        
        // 3. Check for Intel gpu sysfs path in cards 0-2 (both i915 and Xe KMD)
        for card in ["card0", "card1", "card2"] {
            let path1 = format!("/sys/class/drm/{}/gt_cur_freq_mhz", card);
            let path2 = format!("/sys/class/drm/{}/gt/gt0/rps_act_freq_mhz", card);
            let path3 = format!("/sys/class/drm/{}/device/tile0/gt0/freq0/cur_freq", card);
            let path4 = format!("/sys/class/drm/{}/device/tile0/gt0/gtidle/idle_residency_ms", card);
            if Path::new(&path1).exists() || Path::new(&path2).exists() || Path::new(&path3).exists() || Path::new(&path4).exists() {
                return "intel".to_string();
            }
        }
        
        // 4. Fallback: check lspci for Intel Graphics
        if let Ok(output) = Command::new("lspci").output() {
            let lspci_str = String::from_utf8_lossy(&output.stdout).to_lowercase();
            if lspci_str.contains("intel") && (lspci_str.contains("graphics") || lspci_str.contains("gpu") || lspci_str.contains("vga")) {
                return "intel".to_string();
            }
        }

        "unknown".to_string()
    }

    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
        "unknown".to_string()
    }
}
