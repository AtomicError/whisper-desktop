use std::path::{Path, PathBuf};
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_notification::NotificationExt;
use std::time::Instant;

use crate::logger::AppLogs;
use crate::transcribe::TranscribeProgress;

#[derive(serde::Deserialize, serde::Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct HardsubSettings {
    pub video_path: String,
    pub subtitle_path: String,
    pub output_path: String,
    pub output_format: String, // "mp4", "mkv", "webm", "mov"
    pub video_codec: String,   // "h264", "h265", "av1", "vp9", "prores"
    pub hw_accel: String,      // "cpu", "qsv", "nvenc", "vaapi", "videotoolbox"
    #[serde(default = "default_video_quality_mode")]
    pub video_quality_mode: String, // "preset" | "custom"
    #[serde(default = "default_video_quality_preset")]
    pub video_quality_preset: String, // "draft" | "balanced" | "high" | "lossless"
    #[serde(default = "default_video_quality_value")]
    pub video_quality_value: u32, // raw slider value; clamped per encoder: CRF/CQ/GlobalQuality/QP 0-63, q:v 1-100, ProRes profile 0-5
    #[serde(default = "default_video_preset_speed")]
    pub video_preset_speed: String, // "fast" | "medium" | "slow"
    #[serde(default = "default_resolution_scale")]
    pub resolution_scale: String, // "original" | "4k" | "2k" | "1080p" | "720p" | "480p"
    pub font_name: String,
    pub font_size: u32,
    pub primary_color: String,  // Hex "#FFFFFF"
    pub outline_color: String,  // Hex "#000000"
    pub outline_size: u32,
    pub bg_box: bool,
    pub bg_box_color: String,
    pub bg_box_opacity: u8,
    pub bg_box_radius: u32,
    pub position_y: u32,       // MarginV offset
    pub width_margin: u32,
    pub bold: bool,
    pub italic: bool,
    pub alignment: u32,        // 2 = Bottom Center (default), 6 = Top Center, etc.
    #[serde(default = "default_audio_codec")]
    pub audio_codec: String,   // "copy", "aac", "opus", "mp3", "mute"
    #[serde(default = "default_audio_bitrate")]
    pub audio_bitrate: String, // "96k", "128k", "192k", "256k", "320k"
}

fn default_video_quality_mode() -> String { "preset".to_string() }
fn default_video_quality_preset() -> String { "balanced".to_string() }
fn default_video_quality_value() -> u32 { 22 }
fn default_video_preset_speed() -> String { "medium".to_string() }
fn default_resolution_scale() -> String { "original".to_string() }
fn default_audio_codec() -> String { "copy".to_string() }
fn default_audio_bitrate() -> String { "192k".to_string() }

#[derive(serde::Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct HardsubResult {
    pub duration_ms: u64,
    pub output_path: String,
    pub output_size_mb: f64,
}

#[derive(serde::Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FontItem {
    pub name: String,
    pub source: String, // "system" | "bundled" | "custom"
}

