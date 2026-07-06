use std::path::Path;
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use regex::Regex;
use std::fs;
use std::time::Instant;

use crate::logger::AppLogs;
use crate::settings::WhisperSettings;

#[derive(serde::Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FileMetadata {
    pub name: String,
    pub path: String,
    pub format: String,
    pub size: String,
    pub duration_sec: f64,
    pub exists: bool,
}

#[derive(serde::Serialize, Clone)]
pub struct TranscribeProgress {
    pub progress: f64, // 0.0 to 1.0
    pub message: String,
    pub active: bool,
}

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptionResult {
    pub duration_ms: u64,
    pub speed_factor: f64,
    pub generated_files: Vec<String>,
}

pub fn probe_file_metadata(file_path: &str) -> FileMetadata {
    let path = Path::new(file_path);
    let mut meta = FileMetadata {
        name: path.file_name().unwrap_or_default().to_string_lossy().to_string(),
        path: file_path.to_string(),
        format: "Unknown".to_string(),
        size: "0 MB".to_string(),
        duration_sec: 0.0,
        exists: false,
    };
    
    if !path.exists() {
        return meta;
    }
    
    meta.exists = true;
    
    // Size formatting
    if let Ok(fs_meta) = fs::metadata(path) {
        let size_mb = fs_meta.len() as f64 / 1024.0 / 1024.0;
        meta.size = format!("{:.1} MB", size_mb);
    }
    
    // Format detection
    let ext = path.extension().unwrap_or_default().to_string_lossy().to_lowercase();
    match ext.as_str() {
        "mp4" | "mkv" | "avi" | "mov" | "flv" | "webm" | "m4v" => {
            meta.format = "🎥 Video".to_string();
        }
        "mp3" | "wav" | "ogg" | "m4a" | "flac" | "aac" | "wma" => {
            meta.format = "🎵 Audio".to_string();
        }
        _ => {
            meta.format = "📁 File".to_string();
        }
    }
    
    // ffprobe for duration
    let output = std::process::Command::new("ffprobe")
        .args([
            "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            file_path,
        ])
        .output();
        
    if let Ok(out) = output {
        let out_str = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if let Ok(secs) = out_str.parse::<f64>() {
            meta.duration_sec = secs;
        }
    }
    
    meta
}

