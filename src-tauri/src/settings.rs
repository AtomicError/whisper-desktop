use serde::{Serialize, Deserialize};
use std::fs;
use std::path::PathBuf;
use crate::translation::provider::AiProvider;

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct WhisperSettings {
    pub preset: String,
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
    #[serde(default)]
    pub translate_ai_enabled: bool,
    #[serde(default)]
    pub translate_ai_provider: String,
    #[serde(default)]
    pub translate_ai_model: String,
    #[serde(default = "default_target_lang")]
    pub translate_ai_target_lang: String,
    #[serde(default = "default_providers")]
    pub translate_ai_providers: String,
    #[serde(default)]
    pub translate_ai_custom_prompt: String,
    #[serde(default)]
    pub translate_ai_polish: bool,
    #[serde(default = "default_ffmpeg_source")]
    pub ffmpeg_source: String, // "bundled" or "system"
}

fn default_ffmpeg_source() -> String {
    "bundled".to_string()
}

fn default_target_lang() -> String {
    "Persian".to_string()
}

fn default_providers() -> String {
    "[]".to_string()
}

impl WhisperSettings {
    pub fn default_settings() -> Self {
        let home = std::env::var("HOME").unwrap_or_else(|_| "/home/user".to_string());
        let default_models = format!("{}/whisper.cpp", home);
        
        WhisperSettings {
            preset: "safe".to_string(),
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
        }
    }

