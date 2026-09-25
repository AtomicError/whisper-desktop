use sysinfo::{CpuRefreshKind, MemoryRefreshKind, RefreshKind, System};
use std::process::Command;
#[cfg(target_os = "linux")]
use std::path::Path;

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct GpuInfo {
    pub gpu_type: String,        // "nvidia", "intel", "amd", "apple_silicon", "unknown"
    pub gpu_name: String,        // e.g. "Intel Iris Xe Graphics", "NVIDIA GeForce RTX 4070"
    pub is_discrete_gpu: bool,   // true for discrete GPU, false for integrated / CPU
}

pub struct HardwareMonitor {
    sys: System,
    pub gpu_type: String,
    pub gpu_name: String,
    pub is_discrete_gpu: bool,
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
        
        let gpu_info = detect_gpu_info();
        
        HardwareMonitor {
            sys,
            gpu_type: gpu_info.gpu_type,
            gpu_name: gpu_info.gpu_name,
            is_discrete_gpu: gpu_info.is_discrete_gpu,
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

fn parse_nvidia_smi_name(output: &str) -> Option<String> {
    for line in output.lines() {
        if let Some(pos) = line.find("GPU 0: ") {
            let rest = &line[pos + 7..];
            if let Some(uuid_pos) = rest.find(" (UUID:") {
                let name = rest[..uuid_pos].trim();
                if !name.is_empty() {
                    return Some(name.to_string());
                }
            } else {
                let name = rest.trim();
                if !name.is_empty() {
                    return Some(name.to_string());
                }
            }
        }
    }
    None
}

fn clean_intel_gpu_name(raw: &str) -> String {
    let lower = raw.to_lowercase();
    if lower.contains("iris xe") {
        "Intel Iris Xe Graphics".to_string()
    } else if lower.contains("arc") {
        if let Some(start) = raw.find("Arc") {
            let part = &raw[start..];
            let end = part.find(']').unwrap_or(part.len());
            format!("Intel {}", &part[..end].trim())
        } else {
            "Intel Arc Graphics".to_string()
        }
    } else if lower.contains("uhd") {
        "Intel UHD Graphics".to_string()
    } else if lower.contains("hd graphics") {
        "Intel HD Graphics".to_string()
    } else {
        raw.trim().to_string()
    }
}

#[cfg(target_os = "linux")]
fn parse_lspci_line(line: &str) -> (String, String, bool) {
    let lower = line.to_lowercase();
    let parts: Vec<&str> = line.split(':').collect();
    let raw_name = if parts.len() >= 3 {
        parts[2..].join(":").trim().to_string()
    } else if parts.len() == 2 {
        parts[1].trim().to_string()
    } else {
        line.trim().to_string()
    };

    let cleaned_name = if let Some(idx) = raw_name.rfind(" (rev ") {
        raw_name[..idx].trim().to_string()
    } else {
        raw_name
    };

    if lower.contains("nvidia") {
        ("nvidia".to_string(), cleaned_name, true)
    } else if lower.contains("intel") {
        let is_discrete = lower.contains("arc");
        let display_name = clean_intel_gpu_name(&cleaned_name);
        ("intel".to_string(), display_name, is_discrete)
    } else if lower.contains("amd") || lower.contains("advanced micro devices") || lower.contains("radeon") {
        let is_discrete = !lower.contains("radeon graphics") || lower.contains("rx ");
        ("amd".to_string(), cleaned_name, is_discrete)
    } else {
        ("unknown".to_string(), cleaned_name, false)
    }
}

pub fn detect_gpu_info() -> GpuInfo {
    // 1. Check for nvidia-smi (works on Windows & Linux)
    #[cfg(target_os = "windows")]
    use std::os::windows::process::CommandExt;

    let mut cmd = Command::new("nvidia-smi");
    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000);

    if let Ok(output) = cmd.arg("-L").output() {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let name = parse_nvidia_smi_name(&stdout).unwrap_or_else(|| "NVIDIA GPU".to_string());
            return GpuInfo {
                gpu_type: "nvidia".to_string(),
                gpu_name: name,
                is_discrete_gpu: true,
            };
        }
    }

