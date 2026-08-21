use std::collections::VecDeque;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};
use chrono::Local;

const MAX_LOG_LINES: usize = 5000;

pub struct AppLogs {
    logs: Mutex<VecDeque<String>>,
}

impl AppLogs {
    pub fn new() -> Self {
        AppLogs {
            logs: Mutex::new(VecDeque::with_capacity(MAX_LOG_LINES)),
        }
    }

    pub fn log(&self, app: &AppHandle, category: &str, message: &str) {
        let timestamp = Local::now().format("%H:%M:%S").to_string();
        let formatted = format!("[{}] [{}] {}", timestamp, category, message);

        let mut logs = match self.logs.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };

        if logs.len() >= MAX_LOG_LINES {
            logs.pop_front();
        }
        logs.push_back(formatted);

        let payload = LogPayload {
            timestamp,
            category: category.to_string(),
            message: message.to_string(),
        };
        let _ = app.emit("log-message", payload);
    }

    pub fn get_all(&self) -> String {
        let logs = match self.logs.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };

        let mut out = String::with_capacity(logs.iter().map(|l| l.len() + 1).sum::<usize>());
        for line in logs.iter() {
            out.push_str(line);
            out.push('\n');
        }
        out
    }

    pub fn clear(&self) {
        let mut logs = match self.logs.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        logs.clear();
    }

    /// Test-only: append a pre-formatted line without needing an AppHandle.
    #[cfg(test)]
    fn log_line(&self, formatted: String) {
        let mut logs = self.logs.lock().unwrap();
        if logs.len() >= MAX_LOG_LINES {
            logs.pop_front();
        }
        logs.push_back(formatted);
    }
}

#[derive(serde::Serialize, Clone)]
pub struct LogPayload {
    pub timestamp: String,
    pub category: String,
    pub message: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ring_buffer_caps_at_max_lines() {
        let logs = AppLogs::new();
        for i in 0..(MAX_LOG_LINES + 500) {
            logs.log_line(format!("line {}", i));
        }
        let all = logs.get_all();
        let count = all.lines().count();
        assert_eq!(count, MAX_LOG_LINES);
        // Oldest lines were evicted
        assert!(!all.contains("line 0\n"));
        assert!(all.contains(&format!("line {}\n", MAX_LOG_LINES + 499)));
    }

    #[test]
    fn get_all_format_matches_frontend_regex() {
        // Frontend parses: ^\[(\d{2}:\d{2}:\d{2})\] \[([^\]]+)\] (.*)$ — keep in sync
        let logs = AppLogs::new();
        logs.log_line("[12:34:56] [Whisper] hello world".to_string());
        let all = logs.get_all();
        let line = all.trim_end();
        assert!(line.starts_with("[12:34:56] [Whisper] "), "got: {}", line);
        assert!(line.ends_with("hello world"));
    }

    #[test]
    fn clear_empties_buffer() {
        let logs = AppLogs::new();
        logs.log_line("x".to_string());
        logs.clear();
        assert_eq!(logs.get_all(), "");
    }
}
