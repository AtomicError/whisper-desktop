use serde::{Serialize, Deserialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock, RwLock};
use crate::translation::provider::AiProvider;

static SETTINGS_LOCK: RwLock<()> = RwLock::new(());
type LogSink = Arc<dyn Fn(&str) + Send + Sync>;
static LOG_SINK: OnceLock<LogSink> = OnceLock::new();

pub fn register_log_sink(sink: LogSink) {
    let _ = LOG_SINK.set(sink);
}

fn log_warn(message: &str) {
    match LOG_SINK.get() {
        Some(sink) => sink(message),
        None => eprintln!("[SETTINGS] {}", message),
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct WhisperSettings {
    pub selected_backend: String, // "Standard", "Vulkan", "OpenVINO", "CUDA"
    #[serde(rename = "modelsDir", alias = "cloneDir")]
    pub models_dir: String,
    pub threads: i32,
    pub processors: i32,
    pub offset_t: i32,
    pub offset_n: i32,
    pub duration: i32,
    pub max_context: i32,
    pub max_len: i32,
    pub split_word: bool,
    pub best_of: i32,
    pub beam_size: i32,
    pub audio_ctx: i32,
    pub word_thold: f64,
    pub entropy_thold: f64,
    pub logprob_thold: f64,
    pub no_speech_thold: f64,
    pub temperature: f64,
    pub temperature_inc: f64,
    pub debug_mode: bool,
    pub translate: bool,
    pub diarize: bool,
    pub tiny_diarize: bool,
    pub no_fallback: bool,
    pub flash_attn: bool,
    pub output_txt: bool,
    pub output_vtt: bool,
    pub output_srt: bool,
    pub output_lrc: bool,
    pub output_words: bool,
    pub font_path: String,
    pub output_csv: bool,
    pub output_json: bool,
    pub output_json_full: bool,
    pub no_prints: bool,
    pub print_special: bool,
    pub print_colors: bool,
    pub print_confidence: bool,
    pub print_progress: bool,
    pub no_timestamps: bool,
    pub language: String,
    pub detect_language: bool,
    pub prompt: String,
    pub carry_prompt: bool,
    pub model_path: String,
    pub input_file: String,
    pub ov_device: String,
    pub dtw_enabled: bool,
    pub log_score: bool,
    pub no_gpu: bool,
    pub device_id: i32,
    pub vad: bool,
    pub vad_model: String,
    pub vad_thold: f64,
    pub vad_min_speech: i32,
    pub vad_min_sil: i32,
    pub vad_max_speech: f64,
    pub vad_speech_pad: i32,
    pub vad_overlap: f64,
    pub translate_ai_enabled: bool,
    pub translate_ai_provider: String,
    pub translate_ai_model: String,
    pub translate_ai_target_lang: String,
    pub translate_ai_providers: String,
    pub translate_ai_custom_prompt: String,
    pub translate_ai_polish: bool,
    pub ffmpeg_source: String, // "bundled" or "system"
    #[serde(default = "default_output_dir_mode")]
    pub output_dir_mode: String, // "input_dir" or "custom"
    #[serde(default)]
    pub output_dir_path: String,
    #[serde(default = "default_ui_scale", deserialize_with = "deserialize_f64_lenient")]
    pub ui_scale: f64,
    #[serde(default = "default_theme")]
    pub theme: String,
    #[serde(default)]
    pub close_to_tray: bool,
}

fn deserialize_f64_lenient<'de, D>(deserializer: D) -> Result<f64, D::Error>
where
    D: serde::Deserializer<'de>,
{
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum FloatOrString {
        Float(f64),
        String(String),
    }

    match FloatOrString::deserialize(deserializer)? {
        FloatOrString::Float(f) => Ok(f),
        FloatOrString::String(s) => s.trim().parse::<f64>().map_err(serde::de::Error::custom),
    }
}

fn default_theme() -> String {
    "royal-blue".to_string()
}

fn default_ui_scale() -> f64 {
    1.0
}

fn default_output_dir_mode() -> String {
    "input_dir".to_string()
}

impl Default for WhisperSettings {
    fn default() -> Self {
        Self::default_settings()
    }
}

impl WhisperSettings {
    pub fn default_settings() -> Self {
        let home = get_user_home_dir();
        let default_models = home.join("whisper.cpp").to_string_lossy().to_string();

        WhisperSettings {
            selected_backend: "Standard".to_string(),
            models_dir: default_models,
            threads: 4,
            processors: 1,
            offset_t: 0,
            offset_n: 0,
            duration: 0,
            max_context: -1,
            max_len: 0,
            split_word: false,
            best_of: 5,
            beam_size: 5,
            audio_ctx: 0,
            word_thold: 0.01,
            entropy_thold: 2.40,
            logprob_thold: -1.00,
            no_speech_thold: 0.60,
            temperature: 0.00,
            temperature_inc: 0.20,
            debug_mode: false,
            translate: false,
            diarize: false,
            tiny_diarize: false,
            no_fallback: false,
            flash_attn: true,
            output_txt: false,
            output_vtt: false,
            output_srt: true,
            output_lrc: false,
            output_words: false,
            font_path: "".to_string(),
            output_csv: false,
            output_json: false,
            output_json_full: false,
            no_prints: false,
            print_special: false,
            print_colors: false,
            print_confidence: false,
            print_progress: false,
            no_timestamps: false,
            language: "auto".to_string(),
            detect_language: false,
            prompt: "".to_string(),
            carry_prompt: false,
            model_path: "ggml-base.en.bin".to_string(),
            input_file: "".to_string(),
            ov_device: "CPU".to_string(),
            dtw_enabled: false,
            log_score: false,
            no_gpu: false,
            device_id: 0,
            vad: false,
            vad_model: "ggml-silero-v6.2.0.bin".to_string(),
            vad_thold: 0.50,
            vad_min_speech: 250,
            vad_min_sil: 100,
            vad_max_speech: 30000.0,
            vad_speech_pad: 30,
            vad_overlap: 0.10,
            translate_ai_enabled: false,
            translate_ai_provider: "".to_string(),
            translate_ai_model: "".to_string(),
            translate_ai_target_lang: "Persian".to_string(),
            translate_ai_providers: "[]".to_string(),
            translate_ai_custom_prompt: "".to_string(),
            translate_ai_polish: false,
            ffmpeg_source: "bundled".to_string(),
            output_dir_mode: "input_dir".to_string(),
            output_dir_path: "".to_string(),
            ui_scale: 1.0,
            theme: "royal-blue".to_string(),
            close_to_tray: false,
        }
    }

    /// Symmetric validation and sanitization executed on BOTH load and save
    pub fn sanitize_and_validate(&mut self) {
        self.theme = match self.theme.as_str() {
            "fire-orange" | "fire" => "fire-orange".to_string(),
            "cyber-blue" | "royal-blue" => "royal-blue".to_string(),
            _ => "royal-blue".to_string(),
        };

        if self.ui_scale <= 0.0 || self.ui_scale.is_nan() {
            self.ui_scale = 1.0;
        }
        self.ui_scale = (self.ui_scale * 100.0).round() / 100.0;
        self.ui_scale = self.ui_scale.clamp(0.70, 1.60);

        self.threads = self.threads.max(1);
        self.processors = self.processors.max(1);

        self.beam_size = self.beam_size.clamp(1, 8);
        self.best_of = self.best_of.clamp(1, 8);

        self.offset_t = self.offset_t.max(0);
        self.offset_n = self.offset_n.max(0);
        self.duration = self.duration.max(0);
        self.max_len = self.max_len.max(0);
        self.audio_ctx = self.audio_ctx.max(0);
        self.device_id = self.device_id.max(0);

        self.vad_thold = self.vad_thold.clamp(0.0, 1.0);
        if self.vad_min_speech < 0 {
            self.vad_min_speech = 250;
        }
        if self.vad_min_sil < 0 {
            self.vad_min_sil = 100;
        }
        if self.vad_max_speech < 0.0 {
            self.vad_max_speech = 30000.0;
        }
        if self.vad_speech_pad < 0 {
            self.vad_speech_pad = 30;
        }
        self.vad_overlap = self.vad_overlap.clamp(0.0, 1.0);

        self.temperature = self.temperature.clamp(0.0, 2.0);
        self.temperature_inc = self.temperature_inc.clamp(0.0, 2.0);

        self.word_thold = self.word_thold.clamp(0.0, 1.0);
        self.no_speech_thold = self.no_speech_thold.clamp(0.0, 1.0);
        self.entropy_thold = self.entropy_thold.max(0.0);
        self.logprob_thold = self.logprob_thold.min(0.0);

        // Backend fallback
        if self.selected_backend.trim().is_empty() {
            self.selected_backend = "Standard".to_string();
        }

        // Models dir fallback
        if self.models_dir.trim().is_empty() {
            let home = get_user_home_dir();
            self.models_dir = home.join("whisper.cpp").to_string_lossy().to_string();
        }

        // FFmpeg source fallback
        if self.ffmpeg_source != "bundled" && self.ffmpeg_source != "system" {
            self.ffmpeg_source = "bundled".to_string();
        }
    }
}

#[derive(Deserialize, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
struct LegacyAppSettings {
    active_preset: Option<String>,
    safe: Option<WhisperSettings>,
    professional: Option<WhisperSettings>,
}

/// Resolve the current user's home directory cross-platform
pub fn get_user_home_dir() -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        if let Ok(profile) = std::env::var("USERPROFILE") {
            if !profile.trim().is_empty() {
                return PathBuf::from(profile);
            }
        }
        if let (Ok(drive), Ok(path)) = (std::env::var("HOMEDRIVE"), std::env::var("HOMEPATH")) {
            let combined = format!("{}{}", drive, path);
            if !combined.trim().is_empty() {
                return PathBuf::from(combined);
            }
        }
    }

    if let Ok(home) = std::env::var("HOME") {
        if !home.trim().is_empty() {
            return PathBuf::from(home);
        }
    }

    #[cfg(target_os = "windows")]
    {
        PathBuf::from("C:\\")
    }
    #[cfg(not(target_os = "windows"))]
    {
        PathBuf::from("/home/user")
    }
}

