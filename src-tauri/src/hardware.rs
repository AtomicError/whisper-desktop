use sysinfo::{CpuRefreshKind, MemoryRefreshKind, RefreshKind, System};
use std::collections::HashMap;
use std::process::Command;
use std::fs;
use std::path::Path;

#[derive(serde::Serialize, Clone, Debug)]
pub struct SystemStats {
    pub cpu: f64,
    pub ram: String,
    pub gpu: String,
}

pub struct HardwareMonitor {
    sys: System,
    pub gpu_type: String,
    last_drm_clients: HashMap<String, (u64, u64)>,
    last_drm_engines: HashMap<String, u64>,
    last_poll_time: Option<std::time::Instant>,
}

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
            last_drm_clients: HashMap::new(),
            last_drm_engines: HashMap::new(),
            last_poll_time: None,
        }
    }

    pub fn get_stats(&mut self) -> SystemStats {
        self.sys.refresh_cpu_usage();
        self.sys.refresh_memory();
        
        let cpu_usage = self.sys.global_cpu_info().cpu_usage() as f64;
        
        // RAM used vs total
        let total_mem = self.sys.total_memory() as f64 / 1024.0 / 1024.0 / 1024.0; // GB
        let used_mem = self.sys.used_memory() as f64 / 1024.0 / 1024.0 / 1024.0; // GB
        let ram_str = format!("{:.1}GB / {:.1}GB", used_mem, total_mem);
        
        // GPU stats
        let gpu_str = self.get_gpu_stats();
        
        SystemStats {
            cpu: cpu_usage,
            ram: ram_str,
            gpu: gpu_str,
        }
    }

    fn get_gpu_stats(&mut self) -> String {
        match self.gpu_type.as_str() {
            "nvidia" => {
                if let Ok(output) = Command::new("nvidia-smi")
                    .args(["--query-gpu=utilization.gpu", "--format=csv,noheader,nounits"])
                    .output()
                {
                    let out_str = String::from_utf8_lossy(&output.stdout);
                    if let Some(line) = out_str.lines().next() {
                        return format!("NVIDIA: {}%", line.trim());
                    }
                }
                "NVIDIA: N/A".to_string()
            }
            "amd" => {
                for card in ["card0", "card1", "card2"] {
                    let path = format!("/sys/class/drm/{}/device/gpu_busy_percent", card);
                    if let Ok(data) = fs::read_to_string(&path) {
                        return format!("AMD: {}%", data.trim());
                    }
                }
                "AMD: N/A".to_string()
            }
            "intel" => {
                self.get_intel_gpu_stats()
            }
            _ => {
                // Fallback: check AMD sysfs
                for card in ["card0", "card1", "card2"] {
                    let path = format!("/sys/class/drm/{}/device/gpu_busy_percent", card);
                    if let Ok(data) = fs::read_to_string(&path) {
                        return format!("AMD: {}%", data.trim());
                    }
                }
                // Fallback: check Intel sysfs
                let intel_stats = self.get_intel_gpu_stats();
                if intel_stats != "Intel: N/A" {
                    return intel_stats;
                }
                "GPU: N/A".to_string()
            }
        }
    }

    fn get_drm_client_utilization(&mut self) -> Option<f64> {
        let now = std::time::Instant::now();
        let elapsed_ns = self.last_poll_time.map(|t| now.duration_since(t).as_nanos() as f64).unwrap_or(0.0);
        
        let mut cur_clients: HashMap<String, (u64, u64)> = HashMap::new();
        let mut cur_engines: HashMap<String, u64> = HashMap::new();

        // Scan /proc/[0-9]*/fdinfo/* for DRM client hardware stats (standard Linux kernel DRM API)
        if let Ok(proc_entries) = fs::read_dir("/proc") {
            for proc_entry in proc_entries.flatten() {
                let file_name = proc_entry.file_name();
                let pid_str = file_name.to_string_lossy();
                if !pid_str.chars().all(|c| c.is_ascii_digit()) {
                    continue;
                }
                let fdinfo_dir = proc_entry.path().join("fdinfo");
                if let Ok(fd_entries) = fs::read_dir(fdinfo_dir) {
                    for fd_entry in fd_entries.flatten() {
                        if let Ok(content) = fs::read_to_string(fd_entry.path()) {
                            let mut client_id = None;
                            let mut active_rcs = 0u64;
                            let mut total_rcs = 0u64;
                            let mut engine_render_ns = 0u64;

                            for line in content.lines() {
                                if line.starts_with("drm-client-id:") {
                                    client_id = line.split(':').nth(1).map(|s| s.trim().to_string());
                                } else if line.starts_with("drm-cycles-rcs:") {
                                    active_rcs = line.split(':').nth(1).and_then(|s| s.trim().parse().ok()).unwrap_or(0);
                                } else if line.starts_with("drm-total-cycles-rcs:") {
                                    total_rcs = line.split(':').nth(1).and_then(|s| s.trim().parse().ok()).unwrap_or(0);
                                } else if line.starts_with("drm-engine-") {
                                    if let Some(ns_part) = line.split(':').nth(1) {
                                        if let Some(ns_str) = ns_part.trim().split_whitespace().next() {
                                            if let Ok(ns) = ns_str.parse::<u64>() {
                                                engine_render_ns += ns;
                                            }
                                        }
                                    }
                                }
                            }

                            if let Some(cid) = client_id {
                                if total_rcs > 0 {
                                    cur_clients.insert(cid.clone(), (active_rcs, total_rcs));
                                }
                                if engine_render_ns > 0 {
                                    cur_engines.insert(cid, engine_render_ns);
                                }
                            }
                        }
                    }
                }
            }
        }

        let mut total_usage = 0.0;
        let mut has_data = false;

        // Method 1: Intel Xe KMD GPU cycles (exact hardware measurement)
        if !cur_clients.is_empty() {
            for (cid, (cur_act, cur_tot)) in &cur_clients {
                if let Some((last_act, last_tot)) = self.last_drm_clients.get(cid) {
                    let d_act = cur_act.saturating_sub(*last_act) as f64;
                    let d_tot = cur_tot.saturating_sub(*last_tot) as f64;
                    if d_tot > 0.0 {
                        total_usage += (d_act / d_tot) * 100.0;
                        has_data = true;
                    }
                }
            }
        } else if !cur_engines.is_empty() && elapsed_ns > 0.0 {
            // Method 2: i915 / AMD render engine ns
            for (cid, cur_ns) in &cur_engines {
                if let Some(last_ns) = self.last_drm_engines.get(cid) {
                    let d_ns = cur_ns.saturating_sub(*last_ns) as f64;
                    total_usage += (d_ns / elapsed_ns) * 100.0;
                    has_data = true;
                }
            }
        }

        self.last_drm_clients = cur_clients;
        self.last_drm_engines = cur_engines;
        self.last_poll_time = Some(now);

        if has_data {
            Some(total_usage.clamp(0.0, 100.0))
        } else {
            None
        }
    }

    fn get_intel_gpu_stats(&mut self) -> String {
        // Query clock frequency
        let mut cur_freq = 0;
        for card in ["card0", "card1", "card2"] {
            let cur_freq_paths = [
                format!("/sys/class/drm/{}/device/tile0/gt0/freq0/act_freq", card),
                format!("/sys/class/drm/{}/device/tile0/gt0/freq0/cur_freq", card),
                format!("/sys/class/drm/{}/gt/gt0/rps_act_freq_mhz", card),
                format!("/sys/class/drm/{}/gt_cur_freq_mhz", card),
            ];
            cur_freq = cur_freq_paths.iter().map(get_file_as_int).find(|&f| f > 0).unwrap_or(0);
            if cur_freq > 0 {
                break;
            }
        }

        // 1. Primary: Exact hardware engine load from Linux DRM fdinfo (matches nvtop exactly)
        if let Some(drm_usage) = self.get_drm_client_utilization() {
            let usage_pct = drm_usage.round() as i32;
            if cur_freq > 0 {
                return format!("Intel: {}% ({}MHz)", usage_pct, cur_freq);
            }
            return format!("Intel: {}%", usage_pct);
        }

        // 2. Fallback: frequency ratio if DRM fdinfo not yet primed
        if cur_freq > 0 {
            return format!("Intel: 0% ({}MHz)", cur_freq);
        }

        "Intel: N/A".to_string()
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


fn get_file_as_int<P: AsRef<Path>>(path: P) -> i32 {
    if let Ok(content) = fs::read_to_string(path) {
        if let Ok(val) = content.trim().parse::<i32>() {
            return val;
        }
    }
    0
}
