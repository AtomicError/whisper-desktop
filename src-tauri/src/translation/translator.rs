use std::collections::HashMap;
use std::fs;
use std::path::Path;
use serde_json::Value;
use crate::settings::WhisperSettings;
use crate::translation::provider::{AiProvider, get_keyring_key};
use crate::translation::formatter::ParsedSubtitle;
use crate::translation::chunker::chunk_dialogues;
use crate::translation::prompts::build_system_prompt;

/// Maps common target languages to their standard ISO 2-letter codes.
/// Falls back to the lowercase language name if not found.
pub fn get_language_code(lang: &str) -> String {
    match lang.to_lowercase().as_str() {
        "persian" | "farsi" => "fa".to_string(),
        "spanish" => "es".to_string(),
        "french" => "fr".to_string(),
        "german" => "de".to_string(),
        "italian" => "it".to_string(),
        "russian" => "ru".to_string(),
        "chinese" => "zh".to_string(),
        "arabic" => "ar".to_string(),
        "turkish" => "tr".to_string(),
        "portuguese" => "pt".to_string(),
        "japanese" => "ja".to_string(),
        "korean" => "ko".to_string(),
        "english" => "en".to_string(),
        _ => lang.to_lowercase().replace(' ', "_"),
    }
}

/// Parses the response JSON based on format schema
fn parse_response_content(api_format: &str, response_val: &Value) -> Result<String, String> {
    match api_format {
        "Anthropic messages" => {
            response_val["content"][0]["text"]
                .as_str()
                .map(|s| s.to_string())
                .ok_or_else(|| format!("Invalid Anthropic response format: {:?}", response_val))
        }
        "Responses" => {
            // Gemini
            response_val["candidates"][0]["content"]["parts"][0]["text"]
                .as_str()
                .map(|s| s.to_string())
                .ok_or_else(|| format!("Invalid Gemini response format: {:?}", response_val))
        }
        _ => {
            // OpenAI compatible
            response_val["choices"][0]["message"]["content"]
                .as_str()
                .map(|s| s.to_string())
                .ok_or_else(|| format!("Invalid OpenAI response format: {:?}", response_val))
        }
    }
}

/// Parses numbered lines from response (e.g. "1: Translated text")
fn parse_translated_lines(response_text: &str) -> HashMap<usize, String> {
    let mut map = HashMap::new();
    let re = regex::Regex::new(r"^(\d+)[\s:：.-]+(.*)$").unwrap();
    let mut current_idx = None;
    
    for line in response_text.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            current_idx = None;
            continue;
        }
        if trimmed.starts_with("```") {
            continue;
        }
        if let Some(caps) = re.captures(trimmed) {
            if let (Some(num_cap), Some(val_cap)) = (caps.get(1), caps.get(2)) {
                if let Ok(idx) = num_cap.as_str().parse::<usize>() {
                    map.insert(idx, val_cap.as_str().trim().to_string());
                    current_idx = Some(idx);
                }
            }
        } else if let Some(idx) = current_idx {
            if let Some(existing) = map.get_mut(&idx) {
                existing.push('\n');
                existing.push_str(trimmed);
            }
        }
    }
    
    map
}

/// Aligns translation lines, with 1-to-1 fallback if no numbers are parsed
fn align_translations(
    original_entries: &[(usize, String)],
    response_text: &str,
) -> HashMap<usize, String> {
    let mut map = parse_translated_lines(response_text);
    
    if map.is_empty() {
        // 1-to-1 line fallback
        let response_lines: Vec<&str> = response_text
            .lines()
            .map(|l| l.trim())
            .filter(|l| !l.is_empty() && !l.starts_with("```"))
            .collect();
            
        if response_lines.len() == original_entries.len() {
            for (i, entry) in original_entries.iter().enumerate() {
                map.insert(entry.0, response_lines[i].to_string());
            }
        }
    }
    
    // Fill missing entries with original text
    for entry in original_entries {
        if !map.contains_key(&entry.0) {
            map.insert(entry.0, entry.1.clone());
        }
    }
    
    map
}

