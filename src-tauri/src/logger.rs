use std::collections::VecDeque;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};
use chrono::Local;

const MAX_LOG_LINES: usize = 5000;

struct LogBuffer {
    entries: VecDeque<LogPayload>,
    next_seq: u64,
}

pub struct AppLogs {
    logs: Mutex<LogBuffer>,
}

impl AppLogs {
    pub fn new() -> Self {
        AppLogs {
            logs: Mutex::new(LogBuffer {
                entries: VecDeque::with_capacity(MAX_LOG_LINES),
                next_seq: 1,
            }),
        }
    }

    pub fn log(&self, app: &AppHandle, category: &str, message: &str) {
        let timestamp = Local::now().format("%H:%M:%S").to_string();

        let payload = {
            let mut buffer = match self.logs.lock() {
                Ok(guard) => guard,
                Err(poisoned) => poisoned.into_inner(),
            };

            let seq = buffer.next_seq;
            buffer.next_seq = buffer.next_seq.saturating_add(1);

            let entry = LogPayload {
                seq,
                timestamp,
                category: category.to_string(),
                message: message.to_string(),
            };

            if buffer.entries.len() >= MAX_LOG_LINES {
                buffer.entries.pop_front();
            }
            buffer.entries.push_back(entry.clone());
            entry
        };

        // Emit after releasing the mutex so IPC dispatch never contends on the log lock.
        let _ = app.emit("log-message", payload);
    }

    pub fn get_entries(&self) -> Vec<LogPayload> {
        let buffer = match self.logs.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        buffer.entries.iter().cloned().collect()
    }

    #[cfg(test)]
    pub fn get_all(&self) -> String {
        let buffer = match self.logs.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };

        let mut out = String::new();
        for entry in buffer.entries.iter() {
            use std::fmt::Write;
            let _ = writeln!(out, "[{}] [{}] {}", entry.timestamp, entry.category, entry.message);
        }
        out
    }

    pub fn clear(&self) -> u64 {
        let mut buffer = match self.logs.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        // Keep `next_seq` strictly monotonic across clears so in-flight events cannot collide.
        buffer.entries.clear();
        buffer.next_seq
    }

    /// Test-only: append a structured entry without needing an AppHandle.
    #[cfg(test)]
    fn push_entry(&self, timestamp: &str, category: &str, message: &str) -> LogPayload {
        let mut buffer = self.logs.lock().unwrap();
        let seq = buffer.next_seq;
        buffer.next_seq = buffer.next_seq.saturating_add(1);
        let entry = LogPayload {
            seq,
            timestamp: timestamp.to_string(),
            category: category.to_string(),
            message: message.to_string(),
        };
        if buffer.entries.len() >= MAX_LOG_LINES {
            buffer.entries.pop_front();
        }
        buffer.entries.push_back(entry.clone());
        entry
    }
}

#[derive(serde::Serialize, Clone, Debug, PartialEq, Eq)]
pub struct LogPayload {
    pub seq: u64,
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
            logs.push_entry("12:00:00", "Whisper", &format!("line {}", i));
        }
        let entries = logs.get_entries();
        assert_eq!(entries.len(), MAX_LOG_LINES);
        assert_eq!(entries.first().unwrap().message, "line 500");
        assert_eq!(
            entries.last().unwrap().message,
            format!("line {}", MAX_LOG_LINES + 499)
        );
    }

    #[test]
    fn get_all_format_matches_legacy_pattern() {
        let logs = AppLogs::new();
        logs.push_entry("12:34:56", "Whisper", "hello world");
        let all = logs.get_all();
        let line = all.trim_end();
        assert_eq!(line, "[12:34:56] [Whisper] hello world");
    }

    #[test]
    fn get_entries_preserves_multiline_messages_and_monotonic_seq() {
        let logs = AppLogs::new();
        let e1 = logs.push_entry("12:00:00", "Whisper", "first line\nsecond line");
        assert_eq!(e1.seq, 1);

        let cleared_seq = logs.clear();
        assert_eq!(cleared_seq, 2);
        assert!(logs.get_entries().is_empty());
        assert_eq!(logs.get_all(), "");

        let e2 = logs.push_entry("12:00:01", "Translate", "after clear");
        assert_eq!(e2.seq, 2);

        let entries = logs.get_entries();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0], e2);
    }
}
