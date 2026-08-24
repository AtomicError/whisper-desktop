//! Crash-safe translation checkpoints.
//!
//! Every successfully translated line is periodically flushed to a
//! `<output>.ckpt.json` file next to the target output. If the app crashes,
//! power dies, the internet drops, or the user cancels, the next run loads
//! the checkpoint and continues from the last completed chunk instead of
//! re-translating from zero.
//!
//! Writes are atomic (`tmp` + rename) so a power cut mid-write can never
//! leave a half-serialized checkpoint behind.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

/// Checkpoints written by older builds without this field or matching version are rejected.
const CHECKPOINT_VERSION: u32 = 2;

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TranslationCheckpoint {
    pub version: u32,
    /// Source file name (not full path) the checkpoint belongs to.
    pub source_file: String,
    /// Target language code used for these translations.
    pub lang_code: String,
    /// Subtitle format ("srt" | "vtt" | "lrc" | "txt").
    pub format: String,
    /// Active AI provider name.
    pub provider: String,
    /// Active AI model ID.
    pub model: String,
    /// Deterministic cryptographic SHA-256 integrity stamp of the source content.
    /// If the source changed since the checkpoint was written, it is stale
    /// and must be discarded instead of splicing mismatched translations.
    pub source_fingerprint: String,
    /// index -> translated text. Keys are the 1-based cue indices.
    pub translations: HashMap<usize, String>,
}

impl TranslationCheckpoint {
    pub fn new(
        source_file: &str,
        lang_code: &str,
        format: &str,
        provider: &str,
        model: &str,
        content: &str,
        translations: HashMap<usize, String>,
    ) -> Self {
        TranslationCheckpoint {
            version: CHECKPOINT_VERSION,
            source_file: source_file.to_string(),
            lang_code: lang_code.to_string(),
            format: format.to_string(),
            provider: provider.to_string(),
            model: model.to_string(),
            source_fingerprint: fingerprint(content),
            translations,
        }
    }

    fn path_for(parent_dir: &Path, output_file_name: &str) -> PathBuf {
        parent_dir.join(format!("{output_file_name}.ckpt.json"))
    }

    /// Validates identity (version/source/lang/format/provider/model/content) before use.
    fn matches(
        &self,
        source_file: &str,
        lang_code: &str,
        format: &str,
        provider: &str,
        model: &str,
        fingerprint: &str,
    ) -> bool {
        self.version == CHECKPOINT_VERSION
            && self.source_file == source_file
            && self.lang_code == lang_code
            && self.format == format
            && self.provider == provider
            && self.model == model
            && self.source_fingerprint == fingerprint
    }
}

/// Deterministic, compiler-independent SHA-256 content fingerprint.
/// Normalizes CRLF/CR to LF and strips UTF-8 BOM so cross-platform line ending
/// or encoding differences do not invalidate valid checkpoints without heap allocations.
fn fingerprint(content: &str) -> String {
    let mut hasher = Sha256::new();
    let trimmed_bom = content.strip_prefix('\u{feff}').unwrap_or(content);
    let bytes = trimmed_bom.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'\r' {
            hasher.update(b"\n");
            if i + 1 < bytes.len() && bytes[i + 1] == b'\n' {
                i += 2;
            } else {
                i += 1;
            }
        } else {
            let start = i;
            while i < bytes.len() && bytes[i] != b'\r' {
                i += 1;
            }
            hasher.update(&bytes[start..i]);
        }
    }
    format!("{:x}", hasher.finalize())
}

/// Loads a valid checkpoint for this exact (source, lang, format, provider, model, content)
/// combination. Any mismatch, corruption, or legacy file yields `None` and
/// the stale file is left on disk (it gets overwritten by the first save).
#[allow(clippy::too_many_arguments)]
pub fn load(
    parent_dir: &Path,
    output_file_name: &str,
    source_file: &str,
    lang_code: &str,
    format: &str,
    provider: &str,
    model: &str,
    content: &str,
) -> Option<TranslationCheckpoint> {
    let path = TranslationCheckpoint::path_for(parent_dir, output_file_name);
    let raw = fs::read_to_string(&path).ok()?;
    let ckpt: TranslationCheckpoint = serde_json::from_str(&raw).ok()?;
    if ckpt.matches(
        source_file,
        lang_code,
        format,
        provider,
        model,
        &fingerprint(content),
    ) {
        Some(ckpt)
    } else {
        None
    }
}

/// Atomically persists the checkpoint: serialize → write `.tmp` → rename.
/// A crash at any point leaves either the old checkpoint or the new one,
/// never a truncated file.
pub fn save(
    parent_dir: &Path,
    output_file_name: &str,
    ckpt: &TranslationCheckpoint,
) -> Result<(), String> {
    let final_path = TranslationCheckpoint::path_for(parent_dir, output_file_name);
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let tmp_path = parent_dir.join(format!(
        "{}.{}_{}.tmp",
        output_file_name,
        std::process::id(),
        nanos
    ));
    let serialized = serde_json::to_string(ckpt)
        .map_err(|e| format!("Failed to serialize checkpoint: {e}"))?;
    fs::write(&tmp_path, serialized)
        .map_err(|e| format!("Failed to write checkpoint {}: {e}", tmp_path.display()))?;
    crate::settings::atomic_replace_file(&tmp_path, &final_path).map_err(|e| {
        let _ = fs::remove_file(&tmp_path);
        format!("Failed to commit checkpoint {}: {e}", final_path.display())
    })
}

