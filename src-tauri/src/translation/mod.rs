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
    pub supports_reasoning: bool,
}

fn is_falsy_str(s: &str) -> bool {
    matches!(
        s.trim().to_lowercase().as_str(),
        "false" | "disabled" | "none" | "off" | "no" | "0" | ""
    )
}

fn matches_reasoning_keyword(s: &str) -> bool {
    let s_lower = s.trim().to_lowercase();
    s_lower.contains("reasoning")
        || s_lower.contains("thinking")
        || s_lower == "reasoner"
        || s_lower.contains("reasoner")
}

fn check_param_str_or_obj(val: &Value) -> bool {
    if let Some(s) = val.as_str() {
        if matches_reasoning_keyword(s) && !is_falsy_str(s) {
            return true;
        }
    } else if let Some(obj) = val.as_object() {
        for key in &["name", "id", "parameter", "key"] {
            if let Some(s) = obj.get(*key).and_then(|v| v.as_str()) {
                if matches_reasoning_keyword(s) && !is_falsy_str(s) {
                    return true;
                }
            }
        }
    }
    false
}

/// Dynamically extracts whether an API model item supports reasoning based on:
/// - `supported_parameters` / `parameters` (e.g. OpenRouter: ["reasoning", "include_reasoning", "reasoning_effort", "thinking", ...])
/// - Direct metadata fields: `reasoning`, `thinking`, `architecture`, `capabilities`, `features`, `tags`, or `displayName`
pub fn supports_reasoning_of(item: &Value) -> bool {
    // 1. Check supported_parameters or parameters (e.g. OpenRouter, Together, Fireworks)
    for param_key in &["supported_parameters", "parameters"] {
        if let Some(params) = item.get(*param_key) {
            if let Some(arr) = params.as_array() {
                for p in arr {
                    if check_param_str_or_obj(p) {
                        return true;
                    }
                }
            } else if let Some(map) = params.as_object() {
                for (k, v) in map {
                    if matches_reasoning_keyword(k) {
                        if let Some(b) = v.as_bool() {
                            if b {
                                return true;
                            }
                        } else if let Some(s) = v.as_str() {
                            if !is_falsy_str(s) {
                                return true;
                            }
                        } else if !v.is_null() {
                            return true;
                        }
                    }
                }
            }
        }
    }

    // 2. Direct reasoning metadata field
    if let Some(val) = item.get("reasoning") {
        if let Some(b) = val.as_bool() {
            if b {
                return true;
            }
        } else if let Some(obj) = val.as_object() {
            if obj.get("supported").and_then(|v| v.as_bool()) == Some(false)
                || obj.get("enabled").and_then(|v| v.as_bool()) == Some(false)
            {
                // explicitly false
            } else if obj.get("supported").and_then(|v| v.as_bool()) == Some(true)
                || obj.get("enabled").and_then(|v| v.as_bool()) == Some(true)
                || !obj.is_empty()
            {
                return true;
            }
        } else if let Some(s) = val.as_str() {
            if !is_falsy_str(s) {
                let s_lower = s.to_lowercase();
                if s_lower == "true"
                    || s_lower == "supported"
                    || s_lower == "enabled"
                    || matches_reasoning_keyword(s)
                {
                    return true;
                }
            }
        }
    }

    // 3. Direct thinking metadata field
    if let Some(val) = item.get("thinking") {
        if let Some(b) = val.as_bool() {
            if b {
                return true;
            }
        } else if let Some(obj) = val.as_object() {
            if obj.get("supported").and_then(|v| v.as_bool()) == Some(false)
                || obj.get("enabled").and_then(|v| v.as_bool()) == Some(false)
            {
                // explicitly false
            } else if obj.get("supported").and_then(|v| v.as_bool()) == Some(true)
                || obj.get("enabled").and_then(|v| v.as_bool()) == Some(true)
                || !obj.is_empty()
            {
                return true;
            }
        } else if let Some(s) = val.as_str() {
            if !is_falsy_str(s) {
                let s_lower = s.to_lowercase();
                if s_lower == "true"
                    || s_lower == "supported"
                    || s_lower == "enabled"
                    || matches_reasoning_keyword(s)
                {
                    return true;
                }
            }
        }
    }

    // 4. architecture metadata field (OpenRouter & others)
    if let Some(arch) = item.get("architecture") {
        if let Some(map) = arch.as_object() {
            for (k, v) in map {
                if matches_reasoning_keyword(k) {
                    if let Some(b) = v.as_bool() {
                        if b {
                            return true;
                        }
                    } else if let Some(s) = v.as_str() {
                        if !is_falsy_str(s) {
                            return true;
                        }
                    } else if !v.is_null() {
                        return true;
                    }
                }
                if let Some(s) = v.as_str() {
                    if matches_reasoning_keyword(s) && !is_falsy_str(s) {
                        return true;
                    }
                }
            }
        } else if let Some(s) = arch.as_str() {
            if matches_reasoning_keyword(s) && !is_falsy_str(s) {
                return true;
            }
        }
    }

    // 5. Capabilities, features, or tags (array or object)
    for key in &["capabilities", "features", "tags"] {
        if let Some(val) = item.get(*key) {
            if let Some(arr) = val.as_array() {
                for entry in arr {
                    if check_param_str_or_obj(entry) {
                        return true;
                    }
                }
            } else if let Some(obj) = val.as_object() {
                for (k, v) in obj {
                    if matches_reasoning_keyword(k) {
                        if let Some(b) = v.as_bool() {
                            if b {
                                return true;
                            }
                        } else if let Some(s) = v.as_str() {
                            if !is_falsy_str(s) {
                                return true;
                            }
                        } else if !v.is_null() {
                            return true;
                        }
                    }
                }
            }
        }
    }

    // 6. Thinking budget parameters (Gemini / Anthropic / others)
    if item.get("thinkingBudget").is_some()
        || item.get("thinking_budget").is_some()
        || item.get("reasoning_effort").is_some()
        || item.get("reasoningEffort").is_some()
    {
        return true;
    }

    // 7. Dynamic displayName or name containing thinking / reasoning keywords (e.g. Gemini models endpoint)
    for name_key in &["displayName", "display_name"] {
        if let Some(dn) = item.get(*name_key).and_then(|v| v.as_str()) {
            if matches_reasoning_keyword(dn) && !is_falsy_str(dn) {
                return true;
            }
        }
    }

    false
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
                    supports_reasoning: supports_reasoning_of(item),
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
                    supports_reasoning: supports_reasoning_of(item),
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
                    supports_reasoning: supports_reasoning_of(item),
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
    output_dir: Option<String>,
) -> Result<Vec<String>, String> {
    translator::translate_files(
        app,
        session_state.0.clone(),
        log_state.0.clone(),
        settings,
        generated_files,
        parent_dir,
        output_dir,
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
pub fn cancel_preview_translate() -> Result<(), String> {
    translator::cancel_preview_request();
    Ok(())
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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_supports_reasoning_from_supported_parameters() {
        let openrouter_model = json!({
            "id": "deepseek/deepseek-r1",
            "supported_parameters": ["tools", "reasoning", "include_reasoning", "temperature"]
        });
        assert!(supports_reasoning_of(&openrouter_model));

        let non_reasoning_model = json!({
            "id": "meta-llama/llama-3-8b",
            "supported_parameters": ["tools", "temperature", "max_tokens"]
        });
        assert!(!supports_reasoning_of(&non_reasoning_model));

        let thinking_model = json!({
            "id": "anthropic/claude-3.7-sonnet",
            "supported_parameters": ["thinking", "max_tokens"]
        });
        assert!(supports_reasoning_of(&thinking_model));

        let effort_model = json!({
            "id": "openai/o3-mini",
            "supported_parameters": ["reasoning_effort"]
        });
        assert!(supports_reasoning_of(&effort_model));
    }

    #[test]
    fn test_supports_reasoning_from_metadata_fields() {
        assert!(supports_reasoning_of(&json!({
            "id": "model-1",
            "reasoning": true
        })));

        assert!(!supports_reasoning_of(&json!({
            "id": "model-2",
            "reasoning": false
        })));

        assert!(!supports_reasoning_of(&json!({
            "id": "model-2-disabled",
            "reasoning": "disabled"
        })));

        assert!(!supports_reasoning_of(&json!({
            "id": "model-2-none",
            "reasoning": "none"
        })));

        assert!(supports_reasoning_of(&json!({
            "id": "model-3",
            "thinking": true
        })));

        assert!(!supports_reasoning_of(&json!({
            "id": "model-4",
            "thinking": false
        })));

        assert!(supports_reasoning_of(&json!({
            "id": "model-5",
            "architecture": { "instruct_type": "deepseek-reasoning" }
        })));

        assert!(!supports_reasoning_of(&json!({
            "id": "model-6",
            "architecture": { "modality": "text->text" }
        })));

        assert!(supports_reasoning_of(&json!({
            "id": "model-7",
            "capabilities": { "reasoning": true }
        })));

        assert!(!supports_reasoning_of(&json!({
            "id": "model-8",
            "capabilities": { "reasoning": false }
        })));

        assert!(!supports_reasoning_of(&json!({
            "id": "model-8-disabled",
            "capabilities": { "reasoning": "disabled" }
        })));

        assert!(supports_reasoning_of(&json!({
            "id": "model-arr-cap",
            "capabilities": ["tools", "reasoning", "vision"]
        })));

        assert!(supports_reasoning_of(&json!({
            "id": "model-arr-feat",
            "features": ["thinking"]
        })));

        assert!(supports_reasoning_of(&json!({
            "id": "model-obj-param",
            "supported_parameters": [{ "name": "reasoning_effort", "type": "string" }]
        })));

        assert!(supports_reasoning_of(&json!({
            "id": "gemini-model",
            "displayName": "Gemini 2.0 Flash Thinking Exp 1219"
        })));

        assert!(supports_reasoning_of(&json!({
            "id": "model-9",
            "thinkingBudget": 2048
        })));

        assert!(!supports_reasoning_of(&json!({
            "id": "standard-model"
        })));
    }

    #[test]
    fn test_fetched_model_camel_case_serialization() {
        let model = FetchedModel {
            id: "test-model".to_string(),
            context_window: Some(128_000),
            supports_reasoning: true,
        };
        let serialized = serde_json::to_string(&model).unwrap();
        assert!(serialized.contains("\"supportsReasoning\":true"));
        assert!(serialized.contains("\"contextWindow\":128000"));
    }
}