/// Core function to execute translation on a file list.
pub async fn translate_files(
    settings: WhisperSettings,
    generated_files: Vec<String>,
    parent_dir: String,
) -> Result<Vec<String>, String> {
    if !settings.translate_ai_enabled {
        return Ok(Vec::new());
    }

    // Deserialize providers list to find the active one
    let providers_list: Vec<AiProvider> = serde_json::from_str(&settings.translate_ai_providers)
        .map_err(|e| format!("Failed to parse translation providers: {}", e))?;
        
    let provider = providers_list
        .iter()
        .find(|p| p.name == settings.translate_ai_provider)
        .ok_or_else(|| format!("Active provider '{}' not found in config.", settings.translate_ai_provider))?;
        
    // Fetch API Key (Keyring or plaintext)
    let api_key = if provider.use_keyring {
        get_keyring_key(&provider.name)
            .map_err(|e| format!("Could not retrieve key from system keyring: {}", e))?
    } else {
        provider.api_key.clone()
    };
    
    if settings.translate_ai_model.trim().is_empty() {
        return Err("No active translation model is selected. Please configure and select a model under your active provider first.".to_string());
    }

    // Check if model exists and get its context window limit
    let active_model = provider.models
        .iter()
        .find(|m| m.id == settings.translate_ai_model);
        
    let context_window = active_model
        .map(|m| m.context_window)
        .unwrap_or(200000); // 200,000 default safe context limit

    let lang_code = get_language_code(&settings.translate_ai_target_lang);
    let mut successfully_translated = Vec::new();
    
    let client = reqwest::Client::new();

    for file_name in generated_files {
        let input_path = Path::new(&parent_dir).join(&file_name);
        if !input_path.exists() {
            continue;
        }

        let ext = match input_path.extension().and_then(|s| s.to_str()) {
            Some(e) => e.to_lowercase(),
            None => continue,
        };

        if ext != "srt" && ext != "vtt" && ext != "lrc" && ext != "txt" {
            // Unsupported format
            continue;
        }

        // Output file path: e.g. "movie.fa.srt"
        let base_stem = input_path.file_stem().unwrap_or_default().to_string_lossy();
        let output_file_name = format!("{}.{}.{}", base_stem, lang_code, ext);
        let output_path = Path::new(&parent_dir).join(&output_file_name);

        let content = fs::read_to_string(&input_path)
            .map_err(|e| format!("Failed to read source file '{}': {}", file_name, e))?;

        let parsed = ParsedSubtitle::parse(&content, &ext);
        
        // Extract dialogue entries (1-based index, text)
        let original_entries: Vec<(usize, String)> = parsed.cues
            .iter()
            .map(|c| (c.index, c.text.clone()))
            .collect();

        if original_entries.is_empty() {
            // Empty dialogues, just clone the file
            let _ = fs::write(&output_path, &content);
            successfully_translated.push(output_file_name);
            continue;
        }

        let mut translations_map = HashMap::new();
        let mut remaining_entries = original_entries.clone();
        let mut context_window = context_window;

        while !remaining_entries.is_empty() {
            let mut chunks = chunk_dialogues(&remaining_entries, context_window);
            if chunks.is_empty() {
                break;
            }
            
            let chunk = chunks.remove(0);

            let system_prompt = build_system_prompt(
                &provider.custom_prompt,
                &settings.translate_ai_target_lang,
                settings.translate_ai_polish,
            );

            // Format dialogue lines as "index: text"
            let user_content = chunk
                .iter()
                .map(|(idx, text)| format!("{}: {}", idx, text))
                .collect::<Vec<String>>()
                .join("\n");

            let request_body = provider.format_request_body(
                &settings.translate_ai_model,
                &system_prompt,
                &user_content,
            );

            // Format request URL
            let mut request_url = provider.base_url.clone();
            match provider.api_format.as_str() {
                "Anthropic messages" => {
                    if !request_url.contains("/messages") {
                        let clean_base = request_url.trim_end_matches('/');
                        if clean_base.ends_with("/v1") {
                            request_url = format!("{}/messages", clean_base);
                        } else {
                            request_url = format!("{}/v1/messages", clean_base);
                        }
                    }
                }
                "Responses" => {
                    if !request_url.contains("/models/") {
                        let clean_base = request_url.trim_end_matches('/');
                        if clean_base.ends_with("/v1beta") {
                            request_url = format!("{}/models/{}:generateContent", clean_base, settings.translate_ai_model);
                        } else {
                            request_url = format!("{}/v1beta/models/{}:generateContent", clean_base, settings.translate_ai_model);
                        }
                    }
                    if !api_key.is_empty() {
                        request_url = format!("{}?key={}", request_url, api_key);
                    }
                }
                _ => {
                    if !request_url.contains("/chat/completions") {
                        let clean_base = request_url.trim_end_matches('/');
                        request_url = format!("{}/chat/completions", clean_base);
                    }
                }
            }

            let mut req = client.post(&request_url).json(&request_body);
            
            // Set Headers
            if provider.api_format == "Anthropic messages" {
                if !api_key.is_empty() {
                    req = req.header("x-api-key", &api_key);
                }
                req = req.header("anthropic-version", "2023-06-01");
            } else if provider.api_format == "Responses" {
                // Gemini key is in url
            } else {
                // OpenAI compatible
                if !api_key.is_empty() {
                    req = req.bearer_auth(&api_key);
                }
            }

            let res = req.send().await
                .map_err(|e| format!("HTTP request to {} failed: {}", provider.name, e))?;

            if !res.status().is_success() {
                let status = res.status();
                let err_text = res.text().await.unwrap_or_default();
                
                // Reactive context limit recovery
                if let Some(new_limit) = parse_context_limit_from_error(&err_text) {
                    if new_limit < context_window {
                        context_window = new_limit;
                        let _ = update_model_context_window(&settings.translate_ai_provider, &settings.translate_ai_model, new_limit);
                        continue;
                    }
                }

                if is_context_length_error(&err_text) {
                    let new_limit = context_window / 2;
                    if new_limit >= 1024 {
                        context_window = new_limit;
                        let _ = update_model_context_window(&settings.translate_ai_provider, &settings.translate_ai_model, new_limit);
                        continue;
                    }
                }

                return Err(format!("API returned error status ({}): {}", status, err_text));
            }

            let res_json: Value = res.json().await
                .map_err(|e| format!("Failed to parse response JSON: {}", e))?;

            let response_text = parse_response_content(&provider.api_format, &res_json)?;
            let chunk_translations = align_translations(&chunk, &response_text);
            
            translations_map.extend(chunk_translations);
            
            remaining_entries.retain(|(idx, _)| !translations_map.contains_key(idx));
        }

        // Reconstruct and save
        let reconstructed = parsed.reconstruct(&translations_map);
        fs::write(&output_path, reconstructed)
            .map_err(|e| format!("Failed to write output translated file: {}", e))?;

        successfully_translated.push(output_file_name);
    }

    Ok(successfully_translated)
}