/// Removes the checkpoint after the final output has been written.
pub fn remove(parent_dir: &Path, output_file_name: &str) {
    let _ = fs::remove_file(TranslationCheckpoint::path_for(parent_dir, output_file_name));
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmpdir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("whisper-ckpt-test-{}", std::process::id()));
        let dir = dir.join(uuid_like());
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn uuid_like() -> String {
        use std::time::{SystemTime, UNIX_EPOCH};
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .subsec_nanos()
            .to_string()
    }

    #[test]
    fn save_load_roundtrip_and_remove() {
        let dir = tmpdir();
        let mut map = HashMap::new();
        map.insert(1usize, "سلام".to_string());
        map.insert(2, "دنیا".to_string());
        let ckpt = TranslationCheckpoint::new("movie.srt", "fa", "srt", "OpenAI", "gpt-4o", "CONTENT", map);

        save(&dir, "movie.fa.srt", &ckpt).unwrap();
        assert!(!dir.join("movie.fa.srt").exists()); // tmp cleaned up via rename

        let loaded =
            load(&dir, "movie.fa.srt", "movie.srt", "fa", "srt", "OpenAI", "gpt-4o", "CONTENT").unwrap();
        assert_eq!(loaded.translations.get(&1).unwrap(), "سلام");
        assert_eq!(loaded.translations.len(), 2);

        remove(&dir, "movie.fa.srt");
        assert!(
            load(&dir, "movie.fa.srt", "movie.srt", "fa", "srt", "OpenAI", "gpt-4o", "CONTENT").is_none()
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_when_source_content_changed() {
        let dir = tmpdir();
        let mut map = HashMap::new();
        map.insert(1, "old".to_string());
        let ckpt = TranslationCheckpoint::new("a.srt", "fa", "srt", "OpenAI", "gpt-4o", "OLD CONTENT", map);
        save(&dir, "a.fa.srt", &ckpt).unwrap();

        assert!(load(&dir, "a.fa.srt", "a.srt", "fa", "srt", "OpenAI", "gpt-4o", "NEW CONTENT").is_none());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_wrong_lang_or_format_or_source_or_model() {
        let dir = tmpdir();
        let mut map = HashMap::new();
        map.insert(1, "x".to_string());
        let ckpt = TranslationCheckpoint::new("a.srt", "fa", "srt", "OpenAI", "gpt-4o", "C", map);
        save(&dir, "a.fa.srt", &ckpt).unwrap();

        assert!(load(&dir, "a.fa.srt", "a.srt", "en", "srt", "OpenAI", "gpt-4o", "C").is_none());
        assert!(load(&dir, "a.fa.srt", "a.srt", "fa", "vtt", "OpenAI", "gpt-4o", "C").is_none());
        assert!(load(&dir, "a.fa.srt", "b.srt", "fa", "srt", "OpenAI", "gpt-4o", "C").is_none());
        assert!(load(&dir, "a.fa.srt", "a.srt", "fa", "srt", "Anthropic", "gpt-4o", "C").is_none());
        assert!(load(&dir, "a.fa.srt", "a.srt", "fa", "srt", "OpenAI", "claude-3-5", "C").is_none());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn corrupted_checkpoint_is_none_not_panic() {
        let dir = tmpdir();
        fs::write(dir.join("a.fa.srt.ckpt.json"), "{\"version\":2,\"trans").unwrap();
        assert!(load(&dir, "a.fa.srt", "a.srt", "fa", "srt", "OpenAI", "gpt-4o", "C").is_none());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn future_version_rejected() {
        let dir = tmpdir();
        let mut map = HashMap::new();
        map.insert(1, "x".to_string());
        let mut ckpt = TranslationCheckpoint::new("a.srt", "fa", "srt", "OpenAI", "gpt-4o", "C", map);
        ckpt.version = 999;
        save(&dir, "a.fa.srt", &ckpt).unwrap();
        assert!(load(&dir, "a.fa.srt", "a.srt", "fa", "srt", "OpenAI", "gpt-4o", "C").is_none());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn crlf_and_lf_share_same_fingerprint_and_load_cleanly() {
        let dir = tmpdir();
        let mut map = HashMap::new();
        map.insert(1, "x".to_string());
        // Saved with CRLF content
        let ckpt = TranslationCheckpoint::new("a.srt", "fa", "srt", "OpenAI", "gpt-4o", "line1\r\nline2\r\n", map);
        save(&dir, "a.fa.srt", &ckpt).unwrap();

        // Loaded with LF content -> must match and succeed
        let loaded = load(&dir, "a.fa.srt", "a.srt", "fa", "srt", "OpenAI", "gpt-4o", "line1\nline2\n");
        assert!(loaded.is_some(), "CRLF and LF differences must not invalidate checkpoint");
        let _ = fs::remove_dir_all(&dir);
    }
}