pub fn get_settings_path() -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        if let Ok(app_data) = std::env::var("APPDATA") {
            if !app_data.trim().is_empty() {
                let mut path = PathBuf::from(app_data);
                path.push("whisper-desktop");
                path.push("settings.json");
                return path;
            }
        }
        let mut path = get_user_home_dir();
        path.push("AppData");
        path.push("Roaming");
        path.push("whisper-desktop");
        path.push("settings.json");
        return path;
    }

    #[cfg(target_os = "macos")]
    {
        let mut path = get_user_home_dir();
        path.push("Library");
        path.push("Application Support");
        path.push("whisper-desktop");
        path.push("settings.json");
        return path;
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        if let Ok(xdg_config) = std::env::var("XDG_CONFIG_HOME") {
            if !xdg_config.trim().is_empty() {
                let mut path = PathBuf::from(xdg_config);
                path.push("whisper-desktop");
                path.push("settings.json");
                return path;
            }
        }
        let mut path = get_user_home_dir();
        path.push(".config");
        path.push("whisper-desktop");
        path.push("settings.json");
        path
    }
}

pub fn load_settings_from_path(path: &Path) -> WhisperSettings {
    let _guard = SETTINGS_LOCK.read().unwrap_or_else(|e| e.into_inner());

    if path.exists() {
        if let Ok(data) = fs::read_to_string(path) {
            // 1. Check for legacy format { activePreset, safe, professional }
            if let Ok(legacy) = serde_json::from_str::<LegacyAppSettings>(&data) {
                if legacy.safe.is_some() || legacy.professional.is_some() {
                    let is_pro = legacy
                        .active_preset
                        .as_deref()
                        .unwrap_or("safe")
                        .to_lowercase()
                        == "professional";
                    let mut settings = if is_pro {
                        legacy.professional.or(legacy.safe).unwrap_or_default()
                    } else {
                        legacy.safe.or(legacy.professional).unwrap_or_default()
                    };

                    settings.sanitize_and_validate();

                    // Release read lock before persisting migrated flat file
                    drop(_guard);
                    if let Err(e) = save_settings_to_path(path, &settings) {
                        log_warn(&format!(
                            "Failed to persist migrated settings to {}: {}",
                            path.display(),
                            e
                        ));
                    }
                    return settings;
                }
            }

            // 2. Direct flat WhisperSettings format (with struct-level #[serde(default)] for missing fields)
            if let Ok(mut settings) = serde_json::from_str::<WhisperSettings>(&data) {
                settings.sanitize_and_validate();
                return settings;
            } else {
                log_warn(&format!(
                    "Could not parse settings from {}. Using defaults for this session; the existing file was NOT overwritten.",
                    path.display()
                ));
            }
        }
    }

    let mut default = WhisperSettings::default_settings();
    default.sanitize_and_validate();

    // Only persist defaults when no settings file exists at all. If a file
    // exists but failed to parse, leave it on disk so the user (or a future
    // migration) can recover it instead of destroying their configuration.
    if !path.exists() {
        drop(_guard);
        if let Err(e) = save_settings_to_path(path, &default) {
            log_warn(&format!(
                "Failed to persist default settings to {}: {}",
                path.display(),
                e
            ));
        }
    }
    default
}

