use serde::{Serialize, Deserialize};
use keyring::Entry;

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AiModel {
    pub id: String,
    pub context_window: usize,
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
    pub api_key: String, // May hold key or "__KEYRING__" placeholder
    pub api_format: String, // "Chat completions" | "Anthropic messages" | "Responses"
    pub use_keyring: bool,
    pub models: Vec<AiModel>,
    #[serde(default)]
    pub custom_prompt: String,
}

const KEYRING_SERVICE: &str = "whisper-desktop-translation";

pub fn store_keyring_key(provider_name: &str, api_key: &str) -> Result<(), String> {
    let entry = Entry::new(KEYRING_SERVICE, provider_name)
        .map_err(|e| format!("Keyring initialization error: {}", e))?;
    entry.set_password(api_key)
        .map_err(|e| format!("Failed to store key in system keyring: {}", e))?;
    Ok(())
}

pub fn get_keyring_key(provider_name: &str) -> Result<String, String> {
    let entry = Entry::new(KEYRING_SERVICE, provider_name)
        .map_err(|e| format!("Keyring initialization error: {}", e))?;
    entry.get_password()
        .map_err(|e| format!("Failed to retrieve key from system keyring: {}", e))
}

pub fn delete_keyring_key(provider_name: &str) -> Result<(), String> {
    let entry = Entry::new(KEYRING_SERVICE, provider_name)
        .map_err(|e| format!("Keyring initialization error: {}", e))?;
    let _ = entry.delete_password();
    Ok(())
}

impl AiProvider {
    /// Formats request body payload according to API Format
    pub fn format_request_body(
        &self,
        model: &str,
        system_prompt: &str,
        user_content: &str,
    ) -> serde_json::Value {
        match self.api_format.as_str() {
            "Anthropic messages" => {
                // Anthropic Messages API
                serde_json::json!({
                    "model": model,
                    "max_tokens": 4096,
                    "system": system_prompt,
                    "messages": [
                        {
                            "role": "user",
                            "content": user_content
                        }
                    ]
                })
            }
            "Responses" => {
                // Gemini generateContent API
                serde_json::json!({
                    "contents": [
                        {
                            "role": "user",
                            "parts": [
                                {
                                    "text": user_content
                                }
                            ]
                        }
                    ],
                    "systemInstruction": {
                        "parts": [
                            {
                                "text": system_prompt
                            }
                        ]
                    }
                })
            }
            _ => {
                // OpenAI-compatible Chat Completions Format (default)
                serde_json::json!({
                    "model": model,
                    "messages": [
                        {
                            "role": "system",
                            "content": system_prompt
                        },
                        {
                            "role": "user",
                            "content": user_content
                        }
                    ]
                })
            }
        }
    }
}
