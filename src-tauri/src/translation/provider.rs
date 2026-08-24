use keyring::Entry;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AiModel {
    pub id: String,
    pub context_window: usize,
    /// Per-model output cap override (tokens). `None`/0 = auto mode:
    /// a conservative default is used and the real limit is learned
    /// reactively from API 400 errors, then persisted here.
    /// Modern models accept 65_536+; legacy claude-3 tops out at 4_096.
    #[serde(default)]
    pub max_output_tokens: Option<u32>,
    #[serde(default)]
    pub reasoning: String, // "None" | "Low" | "Medium" | "High"
    #[serde(default)]
    pub vision: bool,
    #[serde(default = "default_model_enabled")]
    pub enabled: bool,
}

fn default_model_enabled() -> bool {
    true
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AiProvider {
    pub name: String,
    pub base_url: String,
    pub api_key: String,    // May hold key or "__KEYRING__" placeholder
    pub api_format: String, // "Chat completions" | "Anthropic messages" | "Responses"
    pub use_keyring: bool,
    pub models: Vec<AiModel>,
    #[serde(default)]
    pub custom_prompt: String,
}

const KEYRING_SERVICE: &str = "whisper-desktop-translation";

/// Pinned Anthropic API version header, shared by every request path so the
/// call sites cannot drift apart.
pub const ANTHROPIC_VERSION: &str = "2023-06-01";

/// Wire protocol of a provider. Parsed from the settings string in exactly
/// ONE place; every dispatch site matches on this enum instead of comparing
/// raw strings — a typo in settings can no longer silently fall through to
/// the wrong protocol (the historic failure mode).
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum ApiFormat {
    OpenAiCompatible,
    AnthropicMessages,
    GeminiResponses,
}

impl ApiFormat {
    /// Parses the user-facing format label stored in settings.
    /// Empty string is tolerated as the legacy default (OpenAI-compatible);
    /// any other unknown value is a hard error instead of silent fallback.
    pub fn parse(value: &str) -> Result<Self, String> {
        match value {
            "Chat completions" => Ok(ApiFormat::OpenAiCompatible),
            "Anthropic messages" => Ok(ApiFormat::AnthropicMessages),
            "Responses" => Ok(ApiFormat::GeminiResponses),
            "" => Ok(ApiFormat::OpenAiCompatible), // legacy default
            other => Err(format!(
                "Unknown API format '{}'. Expected \"Chat completions\", \"Anthropic messages\" or \"Responses\".",
                other
            )),
        }
    }
}

pub fn store_keyring_key(provider_name: &str, api_key: &str) -> Result<(), String> {
    let entry = Entry::new(KEYRING_SERVICE, provider_name)
        .map_err(|e| format!("Keyring initialization error: {}", e))?;
    entry
        .set_password(api_key)
        .map_err(|e| format!("Failed to store key in system keyring: {}", e))?;
    Ok(())
}

pub fn get_keyring_key(provider_name: &str) -> Result<String, String> {
    let entry = Entry::new(KEYRING_SERVICE, provider_name)
        .map_err(|e| format!("Keyring initialization error: {}", e))?;
    entry
        .get_password()
        .map_err(|e| format!("Failed to retrieve key from system keyring: {}", e))
}

pub fn delete_keyring_key(provider_name: &str) -> Result<(), String> {
    let entry = Entry::new(KEYRING_SERVICE, provider_name)
        .map_err(|e| format!("Keyring initialization error: {}", e))?;
    let _ = entry.delete_password();
    Ok(())
}

#[derive(Clone, Debug, PartialEq)]
pub struct RequestOptions {
    pub include_temperature: bool,
    pub temperature: f64,
    pub max_output_tokens: Option<u32>,
    pub use_max_completion_tokens: bool,
    pub system_in_user: bool,
    pub reasoning_effort: Option<String>,
}

impl Default for RequestOptions {
    fn default() -> Self {
        Self {
            include_temperature: true,
            temperature: 0.3,
            max_output_tokens: None,
            use_max_completion_tokens: false,
            system_in_user: false,
            reasoning_effort: None,
        }
    }
}

impl AiProvider {
    /// Formats request body payload with full control over parameter negotiation.
    ///
    /// Following the omission-by-default and reactive negotiation pattern:
    /// - OpenAI-compatible endpoints omit `max_tokens` unless explicitly requested.
    /// - Anthropic requires `max_tokens`.
    /// - `temperature` and `system` message role can be dynamically stripped/merged
    ///   if the model or gateway rejects them with 400.
    pub fn format_request_body_ext(
        &self,
        model: &str,
        system_prompt: &str,
        user_content: &str,
        options: &RequestOptions,
    ) -> Result<serde_json::Value, String> {
        let body = match ApiFormat::parse(&self.api_format)? {
            ApiFormat::AnthropicMessages => {
                let max_tokens = options.max_output_tokens.unwrap_or(4096);
                let mut map = serde_json::Map::new();
                map.insert("model".to_string(), serde_json::json!(model));
                map.insert("max_tokens".to_string(), serde_json::json!(max_tokens));

                if options.system_in_user {
                    let combined = format!("{}\n\n{}", system_prompt, user_content);
                    map.insert(
                        "messages".to_string(),
                        serde_json::json!([
                            {
                                "role": "user",
                                "content": combined
                            }
                        ]),
                    );
                } else {
                    map.insert("system".to_string(), serde_json::json!(system_prompt));
                    map.insert(
                        "messages".to_string(),
                        serde_json::json!([
                            {
                                "role": "user",
                                "content": user_content
                            }
                        ]),
                    );
                }

                if options.include_temperature {
                    map.insert("temperature".to_string(), serde_json::json!(options.temperature));
                }

                map.insert("stream".to_string(), serde_json::json!(false));
                serde_json::Value::Object(map)
            }
            ApiFormat::GeminiResponses => {
                let user_text = if options.system_in_user {
                    format!("{}\n\n{}", system_prompt, user_content)
                } else {
                    user_content.to_string()
                };

                let mut map = serde_json::Map::new();
                map.insert(
                    "contents".to_string(),
                    serde_json::json!([
                        {
                            "role": "user",
                            "parts": [
                                {
                                    "text": user_text
                                }
                            ]
                        }
                    ]),
                );

                if !options.system_in_user && !system_prompt.is_empty() {
                    map.insert(
                        "systemInstruction".to_string(),
                        serde_json::json!({
                            "parts": [
                                {
                                    "text": system_prompt
                                }
                            ]
                        }),
                    );
                }

                let mut gen_config = serde_json::Map::new();
                if options.include_temperature {
                    gen_config.insert("temperature".to_string(), serde_json::json!(options.temperature));
                }
                if let Some(tokens) = options.max_output_tokens {
                    gen_config.insert("maxOutputTokens".to_string(), serde_json::json!(tokens));
                }
                if !gen_config.is_empty() {
                    map.insert("generationConfig".to_string(), serde_json::Value::Object(gen_config));
                }

                serde_json::Value::Object(map)
            }
            ApiFormat::OpenAiCompatible => {
                let mut map = serde_json::Map::new();
                map.insert("model".to_string(), serde_json::json!(model));

                let messages = if options.system_in_user {
                    serde_json::json!([
                        {
                            "role": "user",
                            "content": format!("{}\n\n{}", system_prompt, user_content)
                        }
                    ])
                } else {
                    serde_json::json!([
                        {
                            "role": "system",
                            "content": system_prompt
                        },
                        {
                            "role": "user",
                            "content": user_content
                        }
                    ])
                };
                map.insert("messages".to_string(), messages);
                map.insert("stream".to_string(), serde_json::json!(false));

                if options.include_temperature {
                    map.insert("temperature".to_string(), serde_json::json!(options.temperature));
                }

                if options.use_max_completion_tokens {
                    if let Some(t) = options.max_output_tokens {
                        map.insert("max_completion_tokens".to_string(), serde_json::json!(t));
                    }
                } else if let Some(t) = options.max_output_tokens {
                    map.insert("max_tokens".to_string(), serde_json::json!(t));
                }

                // Reasoning effort: forward if configured for model or in options
                let effort = options.reasoning_effort.as_deref().or_else(|| {
                    self.models.iter().find(|m| m.id == model).and_then(|m| {
                        let r = m.reasoning.trim().to_lowercase();
                        if r == "low" || r == "medium" || r == "high" {
                            Some(m.reasoning.as_str())
                        } else {
                            None
                        }
                    })
                });

                if let Some(r) = effort {
                    map.insert("reasoning_effort".to_string(), serde_json::json!(r.to_lowercase()));
                }

                serde_json::Value::Object(map)
            }
        };
        Ok(body)
    }

    /// Legacy convenience wrapper calling `format_request_body_ext`.
    #[allow(dead_code)]
    pub fn format_request_body(
        &self,
        model: &str,
        system_prompt: &str,
        user_content: &str,
        max_output_tokens: u32,
    ) -> Result<serde_json::Value, String> {
        let options = RequestOptions {
            max_output_tokens: if self.api_format == "Anthropic messages" {
                Some(max_output_tokens)
            } else {
                None
            },
            ..RequestOptions::default()
        };
        self.format_request_body_ext(model, system_prompt, user_content, &options)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn format_request_body_legacy_wrapper_works() {
        let provider = AiProvider {
            name: "OpenAI".to_string(),
            base_url: "https://api.openai.com/v1".to_string(),
            api_key: "sk-test".to_string(),
            api_format: "Chat completions".to_string(),
            use_keyring: false,
            models: vec![],
            custom_prompt: "".to_string(),
        };
        let body = provider.format_request_body("gpt-4o", "sys", "usr", 4096).unwrap();
        assert_eq!(body.get("model").and_then(|v| v.as_str()), Some("gpt-4o"));
    }

    #[test]
    fn api_format_parses_all_known_labels() {
        assert_eq!(ApiFormat::parse("Chat completions"), Ok(ApiFormat::OpenAiCompatible));
        assert_eq!(ApiFormat::parse("Anthropic messages"), Ok(ApiFormat::AnthropicMessages));
        assert_eq!(ApiFormat::parse("Responses"), Ok(ApiFormat::GeminiResponses));
    }

    #[test]
    fn api_format_empty_is_legacy_openai_default() {
        assert_eq!(ApiFormat::parse(""), Ok(ApiFormat::OpenAiCompatible));
    }

    #[test]
    fn api_format_unknown_is_loud_error_not_silent_fallback() {
        let e = ApiFormat::parse("Anthropic Message").unwrap_err();
        assert!(e.contains("Unknown API format"), "got: {e}");
        assert!(e.contains("Anthropic Message"));
    }

    #[test]
    fn openai_format_respects_options_temperature_and_completion_tokens() {
        let provider = AiProvider {
            name: "Custom".to_string(),
            base_url: "https://api.example.com/v1".to_string(),
            api_key: "sk-test".to_string(),
            api_format: "Chat completions".to_string(),
            use_keyring: false,
            models: vec![AiModel {
                id: "future-model".to_string(),
                context_window: 128000,
                max_output_tokens: None,
                reasoning: "low".to_string(),
                vision: false,
                enabled: true,
            }],
            custom_prompt: "".to_string(),
        };

        // When temperature is disabled
        let opts = RequestOptions {
            include_temperature: false,
            use_max_completion_tokens: true,
            max_output_tokens: Some(8192),
            ..RequestOptions::default()
        };

        let body = provider.format_request_body_ext("future-model", "sys", "usr", &opts).unwrap();
        assert!(body.get("temperature").is_none());
        assert_eq!(body.get("max_completion_tokens").and_then(|v| v.as_u64()), Some(8192));
        assert!(body.get("max_tokens").is_none());
        assert_eq!(body.get("reasoning_effort").and_then(|v| v.as_str()), Some("low"));
    }

    #[test]
    fn system_in_user_merges_prompts() {
        let provider = AiProvider {
            name: "OpenAI".to_string(),
            base_url: "https://api.openai.com/v1".to_string(),
            api_key: "sk-test".to_string(),
            api_format: "Chat completions".to_string(),
            use_keyring: false,
            models: vec![],
            custom_prompt: "".to_string(),
        };

        let opts = RequestOptions {
            system_in_user: true,
            ..RequestOptions::default()
        };

        let body = provider.format_request_body_ext("model-x", "system instruction", "user message", &opts).unwrap();
        let messages = body.get("messages").and_then(|v| v.as_array()).unwrap();
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].get("role").and_then(|v| v.as_str()), Some("user"));
        assert!(messages[0].get("content").and_then(|v| v.as_str()).unwrap().contains("system instruction"));
    }
}