/// Translates first 3 lines for testing/preview.
pub async fn preview_translate(
    settings: WhisperSettings,
    file_content: String,
) -> Result<String, String> {
    // Deserialize providers list
    let providers_list: Vec<AiProvider> = serde_json::from_str(&settings.translate_ai_providers)
        .map_err(|e| format!("Failed to parse providers: {}", e))?;
        
    let provider = providers_list
        .iter()
        .find(|p| p.name == settings.translate_ai_provider)
        .ok_or_else(|| format!("Active provider '{}' not found in config.", settings.translate_ai_provider))?;
        
    let api_key = if provider.use_keyring {
        get_keyring_key(&provider.name)
            .map_err(|e| format!("Could not retrieve key from system keyring: {}", e))?
    } else {
        provider.api_key.clone()
    };

    if settings.translate_ai_model.trim().is_empty() {
        return Err("No active translation model is selected. Please configure and select a model under your active provider first.".to_string());
    }

    let parsed = ParsedSubtitle::parse(&file_content, "srt"); // default preview format
    let original_entries: Vec<(usize, String)> = parsed.cues
        .iter()
        .take(3) // preview only first 3 lines
        .map(|c| (c.index, c.text.clone()))
        .collect();

    if original_entries.is_empty() {
        return Err("No dialogues found in the provided preview content.".to_string());
    }

    let client = reqwest::Client::new();
    let system_prompt = build_system_prompt(
        &provider.custom_prompt,
        &settings.translate_ai_target_lang,
        settings.translate_ai_polish,
    );

    let user_content = original_entries
        .iter()
        .map(|(idx, text)| format!("{}: {}", idx, text))
        .collect::<Vec<String>>()
        .join("\n");

    let request_body = provider.format_request_body(
        &settings.translate_ai_model,
        &system_prompt,
        &user_content,
    );

    let mut request_url = provider.base_url.clone();
    match provider.api_format.as_str() {
        "Anthropic messages" => {
            if !request_url.contains("/messages") {
                let clean_base = request_url.trim_end_matches('/');
                if clean_base.ends_with("/v1") {
                    request_url = format!("{}/messages", clean_base);
                } else {
                    request_url = format!("{}/v1/messages", clean_base);
                }
            }
        }
        "Responses" => {
            if !request_url.contains("/models/") {
                let clean_base = request_url.trim_end_matches('/');
                if clean_base.ends_with("/v1beta") {
                    request_url = format!("{}/models/{}:generateContent", clean_base, settings.translate_ai_model);
                } else {
                    request_url = format!("{}/v1beta/models/{}:generateContent", clean_base, settings.translate_ai_model);
                }
            }
            if !api_key.is_empty() {
                request_url = format!("{}?key={}", request_url, api_key);
            }
        }
        _ => {
            if !request_url.contains("/chat/completions") {
                let clean_base = request_url.trim_end_matches('/');
                request_url = format!("{}/chat/completions", clean_base);
            }
        }
    }

    let mut req = client.post(&request_url).json(&request_body);
    if provider.api_format == "Anthropic messages" {
        if !api_key.is_empty() {
            req = req.header("x-api-key", &api_key);
        }
        req = req.header("anthropic-version", "2023-06-01");
    } else if provider.api_format == "Responses" {
        // Gemini key is in url
    } else {
        if !api_key.is_empty() {
            req = req.bearer_auth(&api_key);
        }
    }

    let res = req.send().await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !res.status().is_success() {
        let status = res.status();
        let err_text = res.text().await.unwrap_or_default();
        return Err(format!("API returned error status ({}): {}", status, err_text));
    }

    let res_json: Value = res.json().await
        .map_err(|e| format!("Failed to parse JSON response: {}", e))?;

    let response_text = parse_response_content(&provider.api_format, &res_json)?;
    let chunk_translations = align_translations(&original_entries, &response_text);

    let mut preview_lines = Vec::new();
    for entry in original_entries {
        let translated = chunk_translations.get(&entry.0).unwrap_or(&entry.1);
        preview_lines.push(format!("Original ({}): {}\nTranslated: {}", entry.0, entry.1, translated));
    }

    Ok(preview_lines.join("\n\n"))
}