pub fn atomic_replace_file(from: &Path, to: &Path) -> std::io::Result<()> {
    #[cfg(not(windows))]
    {
        fs::rename(from, to)
    }
    #[cfg(windows)]
    {
        if fs::rename(from, to).is_ok() {
            return Ok(());
        }
        let backup_path = to.with_extension(format!("bak.{}", std::process::id()));
        let _ = fs::remove_file(&backup_path);

        let mut backoff = std::time::Duration::from_millis(15);
        for _ in 0..5 {
            if fs::rename(to, &backup_path).is_ok() {
                let move_res = fs::rename(from, to);
                if move_res.is_err() {
                    let _ = fs::rename(&backup_path, to);
                    return move_res;
                }
                let _ = fs::remove_file(&backup_path);
                return Ok(());
            }
            std::thread::sleep(backoff);
            backoff *= 2;
        }
        // Fallback if renaming is blocked by AV / file locks
        fs::copy(from, to)?;
        let _ = fs::remove_file(from);
        Ok(())
    }
}

pub fn save_settings_to_path(path: &Path, settings: &WhisperSettings) -> Result<(), String> {
    let _guard = SETTINGS_LOCK.write().unwrap_or_else(|e| e.into_inner());

    let mut sanitized = settings.clone();
    sanitized.sanitize_and_validate();
    sanitized.translate_ai_providers = sanitize_providers(&sanitized.translate_ai_providers);

    if let Some(parent) = path.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent).map_err(|e| {
                format!(
                    "Failed to create settings directory {}: {}",
                    parent.display(),
                    e
                )
            })?;
        }
    }

    let data = serde_json::to_string_pretty(&sanitized)
        .map_err(|e| format!("Failed to serialize settings: {}", e))?;

    // Atomic write: stage into a sibling .tmp file then rename over the target,
    // so a crash mid-write can never leave a truncated settings file behind.
    let tmp_path = path.with_file_name({
        let mut name = path.file_name().unwrap_or_default().to_os_string();
        name.push(format!(".tmp.{}", std::process::id()));
        name
    });

    fs::write(&tmp_path, data).map_err(|e| {
        format!(
            "Failed to write settings temp file {}: {}",
            tmp_path.display(),
            e
        )
    })?;

    match atomic_replace_file(&tmp_path, path) {
        Ok(()) => Ok(()),
        Err(e) => {
            let _ = fs::remove_file(&tmp_path);
            Err(format!(
                "Failed to write settings file {}: {}",
                path.display(),
                e
            ))
        }
    }
}

