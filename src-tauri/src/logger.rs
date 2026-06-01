use std::sync::Mutex;
use tauri::{AppHandle, Emitter};
use chrono::Local;

pub struct AppLogs {
    logs: Mutex<String>,
}

impl AppLogs {
    pub fn new() -> Self {
        AppLogs {
            logs: Mutex::new(String::new()),
        }
    }

    pub fn log(&self, app: &AppHandle, category: &str, message: &str) {
        let timestamp = Local::now().format("%H:%M:%S").to_string();
        let formatted = format!("[{}] [{}] {}\n", timestamp, category, message);
        
        {
            if let Ok(mut logs) = self.logs.lock() {
                logs.push_str(&formatted);
            }
        }
        
        // Emit log line to the frontend in real-time
        let payload = LogPayload {
            timestamp,
            category: category.to_string(),
            message: message.to_string(),
        };
        let _ = app.emit("log-message", payload);
    }

    pub fn get_all(&self) -> String {
        if let Ok(logs) = self.logs.lock() {
            logs.clone()
        } else {
            String::new()
        }
    }

    pub fn clear(&self) {
        if let Ok(mut logs) = self.logs.lock() {
            logs.clear();
        }
    }
}

#[derive(serde::Serialize, Clone)]
pub struct LogPayload {
    pub timestamp: String,
    pub category: String,
    pub message: String,
}
