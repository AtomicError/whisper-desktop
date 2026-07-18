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
            model_path: "models/ggml-base.en.bin".to_string(),
            input_file: "".to_string(),
            ov_device: "CPU".to_string(),
            dtw_enabled: false,
            log_score: false,
            no_gpu: false,
            device_id: 0,
            vad: false,
            vad_model: "".to_string(),
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
        
        // Sync global values across both profiles
        self.safe.models_dir = models_dir.clone();
        self.professional.models_dir = models_dir;
        self.safe.selected_backend = backend.clone();
        self.professional.selected_backend = backend;
        
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