pub fn load_settings_file() -> WhisperSettings {
    load_settings_from_path(&get_settings_path())
}

/// Serializes every settings WRITE in this process. Two independent writers
/// exist: the frontend `save_settings` command and the translation module's
/// reactive limit-persistence. Without mutual exclusion their
/// load-modify-save cycles interleave and silently drop the other side's
/// update (e.g. a freshly learned model context window).
static SETTINGS_WRITE_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

pub(crate) fn with_settings_write_lock<T>(f: impl FnOnce() -> T) -> T {
    let guard = SETTINGS_WRITE_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let out = f();
    drop(guard);
    out
}

pub fn save_settings_file(settings: &WhisperSettings) -> Result<(), String> {
    with_settings_write_lock(|| save_settings_to_path(&get_settings_path(), settings))
}

/// Load-modify-save under one lock, for callers that must not lose
/// concurrent frontend writes between reading and writing.
/// Only persists to disk if the `mutate` closure returns `Ok(_)`.
pub(crate) fn update_settings_locked<T, E>(
    mutate: impl FnOnce(&mut WhisperSettings) -> Result<T, E>,
) -> Result<T, String>
where
    E: std::fmt::Display,
{
    with_settings_write_lock(|| {
        let mut settings = load_settings_from_path(&get_settings_path());
        let out = mutate(&mut settings).map_err(|e| e.to_string())?;
        save_settings_to_path(&get_settings_path(), &settings)?;
        Ok(out)
    })
}

