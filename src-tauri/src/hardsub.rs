use std::path::Path;
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
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
    pub hw_accel: String,      // "cpu", "qsv", "nvenc", "vaapi"
    pub font_name: String,
    pub font_size: u32,
    pub primary_color: String,  // Hex "#FFFFFF"
    pub outline_color: String,  // Hex "#000000"
    pub outline_size: u32,
    pub bg_box: bool,
    pub bg_box_color: String,
    pub position_y: u32,       // MarginV offset
    pub width_margin: u32,
    pub bold: bool,
    pub italic: bool,
    pub alignment: u32,        // 2 = Bottom Center (default), 6 = Top Center, etc.
    pub audio_mode: String,    // "copy", "aac"
}

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
        ("Lalezar", "bundled"),
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

    // 2. Scan system fonts via fc-list
    if let Ok(output) = std::process::Command::new("fc-list")
        .args([":", "family"])
        .output()
    {
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

    fonts
}

#[derive(serde::Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct HardwareEncodersStatus {
    pub has_qsv: bool,
    pub has_nvenc: bool,
    pub has_vaapi: bool,
}

#[tauri::command]
pub fn check_hardware_encoders() -> HardwareEncodersStatus {
    let check_encoder = |encoder: &str| -> bool {
        if let Ok(output) = std::process::Command::new("ffmpeg")
            .args(["-h", &format!("encoder={}", encoder)])
            .output()
        {
            output.status.success()
        } else {
            false
        }
    };

    HardwareEncodersStatus {
        has_qsv: check_encoder("h264_qsv"),
        has_nvenc: check_encoder("h264_nvenc"),
        has_vaapi: check_encoder("h264_vaapi"),
    }
}