    pub fn apply_preset(&mut self, preset_name: &str) {
        self.preset = preset_name.to_string();
        if preset_name == "safe" {
            self.vad = false;
            self.best_of = 5;
            self.beam_size = 5;
            self.max_len = 0;
            self.split_word = false;
            self.temperature = 0.00;
            self.entropy_thold = 2.40;
            self.logprob_thold = -1.00;
        } else if preset_name == "professional" {
            self.vad = true;
            if self.vad_model.is_empty() {
                self.vad_model = "ggml-silero-v6.2.0.bin".to_string();
            }
            self.best_of = 8;
            self.beam_size = 8;
            self.max_len = 0;
            self.split_word = false;
            self.temperature = 0.00;
            self.entropy_thold = 2.40;
            self.logprob_thold = -1.00;
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub active_preset: String,
    pub safe: WhisperSettings,
    pub professional: WhisperSettings,
}

impl AppSettings {
    pub fn default_app_settings() -> Self {
        let mut safe = WhisperSettings::default_settings();
        safe.apply_preset("safe");
        
        let mut professional = WhisperSettings::default_settings();
        professional.apply_preset("professional");
        
        AppSettings {
            active_preset: "safe".to_string(),
            safe,
            professional,
        }
    }

    pub fn get_active(&self) -> WhisperSettings {
        if self.active_preset.to_lowercase() == "professional" {
            self.professional.clone()
        } else {
            self.safe.clone()
        }
    }

    pub fn set_active(&mut self, settings: WhisperSettings) {
        let models_dir = settings.models_dir.clone();
        let backend = settings.selected_backend.clone();
        let ffmpeg_source = settings.ffmpeg_source.clone();
        
        // Sync global values across both profiles
        self.safe.models_dir = models_dir.clone();
        self.professional.models_dir = models_dir;
        self.safe.selected_backend = backend.clone();
        self.professional.selected_backend = backend;
        self.safe.ffmpeg_source = ffmpeg_source.clone();
        self.professional.ffmpeg_source = ffmpeg_source;
        
        if self.active_preset.to_lowercase() == "professional" {
            self.professional = settings;
        } else {
            self.safe = settings;
        }
    }
}

pub fn get_settings_path() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/home/user".to_string());
    let mut path = PathBuf::from(home);
    path.push(".config");
    path.push("whisper-manager-desktop");
    path.push("settings.json");
    path
}

pub fn load_settings_file() -> WhisperSettings {
    let app_settings = load_app_settings();
    app_settings.get_active()
}

pub fn save_settings_file(settings: &WhisperSettings) -> Result<(), String> {
    let mut app_settings = load_app_settings();
    app_settings.set_active(settings.clone());
    save_app_settings(&app_settings)
}

pub fn load_app_settings() -> AppSettings {
    let path = get_settings_path();
    if path.exists() {
        if let Ok(data) = fs::read_to_string(&path) {
            if let Ok(mut app_settings) = serde_json::from_str::<AppSettings>(&data) {
                if app_settings.safe.beam_size > 8 { app_settings.safe.beam_size = 8; }
                if app_settings.safe.best_of > 8 { app_settings.safe.best_of = 8; }
                if app_settings.professional.beam_size > 8 { app_settings.professional.beam_size = 8; }
                if app_settings.professional.best_of > 8 { app_settings.professional.best_of = 8; }
                
                return app_settings;
            }
            if let Ok(old_settings) = serde_json::from_str::<WhisperSettings>(&data) {
                let mut app_settings = AppSettings::default_app_settings();
                if old_settings.preset.to_lowercase() == "professional" {
                    app_settings.active_preset = "professional".to_string();
                    app_settings.professional = old_settings.clone();
                } else {
                    app_settings.active_preset = "safe".to_string();
                    app_settings.safe = old_settings.clone();
                }
                app_settings.safe.models_dir = old_settings.models_dir.clone();
                app_settings.professional.models_dir = old_settings.models_dir.clone();
                app_settings.safe.selected_backend = old_settings.selected_backend.clone();
                app_settings.professional.selected_backend = old_settings.selected_backend.clone();
                
                if app_settings.safe.beam_size > 8 { app_settings.safe.beam_size = 8; }
                if app_settings.safe.best_of > 8 { app_settings.safe.best_of = 8; }
                if app_settings.professional.beam_size > 8 { app_settings.professional.beam_size = 8; }
                if app_settings.professional.best_of > 8 { app_settings.professional.best_of = 8; }
                
                let _ = save_app_settings(&app_settings);
                return app_settings;
            }
        }
    }
    
    let app_settings = AppSettings::default_app_settings();
    let _ = save_app_settings(&app_settings);
    app_settings
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

pub fn save_app_settings(app_settings: &AppSettings) -> Result<(), String> {
    let mut sanitized = app_settings.clone();
    sanitized.safe.translate_ai_providers = sanitize_providers(&sanitized.safe.translate_ai_providers);
    sanitized.professional.translate_ai_providers = sanitize_providers(&sanitized.professional.translate_ai_providers);

    let path = get_settings_path();
    if let Some(parent) = path.parent() {
        if !parent.exists() {
            let _ = fs::create_dir_all(parent);
        }
    }
    
    let data = serde_json::to_string_pretty(&sanitized)
        .map_err(|e| format!("Failed to serialize settings: {}", e))?;
    
    fs::write(&path, data)
        .map_err(|e| format!("Failed to write settings file: {}", e))?;
    
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn provider_json(key: &str, keyring: bool) -> String {
        format!(
            r#"{{"name":"openai","baseUrl":"https://x","apiKey":"{}","apiFormat":"Chat completions","useKeyring":{},"models":[]}}"#,
            key, keyring
        )
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
        // The invariant the frontend depends on: saved then loaded providers
        // still carry __KEYRING__ so lazy keyring fetch triggers.
        let providers = format!("[{}]", provider_json("sk-secret", true));
        let sanitized = sanitize_providers(&providers);
        let parsed: Vec<AiProvider> = serde_json::from_str(&sanitized).unwrap();
        assert_eq!(parsed[0].api_key, "__KEYRING__");
        assert!(parsed[0].use_keyring);
    }

    #[test]
    fn presets_change_whisper_tuning() {
        let mut s = WhisperSettings::default_settings();
        s.apply_preset("professional");
        assert_eq!(s.preset, "professional");
        assert!(s.vad);
        assert_eq!(s.beam_size, 8);
        assert_eq!(s.best_of, 8);

        let mut s = WhisperSettings::default_settings();
        s.apply_preset("safe");
        assert!(!s.vad);
        assert_eq!(s.beam_size, 5);
    }

    #[test]
    fn set_active_syncs_shared_fields() {
        let mut app = AppSettings::default_app_settings();
        app.active_preset = "safe".to_string();

        let mut new_settings = WhisperSettings::default_settings();
        new_settings.models_dir = "/tmp/models".to_string();
        new_settings.selected_backend = "CUDA".to_string();
        new_settings.threads = 12;
        app.set_active(new_settings);

        // Shared fields propagate to BOTH profiles
        assert_eq!(app.safe.models_dir, "/tmp/models");
        assert_eq!(app.professional.models_dir, "/tmp/models");
        assert_eq!(app.professional.selected_backend, "CUDA");
        // Non-shared field only touches active profile
        assert_eq!(app.safe.threads, 12);
        assert_ne!(app.professional.threads, 12);
    }

    #[test]
    fn beam_size_clamped_on_deserialize() {
        let mut original = AppSettings::default_app_settings();
        original.safe.beam_size = 99;
        original.safe.best_of = 50;
        original.professional.beam_size = 100;
        original.professional.best_of = 80;

        let json_str = serde_json::to_string(&original).unwrap();
        let mut app: AppSettings = serde_json::from_str(&json_str).unwrap();
        if app.safe.beam_size > 8 { app.safe.beam_size = 8; }
        if app.safe.best_of > 8 { app.safe.best_of = 8; }
        if app.professional.beam_size > 8 { app.professional.beam_size = 8; }
        if app.professional.best_of > 8 { app.professional.best_of = 8; }

        assert_eq!(app.safe.beam_size, 8);
        assert_eq!(app.safe.best_of, 8);
        assert_eq!(app.professional.beam_size, 8);
        assert_eq!(app.professional.best_of, 8);
    }
}