/// Strip api_key from providers that use keyring before persisting to disk
fn sanitize_providers(providers_json: &str) -> String {
    if let Ok(mut providers) = serde_json::from_str::<Vec<AiProvider>>(providers_json) {
        for p in &mut providers {
            if p.use_keyring {
                p.api_key = "__KEYRING__".to_string();
            }
        }
        serde_json::to_string(&providers).unwrap_or_else(|_| providers_json.to_string())
    } else if let Ok(mut val) = serde_json::from_str::<serde_json::Value>(providers_json) {
        if let Some(arr) = val.as_array_mut() {
            for item in arr {
                if let Some(obj) = item.as_object_mut() {
                    let uses_keyring = obj
                        .get("useKeyring")
                        .or_else(|| obj.get("use_keyring"))
                        .and_then(|v| v.as_bool())
                        .unwrap_or(false);
                    if uses_keyring {
                        obj.insert("apiKey".to_string(), serde_json::Value::String("__KEYRING__".to_string()));
                    }
                }
            }
            serde_json::to_string(&val).unwrap_or_else(|_| providers_json.to_string())
        } else {
            providers_json.to_string()
        }
    } else {
        providers_json.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn provider_json(key: &str, keyring: bool) -> String {
        format!(
            r#"{{"name":"openai","baseUrl":"https://x","apiKey":"{}","apiFormat":"Chat completions","useKeyring":{},"models":[]}}"#,
            key, keyring
        )
    }

    fn temp_test_file(prefix: &str) -> PathBuf {
        let ts = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let mut p = std::env::temp_dir();
        p.push(format!("whisper_test_{}_{}.json", prefix, ts));
        p
    }

    #[test]
    fn sanitize_replaces_keyring_api_key_with_marker() {
        let providers = format!("[{}]", provider_json("sk-secret123", true));
        let out = sanitize_providers(&providers);
        assert!(out.contains("__KEYRING__"));
        assert!(!out.contains("sk-secret123"));
    }

    #[test]
    fn sanitize_keeps_plain_api_key() {
        let providers = format!("[{}]", provider_json("sk-visible", false));
        let out = sanitize_providers(&providers);
        assert!(out.contains("sk-visible"));
    }

    #[test]
    fn sanitize_preserves_custom_json_fields_and_masks_key() {
        let custom_json = r#"[{"name":"custom","baseUrl":"https://custom","apiKey":"secret_raw","useKeyring":true,"extraField":123}]"#;
        let out = sanitize_providers(custom_json);
        assert!(out.contains("__KEYRING__"));
        assert!(!out.contains("secret_raw"));
        assert!(out.contains("extraField"));
    }

    #[test]
    fn keyring_marker_survives_roundtrip() {
        let providers = format!("[{}]", provider_json("sk-secret", true));
        let sanitized = sanitize_providers(&providers);
        let parsed: Vec<AiProvider> = serde_json::from_str(&sanitized).unwrap();
        assert_eq!(parsed[0].api_key, "__KEYRING__");
        assert!(parsed[0].use_keyring);
    }

    #[test]
    fn missing_fields_automatically_filled_with_defaults_without_data_loss() {
        let temp_path = temp_test_file("missing_fields");
        // Simulated old version config containing only 3 fields
        let minimal_old_json = r#"{
            "modelsDir": "/custom/my-models-dir",
            "threads": 12,
            "selectedBackend": "CUDA"
        }"#;
        fs::write(&temp_path, minimal_old_json).unwrap();

        let loaded = load_settings_from_path(&temp_path);
        assert_eq!(loaded.models_dir, "/custom/my-models-dir");
        assert_eq!(loaded.threads, 12);
        assert_eq!(loaded.selected_backend, "CUDA");
        // All unprovided fields must have default safe values without failing
        assert_eq!(loaded.beam_size, 5);
        assert_eq!(loaded.best_of, 5);
        assert!(!loaded.vad);
        assert_eq!(loaded.vad_overlap, 0.10);
        assert!(loaded.flash_attn);

        let _ = fs::remove_file(&temp_path);
    }

    #[test]
    fn legacy_nested_format_auto_migrates_active_profile_and_persists_flat() {
        let temp_path = temp_test_file("legacy_migration");
        let legacy_json = r#"{
            "activePreset": "professional",
            "safe": {
                "threads": 2,
                "beamSize": 4
            },
            "professional": {
                "modelsDir": "/custom/pro-models",
                "threads": 8,
                "vad": true,
                "beamSize": 8
            }
        }"#;
        fs::write(&temp_path, legacy_json).unwrap();

        let loaded = load_settings_from_path(&temp_path);
        assert_eq!(loaded.models_dir, "/custom/pro-models");
        assert_eq!(loaded.threads, 8);
        assert!(loaded.vad);
        assert_eq!(loaded.beam_size, 8);

        // Verify the file was converted to a clean flat structure on disk
        let persisted_text = fs::read_to_string(&temp_path).unwrap();
        assert!(!persisted_text.contains("\"activePreset\""));
        assert!(!persisted_text.contains("\"safe\":"));
        assert!(!persisted_text.contains("\"professional\":"));

        let _ = fs::remove_file(&temp_path);
    }

    #[test]
    fn symmetric_clamping_and_sanitization_on_save_and_load() {
        let temp_path = temp_test_file("bounds");
        let mut s = WhisperSettings::default_settings();
        s.threads = -10;
        s.beam_size = 999;
        s.best_of = -5;
        s.vad_thold = -2.5;
        s.vad_overlap = 5.0;
        s.temperature = -1.0;
        s.temperature_inc = 42.0;
        s.word_thold = 7.5;
        s.no_speech_thold = -3.0;
        s.entropy_thold = -9.9;
        s.logprob_thold = 4.2;
        s.offset_t = -100;
        s.device_id = -1;
        s.ffmpeg_source = "hack".to_string();

        save_settings_to_path(&temp_path, &s).unwrap();

        let loaded = load_settings_from_path(&temp_path);
        assert_eq!(loaded.threads, 1);
        assert_eq!(loaded.beam_size, 8);
        assert_eq!(loaded.best_of, 1);
        assert_eq!(loaded.vad_thold, 0.0);
        assert_eq!(loaded.vad_overlap, 1.0);
        assert_eq!(loaded.temperature, 0.0);
        assert_eq!(loaded.temperature_inc, 2.0);
        assert_eq!(loaded.word_thold, 1.0);
        assert_eq!(loaded.no_speech_thold, 0.0);
        assert_eq!(loaded.entropy_thold, 0.0);
        assert_eq!(loaded.logprob_thold, 0.0);
        assert_eq!(loaded.offset_t, 0);
        assert_eq!(loaded.device_id, 0);
        assert_eq!(loaded.ffmpeg_source, "bundled");

        let _ = fs::remove_file(&temp_path);
    }

    #[test]
    fn failed_save_leaves_no_tmp_file_and_preserves_target() {
        let temp_path = temp_test_file("atomic");
        save_settings_to_path(&temp_path, &WhisperSettings::default_settings()).unwrap();
        assert!(temp_path.exists());

        // Make the final rename impossible: target is now a directory.
        fs::remove_file(&temp_path).unwrap();
        fs::create_dir(&temp_path).unwrap();

        let result = save_settings_to_path(&temp_path, &WhisperSettings::default_settings());
        assert!(result.is_err());

        let tmp_path = temp_path.with_file_name({
            let mut name = temp_path.file_name().unwrap().to_os_string();
            name.push(".tmp");
            name
        });
        assert!(
            !tmp_path.exists(),
            "stale .tmp file left behind after failed rename"
        );
        assert!(temp_path.is_dir(), "existing target was clobbered");

        fs::remove_dir(&temp_path).unwrap();
    }

    #[test]
    fn log_warn_does_not_panic_without_registered_sink() {
        log_warn("sink-less warning smoke test");
    }

    #[test]
    fn corrupt_json_gracefully_falls_back_to_defaults() {
        let temp_path = temp_test_file("corrupt");
        fs::write(&temp_path, "{ broken_json: ").unwrap();

        let loaded = load_settings_from_path(&temp_path);
        assert_eq!(loaded.selected_backend, "Standard");
        assert_eq!(loaded.threads, 4);
        assert_eq!(loaded.beam_size, 5);

        let _ = fs::remove_file(&temp_path);
    }

    #[test]
    fn update_settings_locked_aborts_write_on_err() {
        let result = update_settings_locked(|_settings| {
            Err::<(), &str>("simulated error during mutation")
        });
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("simulated error"));
    }

    #[test]
    fn settings_path_ends_with_whisper_desktop_settings_json() {
        let path = get_settings_path();
        let path_str = path.to_string_lossy();
        assert!(path_str.ends_with("settings.json"));
        assert!(path_str.contains("whisper-desktop"));
        assert!(!path_str.contains("whisper-manager-desktop"));

        let home = get_user_home_dir();
        assert!(!home.as_os_str().is_empty());
    }

    #[test]
    fn test_ui_scale_sanitization_and_persistence() {
        let mut settings = WhisperSettings::default_settings();
        assert_eq!(settings.ui_scale, 1.0);

        // Test low boundary clamping
        settings.ui_scale = 0.2;
        settings.sanitize_and_validate();
        assert_eq!(settings.ui_scale, 0.70);

        // Test high boundary clamping
        settings.ui_scale = 2.5;
        settings.sanitize_and_validate();
        assert_eq!(settings.ui_scale, 1.60);

        // Test NaN / negative fallback
        settings.ui_scale = f64::NAN;
        settings.sanitize_and_validate();
        assert_eq!(settings.ui_scale, 1.0);

        // Test persistence roundtrip
        let temp_path = temp_test_file("ui_scale_test");
        settings.ui_scale = 1.15;
        save_settings_to_path(&temp_path, &settings).unwrap();

        let loaded = load_settings_from_path(&temp_path);
        assert!((loaded.ui_scale - 1.15).abs() < 1e-6);

        let _ = fs::remove_file(&temp_path);

        // Test lenient deserialization from string format (e.g. "1.25")
        let json_str = r#"{"uiScale": "1.25"}"#;
        let parsed: WhisperSettings = serde_json::from_str(json_str).unwrap();
        assert_eq!(parsed.ui_scale, 1.25);
    }

    #[test]
    fn test_theme_sanitization_and_persistence() {
        let mut settings = WhisperSettings::default_settings();
        assert_eq!(settings.theme, "royal-blue");

        // Invalid theme value fallback
        settings.theme = "invalid-neon-theme".to_string();
        settings.sanitize_and_validate();
        assert_eq!(settings.theme, "royal-blue");

        // Legacy cyber-blue theme migration
        settings.theme = "cyber-blue".to_string();
        settings.sanitize_and_validate();
        assert_eq!(settings.theme, "royal-blue");

        // Valid fire-orange theme
        settings.theme = "fire-orange".to_string();
        settings.sanitize_and_validate();
        assert_eq!(settings.theme, "fire-orange");

        // Legacy fire theme migration
        settings.theme = "fire".to_string();
        settings.sanitize_and_validate();
        assert_eq!(settings.theme, "fire-orange");

        // Test persistence roundtrip
        let temp_path = temp_test_file("theme_test");
        save_settings_to_path(&temp_path, &settings).unwrap();

        let loaded = load_settings_from_path(&temp_path);
        assert_eq!(loaded.theme, "fire-orange");

        let _ = fs::remove_file(&temp_path);
    }
}
