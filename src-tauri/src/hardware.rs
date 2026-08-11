use sysinfo::System;
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
    last_intel_time: Option<std::time::Instant>,
    last_intel_residency: Option<u64>,
}

impl HardwareMonitor {
    pub fn new() -> Self {
        let mut sys = System::new_all();
        sys.refresh_all();
        
        let gpu_type = detect_gpu_type();
        
        HardwareMonitor {
            sys,
            gpu_type,
            last_intel_time: None,
            last_intel_residency: None,
        }
    }

    pub fn get_stats(&mut self) -> SystemStats {
        self.sys.refresh_cpu();
        self.sys.refresh_memory();
        
        // CPU utilization - need two refreshes for delta calculation
        std::thread::sleep(std::time::Duration::from_millis(100));
        self.sys.refresh_cpu();
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

    fn get_intel_gpu_stats(&mut self) -> String {
        for card in ["card0", "card1", "card2"] {
            // Intel Xe KMD & Intel i915 sysfs residency paths
            let residency_paths = [
                format!("/sys/class/drm/{}/device/tile0/gt0/gtidle/idle_residency_ms", card),
                format!("/sys/class/drm/{}/device/gt/gt0/rc6_residency_ms", card),
                format!("/sys/class/drm/{}/gt/gt0/rc6_residency_ms", card),
            ];

            let active_residency_path = residency_paths.iter().find(|p| Path::new(p).exists());
            
            if let Some(res_path) = active_residency_path {
                let current_residency = get_file_as_u64(res_path);
                let now = std::time::Instant::now();

                // Freq paths for Xe KMD and i915
                let cur_freq_paths = [
                    format!("/sys/class/drm/{}/device/tile0/gt0/freq0/cur_freq", card),
                    format!("/sys/class/drm/{}/device/tile0/gt0/freq0/act_freq", card),
                    format!("/sys/class/drm/{}/gt/gt0/rps_act_freq_mhz", card),
                    format!("/sys/class/drm/{}/gt_cur_freq_mhz", card),
                ];
                let cur_freq = cur_freq_paths.iter().map(get_file_as_int).find(|&f| f > 0).unwrap_or(0);
                
                if let (Some(last_time), Some(last_res)) = (self.last_intel_time, self.last_intel_residency) {
                    let elapsed_ms = now.duration_since(last_time).as_millis() as f64;
                    let residency_delta = (current_residency.saturating_sub(last_res)) as f64;
                    
                    self.last_intel_time = Some(now);
                    self.last_intel_residency = Some(current_residency);
                    
                    if elapsed_ms > 0.0 {
                        let idle_ratio = residency_delta / elapsed_ms;
                        let usage_pct = (100.0 - (idle_ratio * 100.0)).round() as i32;
                        let usage_pct = usage_pct.clamp(0, 100);
                        
                        if cur_freq > 0 {
                            return format!("Intel: {}% ({}MHz)", usage_pct, cur_freq);
                        } else {
                            return format!("Intel: {}%", usage_pct);
                        }
                    }
                } else {
                    self.last_intel_time = Some(now);
                    self.last_intel_residency = Some(current_residency);
                    
                    if cur_freq > 0 {
                        return format!("Intel: 0% ({}MHz)", cur_freq);
                    }
                    return "Intel: 0%".to_string();
                }
            }
        }
        
        // Fallback: frequency ratio if residency is not exposed
        for card in ["card0", "card1", "card2"] {
            let cur_freq_paths = [
                format!("/sys/class/drm/{}/device/tile0/gt0/freq0/cur_freq", card),
                format!("/sys/class/drm/{}/device/tile0/gt0/freq0/act_freq", card),
                format!("/sys/class/drm/{}/gt/gt0/rps_act_freq_mhz", card),
                format!("/sys/class/drm/{}/gt_cur_freq_mhz", card),
            ];
            
            let cur_freq = cur_freq_paths.iter().map(get_file_as_int).find(|&f| f > 0).unwrap_or(0);
            
            if cur_freq > 0 {
                let max_freq_paths = [
                    format!("/sys/class/drm/{}/device/tile0/gt0/freq0/max_freq", card),
                    format!("/sys/class/drm/{}/gt/gt0/rps_max_freq_mhz", card),
                    format!("/sys/class/drm/{}/gt_max_freq_mhz", card),
                ];
                let max_freq = max_freq_paths.iter().map(get_file_as_int).find(|&f| f > 0).unwrap_or(0);
                
                if max_freq > 0 {
                    let pct = (cur_freq as f64 / max_freq as f64 * 100.0).round() as i32;
                    return format!("Intel: {}% ({}MHz)", pct, cur_freq);
                }
                return format!("Intel: {}MHz", cur_freq);
            }
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
        return "apple_silicon".to_string();
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
    }
    
    "unknown".to_string()
}


fn get_file_as_int<P: AsRef<Path>>(path: P) -> i32 {
    if let Ok(content) = fs::read_to_string(path) {
        if let Ok(val) = content.trim().parse::<i32>() {
            return val;
        }
    }
    0
}

fn get_file_as_u64<P: AsRef<Path>>(path: P) -> u64 {
    if let Ok(content) = fs::read_to_string(path) {
        if let Ok(val) = content.trim().parse::<u64>() {
            return val;
        }
    }
    0
}