    #[cfg(target_os = "macos")]
    {
        return GpuInfo {
            gpu_type: "apple_silicon".to_string(),
            gpu_name: "Apple Silicon GPU".to_string(),
            is_discrete_gpu: false,
        };
    }

    #[cfg(target_os = "linux")]
    {
        // Check lspci
        if let Ok(output) = Command::new("lspci").output() {
            let lspci_str = String::from_utf8_lossy(&output.stdout);
            for line in lspci_str.lines() {
                let lower = line.to_lowercase();
                if lower.contains("vga compatible") || lower.contains("3d controller") || lower.contains("display controller") {
                    let (gpu_type, gpu_name, is_discrete) = parse_lspci_line(line);
                    if gpu_type != "unknown" {
                        return GpuInfo {
                            gpu_type,
                            gpu_name,
                            is_discrete_gpu: is_discrete,
                        };
                    }
                }
            }
        }

        // Check for AMD gpu sysfs path in cards 0-2
        for card in ["card0", "card1", "card2"] {
            let path = format!("/sys/class/drm/{}/device/gpu_busy_percent", card);
            if Path::new(&path).exists() {
                return GpuInfo {
                    gpu_type: "amd".to_string(),
                    gpu_name: "AMD Radeon GPU".to_string(),
                    is_discrete_gpu: true,
                };
            }
        }

        // Check for Intel gpu sysfs path in cards 0-2 (both i915 and Xe KMD)
        for card in ["card0", "card1", "card2"] {
            let path1 = format!("/sys/class/drm/{}/gt_cur_freq_mhz", card);
            let path2 = format!("/sys/class/drm/{}/gt/gt0/rps_act_freq_mhz", card);
            let path3 = format!("/sys/class/drm/{}/device/tile0/gt0/freq0/cur_freq", card);
            let path4 = format!("/sys/class/drm/{}/device/tile0/gt0/gtidle/idle_residency_ms", card);
            if Path::new(&path1).exists() || Path::new(&path2).exists() || Path::new(&path3).exists() || Path::new(&path4).exists() {
                return GpuInfo {
                    gpu_type: "intel".to_string(),
                    gpu_name: "Intel HD/UHD Graphics".to_string(),
                    is_discrete_gpu: false,
                };
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        let mut ps_cmd = Command::new("powershell");
        ps_cmd.creation_flags(0x08000000);
        ps_cmd.args(["-NoProfile", "-Command", "Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name"]);
        if let Ok(output) = ps_cmd.output() {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                for line in stdout.lines() {
                    let trimmed = line.trim();
                    if trimmed.is_empty() { continue; }
                    let lower = trimmed.to_lowercase();
                    if lower.contains("nvidia") || lower.contains("geforce") || lower.contains("rtx") || lower.contains("gtx") {
                        return GpuInfo {
                            gpu_type: "nvidia".to_string(),
                            gpu_name: trimmed.to_string(),
                            is_discrete_gpu: true,
                        };
                    } else if lower.contains("intel") {
                        let is_discrete = lower.contains("arc");
                        let display_name = clean_intel_gpu_name(trimmed);
                        return GpuInfo {
                            gpu_type: "intel".to_string(),
                            gpu_name: display_name,
                            is_discrete_gpu: is_discrete,
                        };
                    } else if lower.contains("amd") || lower.contains("radeon") {
                        let is_discrete = !lower.contains("radeon(tm) graphics");
                        return GpuInfo {
                            gpu_type: "amd".to_string(),
                            gpu_name: trimmed.to_string(),
                            is_discrete_gpu: is_discrete,
                        };
                    }
                }
            }
        }
    }

    GpuInfo {
        gpu_type: "unknown".to_string(),
        gpu_name: "CPU Only".to_string(),
        is_discrete_gpu: false,
    }
}
