pub mod provider;
pub mod chunker;
pub mod prompts;
pub mod formatter;
pub mod translator;

use crate::settings::WhisperSettings;
use serde_json::Value;

#[tauri::command]
pub async fn fetch_provider_models(
    base_url: String,
    api_key: String,
    api_format: String,
) -> Result<Vec<String>, String> {
    let client = reqwest::Client::new();
    
    // Construct models endpoint URL based on base_url and format
    let mut url = base_url.clone();
    
    if api_format == "Responses" {
        // Gemini: GET https://generativelanguage.googleapis.com/v1beta/models?key={api_key}
        if !url.contains("/models") {
            let clean_base = url.trim_end_matches('/');
            url = format!("{}/v1beta/models", clean_base);
        }
        if !api_key.is_empty() {
            url = format!("{}?key={}", url, api_key);
        }
    } else {
        // OpenAI-compatible / Anthropic models list
        // Typically GET base_url/models (or base_url/v1/models)
        if !url.contains("/models") {
            if url.ends_with('/') {
                url.push_str("models");
            } else {
                url.push_str("/models");
            }
        }
    }
    
    let mut req = client.get(&url);
    if api_format == "Anthropic messages" {
        if !api_key.is_empty() {
            req = req.header("x-api-key", &api_key);
        }
        req = req.header("anthropic-version", "2023-06-01");
    } else if api_format == "Responses" {
        // Gemini key is in URL query param
    } else {
        // OpenAI compatible
        if !api_key.is_empty() {
            req = req.bearer_auth(&api_key);
        }
    }
    
    let res = req.send().await
        .map_err(|e| format!("Failed to connect to API models endpoint: {}", e))?;
        
    if !res.status().is_success() {
        return Err(format!("API returned error status: {}", res.status()));
    }
    
    let json: Value = res.json().await
        .map_err(|e| format!("Failed to parse JSON response: {}", e))?;
        
    let mut models = Vec::new();
    
    if let Some(arr) = json.get("data").and_then(|v| v.as_array()) {
        // OpenAI format: { "data": [ { "id": "gpt-4o" }, ... ] }
        for item in arr {
            if let Some(id) = item.get("id").and_then(|v| v.as_str()) {
                models.push(id.to_string());
            }
        }
    } else if let Some(arr) = json.as_array() {
        // Direct array response
        for item in arr {
            if let Some(id) = item.get("id").and_then(|v| v.as_str()) {
                models.push(id.to_string());
            }
        }
    } else if let Some(arr) = json.get("models").and_then(|v| v.as_array()) {
        // Gemini/other standard format: { "models": [ { "name": "models/gemini-1.5-flash" } ] }
        for item in arr {
            if let Some(name) = item.get("name").and_then(|v| v.as_str()) {
                // Strip models/ prefix if present
                let clean_name = name.strip_prefix("models/").unwrap_or(name);
                models.push(clean_name.to_string());
            }
        }
    }
    
    if models.is_empty() {
        // Anthropic fallback since it doesn't support public listing in some configurations
        if api_format == "Anthropic messages" {
            models.push("claude-3-5-sonnet-latest".to_string());
            models.push("claude-3-5-haiku-latest".to_string());
            models.push("claude-3-opus-latest".to_string());
        } else {
            return Err("No models found in the API response.".to_string());
        }
    }
    
    models.sort();
    Ok(models)
}

#[tauri::command]
pub async fn translate_transcription_files(
    settings: WhisperSettings,
    generated_files: Vec<String>,
    parent_dir: String,
) -> Result<Vec<String>, String> {
    translator::translate_files(settings, generated_files, parent_dir).await
}

#[tauri::command]
pub async fn preview_translate_first_lines(
    settings: WhisperSettings,
    file_content: String,
) -> Result<String, String> {
    translator::preview_translate(settings, file_content).await
}

#[tauri::command]
pub fn store_keyring_credential(provider_name: String, key: String) -> Result<(), String> {
    provider::store_keyring_key(&provider_name, &key)
}

#[tauri::command]
pub fn get_keyring_credential(provider_name: String) -> Result<String, String> {
    provider::get_keyring_key(&provider_name)
}

#[tauri::command]
pub fn delete_keyring_credential(provider_name: String) -> Result<(), String> {
    provider::delete_keyring_key(&provider_name)
}
