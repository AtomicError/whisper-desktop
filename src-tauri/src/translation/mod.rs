pub mod checkpoint;
pub mod chunker;
pub mod formatter;
pub mod prompts;
pub mod provider;
pub mod translator;

use crate::settings::WhisperSettings;
use serde_json::Value;
use tauri::AppHandle;

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FetchedModel {
    pub id: String,
    pub context_window: Option<usize>,
}

#[tauri::command]
pub async fn fetch_provider_models(
    base_url: String,
    api_key: String,
    api_format: String,
) -> Result<Vec<FetchedModel>, String> {
    // Single parse point for the wire protocol — unknown values are a loud
    // configuration error, never a silent fallback to another format.
    let fmt = crate::translation::provider::ApiFormat::parse(&api_format)?;

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(
            translator::REQUEST_TIMEOUT_SECS,
        ))
        .connect_timeout(std::time::Duration::from_secs(
            translator::CONNECT_TIMEOUT_SECS,
        ))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))?;

    // Construct models endpoint URL based on base_url and format
    let mut url = base_url.clone();

    if fmt == crate::translation::provider::ApiFormat::GeminiResponses {
        // Gemini: GET https://generativelanguage.googleapis.com/v1beta/models?key={api_key}
        if !url.contains("/models") {
            let clean_base = url.trim_end_matches('/');
            if clean_base.ends_with("/v1beta") {
                url = format!("{}/models", clean_base);
            } else {
                url = format!("{}/v1beta/models", clean_base);
            }
        }
        // Key travels in the query string (Gemini convention). Percent-encode
        // it and respect pre-existing query params — same rules as
        // `build_request_url`, so the two paths cannot drift apart.
        if !api_key.is_empty() {
            url = translator::append_query_param(&url, "key", &api_key);
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
    use crate::translation::provider::ApiFormat as Fmt;
    match fmt {
        Fmt::AnthropicMessages => {
            if !api_key.is_empty() {
                req = req.header("x-api-key", &api_key);
            }
            req = req.header("anthropic-version", crate::translation::provider::ANTHROPIC_VERSION);
        }
        Fmt::GeminiResponses => {
            // Gemini key is in URL query param
        }
        Fmt::OpenAiCompatible => {
            if !api_key.is_empty() {
                req = req.bearer_auth(&api_key);
            }
        }
    }

    let res = req
        .send()
        .await
        .map_err(|e| format!("Failed to connect to API models endpoint: {}", e))?;

    if !res.status().is_success() {
        return Err(format!("API returned error status: {}", res.status()));
    }

    let json: Value = res
        .json()
        .await
        .map_err(|e| format!("Failed to parse JSON response: {}", e))?;

    let mut models = Vec::new();

    // Context-window extraction deliberately excludes `max_tokens`: that field
    // is an OUTPUT cap, not a context window — using it as a proxy produced
    // wrongly small chunk budgets.
    fn context_window_of(item: &Value) -> Option<usize> {
        item.get("max_model_len")
            .or_else(|| item.get("context_length"))
            .and_then(|v| v.as_u64())
            .map(|v| v as usize)
    }

    if let Some(arr) = json.get("data").and_then(|v| v.as_array()) {
        // OpenAI format: { "data": [ { "id": "gpt-4o" }, ... ] }
        for item in arr {
            if let Some(id) = item.get("id").and_then(|v| v.as_str()) {
                models.push(FetchedModel {
                    id: id.to_string(),
                    context_window: context_window_of(item),
                });
            }
        }
    } else if let Some(arr) = json.as_array() {
        // Direct array response
        for item in arr {
            if let Some(id) = item.get("id").and_then(|v| v.as_str()) {
                models.push(FetchedModel {
                    id: id.to_string(),
                    context_window: context_window_of(item),
                });
            }
        }
    } else if let Some(arr) = json.get("models").and_then(|v| v.as_array()) {
        // Gemini/other standard format: { "models": [ { "name": "models/gemini-1.5-flash" } ] }
        for item in arr {
            if let Some(name) = item.get("name").and_then(|v| v.as_str()) {
                // Strip models/ prefix if present
                let clean_name = name.strip_prefix("models/").unwrap_or(name);
                let context_window = context_window_of(item).or_else(|| {
                    let n_lower = clean_name.to_lowercase();
                    if n_lower.contains("gemini-1.5") || n_lower.contains("gemini-2.0") {
                        Some(1_000_000)
                    } else if n_lower.contains("gemini-1.0") {
                        Some(32_768)
                    } else {
                        None
                    }
                });
                models.push(FetchedModel {
                    id: clean_name.to_string(),
                    context_window,
                });
            }
        }
    }

    if models.is_empty() {
        // Honest failure: fabricating hardcoded model IDs here masked broken
        // configurations (wrong key, restrictive proxy) as a fake success and
        // pushed users toward selecting models their account doesn't have.
        // Anthropic's listing endpoint may be unavailable in some setups —
        // in that case models can be added manually in the provider editor.
        let hint = if api_format == "Anthropic messages" {
            " (Anthropic does not support model listing on all setups — add the model ID manually in the provider editor)"
        } else {
            ""
        };
        return Err(format!("No models found in the API response.{}", hint));
    }

    models.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(models)
}

#[tauri::command]
pub async fn translate_transcription_files(
    app: AppHandle,
    session_state: tauri::State<'_, crate::TranscriptionState>,
    log_state: tauri::State<'_, crate::LogState>,
    settings: WhisperSettings,
    generated_files: Vec<String>,
    parent_dir: String,
) -> Result<Vec<String>, String> {
    translator::translate_files(
        app,
        session_state.0.clone(),
        log_state.0.clone(),
        settings,
        generated_files,
        parent_dir,
    )
    .await
}

#[tauri::command]
pub async fn preview_translate_first_lines(
    app: AppHandle,
    log_state: tauri::State<'_, crate::LogState>,
    settings: WhisperSettings,
    file_content: String,
) -> Result<String, String> {
    translator::preview_translate(app, log_state.0.clone(), settings, file_content).await
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