/// Scans installed fonts on Linux using `fc-list` and returns unique font names.
#[tauri::command]
pub fn get_system_fonts(_app: AppHandle) -> Vec<FontItem> {
    let mut fonts = Vec::new();
    
    // 1. Add bundled Persian & English fonts
    let default_fonts = [
        ("Vazirmatn", "bundled"),
        ("Shabnam", "bundled"),
        ("Samim", "bundled"),
        ("Sahel", "bundled"),
        ("Inter", "bundled"),
        ("Roboto", "bundled"),
        ("Outfit", "bundled"),
    ];

    for (font, src) in default_fonts {
        fonts.push(FontItem {
            name: font.to_string(),
            source: src.to_string(),
        });
    }

    // 2. Scan system fonts via fc-list (if fontconfig is installed)
    let mut scanned_system = false;
    if let Ok(output) = std::process::Command::new("fc-list")
        .args([":", "family"])
        .output()
    {
        if output.status.success() {
            scanned_system = true;
            let stdout = String::from_utf8_lossy(&output.stdout);
            let mut system_font_names: Vec<String> = stdout
                .lines()
                .flat_map(|line| line.split(','))
                .map(|f| f.trim().to_string())
                .filter(|f| !f.is_empty())
                .collect();

            system_font_names.sort();
            system_font_names.dedup();

            for font_name in system_font_names {
                if !fonts.iter().any(|f| f.name.eq_ignore_ascii_case(&font_name)) {
                    fonts.push(FontItem {
                        name: font_name,
                        source: "system".to_string(),
                    });
                }
            }
        }
    }

    // 3. Fallback: Scan OS-specific font directories directly if fc-list is unavailable
    if !scanned_system {
        let font_dirs: Vec<&str> = if cfg!(target_os = "windows") {
            vec!["C:\\Windows\\Fonts"]
        } else if cfg!(target_os = "macos") {
            vec!["/Library/Fonts", "/System/Library/Fonts"]
        } else {
            vec!["/usr/share/fonts", "/usr/local/share/fonts"]
        };

        for dir_path in font_dirs {
            let p = Path::new(dir_path);
            if p.exists() && p.is_dir() {
                if let Ok(entries) = std::fs::read_dir(p) {
                    for entry in entries.flatten() {
                        let path = entry.path();
                        if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
                            if ext.eq_ignore_ascii_case("ttf") || ext.eq_ignore_ascii_case("otf") {
                                if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                                    let clean_name = stem.trim();
                                    if !clean_name.is_empty() && !fonts.iter().any(|f| f.name.eq_ignore_ascii_case(clean_name)) {
                                        fonts.push(FontItem {
                                            name: clean_name.to_string(),
                                            source: "system".to_string(),
                                        });
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    fonts
}


fn read_u16(data: &[u8], off: usize) -> Option<u16> {
    Some(u16::from_be_bytes([*data.get(off)?, *data.get(off + 1)?]))
}

fn read_i16(data: &[u8], off: usize) -> Option<i16> {
    Some(i16::from_be_bytes([*data.get(off)?, *data.get(off + 1)?]))
}

fn read_u32(data: &[u8], off: usize) -> Option<u32> {
    Some(u32::from_be_bytes([*data.get(off)?, *data.get(off + 1)?, *data.get(off + 2)?, *data.get(off + 3)?]))
}

/// Reads a TTF/OTF file and returns (unitsPerEm, ascent, descent) in font units.
///
/// The dimensions follow the same priority libass uses in `set_font_metrics`
/// (which FreeType's `FT_SIZE_REQUEST_TYPE_REAL_DIM` uses to scale glyphs):
/// OS/2 winAscent/winDescent, then OS/2 typo metrics, then hhea, then head bbox.
fn read_font_metrics(path: &Path) -> Option<(u16, u32, u32)> {
    let data = std::fs::read(path).ok()?;

    // TTC collections: read the first font offset table
    let data = if data.starts_with(b"ttcf") {
        let offset = read_u32(&data, 12)? as usize;
        data.get(offset..)?
    } else {
        &data[..]
    };

    let sfnt_ok = data.starts_with(b"\x00\x01\x00\x00")
        || data.starts_with(b"OTTO")
        || data.starts_with(b"true");
    if !sfnt_ok {
        return None;
    }

    let num_tables = read_u16(data, 4)? as usize;
    let find_table = |tag: &[u8; 4]| -> Option<(usize, usize)> {
        for i in 0..num_tables {
            let rec = 12 + i * 16;
            if data.get(rec..rec + 4) != Some(&tag[..]) {
                continue;
            }
            let off = read_u32(data, rec + 8)? as usize;
            let len = read_u32(data, rec + 12)? as usize;
            return Some((off, len));
        }
        None
    };

    let upem = find_table(b"head").and_then(|(o, l)| {
        if l >= 20 { read_u16(data, o + 18) } else { None }
    })?;
    if upem == 0 {
        return None;
    }

    // OS/2 table
    let os2_metrics = find_table(b"OS/2").and_then(|(o, l)| {
        if l < 78 {
            return None;
        }
        let fs_selection = read_u16(data, o + 62)?;
        let typo_ascender = read_i16(data, o + 68)?;
        let typo_descender = read_i16(data, o + 70)?;
        let win_ascent = read_u16(data, o + 74)?;
        let win_descent = read_u16(data, o + 76)?;
        if win_ascent + win_descent != 0 {
            Some((win_ascent as u32, win_descent as u32))
        } else if fs_selection & 0x80 != 0 {
            Some((typo_ascender as u32, typo_descender.unsigned_abs() as u32))
        } else {
            None
        }
    });

    let (ascent, descent) = if let Some(m) = os2_metrics {
        m
    } else {
        let hhea_metrics = find_table(b"hhea").and_then(|(o, l)| {
            if l < 8 {
                return None;
            }
            let ascender = read_i16(data, o + 4)?;
            let descender = read_i16(data, o + 6)?;
            Some((ascender as u32, descender.unsigned_abs() as u32))
        });
        if let Some(m) = hhea_metrics {
            m
        } else {
            let bbox_metrics = find_table(b"head").and_then(|(o, l)| {
                if l < 42 {
                    return None;
                }
                let y_min = read_i16(data, o + 38)?;
                let y_max = read_i16(data, o + 42)?;
                Some((y_max as u32, y_min.unsigned_abs() as u32))
            });
            bbox_metrics?
        }
    };

    if ascent + descent == 0 {
        return None;
    }
    Some((upem, ascent, descent))
}

/// Resolves the font file libass would use: fontconfig first (mirroring libass
/// fontselect), then the bundled fonts directory as fallback.
/// Resolves the font file libass would use: fontconfig first (mirroring libass
/// fontselect), then the bundled fonts directory as fallback.
fn resolve_font_file<R: tauri::Runtime>(font_name: &str, bold: bool, italic: bool, app: &tauri::AppHandle<R>) -> Option<std::path::PathBuf> {
    let mut pattern = font_name.to_string();
    if bold {
        pattern.push_str(":bold");
    }
    if italic {
        pattern.push_str(":italic");
    }
    if let Ok(out) = std::process::Command::new("fc-match")
        .args(["-f", "%{file}\t%{family}", &pattern])
        .output()
    {
        if out.status.success() {
            let stdout = String::from_utf8_lossy(&out.stdout);
            let mut parts = stdout.trim().split('\t');
            if let Some(file) = parts.next() {
                let family = parts.next().unwrap_or("");
                let path = std::path::Path::new(file);
                if path.exists()
                    && family
                        .split(',')
                        .any(|f| f.trim().eq_ignore_ascii_case(font_name))
                {
                    return Some(path.to_path_buf());
                }
            }
        }
    }

    let mut resolved_dir = app.path().resolve("resources/fonts", tauri::path::BaseDirectory::Resource).ok().filter(|p| p.exists());
    if resolved_dir.is_none() {
        if let Ok(exe_path) = std::env::current_exe() {
            if let Some(parent) = exe_path.parent() {
                let portable_fonts = parent.join("resources").join("fonts");
                if portable_fonts.exists() {
                    resolved_dir = Some(portable_fonts);
                }
            }
        }
    }
    if resolved_dir.is_none() {
        if let Ok(manifest_dir) = std::env::var("CARGO_MANIFEST_DIR") {
            let dev_path = std::path::Path::new(&manifest_dir).join("resources/fonts");
            if dev_path.exists() {
                resolved_dir = Some(dev_path);
            }
        }
    }

    if let Some(dir) = resolved_dir {
        for ext in ["ttf", "otf"] {
            let p = dir.join(format!("{}.{}", font_name, ext));
            if p.exists() {
                return Some(p);
            }
        }
    }

    None
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FontMetrics {
    pub scale: f64,
    pub ascent_ratio: f64,
    pub descent_ratio: f64,
}

/// Computes the layout metrics for an ASS font.
///
/// Returns the scaling factor to match Canvas/CSS em semantics with libass cell height,
/// as well as the relative ascent and descent ratios from the font file.
#[tauri::command]
pub fn get_font_render_scale(app: AppHandle, font_name: String, bold: bool, italic: bool) -> FontMetrics {
    let Some(path) = resolve_font_file(&font_name, bold, italic, &app) else {
        return FontMetrics { scale: 1.0, ascent_ratio: 0.78, descent_ratio: 0.22 };
    };
    let Some((upem, ascent, descent)) = read_font_metrics(&path) else {
        return FontMetrics { scale: 1.0, ascent_ratio: 0.78, descent_ratio: 0.22 };
    };
    let height = ascent + descent;
    if height == 0 {
        return FontMetrics { scale: 1.0, ascent_ratio: 0.78, descent_ratio: 0.22 };
    }
    FontMetrics {
        scale: upem as f64 / height as f64,
        ascent_ratio: ascent as f64 / height as f64,
        descent_ratio: descent as f64 / height as f64,
    }
}

pub fn find_vaapi_render_device() -> Option<String> {
    for i in 128..=136 {
        let path = format!("/dev/dri/renderD{}", i);
        if std::path::Path::new(&path).exists() {
            return Some(path);
        }
    }
    None
}

#[derive(serde::Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct HardwareEncodersStatus {
    pub has_qsv: bool,
    pub has_nvenc: bool,
    pub has_vaapi: bool,
    pub has_videotoolbox: bool,
}

#[tauri::command]
pub async fn check_hardware_encoders(app: tauri::AppHandle) -> HardwareEncodersStatus {
    let ffmpeg_bin = crate::ffmpeg_resolver::ensure_ffmpeg_available(Some(&app))
        .unwrap_or_else(|_| PathBuf::from("ffmpeg"));

    let f1 = ffmpeg_bin.clone();
    let qsv_task = tokio::task::spawn_blocking(move || {
        std::process::Command::new(&f1)
            .args(["-f", "lavfi", "-i", "nullsrc", "-frames:v", "1", "-c:v", "h264_qsv", "-f", "null", "-"])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    });

    let f2 = ffmpeg_bin.clone();
    let nvenc_task = tokio::task::spawn_blocking(move || {
        std::process::Command::new(&f2)
            .args(["-f", "lavfi", "-i", "nullsrc", "-frames:v", "1", "-c:v", "h264_nvenc", "-f", "null", "-"])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    });

    let f3 = ffmpeg_bin.clone();
    let vaapi_task = tokio::task::spawn_blocking(move || {
        if let Some(dev) = find_vaapi_render_device() {
            std::process::Command::new(&f3)
                .args([
                    "-vaapi_device", &dev,
                    "-f", "lavfi", "-i", "nullsrc", "-frames:v", "1",
                    "-vf", "format=nv12,hwupload",
                    "-c:v", "h264_vaapi",
                    "-f", "null", "-",
                ])
                .output()
                .map(|o| o.status.success())
                .unwrap_or(false)
        } else {
            false
        }
    });

    let f4 = ffmpeg_bin.clone();
    let videotoolbox_task = tokio::task::spawn_blocking(move || {
        std::process::Command::new(&f4)
            .args(["-f", "lavfi", "-i", "nullsrc", "-frames:v", "1", "-c:v", "h264_videotoolbox", "-f", "null", "-"])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    });

    let (has_qsv, has_nvenc, has_vaapi, has_videotoolbox) = tokio::join!(
        async { qsv_task.await.unwrap_or(false) },
        async { nvenc_task.await.unwrap_or(false) },
        async { vaapi_task.await.unwrap_or(false) },
        async { videotoolbox_task.await.unwrap_or(false) },
    );

    HardwareEncodersStatus {
        has_qsv,
        has_nvenc,
        has_vaapi,
        has_videotoolbox,
    }
}

/// Converts HTML Hex color "#RRGGBB" or "#AARRGGBB" into ASS Color format "&H(AA)BBGGRR&"
fn hex_to_ass_color(hex: &str, alpha: u8) -> String {
    let clean = hex.trim_start_matches('#');
    let (r, g, b) = if clean.len() >= 6 && clean.is_char_boundary(6) && clean.as_bytes().iter().take(6).all(u8::is_ascii_hexdigit) {
        (
            &clean[0..2],
            &clean[2..4],
            &clean[4..6],
        )
    } else {
        ("FF", "FF", "FF")
    };
    
    // ASS format uses BGR order: &H(Alpha)BBGGRR&
    format!("&H{:02X}{}{}{}&", alpha, b, g, r)
}

/// ASS stores transparency inversely: 00 is fully opaque and FF is fully transparent.
fn opacity_percent_to_ass_alpha(opacity: u8) -> u8 {
    let clamped = opacity.min(100);
    255 - ((clamped as u16 * 255 + 50) / 100) as u8
}

/// Calculates the downscaling FFmpeg filter maintaining aspect ratio
pub fn get_resolution_scale_filter(scale_choice: &str, video_width: u32, video_height: u32) -> Option<String> {
    if scale_choice == "original" || scale_choice.is_empty() {
        return None;
    }

    let (target_w, target_h) = match scale_choice {
        "4k" => (3840, 2160),
        "2k" => (2560, 1440),
        "1080p" => (1920, 1080),
        "720p" => (1280, 720),
        "480p" => (854, 480),
        _ => return None,
    };

    let is_portrait = video_height > video_width;
    let (max_w, max_h) = if is_portrait {
        (target_h, target_w)
    } else {
        (target_w, target_h)
    };

    // If source is already smaller or equal, do not upscale
    if video_width <= max_w && video_height <= max_h {
        return None;
    }

    if is_portrait {
        Some(format!("scale=-2:{}:flags=bicubic", max_h))
    } else {
        Some(format!("scale={}:-2:flags=bicubic", max_w))
    }
}

/// Unified Single Source of Truth for Recommended Quality Preset Values across all HW & Codec permutations.
/// Returns exact integer quality parameter (CRF, CQ, Global Quality, QP, q:v %, or ProRes profile).
pub fn get_preset_quality_value(hw: &str, codec: &str, preset: &str) -> i32 {
    match (hw, codec) {
        ("videotoolbox", "prores") => match preset {
            "draft" => 1, // LT
            "high" => 3,  // HQ
            "lossless" => 4, // 4444
            _ => 2,       // Standard
        },
        ("videotoolbox", _) => match preset {
            "draft" => 50,
            "high" => 78,
            "lossless" => 90,
            _ => 65,
        },
        ("nvenc", "av1") | ("qsv", "av1") | ("vaapi", "av1") => match preset {
            "draft" => 32,
            "high" => 20,
            "lossless" => 16,
            _ => 26,
        },
        ("nvenc", _) | ("qsv", _) | ("vaapi", _) => match preset {
            "draft" => 28,
            "high" => 18,
            "lossless" => 14,
            _ => 22,
        },
        (_, "prores") => match preset {
            "draft" => 1, // LT
            "high" => 3,  // HQ
            "lossless" => 4, // 4444
            _ => 2,       // Standard
        },
        (_, "av1") => match preset {
            "draft" => 34,
            "high" => 22,
            "lossless" => 18,
            _ => 28,
        },
        (_, "vp9") => match preset {
            "draft" => 36,
            "high" => 24,
            "lossless" => 18,
            _ => 30,
        },
        (_, "h265") => match preset {
            "draft" => 29,
            "high" => 20,
            "lossless" => 16,
            _ => 24,
        },
        _ => match preset { // libx264 & default fallback
            "draft" => 28,
            "high" => 18,
            "lossless" => 14,
            _ => 22,
        },
    }
}

/// Builds dynamic video encoder and quality/speed arguments based on codec, hardware accelerator, and quality mode
pub fn build_video_encoder_flags(settings: &HardsubSettings) -> Vec<String> {
    let mut args = Vec::new();
    let is_custom = settings.video_quality_mode == "custom" || settings.video_quality_preset == "custom";
    let speed = settings.video_preset_speed.as_str();
    let hw = settings.hw_accel.as_str();
    let codec = settings.video_codec.as_str();

    match (hw, codec) {
        ("qsv", "h264") | ("qsv", "h265") | ("qsv", "av1") => {
            let codec_name = match codec {
                "h265" => "hevc_qsv",
                "av1" => "av1_qsv",
                _ => "h264_qsv",
            };
            let qsv_preset = match speed {
                "fast" => "faster",
                "slow" => "slow",
                _ => "medium",
            };
            let gq = if is_custom {
                settings.video_quality_value.clamp(1, 51) as i32
            } else {
                get_preset_quality_value(hw, codec, &settings.video_quality_preset)
            };
            args.push("-c:v".to_string());
            args.push(codec_name.to_string());
            args.push("-preset".to_string());
            args.push(qsv_preset.to_string());
            args.push("-global_quality".to_string());
            args.push(gq.to_string());
        }
        ("nvenc", "h264") | ("nvenc", "h265") | ("nvenc", "av1") => {
            let codec_name = match codec {
                "h265" => "hevc_nvenc",
                "av1" => "av1_nvenc",
                _ => "h264_nvenc",
            };
            let nvenc_preset = match speed {
                "fast" => "p2",
                "slow" => "p6",
                _ => "p4",
            };
            let cq = if is_custom {
                settings.video_quality_value.clamp(1, 51) as i32
            } else {
                get_preset_quality_value(hw, codec, &settings.video_quality_preset)
            };
            args.push("-c:v".to_string());
            args.push(codec_name.to_string());
            args.push("-preset".to_string());
            args.push(nvenc_preset.to_string());
            args.push("-cq".to_string());
            args.push(cq.to_string());
        }
        ("vaapi", "h264") | ("vaapi", "h265") | ("vaapi", "av1") => {
            let codec_name = match codec {
                "h265" => "hevc_vaapi",
                "av1" => "av1_vaapi",
                _ => "h264_vaapi",
            };
            let qp = if is_custom {
                settings.video_quality_value.clamp(1, 51) as i32
            } else {
                get_preset_quality_value(hw, codec, &settings.video_quality_preset)
            };
            args.push("-c:v".to_string());
            args.push(codec_name.to_string());
            args.push("-qp".to_string());
            args.push(qp.to_string());
        }
        ("videotoolbox", "h264") | ("videotoolbox", "h265") => {
            let codec_name = match codec {
                "h265" => "hevc_videotoolbox",
                _ => "h264_videotoolbox",
            };
            let qv = if is_custom {
                settings.video_quality_value.clamp(1, 100) as i32
            } else {
                get_preset_quality_value(hw, codec, &settings.video_quality_preset)
            };
            args.push("-c:v".to_string());
            args.push(codec_name.to_string());
            args.push("-q:v".to_string());
            args.push(qv.to_string());
        }
        ("videotoolbox", "prores") => {
            let profile = if is_custom {
                settings.video_quality_value.clamp(0, 5) as i32
            } else {
                get_preset_quality_value(hw, codec, &settings.video_quality_preset)
            };
            args.push("-c:v".to_string());
            args.push("prores_videotoolbox".to_string());
            args.push("-profile:v".to_string());
            args.push(profile.to_string());
        }
        // CPU Encoders & Generic fallback
        _ => {
            match codec {
                "h265" => {
                    let crf = if is_custom {
                        settings.video_quality_value.clamp(0, 51) as i32
                    } else {
                        get_preset_quality_value(hw, codec, &settings.video_quality_preset)
                    };
                    let cpu_preset = match speed {
                        "fast" => "fast",
                        "slow" => "slow",
                        _ => "medium",
                    };
                    args.push("-c:v".to_string());
                    args.push("libx265".to_string());
                    args.push("-crf".to_string());
                    args.push(crf.to_string());
                    args.push("-preset".to_string());
                    args.push(cpu_preset.to_string());
                }
                "av1" => {
                    let crf = if is_custom {
                        settings.video_quality_value.clamp(0, 63) as i32
                    } else {
                        get_preset_quality_value(hw, codec, &settings.video_quality_preset)
                    };
                    let svt_preset = match speed {
                        "fast" => "8",
                        "slow" => "4",
                        _ => "6",
                    };
                    args.push("-c:v".to_string());
                    args.push("libsvtav1".to_string());
                    args.push("-crf".to_string());
                    args.push(crf.to_string());
                    args.push("-preset".to_string());
                    args.push(svt_preset.to_string());
                }
                "vp9" => {
                    let crf = if is_custom {
                        settings.video_quality_value.clamp(0, 63) as i32
                    } else {
                        get_preset_quality_value(hw, codec, &settings.video_quality_preset)
                    };
                    args.push("-c:v".to_string());
                    args.push("libvpx-vp9".to_string());
                    args.push("-crf".to_string());
                    args.push(crf.to_string());
                    args.push("-b:v".to_string());
                    args.push("0".to_string());
                    match speed {
                        "fast" => {
                            args.push("-deadline".to_string());
                            args.push("realtime".to_string());
                            args.push("-cpu-used".to_string());
                            args.push("4".to_string());
                        }
                        "slow" => {
                            args.push("-deadline".to_string());
                            args.push("good".to_string());
                            args.push("-cpu-used".to_string());
                            args.push("0".to_string());
                        }
                        _ => {
                            args.push("-deadline".to_string());
                            args.push("good".to_string());
                            args.push("-cpu-used".to_string());
                            args.push("2".to_string());
                        }
                    }
                }
                "prores" => {
                    let profile = if is_custom {
                        settings.video_quality_value.clamp(0, 5) as i32
                    } else {
                        get_preset_quality_value(hw, codec, &settings.video_quality_preset)
                    };
                    args.push("-c:v".to_string());
                    args.push("prores_ks".to_string());
                    args.push("-profile:v".to_string());
                    args.push(profile.to_string());
                }
                _ => { // Default H.264 (libx264)
                    let crf = if is_custom {
                        settings.video_quality_value.clamp(0, 51) as i32
                    } else {
                        get_preset_quality_value(hw, codec, &settings.video_quality_preset)
                    };
                    let cpu_preset = match speed {
                        "fast" => "faster",
                        "slow" => "slow",
                        _ => "medium",
                    };
                    args.push("-c:v".to_string());
                    args.push("libx264".to_string());
                    args.push("-crf".to_string());
                    args.push(crf.to_string());
                    args.push("-preset".to_string());
                    args.push(cpu_preset.to_string());
                }
            }
        }
    }
    args
}

/// Builds audio encoder arguments
pub fn build_audio_encoder_flags(settings: &HardsubSettings) -> Vec<String> {
    let mut args = Vec::new();
    let codec = if settings.audio_codec.is_empty() {
        "copy"
    } else {
        settings.audio_codec.as_str()
    };

    let bitrate = if settings.audio_bitrate.is_empty() {
        "192k"
    } else {
        settings.audio_bitrate.as_str()
    };

    match codec {
        "mute" => {
            args.push("-an".to_string());
        }
        "aac" => {
            args.push("-c:a".to_string());
            args.push("aac".to_string());
            args.push("-b:a".to_string());
            args.push(bitrate.to_string());
        }
        "opus" => {
            args.push("-c:a".to_string());
            args.push("libopus".to_string());
            args.push("-b:a".to_string());
            args.push(bitrate.to_string());
        }
        "mp3" => {
            args.push("-c:a".to_string());
            args.push("libmp3lame".to_string());
            args.push("-b:a".to_string());
            args.push(bitrate.to_string());
        }
        _ => { // "copy"
            args.push("-c:a".to_string());
            args.push("copy".to_string());
        }
    }
    args
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn test_escape_ffmpeg_filter_path() {
        // Windows standard path
        assert_eq!(
            escape_ffmpeg_filter_path(r"C:\Users\ahmad\Desktop\vid.srt"),
            "C\\:/Users/ahmad/Desktop/vid.srt"
        );
        // Windows verbatim UNC path (\\?\)
        assert_eq!(
            escape_ffmpeg_filter_path(r"\\?\C:\Users\ahmad\AppData\Local\WhisperDesktop\resources\fonts"),
            "C\\:/Users/ahmad/AppData/Local/WhisperDesktop/resources/fonts"
        );
        // Windows verbatim network share path (\\?\UNC\)
        assert_eq!(
            escape_ffmpeg_filter_path(r"\\?\UNC\192.168.1.10\share\sub.srt"),
            "//192.168.1.10/share/sub.srt"
        );
        // Path with special characters
        assert_eq!(
            escape_ffmpeg_filter_path(r"C:\My [Videos] & Movies, Part 1\sub's.srt"),
            "C\\:/My \\[Videos\\] & Movies\\, Part 1/sub'\\''s.srt"
        );
    }

    #[test]
    fn converts_opacity_to_ass_transparency() {
        assert_eq!(opacity_percent_to_ass_alpha(0), 255);
        assert_eq!(opacity_percent_to_ass_alpha(50), 127);
        assert_eq!(opacity_percent_to_ass_alpha(100), 0);
        assert_eq!(opacity_percent_to_ass_alpha(255), 0);
    }

    #[test]
    fn reads_vazirmatn_metrics_and_scale() {
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("resources/fonts/Vazirmatn.ttf");
        let (upem, ascent, descent) = read_font_metrics(&path).expect("bundled Vazirmatn should parse");
        assert_eq!(upem, 2048);
        assert_eq!(ascent, 2200);
        assert_eq!(descent, 1300);
    }

    #[test]
    fn hex_to_ass_color_conversion() {
        assert_eq!(hex_to_ass_color("#FF0000", 0), "&H000000FF&");
        assert_eq!(hex_to_ass_color("#0000FF", 0), "&H00FF0000&");
        assert_eq!(hex_to_ass_color("#FFFFFF", 128), "&H80FFFFFF&");
    }

    #[test]
    fn test_resolution_scale_filter() {
        // Landscape video 4K downscale to 1080p
        let filter = get_resolution_scale_filter("1080p", 3840, 2160);
        assert_eq!(filter, Some("scale=1920:-2:flags=bicubic".to_string()));

        // Already 1080p -> should return None
        let filter_same = get_resolution_scale_filter("1080p", 1920, 1080);
        assert_eq!(filter_same, None);

        // Portrait 1080x1920 downscale to 720p
        let filter_portrait = get_resolution_scale_filter("720p", 1080, 1920);
        assert_eq!(filter_portrait, Some("scale=-2:1280:flags=bicubic".to_string()));

        // Upscale guard: source 1280x720 target 4k -> None (no upscaling)
        assert_eq!(get_resolution_scale_filter("4k", 1280, 720), None);
    }

    #[test]
    fn test_preset_quality_matrix_values() {
        assert_eq!(get_preset_quality_value("cpu", "h264", "draft"), 28);
        assert_eq!(get_preset_quality_value("cpu", "h264", "balanced"), 22);
        assert_eq!(get_preset_quality_value("cpu", "h264", "high"), 18);
        assert_eq!(get_preset_quality_value("cpu", "h264", "lossless"), 14);

        assert_eq!(get_preset_quality_value("cpu", "h265", "draft"), 29);
        assert_eq!(get_preset_quality_value("cpu", "h265", "balanced"), 24);
        assert_eq!(get_preset_quality_value("cpu", "h265", "high"), 20);
        assert_eq!(get_preset_quality_value("cpu", "h265", "lossless"), 16);

        assert_eq!(get_preset_quality_value("cpu", "av1", "draft"), 34);
        assert_eq!(get_preset_quality_value("cpu", "av1", "balanced"), 28);
        assert_eq!(get_preset_quality_value("cpu", "av1", "high"), 22);
        assert_eq!(get_preset_quality_value("cpu", "av1", "lossless"), 18);

        assert_eq!(get_preset_quality_value("nvenc", "h264", "balanced"), 22);
        assert_eq!(get_preset_quality_value("nvenc", "av1", "balanced"), 26);
        assert_eq!(get_preset_quality_value("qsv", "h264", "balanced"), 22);
        assert_eq!(get_preset_quality_value("vaapi", "h264", "balanced"), 22);

        assert_eq!(get_preset_quality_value("videotoolbox", "h264", "balanced"), 65);
        assert_eq!(get_preset_quality_value("videotoolbox", "h264", "high"), 78);
        assert_eq!(get_preset_quality_value("videotoolbox", "prores", "high"), 3);
        assert_eq!(get_preset_quality_value("cpu", "prores", "balanced"), 2);
    }

    #[test]
    fn test_video_encoder_flags_cpu_h264() {
        let mut settings = HardsubSettings {
            video_path: "test.mp4".to_string(),
            subtitle_path: "test.ass".to_string(),
            output_path: "out.mp4".to_string(),
            output_format: "mp4".to_string(),
            video_codec: "h264".to_string(),
            hw_accel: "cpu".to_string(),
            video_quality_mode: "preset".to_string(),
            video_quality_preset: "high".to_string(),
            video_quality_value: 18,
            video_preset_speed: "slow".to_string(),
            resolution_scale: "original".to_string(),
            font_name: "Vazirmatn".to_string(),
            font_size: 24,
            primary_color: "#FFFFFF".to_string(),
            outline_color: "#000000".to_string(),
            outline_size: 2,
            bg_box: false,
            bg_box_color: "#000000".to_string(),
            bg_box_opacity: 50,
            bg_box_radius: 0,
            position_y: 30,
            width_margin: 90,
            bold: true,
            italic: false,
            alignment: 2,
            audio_codec: "aac".to_string(),
            audio_bitrate: "256k".to_string(),
        };

        let flags = build_video_encoder_flags(&settings);
        assert_eq!(flags, vec!["-c:v", "libx264", "-crf", "18", "-preset", "slow"]);

        // Custom CRF mode
        settings.video_quality_mode = "custom".to_string();
        settings.video_quality_value = 16;
        let flags_custom = build_video_encoder_flags(&settings);
        assert_eq!(flags_custom, vec!["-c:v", "libx264", "-crf", "16", "-preset", "slow"]);
    }

    #[test]
    fn test_video_encoder_flags_nvenc() {
        let settings = HardsubSettings {
            video_path: "test.mp4".to_string(),
            subtitle_path: "test.ass".to_string(),
            output_path: "out.mp4".to_string(),
            output_format: "mp4".to_string(),
            video_codec: "h265".to_string(),
            hw_accel: "nvenc".to_string(),
            video_quality_mode: "custom".to_string(),
            video_quality_preset: "balanced".to_string(),
            video_quality_value: 21,
            video_preset_speed: "fast".to_string(),
            resolution_scale: "original".to_string(),
            font_name: "Vazirmatn".to_string(),
            font_size: 24,
            primary_color: "#FFFFFF".to_string(),
            outline_color: "#000000".to_string(),
            outline_size: 2,
            bg_box: false,
            bg_box_color: "#000000".to_string(),
            bg_box_opacity: 50,
            bg_box_radius: 0,
            position_y: 30,
            width_margin: 90,
            bold: true,
            italic: false,
            alignment: 2,
            audio_codec: "copy".to_string(),
            audio_bitrate: "192k".to_string(),
        };

        let flags = build_video_encoder_flags(&settings);
        assert_eq!(flags, vec!["-c:v", "hevc_nvenc", "-preset", "p2", "-cq", "21"]);
    }

    #[test]
    fn test_audio_encoder_flags() {
        let mut settings = HardsubSettings {
            video_path: "test.mp4".to_string(),
            subtitle_path: "test.ass".to_string(),
            output_path: "out.mp4".to_string(),
            output_format: "mp4".to_string(),
            video_codec: "h264".to_string(),
            hw_accel: "cpu".to_string(),
            video_quality_mode: "preset".to_string(),
            video_quality_preset: "balanced".to_string(),
            video_quality_value: 22,
            video_preset_speed: "medium".to_string(),
            resolution_scale: "original".to_string(),
            font_name: "Vazirmatn".to_string(),
            font_size: 24,
            primary_color: "#FFFFFF".to_string(),
            outline_color: "#000000".to_string(),
            outline_size: 2,
            bg_box: false,
            bg_box_color: "#000000".to_string(),
            bg_box_opacity: 50,
            bg_box_radius: 0,
            position_y: 30,
            width_margin: 90,
            bold: true,
            italic: false,
            alignment: 2,
            audio_codec: "opus".to_string(),
            audio_bitrate: "128k".to_string(),
        };

        assert_eq!(build_audio_encoder_flags(&settings), vec!["-c:a", "libopus", "-b:a", "128k"]);

        settings.audio_codec = "mute".to_string();
        assert_eq!(build_audio_encoder_flags(&settings), vec!["-an"]);

        settings.audio_codec = "copy".to_string();
        assert_eq!(build_audio_encoder_flags(&settings), vec!["-c:a", "copy"]);
    }
}

#[tauri::command]
pub async fn start_hardsub_task(
    app: AppHandle,
    log_state: tauri::State<'_, crate::LogState>,
    hardsub_state: tauri::State<'_, crate::HardsubState>,
    settings: HardsubSettings,
) -> Result<HardsubResult, String> {
    let logs = log_state.0.clone();
    let session = hardsub_state.0.clone();
    run_hardsub_task(app, logs, session, settings).await
}

/// Escapes special characters in file paths for FFmpeg filtergraphs (-vf subtitles=...).
/// Handles Windows verbatim local paths (\\?\C:\) and extended network paths (\\?\UNC\server\share).
fn escape_ffmpeg_filter_path(path: &str) -> String {
    let clean = if let Some(unc_suffix) = path.strip_prefix(r"\\?\UNC\").or_else(|| path.strip_prefix("//?/UNC/")) {
        format!("//{}", unc_suffix.trim_start_matches('\\').trim_start_matches('/'))
    } else {
        path.strip_prefix(r"\\?\")
            .or_else(|| path.strip_prefix("//?/"))
            .unwrap_or(path)
            .to_string()
    };

    clean
        .replace('\\', "/")
        .replace(':', "\\:")
        .replace('\'', "'\\''")
        .replace('[', "\\[")
        .replace(']', "\\]")
        .replace(',', "\\,")
        .replace(';', "\\;")
}

/// Resolves a unique output path by appending (1), (2), etc. if the file already exists on disk
fn resolve_unique_output_path(target_path: &str) -> String {
    let path = Path::new(target_path);
    if !path.exists() {
        return target_path.to_string();
    }

    let parent = path.parent().unwrap_or_else(|| Path::new(""));
    let stem = path.file_stem().unwrap_or_default().to_string_lossy();
    let ext = path.extension().unwrap_or_default().to_string_lossy();

    let mut count = 1;
    loop {
        let new_filename = if ext.is_empty() {
            format!("{} ({})", stem, count)
        } else {
            format!("{} ({}).{}", stem, count, ext)
        };
        let candidate = parent.join(new_filename);
        if !candidate.exists() {
            return candidate.to_string_lossy().to_string();
        }
        count += 1;
    }
}

pub async fn run_hardsub_task(
    app: AppHandle,
    logs: Arc<AppLogs>,
    session: Arc<std::sync::Mutex<crate::HardsubSession>>,
    mut settings: HardsubSettings,
) -> Result<HardsubResult, String> {
    struct TempAssCleanupGuard<'a> {
        path: &'a str,
        logs: Arc<AppLogs>,
        app: AppHandle,
    }

    impl<'a> Drop for TempAssCleanupGuard<'a> {
        fn drop(&mut self) {
            if self.path.ends_with(".temp.ass") {
                let p = Path::new(self.path);
                if p.exists() {
                    let _ = std::fs::remove_file(p);
                    self.logs.log(&self.app, "Hardsub", &format!("Cleaned up temporary subtitle file: {}", self.path));
                }
            }
        }
    }

    struct HardsubSessionGuard {
        session: Arc<std::sync::Mutex<crate::HardsubSession>>,
    }

    impl Drop for HardsubSessionGuard {
        fn drop(&mut self) {
            if let Ok(mut lock) = self.session.lock() {
                lock.child_pid = None;
                lock.is_running = false;
                lock.cancel_requested = false;
            }
        }
    }

    // Register pid and set phase
    {
        let mut lock = session.lock().map_err(|e| format!("Session lock failed: {}", e))?;
        if lock.is_running {
            return Err("Another video hardsubbing task is already running.".to_string());
        }
        lock.is_running = true;
        lock.cancel_requested = false;
        lock.child_pid = None;
    }
    let _session_guard = HardsubSessionGuard { session: session.clone() };

    let _cleanup_guard = TempAssCleanupGuard {
        path: &settings.subtitle_path,
        logs: logs.clone(),
        app: app.clone(),
    };

    let start_time = Instant::now();

    // Auto-increment output filename if file already exists on disk
    let final_output_path = resolve_unique_output_path(&settings.output_path);
    settings.output_path = final_output_path.clone();

    let video_name = Path::new(&settings.video_path)
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();

    logs.log(&app, "Hardsub", &format!("Starting hardsub task for: {} (Output: {})", video_name, settings.output_path));

    // Trigger OS notification
    let _ = app.notification().builder().title("Hardsub Video Started").body(format!("Encoding {}...", video_name)).show();

    let _ = app.emit("hardsub-status", TranscribeProgress {
        progress: 0.0,
        message: "Initializing FFmpeg Encoder...".to_string(),
        active: true,
    });

    // Probe duration, width, and height using ffprobe.
    // Runs asynchronously with a hard timeout so a hung ffprobe (network mount,
    // corrupt container) can never wedge the task; the blocking std::process
    // variant previously stalled a tokio worker thread with no escape.
    let ffprobe_bin = crate::ffmpeg_resolver::ensure_ffprobe_available(Some(&app))?;
    let ffmpeg_bin = crate::ffmpeg_resolver::ensure_ffmpeg_available(Some(&app))?;

    let mut total_duration_sec = 0.0;
    let mut video_width = 1920;
    let mut video_height = 1080;

    let probe_out = tokio::time::timeout(
        std::time::Duration::from_secs(30),
        Command::new(&ffprobe_bin)
            .args([
                "-v", "error",
                "-show_entries", "format=duration:stream=duration,width,height,codec_type,side_data_list,tags",
                "-of", "json",
                &settings.video_path,
            ])
            .output(),
    )
    .await;

    let mut rotation = 0;
    if let Ok(Ok(out)) = probe_out {
        if let Ok(json) = serde_json::from_slice::<serde_json::Value>(&out.stdout) {
            if let Some(duration_str) = json.pointer("/format/duration").and_then(|v| v.as_str()) {
                if let Ok(secs) = duration_str.parse::<f64>() {
                    total_duration_sec = secs;
                }
            }
            if let Some(streams) = json.pointer("/streams").and_then(|v| v.as_array()) {
                for stream in streams {
                    if stream.get("codec_type").and_then(|v| v.as_str()) != Some("video") {
                        continue;
                    }
                    if total_duration_sec <= 0.0 {
                        if let Some(d_str) = stream.get("duration").and_then(|v| v.as_str()) {
                            if let Ok(secs) = d_str.parse::<f64>() {
                                if secs > 0.0 {
                                    total_duration_sec = secs;
                                }
                            }
                        }
                    }
                    if let (Some(w), Some(h)) = (stream.get("width").and_then(|v| v.as_u64()), stream.get("height").and_then(|v| v.as_u64())) {
                        video_width = w as u32;
                        video_height = h as u32;
                    }
                    
                    // Try parsing rotation from Display Matrix in side_data_list
                    if let Some(side_data_list) = stream.get("side_data_list").and_then(|v| v.as_array()) {
                        for sd in side_data_list {
                            if sd.get("side_data_type").and_then(|v| v.as_str()) == Some("Display Matrix") {
                                if let Some(r) = sd.get("rotation").and_then(|v| v.as_i64()) {
                                    rotation = r;
                                }
                            }
                        }
                    }
                    
                    // Try parsing rotation from tags
                    if rotation == 0 {
                        if let Some(tags) = stream.get("tags") {
                            if let Some(r_str) = tags.get("rotate").and_then(|v| v.as_str()) {
                                if let Ok(r) = r_str.parse::<i64>() {
                                    rotation = r;
                                }
                            }
                        }
                    }
                    break;
                }
            }
        }
    }

    let normalized_rotation = ((rotation % 360 + 360) % 360) as u32;
    if normalized_rotation == 90 || normalized_rotation == 270 {
        std::mem::swap(&mut video_width, &mut video_height);
    }

    // Honour a cancellation requested while the probe was running (previously
    // unreachable: the first check only happened after filter construction).
    if session.lock().map(|l| l.cancel_requested).unwrap_or(false) {
        let _ = app.emit("hardsub-status", TranscribeProgress {
            progress: 0.0,
            message: "Hardsubbing cancelled by user.".to_string(),
            active: false,
        });
        return Err("Hardsubbing cancelled by user.".to_string());
    }

    logs.log(&app, "Hardsub", &format!("Probed video dimensions: {}x{} (Aspect: {:.3})", video_width, video_height, video_width as f64 / video_height as f64));

    // Calculate dynamic 288p reference canvas dimensions preserving video aspect ratio (for 16:9, 9:16, 4:3, 21:9, etc.)
    let aspect = (video_width as f64) / (video_height.max(1) as f64);
    let ref_height: u32 = 288;
    let ref_width = ((ref_height as f64) * aspect).round().max(1.0) as u32;

    // Construct Subtitle Style (force_style parameters)
    let raw_safe_font = settings
        .font_name
        .chars()
        .filter(|&c| !matches!(c, ',' | '\'' | '"' | ':' | '\\' | '=' | ';' | '\n' | '\r' | '{' | '}' | '%' | '[' | ']'))
        .collect::<String>()
        .trim()
        .to_string();
    let safe_font_name = if raw_safe_font.is_empty() {
        "Sans".to_string()
    } else if raw_safe_font.eq_ignore_ascii_case("Inter") {
        "Inter 24pt".to_string()
    } else {
        raw_safe_font
    };

    let font_metrics = get_font_render_scale(app.clone(), settings.font_name.clone(), settings.bold, settings.italic);
    let compensated_font_size = ((settings.font_size as f64) / font_metrics.scale).round() as u32;
    logs.log(&app, "Hardsub", &format!("Font render scale for '{}' (bold={}, italic={}): {:.4} -> FontSize {} -> {}", settings.font_name, settings.bold, settings.italic, font_metrics.scale, settings.font_size, compensated_font_size));

    let ass_primary_color = hex_to_ass_color(&settings.primary_color, 0); // 00 = fully opaque
    let ass_outline_color = hex_to_ass_color(&settings.outline_color, 0);
    let ass_bg_color = hex_to_ass_color(&settings.bg_box_color, opacity_percent_to_ass_alpha(settings.bg_box_opacity));

    let border_style = if settings.bg_box {
        3 // Opaque box style
    } else {
        1 // Outline + shadow style
    };

    let alignment = settings.alignment;

    // Use libass style overrides to format subtitle typography and position precisely.
    // MarginV sets bottom vertical distance in 288p coordinate space, while margin_lr scales with ref_width.
    let margin_lr = ((100 - settings.width_margin.min(100)) as f64 / 200.0 * (ref_width as f64)).round() as u32;
    let force_style = format!(
        "FontName={},FontSize={},Bold={},Italic={},PrimaryColour={},OutlineColour={},BackColour={},BorderStyle={},Outline={},Shadow=0,Alignment={},MarginV={},MarginL={},MarginR={}",
        safe_font_name,
        compensated_font_size,
        if settings.bold { 1 } else { 0 },
        if settings.italic { 1 } else { 0 },
        ass_primary_color,
        ass_outline_color,
        ass_bg_color,
        border_style,
        settings.outline_size,
        alignment,
        settings.position_y,
        margin_lr,
        margin_lr
    );

    let mut resolved_fonts_dir = app.path().resolve("resources/fonts", tauri::path::BaseDirectory::Resource).ok().filter(|p| p.exists());
    if resolved_fonts_dir.is_none() {
        if let Ok(exe_path) = std::env::current_exe() {
            if let Some(parent) = exe_path.parent() {
                let portable_fonts = parent.join("resources").join("fonts");
                if portable_fonts.exists() {
                    resolved_fonts_dir = Some(portable_fonts);
                }
            }
        }
    }
    if resolved_fonts_dir.is_none() {
        if let Ok(manifest_dir) = std::env::var("CARGO_MANIFEST_DIR") {
            let dev_path = std::path::Path::new(&manifest_dir).join("resources/fonts");
            if dev_path.exists() {
                resolved_fonts_dir = Some(dev_path);
            }
        }
    }

    let fonts_dir_opt = if let Some(path) = resolved_fonts_dir {
        let escaped_fonts_dir = escape_ffmpeg_filter_path(&path.to_string_lossy());
        format!(":fontsdir='{}'", escaped_fonts_dir)
    } else {
        "".to_string()
    };

    let escaped_sub_path = escape_ffmpeg_filter_path(&settings.subtitle_path);

    // Choose subtitles filter mode based on extension (.ass -> subtitles filter preserving native formatting; .srt -> force_style with dynamic reference resolution)
    let is_ass_file = settings.subtitle_path.to_lowercase().ends_with(".ass");
    let sub_filter = if is_ass_file {
        // ASS script has complete style and header metadata defined
        format!("subtitles='{}'{}", escaped_sub_path, fonts_dir_opt)
    } else {
        format!("subtitles='{}':original_size={}x{}{}:force_style='{}'", escaped_sub_path, ref_width, ref_height, fonts_dir_opt, force_style)
    };

    // Build FFmpeg Arguments
    let mut ffmpeg_args: Vec<String> = Vec::new();

    // Pass global non-interactive flags and machine-readable progress on stdout
    ffmpeg_args.push("-nostdin".to_string());
    ffmpeg_args.push("-progress".to_string());
    ffmpeg_args.push("pipe:1".to_string());

    // 1. Hardware acceleration flags before -i
    let vaapi_dev = find_vaapi_render_device();
    if settings.hw_accel == "vaapi" {
        if let Some(ref dev) = vaapi_dev {
            ffmpeg_args.push("-vaapi_device".to_string());
            ffmpeg_args.push(dev.clone());
        }
    }

    // Disable FFmpeg auto-rotation so that we can rotate manually at the start of the filtergraph.
    // This ensures libass renders subtitles on the rotated vertical frame at the correct aspect ratio.
    ffmpeg_args.push("-noautorotate".to_string());
    ffmpeg_args.push("-y".to_string());
    ffmpeg_args.push("-i".to_string());
    ffmpeg_args.push(settings.video_path.clone());

    // 2. Video Filter
    let mut vf_filters = Vec::new();
    if normalized_rotation == 90 {
        vf_filters.push("transpose=1".to_string());
    } else if normalized_rotation == 180 {
        vf_filters.push("transpose=1,transpose=1".to_string());
    } else if normalized_rotation == 270 {
        vf_filters.push("transpose=2".to_string());
    }
    vf_filters.push(sub_filter);

    // Optional Resolution Downscaling Filter
    if let Some(scale_filter) = get_resolution_scale_filter(&settings.resolution_scale, video_width, video_height) {
        logs.log(&app, "Hardsub", &format!("Applying resolution scale filter: '{}' for target '{}'", scale_filter, settings.resolution_scale));
        vf_filters.push(scale_filter);
    }

    // If using VA-API hardware encoder, upload processed frames to VAAPI GPU surface
    if settings.hw_accel == "vaapi" {
        vf_filters.push("format=nv12,hwupload".to_string());
    }
    
    let vf_arg = vf_filters.join(",");

    ffmpeg_args.push("-vf".to_string());
    ffmpeg_args.push(vf_arg);

    // After a manual transpose, clear the source rotation metadata: mp4 muxers
    // drop it, but matroska copies the ROTATE tag into the output, which would
    // rotate the already-transposed video a second time in players.
    if normalized_rotation != 0 {
        ffmpeg_args.push("-metadata:s:v".to_string());
        ffmpeg_args.push("rotate=0".to_string());
    }

    // 3. Video Encoder Selection & Quality Parameters
    let video_encoder_flags = build_video_encoder_flags(&settings);
    ffmpeg_args.extend(video_encoder_flags);

    // 4. Audio Codec & Bitrate Selection
    let audio_encoder_flags = build_audio_encoder_flags(&settings);
    ffmpeg_args.extend(audio_encoder_flags);

    // 5. Output file
    ffmpeg_args.push(settings.output_path.clone());

    // Check if cancellation was requested while preparing probing/subtitles
    if session.lock().map(|l| l.cancel_requested).unwrap_or(false) {
        if Path::new(&settings.output_path).exists() {
            let _ = std::fs::remove_file(&settings.output_path);
        }
        let _ = app.emit("hardsub-status", TranscribeProgress {
            progress: 0.0,
            message: "Hardsubbing cancelled by user.".to_string(),
            active: false,
        });
        return Err("Hardsubbing cancelled by user.".to_string());
    }

    logs.log(&app, "FFmpeg", &format!("Executing command: {} {}", ffmpeg_bin.display(), ffmpeg_args.join(" ")));

    let mut cmd = Command::new(&ffmpeg_bin);
    cmd.args(&ffmpeg_args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(unix)]
    {
        cmd.process_group(0);
    }

    let mut child = cmd.spawn()
        .map_err(|e| format!("Failed to spawn ffmpeg ({}): {}", ffmpeg_bin.display(), e))?;

    let child_pid = child.id();
    let is_cancelled = if let Ok(mut lock) = session.lock() {
        if lock.cancel_requested {
            true
        } else {
            lock.child_pid = child_pid;
            false
        }
    } else {
        false
    };

    if is_cancelled {
        let _ = child.kill().await;
        if Path::new(&settings.output_path).exists() {
            let _ = std::fs::remove_file(&settings.output_path);
        }
        let _ = app.emit("hardsub-status", TranscribeProgress {
            progress: 0.0,
            message: "Hardsubbing cancelled by user.".to_string(),
            active: false,
        });
        return Err("Hardsubbing cancelled by user.".to_string());
    }

    let stdout = child.stdout.take().ok_or("Failed to capture ffmpeg stdout")?;
    let stderr = child.stderr.take().ok_or("Failed to capture ffmpeg stderr")?;

    let mut stdout_reader = BufReader::new(stdout).lines();
    let mut stderr_reader = BufReader::new(stderr).lines();

    let mut stdout_done = false;
    let mut stderr_done = false;

    let mut current_speed = String::new();
    let mut current_fps = String::new();
    let mut max_progress: f64 = 0.0;
    let mut last_emit_time = Instant::now() - std::time::Duration::from_secs(1);
    let mut last_emitted_percent: Option<u32> = None;

    let parse_time_str = |time_str: &str| -> Option<f64> {
        let parts: Vec<&str> = time_str.split(':').collect();
        if parts.len() == 3 {
            let h = parts[0].parse::<f64>().ok()?;
            let m = parts[1].parse::<f64>().ok()?;
            let s = parts[2].parse::<f64>().ok()?;
            Some(h * 3600.0 + m * 60.0 + s)
        } else {
            None
        }
    };

    while !stdout_done || !stderr_done {
        tokio::select! {
            res = crate::transcribe::next_line_lossy(&mut stdout_reader), if !stdout_done => {
                match res {
                    Some(line) => {
                        let trimmed = line.trim();
                        if let Some((k, v)) = trimmed.split_once('=') {
                            let k = k.trim();
                            let v = v.trim();
                            
                            let parsed_sec: Option<f64> = match k {
                                "out_time_us" => v.parse::<f64>().ok().map(|us| us / 1_000_000.0),
                                "out_time_ms" => v.parse::<f64>().ok().map(|val| {
                                    if val > 1_000_000.0 { val / 1_000_000.0 } else { val / 1000.0 }
                                }),
                                "out_time" => parse_time_str(v),
                                _ => None,
                            };

                            if let Some(current_sec) = parsed_sec {
                                if total_duration_sec > 0.0 {
                                    let raw_p = (current_sec / total_duration_sec).clamp(0.0, 0.99);
                                    // Enforce strictly monotonic progress (never moves backwards)
                                    max_progress = max_progress.max(raw_p);
                                    let p = max_progress;
                                    let percent = (p * 100.0) as u32;

                                    let now = Instant::now();
                                    let time_since_last_emit = now.duration_since(last_emit_time);
                                    let percent_changed = last_emitted_percent != Some(percent);

                                    // Throttle IPC events to at most every 150ms or on integer percentage changes
                                    if percent_changed || time_since_last_emit >= std::time::Duration::from_millis(150) {
                                        last_emit_time = now;
                                        last_emitted_percent = Some(percent);

                                        let mut detail = Vec::new();
                                        if !current_speed.is_empty() && current_speed != "N/A" {
                                            detail.push(format!("Speed: {}", current_speed));
                                        }
                                        if !current_fps.is_empty() && current_fps != "0.00" && current_fps != "N/A" {
                                            detail.push(format!("{} FPS", current_fps));
                                        }

                                        let msg = if !detail.is_empty() {
                                            format!("Embedding Subtitles into Video... {}% ({})", percent, detail.join(" | "))
                                        } else {
                                            format!("Embedding Subtitles into Video... {}%", percent)
                                        };

                                        let _ = app.emit("hardsub-status", TranscribeProgress {
                                            progress: p,
                                            message: msg,
                                            active: true,
                                        });
                                    }
                                }
                            }

                            match k {
                                "speed" => {
                                    current_speed = v.to_string();
                                }
                                "fps" => {
                                    current_fps = v.to_string();
                                }
                                "progress" if v == "end" => {
                                    let _ = app.emit("hardsub-status", TranscribeProgress {
                                        progress: 0.99,
                                        message: "Finalizing video export...".to_string(),
                                        active: true,
                                    });
                                }
                                _ => {}
                            }
                        }
                    }
                    None => stdout_done = true,
                }
            }
            res = crate::transcribe::next_line_lossy(&mut stderr_reader), if !stderr_done => {
                match res {
                    Some(line) => {
                        logs.log(&app, "FFmpeg", &line);
                    }
                    None => stderr_done = true,
                }
            }
        }
    }

    let status = child.wait().await.map_err(|e| format!("ffmpeg execution failed: {}", e))?;

    // Check cancellation requested flag
    let was_cancelled = if let Ok(mut lock) = session.lock() {
        let cancelled = lock.cancel_requested;
        lock.child_pid = None;
        lock.is_running = false;
        cancelled
    } else {
        false
    };

    if was_cancelled || !status.success() {
        // Clean up partial output file if present
        if Path::new(&settings.output_path).exists() {
            let _ = std::fs::remove_file(&settings.output_path);
            logs.log(&app, "Hardsub", &format!("Removed partial output file: {}", settings.output_path));
        }

        if was_cancelled {
            let _ = app.emit("hardsub-status", TranscribeProgress {
                progress: 0.0,
                message: "Hardsubbing cancelled by user.".to_string(),
                active: false,
            });
            return Err("Hardsubbing cancelled by user.".to_string());
        }

        let _ = app.emit("hardsub-status", TranscribeProgress {
            progress: 0.0,
            message: "Hardsubbing encoding failed.".to_string(),
            active: false,
        });
        return Err(format!("FFmpeg failed with exit code: {:?}", status.code()));
    }

    let duration_ms = start_time.elapsed().as_millis() as u64;

    let output_size_mb = if let Ok(meta) = std::fs::metadata(&settings.output_path) {
        meta.len() as f64 / 1024.0 / 1024.0
    } else {
        0.0
    };

    logs.log(&app, "Hardsub", &format!("Hardsub completed successfully! Saved to: {}", settings.output_path));

    let _ = app.emit("hardsub-status", TranscribeProgress {
        progress: 1.0,
        message: "Hardsub video exported successfully!".to_string(),
        active: false,
    });

    // Notify OS
    let _ = app.notification().builder().title("Hardsub Completed").body(format!("Video saved to {}", settings.output_path)).show();

    Ok(HardsubResult {
        duration_ms,
        output_path: settings.output_path,
        output_size_mb,
    })
}