pub async fn convert_to_wav(
    app: AppHandle,
    logs: Arc<AppLogs>,
    file_path: String,
) -> Result<String, String> {
    logs.log(&app, "FFmpeg", &format!("Starting conversion for: {}", file_path));
    
    // Generate temp wav file name in /tmp or system temp dir
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    
    let tmp_dir = std::env::temp_dir();
    let tmp_wav = tmp_dir.join(format!("whisper_tmp_{}.wav", timestamp));
    let tmp_wav_str = tmp_wav.to_str().ok_or("Invalid temp wav path")?.to_string();
    
    app.emit("transcribe-status", TranscribeProgress {
        progress: 0.0,
        message: "Converting to 16kHz WAV...".to_string(),
        active: true,
    }).unwrap();
    
    let mut child = Command::new("ffmpeg")
        .args([
            "-y",
            "-i", &file_path,
            "-ar", "16000",
            "-ac", "1",
            "-c:a", "pcm_s16le",
            &tmp_wav_str,
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn ffmpeg: {}", e))?;
        
    let stdout = child.stdout.take().ok_or("Failed to capture ffmpeg stdout")?;
    let stderr = child.stderr.take().ok_or("Failed to capture ffmpeg stderr")?;
    
    let mut stdout_reader = BufReader::new(stdout).lines();
    let mut stderr_reader = BufReader::new(stderr).lines();
    
    loop {
        tokio::select! {
            line = stdout_reader.next_line() => {
                match line {
                    Ok(Some(l)) => logs.log(&app, "FFmpeg", &l),
                    Ok(None) => break,
                    Err(_) => {}
                }
            }
            line = stderr_reader.next_line() => {
                match line {
                    Ok(Some(l)) => logs.log(&app, "FFmpeg", &l),
                    _ => {}
                }
            }
        }
    }
    
    let status = child.wait().await.map_err(|e| format!("ffmpeg execution failed: {}", e))?;
    if !status.success() {
        let _ = fs::remove_file(&tmp_wav);
        return Err(format!("FFmpeg failed with exit code: {:?}", status.code()));
    }
    
    logs.log(&app, "FFmpeg", "WAV conversion finished successfully! Format: PCM 16-bit, 16kHz, Mono.");
    app.emit("transcribe-status", TranscribeProgress {
        progress: 1.0,
        message: "Conversion complete! Ready to transcribe.".to_string(),
        active: false,
    }).unwrap();
    
    Ok(tmp_wav_str)
}

struct ActiveSessionGuard {
    session: std::sync::Arc<std::sync::Mutex<crate::TranscriptionSession>>,
}

impl Drop for ActiveSessionGuard {
    fn drop(&mut self) {
        if let Ok(mut lock) = self.session.lock() {
            lock.child_pid = None;
        }
    }
}

pub async fn run_transcription(
    app: AppHandle,
    logs: std::sync::Arc<AppLogs>,
    session: std::sync::Arc<std::sync::Mutex<crate::TranscriptionSession>>,
    settings: WhisperSettings,
    wav_path: String,
    mut duration_sec: f64,
) -> Result<TranscriptionResult, String> {
    let start_time = Instant::now();
    let file_name = Path::new(&settings.input_file)
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
        
    // Trigger OS-level notification
    let _ = std::process::Command::new("notify-send")
        .args(["Transcription Started", &format!("Processing {}...", file_name)])
        .spawn();
        
    let root = Path::new(&settings.clone_dir);
    let dir_name = settings.selected_backend.to_lowercase();
    let bin_path_1 = root.join(format!("build-{}", dir_name)).join("bin").join("whisper-cli");
    let bin_path_2 = root.join(format!("build-{}", dir_name)).join("whisper-cli");
    
    let bin_path = if bin_path_1.exists() {
        bin_path_1
    } else if bin_path_2.exists() {
        bin_path_2
    } else {
        return Err(format!("Whisper CLI binary not found! Please compile the {} backend first.", settings.selected_backend));
    };
    
    // Generate output file prefix (avoid overwriting existing ones by appending counters)
    let input_path = Path::new(&settings.input_file);
    let base_name = input_path.file_stem().unwrap_or_default().to_string_lossy();
    let parent_dir = input_path.parent().unwrap_or_else(|| Path::new("."));
    
    let mut out_name = parent_dir.join(base_name.to_string());
    let mut counter = 1;
    while {
        let name_str = out_name.file_name()
            .map(|f| f.to_string_lossy().into_owned())
            .unwrap_or_default();
            
        parent_dir.join(format!("{}.srt", name_str)).exists()
            || parent_dir.join(format!("{}.txt", name_str)).exists()
    } {
        out_name = parent_dir.join(format!("{}-{}", base_name, counter));
        counter += 1;
    }
    
    let out_name_str = out_name.to_str().ok_or("Invalid output name path")?.to_string();
    
    // Build arguments
    let mut args = vec![
        "-m".to_string(),
        root.join(&settings.model_path).to_string_lossy().to_string(),
        "-f".to_string(),
        wav_path.clone(),
        "-t".to_string(),
        settings.threads.to_string(),
        "-p".to_string(),
        settings.processors.to_string(),
        "-of".to_string(),
        out_name_str.clone(),
    ];
    
    if !settings.language.is_empty() && settings.language != "auto" {
        args.push("-l".to_string());
        args.push(settings.language.clone());
    }
    
    if !settings.prompt.is_empty() {
        args.push("--prompt".to_string());
        args.push(settings.prompt.clone());
    }
    
    if settings.output_txt { args.push("-otxt".to_string()); }
    if settings.output_vtt { args.push("-ovtt".to_string()); }
    if settings.output_srt { args.push("-osrt".to_string()); }
    if settings.output_lrc { args.push("-olrc".to_string()); }
    if settings.output_words {
        args.push("-owts".to_string());
        if !settings.font_path.is_empty() {
            args.push("-fp".to_string());
            args.push(settings.font_path.clone());
        }
    }
    if settings.output_csv { args.push("-ocsv".to_string()); }
    if settings.output_json { args.push("-oj".to_string()); }
    if settings.output_json_full { args.push("-ojf".to_string()); }
    
    if settings.offset_t > 0 { args.push("-ot".to_string()); args.push(settings.offset_t.to_string()); }
    if settings.offset_n > 0 { args.push("-on".to_string()); args.push(settings.offset_n.to_string()); }
    if settings.duration > 0 { args.push("-d".to_string()); args.push(settings.duration.to_string()); }
    if settings.max_context != -1 { args.push("-mc".to_string()); args.push(settings.max_context.to_string()); }
    if settings.max_len > 0 { args.push("-ml".to_string()); args.push(settings.max_len.to_string()); }
    if settings.split_word { args.push("-sow".to_string()); }
    if settings.best_of != 5 { args.push("-bo".to_string()); args.push(settings.best_of.to_string()); }
    if settings.beam_size != 5 { args.push("-bs".to_string()); args.push(settings.beam_size.to_string()); }
    if settings.audio_ctx > 0 { args.push("-ac".to_string()); args.push(settings.audio_ctx.to_string()); }
    
    if (settings.word_thold - 0.01).abs() > 0.001 { args.push("-wt".to_string()); args.push(format!("{:.2}", settings.word_thold)); }
    if (settings.entropy_thold - 2.40).abs() > 0.001 { args.push("-et".to_string()); args.push(format!("{:.2}", settings.entropy_thold)); }
    if (settings.logprob_thold - -1.00).abs() > 0.001 { args.push("-lpt".to_string()); args.push(format!("{:.2}", settings.logprob_thold)); }
    if (settings.no_speech_thold - 0.60).abs() > 0.001 { args.push("-nth".to_string()); args.push(format!("{:.2}", settings.no_speech_thold)); }
    if settings.temperature != 0.00 { args.push("-tp".to_string()); args.push(format!("{:.2}", settings.temperature)); }
    if (settings.temperature_inc - 0.20).abs() > 0.001 { args.push("-tpi".to_string()); args.push(format!("{:.2}", settings.temperature_inc)); }
    
    if settings.debug_mode { args.push("-debug".to_string()); }
    if settings.translate { args.push("-tr".to_string()); }
    if settings.diarize { args.push("-di".to_string()); }
    if settings.tiny_diarize { args.push("-tdrz".to_string()); }
    if settings.no_fallback { args.push("-nf".to_string()); }
    if !settings.flash_attn { args.push("-nfa".to_string()); }
    
    if settings.no_prints { args.push("-np".to_string()); }
    if settings.print_special { args.push("-ps".to_string()); }
    if settings.print_colors { args.push("-pc".to_string()); }
    if settings.print_confidence { args.push("--print-confidence".to_string()); }
    if settings.print_progress { args.push("-pp".to_string()); }
    if settings.no_timestamps { args.push("-nt".to_string()); }
    if settings.detect_language { args.push("-dl".to_string()); }
    if settings.carry_prompt { args.push("--carry-initial-prompt".to_string()); }
    if settings.log_score { args.push("-ls".to_string()); }
    if settings.no_gpu { args.push("-ng".to_string()); }
    if settings.device_id != 0 { args.push("-dev".to_string()); args.push(settings.device_id.to_string()); }
    
    if settings.selected_backend == "OpenVINO" && !settings.ov_device.is_empty() {
        args.push("--ov-e-device".to_string());
        args.push(settings.ov_device.clone());
    }
    
    if settings.vad {
        args.push("--vad".to_string());
        if !settings.vad_model.is_empty() {
            args.push("-vm".to_string());
            args.push(root.join(&settings.vad_model).to_string_lossy().to_string());
        }
        args.push("-vt".to_string()); args.push(format!("{:.2}", settings.vad_thold));
        args.push("-vspd".to_string()); args.push(settings.vad_min_speech.to_string());
        args.push("-vsd".to_string()); args.push(settings.vad_min_sil.to_string());
        args.push("-vmsd".to_string()); args.push(format!("{:.1}", settings.vad_max_speech));
        args.push("-vp".to_string()); args.push(settings.vad_speech_pad.to_string());
        args.push("-vo".to_string()); args.push(format!("{:.2}", settings.vad_overlap));
    }
    
    logs.log(&app, "Whisper", &format!("Spawning Whisper CLI: {} {}", bin_path.display(), args.join(" ")));
    app.emit("transcribe-status", TranscribeProgress {
        progress: 0.0,
        message: "Running Whisper AI model...".to_string(),
        active: true,
    }).unwrap();
    
    let mut child = Command::new(&bin_path)
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn Whisper process: {}", e))?;
        
    let pid = child.id();
    if let Ok(mut lock) = session.lock() {
        lock.child_pid = pid;
    }
    let _guard = ActiveSessionGuard { session: session.clone() };
        
    let stdout = child.stdout.take().ok_or("Failed to capture whisper stdout")?;
    let stderr = child.stderr.take().ok_or("Failed to capture whisper stderr")?;
    
    let mut stdout_reader = BufReader::new(stdout).lines();
    let mut stderr_reader = BufReader::new(stderr).lines();
    
    // Regex to match timestamps like: [00:01:23.000 --> 00:01:30.000]
    let timestamp_regex = Regex::new(r"\[(\d{2}):(\d{2}):(\d{2})\.(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})\.(\d{3})\]").unwrap();
    // Regex to match duration in Whisper startup logs: e.g. "samples, 50.0 sec)"
    let whisper_duration_regex = Regex::new(r"samples,\s*([\d.]+)\s*sec\)").unwrap();
    
    loop {
        tokio::select! {
            line = stdout_reader.next_line() => {
                match line {
                    Ok(Some(l)) => {
                        logs.log(&app, "Whisper", &l);
                        
                        // Parse timestamp to calculate progress
                        if let Some(caps) = timestamp_regex.captures(&l) {
                            if let (Some(h_str), Some(m_str), Some(s_str)) = (caps.get(5), caps.get(6), caps.get(7)) {
                                let h = h_str.as_str().parse::<f64>().unwrap_or(0.0);
                                let m = m_str.as_str().parse::<f64>().unwrap_or(0.0);
                                let s = s_str.as_str().parse::<f64>().unwrap_or(0.0);
                                
                                let curr_time_secs = h * 3600.0 + m * 60.0 + s;
                                if duration_sec > 0.0 {
                                    let progress = (curr_time_secs / duration_sec).min(1.0).max(0.0);
                                    let _ = app.emit("transcribe-status", TranscribeProgress {
                                        progress,
                                        message: format!("Transcribing: {:.0}%", progress * 100.0),
                                        active: true,
                                    });
                                }
                            }
                        }
                    }
                    Ok(None) => break,
                    Err(_) => {}
                }
            }
            line = stderr_reader.next_line() => {
                match line {
                    Ok(Some(l)) => {
                        logs.log(&app, "Whisper", &l);
                        if let Some(caps) = whisper_duration_regex.captures(&l) {
                            if let Some(sec_str) = caps.get(1) {
                                if let Ok(sec_val) = sec_str.as_str().parse::<f64>() {
                                    duration_sec = sec_val;
                                }
                            }
                        }
                    }
                    _ => {}
                }
            }
        }
    }
    
    let status = child.wait().await.map_err(|e| format!("Whisper CLI wait failed: {}", e))?;
    let _ = fs::remove_file(&wav_path); // Clean up converted WAV file
    
    if !status.success() {
        let _ = std::process::Command::new("notify-send")
            .args(["Transcription Failed or Cancelled", &format!("Whisper process terminated for {}!", file_name)])
            .spawn();
        return Err(format!("Whisper CLI failed or was cancelled. Exit code: {:?}", status.code()));
    }
    
    let elapsed = start_time.elapsed().as_millis() as u64;
    let speed_factor = if elapsed > 0 {
        (duration_sec * 1000.0) / elapsed as f64
    } else {
        0.0
    };
    
    // Probe output directory for written formats
    let mut generated_files = Vec::new();
    let out_basename = Path::new(&out_name_str).file_name().unwrap_or_default().to_string_lossy().to_string();
    let formats = [".txt", ".srt", ".vtt", ".lrc", ".csv", ".json"];
    for fmt in formats {
        let path = format!("{}{}", out_name_str, fmt);
        if Path::new(&path).exists() {
            generated_files.push(format!("{}{}", out_basename, fmt));
        }
    }
    
    // Post-process the Karaoke video output format .wts if generated
    let wts_path = format!("{}.wts", out_name_str);
    if Path::new(&wts_path).exists() {
        let wts_sh_path = format!("{}.wts.sh", out_name_str);
        if let Ok(data) = fs::read_to_string(&wts_path) {
            let updated_content = data.replace(&wav_path, &settings.input_file);
            if fs::write(&wts_sh_path, updated_content).is_ok() {
                let _ = fs::remove_file(&wts_path);
                generated_files.push(format!("{}.wts.sh", out_basename));
            } else {
                let _ = fs::rename(&wts_path, &wts_sh_path);
                generated_files.push(format!("{}.wts.sh", out_basename));
            }
        } else {
            let _ = fs::rename(&wts_path, &wts_sh_path);
            generated_files.push(format!("{}.wts.sh", out_basename));
        }
    }
    
    logs.log(&app, "Whisper", "Transcription completed successfully!");
    
    // Emitting OS notification
    let _ = std::process::Command::new("notify-send")
        .args(["Transcription Complete", &format!("Successfully processed {}!", file_name)])
        .spawn();
        
    app.emit("transcribe-status", TranscribeProgress {
        progress: 1.0,
        message: "Transcription successfully completed!".to_string(),
        active: false,
    }).unwrap();
    
    Ok(TranscriptionResult {
        duration_ms: elapsed,
        speed_factor,
        generated_files,
    })
}


pub fn read_text_file(file_path: String) -> Result<String, String> {
    let path = Path::new(&file_path);
    if !path.exists() {
        return Err("File does not exist".to_string());
    }
    fs::read_to_string(path)
        .map_err(|e| format!("Failed to read file: {}", e))
}

