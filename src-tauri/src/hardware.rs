use sysinfo::System;
use std::process::Command;
use std::fs;

#[derive(serde::Serialize, Clone, Debug)]
pub struct SystemStats {
    pub cpu: f64,
    pub ram: String,
    pub gpu: String,
}

pub struct HardwareMonitor {
    sys: System,
    gpu_type: String,
}

impl HardwareMonitor {
    pub fn new() -> Self {
        let mut sys = System::new_all();
        sys.refresh_all();
        
        let gpu_type = detect_gpu_type();
        
        HardwareMonitor { sys, gpu_type }
    }

    pub fn get_stats(&mut self) -> SystemStats {
        self.sys.refresh_cpu();
        self.sys.refresh_memory();
        
        // CPU utilization
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

    fn get_gpu_stats(&self) -> String {
        match self.gpu_type.as_str() {
            "nvidia" => {
                if let Ok(output) = Command::new("nvidia-smi")
                    .args(["--query-gpu=utilization.gpu", "--format=csv,noheader,nounits"])
                    .output()
                {
                    let out_str = String::from_utf8_lossy(&output.stdout);
                    if let Some(line) = out_str.lines().next() {
                        return format!("{}%", line.trim());
                    }
                }
                "N/A (Nvidia)".to_string()
            }
            "amd" => {
                if let Ok(data) = fs::read_to_string("/sys/class/drm/card0/device/gpu_busy_percent") {
                    return format!("{}%", data.trim());
                }
                "N/A (AMD)".to_string()
            }
            "intel" => {
                let freq = get_intel_freq();
                let status = if freq > 600 { "🔥 ACTIVE" } else { "💤 IDLE" };
                format!("{}MHz ({})", freq, status)
            }
            _ => "N/A".to_string()
        }
    }
}

fn detect_gpu_type() -> String {
    // 1. Check for nvidia-smi
    if Command::new("which").arg("nvidia-smi").output().map(|o| o.status.success()).unwrap_or(false) {
        return "nvidia".to_string();
    }
    
    // 2. Check for AMD gpu sysfs path
    if Path::new("/sys/class/drm/card0/device/gpu_busy_percent").exists() {
        return "amd".to_string();
    }
    
    // 3. Check lpcspci for Intel Graphics
    if let Ok(output) = Command::new("lspci").output() {
        let lspci_str = String::from_utf8_lossy(&output.stdout).to_lowercase();
        if lspci_str.contains("intel") && lspci_str.contains("graphics") {
            return "intel".to_string();
        }
    }
    
    "unknown".to_string()
}

use std::path::Path;

fn get_file_as_int<P: AsRef<Path>>(path: P) -> i32 {
    if let Ok(content) = fs::read_to_string(path) {
        if let Ok(val) = content.trim().parse::<i32>() {
            return val;
        }
    }
    0
}

fn get_intel_freq() -> i32 {
    let freq_path_1 = "/sys/class/drm/card0/gt_cur_freq_mhz";
    let freq_path_2 = "/sys/class/drm/card0/gt/gt0/rps_act_freq_mhz";
    
    let mut freq = get_file_as_int(freq_path_2);
    if freq == 0 {
        freq = get_file_as_int(freq_path_1);
    }
    
    if freq == 0 {
        let freq_path_1_alt = "/sys/class/drm/card1/gt_cur_freq_mhz";
        let freq_path_2_alt = "/sys/class/drm/card1/gt/gt0/rps_act_freq_mhz";
        freq = get_file_as_int(freq_path_2_alt);
        if freq == 0 {
            freq = get_file_as_int(freq_path_1_alt);
        }
    }
    
    freq
}