/// Converts HTML Hex color "#RRGGBB" or "#AARRGGBB" into ASS Color format "&H(AA)BBGGRR&"
fn hex_to_ass_color(hex: &str, alpha: u8) -> String {
    let clean = hex.trim_start_matches('#');
    let (r, g, b) = if clean.len() >= 6 {
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

#[tauri::command]
pub async fn start_hardsub_task(
    app: AppHandle,
    log_state: tauri::State<'_, crate::LogState>,
    session_state: tauri::State<'_, crate::TranscriptionState>,
    settings: HardsubSettings,
) -> Result<HardsubResult, String> {
    let logs = log_state.0.clone();
    let session = session_state.0.clone();
    run_hardsub_task(app, logs, session, settings).await
}

pub async fn run_hardsub_task(
    app: AppHandle,
    logs: Arc<AppLogs>,
    session: Arc<std::sync::Mutex<crate::TranscriptionSession>>,
    settings: HardsubSettings,
) -> Result<HardsubResult, String> {
    let start_time = Instant::now();
    let video_name = Path::new(&settings.video_path)
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();

    logs.log(&app, "Hardsub", &format!("Starting hardsub task for: {}", video_name));

    // Register pid and set phase
    {
        let mut lock = session.lock().map_err(|e| format!("Session lock failed: {}", e))?;
        lock.phase = crate::SessionPhase::Transcribing;
        lock.cancel_requested = false;
    }

    // Trigger OS notification
    let _ = std::process::Command::new("notify-send")
        .args(["Hardsub Video Started", &format!("Encoding {}...", video_name)])
        .spawn();

    let _ = app.emit("hardsub-status", TranscribeProgress {
        progress: 0.0,
        message: "Initializing FFmpeg encoder...".to_string(),
        active: true,
    });

    // Probe duration using ffprobe
    let mut total_duration_sec = 0.0;
    let probe_out = std::process::Command::new("ffprobe")
        .args([
            "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            &settings.video_path,
        ])
        .output();
    if let Ok(out) = probe_out {
        if let Ok(secs) = String::from_utf8_lossy(&out.stdout).trim().parse::<f64>() {
            total_duration_sec = secs;
        }
    }

    // Construct Subtitle Style (force_style parameters)
    let ass_primary_color = hex_to_ass_color(&settings.primary_color, 0); // 00 = fully opaque
    let ass_outline_color = hex_to_ass_color(&settings.outline_color, 0);
    let border_style = if settings.bg_box { 3 } else { 1 };
    let ass_bg_color = hex_to_ass_color(&settings.bg_box_color, 128); // 80 = 50% opacity

    let mut force_style = format!(
        "FontName={},FontSize={},PrimaryColour={},OutlineColour={},Outline={},BorderStyle={},MarginV={},Alignment={},Bold={},Italic={}",
        settings.font_name,
        settings.font_size,
        ass_primary_color,
        ass_outline_color,
        settings.outline_size,
        border_style,
        settings.position_y,
        settings.alignment,
        if settings.bold { 1 } else { 0 },
        if settings.italic { 1 } else { 0 },
    );

    if settings.bg_box {
        force_style.push_str(&format!(",BackColour={}", ass_bg_color));
    }

    // Resolve subtitle path escaping
    let escaped_sub_path = settings.subtitle_path
        .replace('\\', "/")
        .replace(':', "\\:")
        .replace('\'', "'\\''");

    let sub_filter = format!("subtitles='{}':force_style='{}'", escaped_sub_path, force_style);

    // Build FFmpeg Arguments
    let mut ffmpeg_args: Vec<String> = Vec::new();

    // 1. Hardware acceleration flags before -i
    match settings.hw_accel.as_str() {
        "qsv" => {
            ffmpeg_args.push("-hwaccel".to_string());
            ffmpeg_args.push("qsv".to_string());
            ffmpeg_args.push("-hwaccel_output_format".to_string());
            ffmpeg_args.push("qsv".to_string());
        }
        "vaapi" => {
            ffmpeg_args.push("-hwaccel".to_string());
            ffmpeg_args.push("vaapi".to_string());
        }
        _ => {}
    }

    ffmpeg_args.push("-y".to_string());
    ffmpeg_args.push("-i".to_string());
    ffmpeg_args.push(settings.video_path.clone());

    // 2. Video Filter
    ffmpeg_args.push("-vf".to_string());
    ffmpeg_args.push(sub_filter);

    // 3. Video Encoder Selection
    match (settings.hw_accel.as_str(), settings.video_codec.as_str()) {
        ("qsv", "h264") => {
            ffmpeg_args.push("-c:v".to_string());
            ffmpeg_args.push("h264_qsv".to_string());
            ffmpeg_args.push("-preset".to_string());
            ffmpeg_args.push("slow".to_string());
            ffmpeg_args.push("-global_quality".to_string());
            ffmpeg_args.push("23".to_string());
            ffmpeg_args.push("-look_ahead".to_string());
            ffmpeg_args.push("1".to_string());
            ffmpeg_args.push("-look_ahead_depth".to_string());
            ffmpeg_args.push("50".to_string());
        }
        ("qsv", "h265") => {
            ffmpeg_args.push("-c:v".to_string());
            ffmpeg_args.push("hevc_qsv".to_string());
            ffmpeg_args.push("-preset".to_string());
            ffmpeg_args.push("slow".to_string());
            ffmpeg_args.push("-global_quality".to_string());
            ffmpeg_args.push("23".to_string());
        }
        ("nvenc", "h264") => {
            ffmpeg_args.push("-c:v".to_string());
            ffmpeg_args.push("h264_nvenc".to_string());
            ffmpeg_args.push("-preset".to_string());
            ffmpeg_args.push("p4".to_string());
            ffmpeg_args.push("-cq".to_string());
            ffmpeg_args.push("23".to_string());
        }
        ("nvenc", "h265") => {
            ffmpeg_args.push("-c:v".to_string());
            ffmpeg_args.push("hevc_nvenc".to_string());
            ffmpeg_args.push("-preset".to_string());
            ffmpeg_args.push("p4".to_string());
            ffmpeg_args.push("-cq".to_string());
            ffmpeg_args.push("23".to_string());
        }
        ("vaapi", _) => {
            ffmpeg_args.push("-c:v".to_string());
            ffmpeg_args.push("h264_vaapi".to_string());
        }
        _ => {
            // Standard CPU
            match settings.video_codec.as_str() {
                "h265" => {
                    ffmpeg_args.push("-c:v".to_string());
                    ffmpeg_args.push("libx265".to_string());
                    ffmpeg_args.push("-crf".to_string());
                    ffmpeg_args.push("23".to_string());
                    ffmpeg_args.push("-preset".to_string());
                    ffmpeg_args.push("medium".to_string());
                }
                "vp9" => {
                    ffmpeg_args.push("-c:v".to_string());
                    ffmpeg_args.push("libvpx-vp9".to_string());
                    ffmpeg_args.push("-crf".to_string());
                    ffmpeg_args.push("30".to_string());
                    ffmpeg_args.push("-b:v".to_string());
                    ffmpeg_args.push("0".to_string());
                }
                "prores" => {
                    ffmpeg_args.push("-c:v".to_string());
                    ffmpeg_args.push("prores_ks".to_string());
                    ffmpeg_args.push("-profile:v".to_string());
                    ffmpeg_args.push("3".to_string());
                }
                _ => {
                    ffmpeg_args.push("-c:v".to_string());
                    ffmpeg_args.push("libx264".to_string());
                    ffmpeg_args.push("-crf".to_string());
                    ffmpeg_args.push("22".to_string());
                    ffmpeg_args.push("-preset".to_string());
                    ffmpeg_args.push("medium".to_string());
                }
            }
        }
    }

    // 4. Audio Codec
    if settings.audio_mode == "aac" {
        ffmpeg_args.push("-c:a".to_string());
        ffmpeg_args.push("aac".to_string());
        ffmpeg_args.push("-b:a".to_string());
        ffmpeg_args.push("192k".to_string());
    } else {
        ffmpeg_args.push("-c:a".to_string());
        ffmpeg_args.push("copy".to_string());
    }

    // 5. Output file
    ffmpeg_args.push(settings.output_path.clone());

    logs.log(&app, "FFmpeg", &format!("Executing command: ffmpeg {}", ffmpeg_args.join(" ")));

    let mut child = Command::new("ffmpeg")
        .args(&ffmpeg_args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn ffmpeg: {}", e))?;

    let child_pid = child.id();
    if let Ok(mut lock) = session.lock() {
        lock.child_pid = child_pid;
    }

    let stderr = child.stderr.take().ok_or("Failed to capture ffmpeg stderr")?;
    let mut stderr_reader = BufReader::new(stderr).lines();

    // Regex for parsing time=HH:MM:SS.ss progress
    let time_regex = regex::Regex::new(r"time=(\d+):(\d+):(\d+\.\d+)").unwrap();

    while let Ok(Some(line)) = stderr_reader.next_line().await {
        logs.log(&app, "FFmpeg", &line);

        // Parse progress time
        if total_duration_sec > 0.0 {
            if let Some(caps) = time_regex.captures(&line) {
                let hours: f64 = caps[1].parse().unwrap_or(0.0);
                let mins: f64 = caps[2].parse().unwrap_or(0.0);
                let secs: f64 = caps[3].parse().unwrap_or(0.0);
                let current_sec = hours * 3600.0 + mins * 60.0 + secs;

                let progress = (current_sec / total_duration_sec).min(1.0);
                let percent = (progress * 100.0) as u32;

                let _ = app.emit("hardsub-status", TranscribeProgress {
                    progress,
                    message: format!("Hardsubbing video... {}%", percent),
                    active: true,
                });
            }
        }
    }

    let status = child.wait().await.map_err(|e| format!("ffmpeg execution failed: {}", e))?;

    // Reset session phase
    if let Ok(mut lock) = session.lock() {
        lock.child_pid = None;
        lock.phase = crate::SessionPhase::Idle;
    }

    if !status.success() {
        let _ = app.emit("hardsub-status", TranscribeProgress {
            progress: 0.0,
            message: "Hardsubbing failed or was cancelled.".to_string(),
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
        message: "Hardsubbing complete! Output ready.".to_string(),
        active: false,
    });

    // Notify OS
    let _ = std::process::Command::new("notify-send")
        .args(["Hardsub Completed", &format!("Video saved to {}", settings.output_path)])
        .spawn();

    Ok(HardsubResult {
        duration_ms,
        output_path: settings.output_path,
        output_size_mb,
    })
}