fn parse_context_limit_from_error(error_msg: &str) -> Option<usize> {
    let error_lower = error_msg.to_lowercase();
    let patterns = [
        r"max_model_len\s*(?:is\s*)?[:=(]?\s*(\d{4,})",
        r"maximum model length\s*(?:is\s*)?[:=(]?\s*(\d{4,})",
        r"(?:max(?:imum)?|limit)\s*(?:context\s*)?(?:length|size|window)?\s*(?:is|of|:)?\s*(\d{4,})",
        r"context\s*(?:length|size|window)\s*(?:is|of|:)?\s*(\d{4,})",
        r"(\d{4,})\s*(?:token)?\s*(?:context|limit)",
        r">\s*(\d{4,})\s*(?:max|limit|token)",
        r"(\d{4,})\s*(?:max(?:imum)?)\b",
    ];

    for pattern in &patterns {
        if let Ok(re) = regex::Regex::new(pattern) {
            if let Some(caps) = re.captures(&error_lower) {
                if let Some(num_match) = caps.get(1) {
                    if let Ok(limit) = num_match.as_str().parse::<usize>() {
                        if limit >= 1024 && limit <= 10_000_000 {
                            return Some(limit);
                        }
                    }
                }
            }
        }
    }
    None
}

fn is_context_length_error(error_msg: &str) -> bool {
    let error_lower = error_msg.to_lowercase();
    error_lower.contains("context") && (
        error_lower.contains("exceed") ||
        error_lower.contains("too long") ||
        error_lower.contains("too large") ||
        error_lower.contains("overflow") ||
        error_lower.contains("limit")
    )
}

fn update_model_context_window(provider_name: &str, model_id: &str, new_limit: usize) -> Result<(), String> {
    use crate::settings::{load_settings_file, save_settings_file};
    use crate::translation::provider::AiProvider;

    let mut settings = load_settings_file();
    let mut providers: Vec<AiProvider> = serde_json::from_str(&settings.translate_ai_providers)
        .map_err(|e| format!("Failed to parse translation providers: {}", e))?;

    if let Some(provider) = providers.iter_mut().find(|p| p.name == provider_name) {
        if let Some(model) = provider.models.iter_mut().find(|m| m.id == model_id) {
            model.context_window = new_limit;
            settings.translate_ai_providers = serde_json::to_string(&providers)
                .map_err(|e| format!("Failed to serialize providers: {}", e))?;
            save_settings_file(&settings)?;
        }
    }
    Ok(())
}
