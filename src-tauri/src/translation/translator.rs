use crate::settings::WhisperSettings;
use crate::logger::AppLogs;
use crate::translation::chunker::{chunk_dialogues_with_cap, MAX_ITEMS_PER_CHUNK};
use crate::translation::formatter::ParsedSubtitle;
use crate::translation::prompts::build_system_prompt;
use crate::translation::provider::{get_keyring_key, AiModel, AiProvider, ApiFormat, RequestOptions, ANTHROPIC_VERSION};
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::sync::{Arc, Mutex, OnceLock};
use tauri::{AppHandle, Emitter};

/// Conservative default token context for models whose context window is
/// unknown (e.g. manually typed model ids). Deliberately small: an oversized
/// first request burns an API call and relies on error-message parsing to
/// recover, while under-utilising a big model costs nothing.
const DEFAULT_CONTEXT_TOKENS: usize = 32_768;

/// Bounds for the Anthropic `max_tokens` field. The field is mandatory for
/// Anthropic and a value above the model's cap is rejected with an instant
/// HTTP 400 (never truncated), so we start from a floor that every current
/// Claude model accepts and learn the real cap reactively from that 400,
/// then persist it per-model. Modern models accept 65_536+; claude-3-opus
/// tops out at 4_096. Truncation below the cap is detected via missing line
/// numbers and retried.
const MIN_OUTPUT_TOKENS: u32 = 1024;
const DEFAULT_MAX_OUTPUT_TOKENS: u32 = 4_096;
const ABSOLUTE_MAX_OUTPUT_TOKENS: u32 = 200_000;

/// Transport retries for transient failures (network errors, 429, 5xx).
const MAX_TRANSIENT_RETRIES: u32 = 2;

/// Upper bound when honouring a server-sent `Retry-After` seconds value.
const RETRY_AFTER_CAP_SECS: u64 = 30;

/// How many consecutive rounds a chunk may fail to produce any parseable
/// translation before we abort instead of silently looping.
const MAX_STALL_ROUNDS: usize = 3;

/// Overall HTTP budget per request. Local LLMs can be slow, so this is
/// generous, but it prevents permanently hung connections.
pub const REQUEST_TIMEOUT_SECS: u64 = 240;
pub const CONNECT_TIMEOUT_SECS: u64 = 15;
pub const PREVIEW_TIMEOUT_SECS: u64 = 25;
pub const PREVIEW_CONNECT_TIMEOUT_SECS: u64 = 10;

use std::sync::atomic::{AtomicBool, Ordering};

static PREVIEW_CANCELLED: AtomicBool = AtomicBool::new(false);
static PREVIEW_NOTIFY: OnceLock<tokio::sync::Notify> = OnceLock::new();

fn preview_notify() -> &'static tokio::sync::Notify {
    PREVIEW_NOTIFY.get_or_init(tokio::sync::Notify::new)
}

pub fn cancel_preview_request() {
    PREVIEW_CANCELLED.store(true, Ordering::SeqCst);
    preview_notify().notify_waiters();
}

fn build_preview_http_client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(PREVIEW_TIMEOUT_SECS))
        .connect_timeout(std::time::Duration::from_secs(PREVIEW_CONNECT_TIMEOUT_SECS))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new())
}

pub const TRANSLATION_CANCELLED_MSG: &str = "Translation cancelled by user";

fn numbered_line_re() -> &'static regex::Regex {
    static RE: OnceLock<regex::Regex> = OnceLock::new();
    RE.get_or_init(|| {
        // Colon-separated numbering only (ASCII + full-width). A '.' separator
        // is rejected on purpose: translated text like "12. ساعت شب بود" must
        // not be mistaken for line number 12.
        regex::Regex::new(r"^(\d+)\s*[:：]\s*(.*)$").expect("static regex")
    })
}

/// Detects the "N: H:MM" shape where the value itself starts like a clock
/// time. Such lines are ambiguous between a genuine cue number and dialogue
/// content that leaked out of numbering; callers disambiguate via expected
/// sequence order instead of trusting the capture blindly.
fn looks_like_numbered_timecode(line: &str) -> bool {
    static RE: OnceLock<regex::Regex> = OnceLock::new();
    let normalized = normalize_digits(line);
    RE.get_or_init(|| {
        regex::Regex::new(r"^\d{1,3}\s*[:：]\s*\d{1,2}\s*[:：]").expect("static regex")
    })
    .is_match(&normalized)
}

/// Detects bare clock times without a cue-separator space (e.g. `9:00 صبح است`,
/// `12:30`, `۹:۰۰`, `12:30:45`) so continuation dialogue starting with a clock
/// time cannot hijack a future cue slot inside the same chunk.
fn looks_like_bare_clock_time(line: &str) -> bool {
    static RE: OnceLock<regex::Regex> = OnceLock::new();
    let normalized = normalize_digits(line);
    RE.get_or_init(|| {
        regex::Regex::new(r"^(?:[01]?\d|2[0-3])[:：][0-5]\d(?:$|[^\d])").expect("static regex")
    })
    .is_match(&normalized)
}

/// Maps Persian/Arabic-Indic digits to ASCII so model responses that ignore
/// the "ASCII numbers" instruction (`۵: سلام`) still parse instead of being
/// silently dropped by `parse::<usize>` after `\d` matches them.
fn normalize_digits(input: &str) -> String {
    input
        .chars()
        .map(|c| match c {
            '۰'..='۹' => char::from(b'0' + (c as u32 - '۰' as u32) as u8),
            '٠'..='٩' => char::from(b'0' + (c as u32 - '٠' as u32) as u8),
            _ => c,
        })
        .collect()
}

/// Truncates a debug string on a char boundary. Byte-index slicing (`&s[..n]`)
/// panics on multi-byte characters — common in Persian/Arabic API dumps.
fn safe_truncate(s: &str, max_bytes: usize) -> String {
    if s.len() <= max_bytes {
        return s.to_string();
    }
    let mut end = max_bytes;
    while end > 0 && !s.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}... (truncated)", &s[..end])
}

/// Poison-proof session helpers. If another thread panicked while holding the
/// mutex we recover the inner data instead of silently dropping every future
/// lock and leaving the phase stuck in `Translating`.
fn with_session<T>(
    session: &Arc<Mutex<crate::TranscriptionSession>>,
    f: impl FnOnce(&mut crate::TranscriptionSession) -> T,
) -> Option<T> {
    let mut guard = match session.lock() {
        Ok(g) => g,
        Err(poisoned) => poisoned.into_inner(),
    };
    Some(f(&mut guard))
}

fn is_cancelled(session: &Arc<Mutex<crate::TranscriptionSession>>) -> bool {
    with_session(session, |s| s.cancel_requested).unwrap_or(false)
}

/// Ensures a terminal `translation-status` (`active: false`) event is emitted
/// once an active session has been announced, even if `translate_files` exits
/// with an error or panics mid-flight, so global job tracking and OS taskbar
/// progress never stay stuck active.
struct TranslationStatusGuard {
    app: AppHandle,
    last_progress: f64,
    disarmed: bool,
}

impl TranslationStatusGuard {
    fn new(app: AppHandle) -> Self {
        Self {
            app,
            last_progress: 0.0,
            disarmed: false,
        }
    }

    fn set_progress(&mut self, progress: f64) {
        self.last_progress = progress;
    }

    fn disarm(&mut self) {
        self.disarmed = true;
    }
}

impl Drop for TranslationStatusGuard {
    fn drop(&mut self) {
        if !self.disarmed {
            emit_status(&self.app, self.last_progress, "Translation failed", false, None);
        }
    }
}

fn resolve_next_output_cap(
    current_override: Option<u32>,
    sent_tokens: Option<u32>,
    exact_cap: Option<u32>,
) -> Result<u32, String> {
    let current = match (current_override, sent_tokens) {
        (Some(o), Some(s)) => o.min(s),
        (Some(o), None) => o,
        (None, Some(s)) => s,
        (None, None) => DEFAULT_MAX_OUTPUT_TOKENS,
    };
    if current <= MIN_OUTPUT_TOKENS && exact_cap.is_none() {
        return Err(format!(
            "Model rejected every output cap down to {} tokens; its max_tokens limit could not be satisfied.",
            MIN_OUTPUT_TOKENS
        ));
    }
    let ceiling = current_override.map(|o| o.min(current)).unwrap_or(u32::MAX);
    let new_cap = exact_cap
        .filter(|&cap| cap < ceiling)
        .unwrap_or_else(|| (current / 2).max(MIN_OUTPUT_TOKENS));
    if new_cap < MIN_OUTPUT_TOKENS || (current_override.is_some() && new_cap >= current) {
        return Err(format!(
            "Model output cap ({} tokens) is too small or could not be satisfied to translate dialogue lines.",
            new_cap
        ));
    }
    Ok(new_cap)
}

/// Reset the shared session state when translation ends, regardless of whether
/// it finished, errored, or was cancelled. Mirrors `ActiveSessionGuard` on the
/// transcription side so the session never gets stuck in `Translating`.
struct TranslationSessionGuard {
    session: Arc<Mutex<crate::TranscriptionSession>>,
}

impl Drop for TranslationSessionGuard {
    fn drop(&mut self) {
        with_session(&self.session, |s| {
            s.phase = crate::SessionPhase::Idle;
            s.cancel_requested = false;
        });
    }
}

type ProgressExtras = Option<(usize, usize, usize, usize)>; // (currentLine, totalLines, fileIndex, totalFiles)

fn emit_status(
    app: &AppHandle,
    progress: f64,
    message: &str,
    active: bool,
    extras: ProgressExtras,
) {
    let mut payload =
        serde_json::json!({ "progress": progress, "message": message, "active": active });
    if let Some((current_line, total_lines, file_index, total_files)) = extras {
        payload["currentLine"] = serde_json::json!(current_line);
        payload["totalLines"] = serde_json::json!(total_lines);
        payload["fileIndex"] = serde_json::json!(file_index);
        payload["totalFiles"] = serde_json::json!(total_files);
    }
    let _ = app.emit("translation-status", payload);
}

fn emit_cancelled(app: &AppHandle, last_progress: f64) {
    // Report the real last progress, not a fake 1.0.
    emit_status(app, last_progress, "Translation cancelled", false, None);
}

/// Maps common target languages to their standard ISO / BCP-47 codes.
/// Aligned with `TRANSLATION_TARGET_LANGUAGES` in `src/languages.ts`.
/// Falls back to a sanitized lowercase language name if not found.
pub fn get_language_code(lang: &str) -> String {
    match lang.trim().to_lowercase().as_str() {
        "persian" | "farsi" => "fa".to_string(),
        "dari" => "fa-AF".to_string(),
        "spanish" => "es".to_string(),
        "french" => "fr".to_string(),
        "german" => "de".to_string(),
        "italian" => "it".to_string(),
        "russian" => "ru".to_string(),
        "chinese" | "chinese (simplified)" | "simplified chinese" => "zh".to_string(),
        "chinese (traditional)" | "traditional chinese" => "zh-TW".to_string(),
        "cantonese" => "yue".to_string(),
        "arabic" => "ar".to_string(),
        "turkish" => "tr".to_string(),
        "portuguese" => "pt".to_string(),
        "portuguese (brazil)" => "pt-BR".to_string(),
        "portuguese (portugal)" => "pt-PT".to_string(),
        "japanese" => "ja".to_string(),
        "korean" => "ko".to_string(),
        "english" => "en".to_string(),
        "dutch" => "nl".to_string(),
        "polish" => "pl".to_string(),
        "swedish" => "sv".to_string(),
        "norwegian" | "norwegian bokmål" | "norwegian bokmal" => "nb".to_string(),
        "danish" => "da".to_string(),
        "finnish" => "fi".to_string(),
        "greek" => "el".to_string(),
        "czech" => "cs".to_string(),
        "romanian" => "ro".to_string(),
        "hungarian" => "hu".to_string(),
        "ukrainian" => "uk".to_string(),
        "hebrew" => "he".to_string(),
        "hindi" => "hi".to_string(),
        "urdu" => "ur".to_string(),
        "bengali" => "bn".to_string(),
        "indonesian" => "id".to_string(),
        "malay" => "ms".to_string(),
        "vietnamese" => "vi".to_string(),
        "thai" => "th".to_string(),
        "kurdish" => "ku".to_string(),
        "central kurdish" => "ckb".to_string(),
        "northern kurdish" => "kmr".to_string(),
        "pashto" => "ps".to_string(),
        "azerbaijani" => "az".to_string(),
        "uzbek" => "uz".to_string(),
        "kazakh" => "kk".to_string(),
        "tagalog" | "filipino" => "tl".to_string(),
        "swahili" => "sw".to_string(),
        "catalan" => "ca".to_string(),
        "serbian" => "sr".to_string(),
        "bulgarian" => "bg".to_string(),
        "armenian" => "hy".to_string(),
        "albanian" => "sq".to_string(),
        "slovak" => "sk".to_string(),
        "croatian" => "hr".to_string(),
        "belarusian" => "be".to_string(),
        "sicilian" => "scn".to_string(),
        "georgian" => "ka".to_string(),
        "lombard" => "lmo".to_string(),
        "lithuanian" => "lt".to_string(),
        "galician" => "gl".to_string(),
        "bosnian" => "bs".to_string(),
        "slovenian" => "sl".to_string(),
        "macedonian" => "mk".to_string(),
        "latvian" => "lv".to_string(),
        "estonian" => "et".to_string(),
        "icelandic" => "is".to_string(),
        "maltese" => "mt".to_string(),
        "welsh" => "cy".to_string(),
        "irish" => "ga".to_string(),
        "breton" => "br".to_string(),
        "basque" => "eu".to_string(),
        "yiddish" => "yi".to_string(),
        "luxembourgish" => "lb".to_string(),
        "occitan" => "oc".to_string(),
        "aragonese" => "an".to_string(),
        "latin" => "la".to_string(),
        "esperanto" => "eo".to_string(),
        "kyrgyz" => "ky".to_string(),
        "turkmen" => "tk".to_string(),
        "tajik" => "tg".to_string(),
        "mongolian" => "mn".to_string(),
        "bashkir" => "ba".to_string(),
        "tatar" => "tt".to_string(),
        "uyghur" => "ug".to_string(),
        "marathi" => "mr".to_string(),
        "telugu" => "te".to_string(),
        "tamil" => "ta".to_string(),
        "gujarati" => "gu".to_string(),
        "kannada" => "kn".to_string(),
        "punjabi" => "pa".to_string(),
        "malayalam" => "ml".to_string(),
        "bhojpuri" => "bho".to_string(),
        "maithili" => "mai".to_string(),
        "nepali" => "ne".to_string(),
        "sinhala" => "si".to_string(),
        "assamese" => "as".to_string(),
        "konkani" => "kok".to_string(),
        "sanskrit" => "sa".to_string(),
        "lao" => "lo".to_string(),
        "burmese" => "my".to_string(),
        "khmer" => "km".to_string(),
        "javanese" => "jv".to_string(),
        "sundanese" => "su".to_string(),
        "acehnese" => "ace".to_string(),
        "pangasinan" => "pag".to_string(),
        "pampangan" => "pam".to_string(),
        "cebuano" => "ceb".to_string(),
        "hausa" => "ha".to_string(),
        "amharic" => "am".to_string(),
        "igbo" => "ig".to_string(),
        "wolof" => "wo".to_string(),
        "xhosa" => "xh".to_string(),
        "zulu" => "zu".to_string(),
        "afrikaans" => "af".to_string(),
        "oromo" => "om".to_string(),
        "southern sotho" => "st".to_string(),
        "tswana" => "tn".to_string(),
        "tsonga" => "ts".to_string(),
        "malagasy" => "mg".to_string(),
        "lingala" => "ln".to_string(),
        "haitian creole" => "ht".to_string(),
        "quechua" => "qu".to_string(),
        "aymara" => "ay".to_string(),
        "guarani" => "gn".to_string(),
        "maori" => "mi".to_string(),
        _ => sanitize_filename_code(lang),
    }
}

/// Filename-safe fallback for unmapped languages: lowercase, spaces become
/// dashes, everything outside [a-z0-9-_] is stripped so the output filename
/// never contains garbage like spaces or slashes.
fn sanitize_filename_code(lang: &str) -> String {
    let lower = lang.to_lowercase().replace(' ', "-");
    let cleaned: String = lower
        .chars()
        .filter(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || *c == '-' || *c == '_')
        .collect();
    if cleaned.is_empty() {
        "xx".to_string()
    } else {
        cleaned
    }
}

/// Parses the response JSON based on the provider's wire protocol.
/// Handles multi-part responses (e.g. Gemini thinking parts with `thought: true`
/// and Anthropic `content` arrays starting with `type: "thinking"` blocks).
fn parse_response_content(api_format: ApiFormat, response_val: &Value) -> Result<String, String> {
    let trunc = |v: &Value| safe_truncate(&format!("{:?}", v), 500);
    match api_format {
        ApiFormat::AnthropicMessages => {
            if let Some(parts) = response_val["content"].as_array() {
                let texts: Vec<&str> = parts
                    .iter()
                    .filter(|part| {
                        part.get("type")
                            .and_then(|v| v.as_str())
                            .map(|t| t == "text")
                            .unwrap_or(true)
                    })
                    .filter_map(|part| part.get("text").and_then(|v| v.as_str()))
                    .collect();
                if !texts.is_empty() {
                    return Ok(texts.join("\n"));
                }
            }
            Err(format!("Invalid Anthropic response format: {}", trunc(response_val)))
        }
        ApiFormat::GeminiResponses => {
            if let Some(parts) = response_val["candidates"][0]["content"]["parts"].as_array() {
                let texts: Vec<&str> = parts
                    .iter()
                    .filter(|part| part.get("thought").and_then(|v| v.as_bool()) != Some(true))
                    .filter_map(|part| part.get("text").and_then(|v| v.as_str()))
                    .collect();
                if !texts.is_empty() {
                    return Ok(texts.join("\n"));
                }
            }
            Err(format!("Invalid Gemini response format: {}", trunc(response_val)))
        }
        ApiFormat::OpenAiCompatible => {
            let content = &response_val["choices"][0]["message"]["content"];
            if let Some(s) = content.as_str() {
                return Ok(s.to_string());
            }
            if let Some(parts) = content.as_array() {
                let texts: Vec<&str> = parts
                    .iter()
                    .filter(|part| {
                        part.get("type")
                            .and_then(|v| v.as_str())
                            .map(|t| t == "text")
                            .unwrap_or(true)
                    })
                    .filter_map(|part| part.get("text").and_then(|v| v.as_str()))
                    .collect();
                if !texts.is_empty() {
                    return Ok(texts.join("\n"));
                }
            }
            Err(format!("Invalid OpenAI response format: {}", trunc(response_val)))
        }
    }
}

/// Parses numbered lines from response (e.g. "1: Translated text").
///
/// `allowed`: inclusive index range accepted from the model. Numbers outside
/// the current chunk are dropped entirely — otherwise an echoing model that
/// repeats "[Previous Context]" lines would overwrite good translations from
/// earlier chunks via `extend()`.
///
/// `expected_order`: cue indices in the order they were sent. Used to
/// disambiguate dialogue content that *looks* numbered (e.g. "12:30 نیمه‌شب"
/// leaking out of its own line after a model numbering glitch): a capture
/// whose number is NOT the next expected cue and whose value starts like a
/// clock time is treated as continuation text of the previous cue instead of
/// hijacking another cue's slot.
///
/// Blank lines do not reset continuation: a multi-paragraph translation of
/// one cue keeps appending to its index.
fn parse_translated_lines(
    response_text: &str,
    expected_order: &[usize],
) -> HashMap<usize, String> {
    let in_allowed = |idx: usize| expected_order.contains(&idx);

    let mut map = HashMap::new();
    let re = numbered_line_re();
    let mut current_idx: Option<usize> = None;
    // Pointer into expected_order tracking which cue we believe comes next;
    // advanced whenever a capture is accepted as a genuine numbered line.
    let mut expect_pos: usize = 0;

    // Tracks a stack of cue slots tentatively populated by bare-clock or compact
    // numeric lines (`N:MM ...` with no space after the colon) while inside
    // another active cue. If a genuine cue `N: ...` arrives afterward, we
    // restore the tentative clock/ratio text (and any subsequent stacked
    // tentative slots) as continuation lines of the original `prev_owner` and
    // place the genuine cue into `map[N]`.
    struct TentativeCompact {
        idx: usize,
        prev_owner: usize,
        raw_line: String,
        extra_lines: Vec<String>,
    }
    let mut tentative_stack: Vec<TentativeCompact> = Vec::new();

    for line in response_text.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("```") {
            continue;
        }
        if trimmed.is_empty() {
            continue;
        }

        if let Some(caps) = re.captures(trimmed) {
            if let (Some(num_cap), Some(val_cap)) = (caps.get(1), caps.get(2)) {
                let normalized = normalize_digits(num_cap.as_str());
                if let Ok(idx) = normalized.parse::<usize>() {
                    let next_expected = expected_order.get(expect_pos).copied();
                    let is_bare_clock = looks_like_bare_clock_time(trimmed);
                    let has_separator_space = trimmed
                        .find([':', '：'])
                        .and_then(|pos| {
                            let sep_len = trimmed[pos..].chars().next()?.len_utf8();
                            Some(trimmed[pos + sep_len..].starts_with(char::is_whitespace))
                        })
                        .unwrap_or(false);
                    let normalized_val = normalize_digits(val_cap.as_str());
                    let is_compact_numeric = !has_separator_space
                        && normalized_val.chars().next().is_some_and(|c| c.is_ascii_digit());
                    let matched_pos = expected_order.iter().position(|&e| e == idx);
                    let is_behind_duplicate =
                        matched_pos.is_some_and(|pos| pos < expect_pos) && map.contains_key(&idx);

                    let reclaim_pos = tentative_stack.iter().rposition(|t| t.idx == idx);
                    let is_genuine_cue_shape =
                        has_separator_space || (!is_bare_clock && !is_compact_numeric);
                    let reclaims_tentative = reclaim_pos.is_some()
                        && is_genuine_cue_shape
                        && !val_cap.as_str().trim().is_empty();

                    if reclaims_tentative {
                        if let Some(stack_idx) = reclaim_pos {
                            let drained: Vec<TentativeCompact> =
                                tentative_stack.drain(stack_idx..).collect();
                            let target_owner = drained[0].prev_owner;
                            let mut restored_lines = Vec::new();
                            for entry in drained {
                                map.remove(&entry.idx);
                                restored_lines.push(entry.raw_line);
                                restored_lines.extend(entry.extra_lines);
                            }
                            map.entry(target_owner)
                                .and_modify(|existing: &mut String| {
                                    for restored in &restored_lines {
                                        existing.push('\n');
                                        existing.push_str(restored);
                                    }
                                })
                                .or_insert_with(|| restored_lines.join("\n"));
                            map.insert(idx, val_cap.as_str().trim().to_string());
                            if let Some(pos) = matched_pos {
                                expect_pos = pos + 1;
                            }
                            current_idx = Some(idx);
                            continue;
                        }
                    }

                    // If a line looks like a bare clock time, a compact N:M numeric ratio/time
                    // without a separator space, or an already-translated behind-cursor number
                    // inside an active cue and does not match the next expected cue number, treat
                    // it as continuation dialogue rather than overwriting an earlier cue or
                    // hijacking a future slot.
                    if current_idx.is_some()
                        && Some(idx) != next_expected
                        && (is_bare_clock || is_compact_numeric || is_behind_duplicate)
                    {
                        // Fall through to continuation below
                    } else if !in_allowed(idx) {
                        // Out-of-range numbered lines (e.g. echoed [Previous Context]
                        // or hallucinated extra cues) must be dropped cleanly and must
                        // not bleed into the previously accepted cue.
                        current_idx = None;
                        tentative_stack.clear();
                        continue;
                    } else {
                        // Disambiguation: "12:30 نیمه‌شب" or "9:00 صبح بود" is
                        // handled as bare clock time above. If a two-colon timecode
                        // follows an explicit cue separator (e.g. "7: 10:30 شب بود"),
                        // accept it only when it is next expected or explicitly
                        // separated as an upcoming cue in expected_order.
                        let is_expected_ahead = expected_order.get(expect_pos..)
                            .map(|slice| slice.contains(&idx))
                            .unwrap_or(false);
                        let is_timecode_like = looks_like_numbered_timecode(trimmed);

                        let should_accept = Some(idx) == next_expected
                            || !is_timecode_like
                            || (is_expected_ahead
                                && has_separator_space
                                && !val_cap.as_str().trim().is_empty());

                        if should_accept {
                            if let Some(pos) = matched_pos {
                                expect_pos = expect_pos.max(pos + 1);
                            }
                            let prev_owner = current_idx;
                            let was_unpopulated = !map.contains_key(&idx);
                            let text = val_cap.as_str().trim().to_string();
                            if !text.is_empty() {
                                map.insert(idx, text);
                                if !has_separator_space
                                    && (is_bare_clock || is_compact_numeric)
                                    && was_unpopulated
                                {
                                    if let Some(prev) = prev_owner {
                                        if prev != idx && in_allowed(prev) {
                                            tentative_stack.push(TentativeCompact {
                                                idx,
                                                prev_owner: prev,
                                                raw_line: trimmed.to_string(),
                                                extra_lines: Vec::new(),
                                            });
                                        } else {
                                            tentative_stack.clear();
                                        }
                                    } else {
                                        tentative_stack.clear();
                                    }
                                } else {
                                    tentative_stack.clear();
                                }
                            } else {
                                tentative_stack.clear();
                            }
                            current_idx = Some(idx);
                            continue;
                        }
                    }
                }
            }
        }

        // Un-numbered line (or rejected ambiguous capture): continuation of
        // the previous accepted index — but only if it's in the allowed chunk.
        if let Some(idx) = current_idx {
            if in_allowed(idx) {
                map.entry(idx)
                    .and_modify(|existing| {
                        existing.push('\n');
                        existing.push_str(trimmed);
                    })
                    .or_insert_with(|| trimmed.to_string());
                if let Some(top) = tentative_stack.last_mut() {
                    if top.idx == idx {
                        top.extra_lines.push(trimmed.to_string());
                    }
                }
            }
        }
    }

    map
}

/// Strips reasoning/thought blocks emitted by reasoning models (e.g. DeepSeek-R1,
/// QwQ, Claude thinking mode, etc.) so internal reasoning cannot be mistaken for
/// subtitle dialogue lines or numbering.
pub fn strip_reasoning_blocks(text: &str) -> String {
    static CLOSED_THINK_RE: OnceLock<regex::Regex> = OnceLock::new();
    let re = CLOSED_THINK_RE.get_or_init(|| {
        regex::Regex::new(r"(?is)<\s*(?:think|thought|reasoning)\b(?:\s+[^>]*)?>.*?</\s*(?:think|thought|reasoning)\s*>")
            .expect("valid regex")
    });

    let cleaned = re.replace_all(text, "");

    // Unclosed reasoning tag at the beginning of the text
    static UNCLOSED_START_RE: OnceLock<regex::Regex> = OnceLock::new();
    let unclosed_start = UNCLOSED_START_RE.get_or_init(|| {
        regex::Regex::new(r"(?is)^\s*<\s*(?:think|thought|reasoning)\b(?:\s+[^>]*)?>.*$")
            .expect("valid regex")
    });

    if unclosed_start.is_match(&cleaned) {
        return String::new();
    }

    // Line-anchored unclosed thought tag on a dedicated line
    static UNCLOSED_LINE_RE: OnceLock<regex::Regex> = OnceLock::new();
    let unclosed_line = UNCLOSED_LINE_RE.get_or_init(|| {
        regex::Regex::new(r"(?is)(?:\r?\n)\s*<\s*(?:think|thought|reasoning)\b(?:\s+[^>]*)?>.*$")
            .expect("valid regex")
    });

    unclosed_line.replace_all(&cleaned, "").to_string()
}

pub fn is_unsupported_parameter_error(err_msg: &str, param: &str) -> bool {
    let err = err_msg.to_lowercase();
    let p = param.to_lowercase();
    err.contains(&p)
        && (err.contains("not supported")
            || err.contains("unsupported")
            || err.contains("invalid")
            || err.contains("not allowed")
            || err.contains("not recognized")
            || err.contains("unknown parameter")
            || err.contains("unexpected parameter")
            || err.contains("unrecognized request argument")
            || err.contains("unrecognized parameter")
            || err.contains("extra inputs are not permitted")
            || err.contains("extra fields not permitted")
            || err.contains("not permitted")
            || err.contains("does not support"))
}

pub fn is_unsupported_system_role_error(err_msg: &str) -> bool {
    let err = err_msg.to_lowercase();
    let mentions_role = (err.contains("system") || err.contains("developer"))
        && (err.contains("role") || err.contains("message") || err.contains("instruction") || err.contains("prompt"));

    let mentions_unsupported = err.contains("not supported")
        || err.contains("unsupported")
        || err.contains("not allowed")
        || err.contains("not enabled")
        || err.contains("only user")
        || err.contains("is not permitted")
        || err.contains("does not support")
        || err.contains("invalid")
        || err.contains("not recognized");

    mentions_role && mentions_unsupported
}

fn negotiate_parameter_error_step(
    api_format: ApiFormat,
    err_text: &str,
    options: &mut crate::translation::provider::RequestOptions,
) -> Option<&'static str> {
    if options.include_temperature && is_unsupported_parameter_error(err_text, "temperature") {
        options.include_temperature = false;
        return Some("API rejected 'temperature'; disabling temperature and retrying immediately");
    }

    if is_unsupported_parameter_error(err_text, "max_tokens") {
        let lower = err_text.to_lowercase();
        if api_format == ApiFormat::OpenAiCompatible
            && lower.contains("max_completion_tokens")
            && !options.use_max_completion_tokens
        {
            options.use_max_completion_tokens = true;
            return Some("API requires 'max_completion_tokens' instead of 'max_tokens'; switching and retrying");
        } else if api_format != ApiFormat::AnthropicMessages && options.max_output_tokens.is_some() {
            options.max_output_tokens = None;
            return Some("API rejected 'max_tokens'; omitting parameter and retrying");
        }
    }

    if options.include_reasoning_effort && is_unsupported_parameter_error(err_text, "reasoning_effort") {
        options.include_reasoning_effort = false;
        options.reasoning_effort = None;
        return Some("API rejected 'reasoning_effort'; omitting parameter and retrying");
    }

    if !options.system_in_user && is_unsupported_system_role_error(err_text) {
        options.system_in_user = true;
        return Some("API rejected 'system' message role; merging system prompt into user message and retrying");
    }

    None
}

pub fn negotiate_parameter_error(
    api_format: ApiFormat,
    err_text: &str,
    options: &mut crate::translation::provider::RequestOptions,
    app: &AppHandle,
    logs: &AppLogs,
) -> bool {
    if let Some(log_msg) = negotiate_parameter_error_step(api_format, err_text, options) {
        logs.log(app, "Translate", log_msg);
        true
    } else {
        false
    }
}

/// Aligns translations to chunk entries. Only genuinely parsed lines are
/// returned — missing entries stay missing so the caller can retry them and
/// report them. Silently substituting the original text here masked every
/// model failure and produced `.fa.srt` files that were never translated.
///
/// `allow_positional_fallback`: the 1-to-1 positional rescue for models that
/// translate correctly but drop the numbering. GATED by the caller: it must
/// only fire after at least one numbered-protocol round already failed,
/// otherwise it masks protocol violations from round one — and its
/// order-preserving assumption would silently swap translations if a sloppy
/// model reorders unnumbered lines.
fn align_translations(
    original_entries: &[(usize, String)],
    response_text: &str,
    allow_positional_fallback: bool,
) -> HashMap<usize, String> {
    let sanitized = strip_reasoning_blocks(response_text);
    let expected_order: Vec<usize> = original_entries.iter().map(|(i, _)| *i).collect();
    let mut map = parse_translated_lines(&sanitized, &expected_order);

    if map.is_empty() && allow_positional_fallback {
        // 1-to-1 positional fallback for models that translate correctly but
        // drop the numbers. Only accepted when the count matches exactly and
        // the response is free of markdown headers / chat boilerplate.
        let response_lines: Vec<&str> = sanitized
            .lines()
            .map(|l| l.trim())
            .filter(|l| !l.is_empty() && !l.starts_with("```"))
            .collect();

        let looks_like_boilerplate = |l: &str| {
            let lower = l.to_lowercase();
            lower.starts_with("here is")
                || lower.starts_with("here are")
                || lower.starts_with("translated:")
                || lower.starts_with("translation:")
        };

        if response_lines.len() == original_entries.len()
            && !response_lines.iter().any(|l| looks_like_boilerplate(l))
        {
            for (i, entry) in original_entries.iter().enumerate() {
                let line = response_lines[i].trim();
                if !line.is_empty() {
                    map.insert(entry.0, line.to_string());
                }
            }
        }
    }

    // Enforce speaker prefix preservation (- / – / —) across all dialogue lines
    for entry in original_entries {
        let (idx, orig_text) = entry;

        if let Some(translated_text) = map.get_mut(idx) {
            let starts_with_dialogue_dash = |t: &str| {
                let s = t.trim_start();
                if s.starts_with('—') || s.starts_with('–') || s == "-" {
                    return true;
                }
                if let Some(after) = s.strip_prefix('-') {
                    // Treat compact speaker dashes like "-سلام" as already prefixed so we
                    // don't double them to "- -سلام", while keeping negative numbers ("-5",
                    // "-۱۲") unprefixed so prepending "- " produces "- -5" instead of "+5".
                    !after
                        .chars()
                        .next()
                        .is_some_and(|c| c.is_ascii_digit() || ('\u{0660}'..='\u{0669}').contains(&c) || ('\u{06F0}'..='\u{06F9}').contains(&c))
                } else {
                    false
                }
            };

            let orig_lines: Vec<&str> = orig_text.lines().collect();
            let trans_lines: Vec<&str> = translated_text.lines().collect();

            if orig_lines.len() == trans_lines.len() && orig_lines.len() > 1 {
                let mut updated_lines = Vec::with_capacity(trans_lines.len());
                for (o_line, t_line) in orig_lines.iter().zip(trans_lines.iter()) {
                    if starts_with_dialogue_dash(o_line) && !starts_with_dialogue_dash(t_line) {
                        updated_lines.push(format!("- {}", t_line.trim_start()));
                    } else {
                        updated_lines.push(t_line.to_string());
                    }
                }
                *translated_text = updated_lines.join("\n");
            } else if starts_with_dialogue_dash(orig_text)
                && !starts_with_dialogue_dash(translated_text)
            {
                *translated_text = format!("- {}", translated_text.trim_start());
            }
        }
    }

    map
}

/// Rough output-token budget for Anthropic's mandatory `max_tokens`: ~2 input
/// characters per output token, clamped to sane bounds.
///
/// `model_override` (per-model setting, may be reactively discovered) is an
/// upper bound: the estimate never exceeds it. When no override exists the
/// conservative `DEFAULT_MAX_OUTPUT_TOKENS` is the cap until a 400 error
/// teaches us the model allows more.
fn estimate_max_output_tokens(prompt_chars: usize, model_override: Option<u32>) -> u32 {
    let cap = model_override.unwrap_or(DEFAULT_MAX_OUTPUT_TOKENS);
    let raw = (prompt_chars / 2) as u32;
    raw.clamp(MIN_OUTPUT_TOKENS, cap.min(ABSOLUTE_MAX_OUTPUT_TOKENS))
}

/// Redacts secret query parameters (such as `?key=`, `api_key=`, or `apikey=`)
/// from URLs or formatted error strings as defense-in-depth against credential leaks.
pub(crate) fn redact_url_secrets(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let bytes = input.as_bytes();
    let lower = input.to_ascii_lowercase();
    let lower_bytes = lower.as_bytes();
    let mut i = 0;

    while i < bytes.len() {
        let rest = &lower[i..];
        let matched_param_len = if i == 0 || matches!(bytes[i - 1], b'?' | b'&') {
            ["access_token=", "api_key=", "apikey=", "token=", "key="]
                .into_iter()
                .find(|prefix| rest.starts_with(prefix))
                .map(|prefix| prefix.len())
        } else {
            None
        };

        if let Some(plen) = matched_param_len {
            out.push_str(&input[i..i + plen]);
            out.push_str("<redacted>");
            i += plen;
            while i < bytes.len() {
                let b = lower_bytes[i];
                if b == b'&' || b.is_ascii_whitespace() || matches!(b, b')' | b'"' | b'\'' | b'>' | b'#') {
                    break;
                }
                i += 1;
            }
        } else {
            let ch = input[i..].chars().next().unwrap();
            out.push(ch);
            i += ch.len_utf8();
        }
    }
    out
}

/// Strips request URLs from `reqwest::Error` and redacts any query secrets.
pub(crate) fn sanitize_reqwest_error(err: reqwest::Error) -> String {
    redact_url_secrets(&err.without_url().to_string())
}

/// Reads a subtitle file tolerating non-UTF-8 encodings.
///
/// Multi-tier decoding:
/// 1. Fast path: exact UTF-8 (the vast majority of modern subtitles).
/// 2. UTF-16 LE/BE with BOM (common from specialized subtitle tools).
/// 3. UTF-8 with BOM or lossy UTF-8: if the file is mostly valid UTF-8
///    (e.g. Persian/Arabic text with isolated byte corruption), lossy decode
///    preserves the text instead of ruining the entire file into Windows-1252 mojibake.
/// 4. Windows-1256 (Persian/Arabic) vs. Windows-1252 / Latin-1 decode for legacy
///    single-byte subtitles.
fn is_arabic_persian_letter(ch: char) -> bool {
    ('\u{0621}'..='\u{063A}').contains(&ch)
        || ('\u{0641}'..='\u{064A}').contains(&ch)
        || ('\u{0671}'..='\u{06D5}').contains(&ch)
}

fn is_likely_windows_1256(bytes: &[u8]) -> bool {
    let total_non_ascii = bytes.iter().filter(|&&b| b >= 0x80).count();
    if total_non_ascii < 3 {
        return false;
    }

    let (decoded, _, _) = encoding_rs::WINDOWS_1256.decode(bytes);
    let chars: Vec<char> = decoded.chars().collect();
    let arabic_persian_chars = chars
        .iter()
        .filter(|&&ch| ('\u{0600}'..='\u{06FF}').contains(&ch))
        .count();

    let mut clean_arabic_pairs = 0usize;
    let mut clean_arabic_words = 0usize;
    let mut i = 0;
    while i < chars.len() {
        if is_arabic_persian_letter(chars[i]) {
            let start = i;
            while i < chars.len() && is_arabic_persian_letter(chars[i]) {
                i += 1;
            }
            let run_len = i - start;
            let prev_is_latin = start > 0 && chars[start - 1].is_ascii_alphabetic();
            let next_is_latin = i < chars.len() && chars[i].is_ascii_alphabetic();
            if !prev_is_latin && !next_is_latin {
                clean_arabic_pairs += run_len.saturating_sub(1);
                if run_len >= 2 {
                    clean_arabic_words += 1;
                }
            }
        } else {
            i += 1;
        }
    }

    arabic_persian_chars * 100 >= total_non_ascii * 60
        && clean_arabic_pairs >= 2
        && clean_arabic_words >= 1
}

pub(crate) fn read_subtitle_string(path: &Path) -> Result<String, String> {
    let bytes = fs::read(path)
        .map_err(|e| format!("Failed to read source file '{}': {}", path.display(), e))?;
    // 1. Fast path: valid UTF-8
    if let Ok(s) = std::str::from_utf8(&bytes) {
        return Ok(s.to_owned());
    }
    // 2. UTF-16 with BOM
    if bytes.starts_with(&[0xFF, 0xFE]) {
        let (decoded, _) = encoding_rs::UTF_16LE.decode_without_bom_handling(&bytes);
        return Ok(decoded.into_owned());
    }
    if bytes.starts_with(&[0xFE, 0xFF]) {
        let (decoded, _) = encoding_rs::UTF_16BE.decode_without_bom_handling(&bytes);
        return Ok(decoded.into_owned());
    }
    // 3. UTF-8 decode
    let (decoded_utf8, _, malformed_utf8) = encoding_rs::UTF_8.decode(&bytes);
    if !malformed_utf8 {
        return Ok(decoded_utf8.into_owned());
    }

    // 3a. Distinguish genuine Windows-1256 Persian/Arabic files (where occasional
    // high-byte pairs like `[0xC7, 0xA1]` happen to form valid 2-byte UTF-8, while
    // most non-ASCII bytes fail UTF-8 decoding) from mostly-valid corrupted UTF-8.
    let mut valid_multibyte_utf8 = 0usize;
    let mut fffd_count = 0usize;
    for c in decoded_utf8.chars() {
        if c == '\u{FFFD}' {
            fffd_count += 1;
        } else if c > '\u{7F}' {
            valid_multibyte_utf8 += 1;
        }
    }

    if is_likely_windows_1256(&bytes) && fffd_count > valid_multibyte_utf8 {
        let (decoded_1256, _, _) = encoding_rs::WINDOWS_1256.decode(&bytes);
        return Ok(decoded_1256.into_owned());
    }

    // 3b. Preserve mostly-valid corrupted UTF-8 (where valid multi-byte UTF-8
    // characters are at least as frequent as U+FFFD replacement characters)
    // rather than ruining it into Windows-1252 mojibake. Conversely, if a file
    // has more replacement characters than accidental 2-byte UTF-8 pairs (e.g.
    // German/French Windows-1252 sequences like `ß…` [0xDF, 0x85] or `É…`
    // [0xC9, 0x85]), fall through to Windows-1252 below.
    if valid_multibyte_utf8 > 0 && valid_multibyte_utf8 >= fffd_count {
        return Ok(decoded_utf8.into_owned());
    }

    // 4. Legacy single-byte subtitle encodings: Windows-1252 / Latin-1 fallback
    // (reached when `valid_multibyte_utf8 < fffd_count`, so Windows-1256 was
    // already handled in step 3a and single-byte European files recover cleanly).
    let (decoded_1252, _, _) = encoding_rs::WINDOWS_1252.decode(&bytes);
    Ok(decoded_1252.into_owned())
}

/// Builds the final request URL from provider settings. Shared by
/// `translate_files` and `preview_translate` so both paths cannot drift apart.
fn build_request_url(
    api_format: ApiFormat,
    base_url: &str,
    model: &str,
) -> String {
    let trimmed = base_url.trim();
    let base_no_frag = trimmed.split('#').next().unwrap_or(trimmed);
    let (path_part, query_part) = match base_no_frag.split_once('?') {
        Some((p, q)) => (p.trim_end_matches('/'), Some(q)),
        None => (base_no_frag.trim_end_matches('/'), None),
    };

    let endpoint = match api_format {
        ApiFormat::AnthropicMessages => {
            if path_part.ends_with("/messages") {
                path_part.to_string()
            } else if path_part.ends_with("/v1") {
                format!("{}/messages", path_part)
            } else {
                format!("{}/v1/messages", path_part)
            }
        }
        ApiFormat::GeminiResponses => {
            let trimmed_model = model.trim();
            let clean_model = trimmed_model.strip_prefix("models/").unwrap_or(trimmed_model);
            if path_part.contains(":generateContent") {
                path_part.to_string()
            } else if path_part.ends_with("/models") {
                format!("{}/{}:generateContent", path_part, clean_model)
            } else if path_part.contains("/models/") {
                format!("{}:generateContent", path_part)
            } else if path_part.ends_with("/v1beta") || path_part.ends_with("/v1") {
                format!("{}/models/{}:generateContent", path_part, clean_model)
            } else {
                format!("{}/v1beta/models/{}:generateContent", path_part, clean_model)
            }
        }
        ApiFormat::OpenAiCompatible => {
            if path_part.ends_with("/chat/completions") {
                path_part.to_string()
            } else {
                format!("{}/chat/completions", path_part)
            }
        }
    };

    match query_part {
        Some(q) if !q.is_empty() => format!("{}?{}", endpoint, q),
        _ => endpoint,
    }
}

/// Applies auth headers across all formats (including `x-goog-api-key` for Gemini).
fn apply_auth_headers(
    req: reqwest::RequestBuilder,
    api_format: ApiFormat,
    api_key: &str,
) -> reqwest::RequestBuilder {
    let api_key = api_key.trim();
    match api_format {
        ApiFormat::AnthropicMessages => {
            let req = if !api_key.is_empty() {
                req.header("x-api-key", api_key)
            } else {
                req
            };
            req.header("anthropic-version", ANTHROPIC_VERSION)
        }
        ApiFormat::OpenAiCompatible => {
            if !api_key.is_empty() {
                req.bearer_auth(api_key)
            } else {
                req
            }
        }
        ApiFormat::GeminiResponses => {
            if !api_key.is_empty() {
                req.header("x-goog-api-key", api_key)
            } else {
                req
            }
        }
    }
}

fn build_http_client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .connect_timeout(std::time::Duration::from_secs(CONNECT_TIMEOUT_SECS))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new())
}

/// Polls the cancel flag directly: it is stateful and never lost, so a cancel
/// is honoured within ~50ms without relying on a one-shot `Notify`.
async fn cancellation_poller(session: Arc<Mutex<crate::TranscriptionSession>>) {
    loop {
        if is_cancelled(&session) {
            return;
        }
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
}

enum ChunkOutcome {
    /// Parsed translations (possibly partial — missing lines are the
    /// caller's signal of protocol violations / truncation).
    Translated(HashMap<usize, String>),
    /// The API refused the request because it exceeded the model's context.
    /// Carries the exact limit when one could be parsed from the error text.
    ContextLimitExceeded(Option<usize>),
    /// The API rejected `max_tokens` as larger than the model's output cap
    /// (Anthropic rejects instead of truncating). Carries the exact cap when
    /// parseable so it can be persisted per-model and never retried wrong.
    OutputCapExceeded(Option<u32>),
}

enum NonSuccessAction {
    Outcome(ChunkOutcome),
    NegotiateRetry(&'static str),
    CheckTransientOrFail,
}

fn classify_non_success_error(
    api_format: ApiFormat,
    status_code: u16,
    err_text: &str,
    options: &mut crate::translation::provider::RequestOptions,
) -> NonSuccessAction {
    // Only client payload/limit errors (400 / 413 / 422) may trigger reactive
    // output-cap, context-window shrinking, or parameter negotiation.
    // Rate limits (429), auth errors (401/403), and server errors (5xx) must
    // never shrink and persist the model's context_window.
    if !matches!(status_code, 400 | 413 | 422) {
        return NonSuccessAction::CheckTransientOrFail;
    }

    // 1. Reactive output-cap recovery: check BEFORE context-limit and generic
    // parameter negotiation so Anthropic/OpenAI 400s like
    // "max_tokens: 16384 exceeds the maximum of 8192" or
    // "invalid_request_error: max_tokens: 100000 > 64000 (maximum allowed)"
    // are learned and persisted as output caps rather than context limits.
    if status_code == 400 && options.max_output_tokens.is_some() {
        if let Some(cap) = parse_output_cap_from_error(err_text) {
            return NonSuccessAction::Outcome(ChunkOutcome::OutputCapExceeded(Some(cap)));
        }
        if is_max_tokens_error(err_text) {
            return NonSuccessAction::Outcome(ChunkOutcome::OutputCapExceeded(None));
        }
    }

    // 2. Reactive context-limit recovery: report back so the caller can shrink
    // the window and re-chunk.
    if let Some(exact) = parse_context_limit_from_error(err_text) {
        return NonSuccessAction::Outcome(ChunkOutcome::ContextLimitExceeded(Some(exact)));
    }
    if is_context_length_error(err_text) {
        return NonSuccessAction::Outcome(ChunkOutcome::ContextLimitExceeded(None));
    }
    if status_code == 413 && !is_rate_limit_or_quota_error(&err_text.to_lowercase()) {
        return NonSuccessAction::Outcome(ChunkOutcome::ContextLimitExceeded(None));
    }

    // 3. Universal Parameter Negotiation: If the API rejected a parameter,
    // adapt options in-place and retry immediately.
    if status_code == 400 || status_code == 422 {
        if let Some(msg) = negotiate_parameter_error_step(api_format, err_text, options) {
            return NonSuccessAction::NegotiateRetry(msg);
        }
    }

    NonSuccessAction::CheckTransientOrFail
}

fn resolve_next_context_shrink(
    current_window: usize,
    current_chunk_len: usize,
    current_max_items: usize,
    parsed_exact: Option<usize>,
) -> Result<(usize, usize, Option<usize>), String> {
    let persist_window = parsed_exact.filter(|&limit| limit >= 1024 && limit < current_window);
    let next_window = persist_window.unwrap_or(current_window);
    if current_chunk_len <= 1 {
        return Err(format!(
            "Model context window ({}) is too small to translate even a single dialogue line.",
            parsed_exact.unwrap_or(current_window)
        ));
    }
    let next_max_items = (current_chunk_len / 2)
        .max(1)
        .min(current_max_items.saturating_sub(1).max(1));
    Ok((next_window, next_max_items, persist_window))
}

fn finalize_empty_translation_error(skipped_reasons: &[String]) -> Option<String> {
    if skipped_reasons.is_empty() {
        None
    } else {
        Some(skipped_reasons.join("; "))
    }
}

fn extract_translatable_entries(parsed: &ParsedSubtitle) -> Vec<(usize, String)> {
    parsed
        .cues
        .iter()
        .filter(|c| !c.text.trim().is_empty())
        .map(|c| (c.index, c.text.clone()))
        .collect()
}

fn ensure_output_dir_writable(dir: &Path) -> Result<(), String> {
    fs::create_dir_all(dir)
        .map_err(|e| format!("Failed to create output directory '{}': {}", dir.display(), e))?;
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let probe_path = dir.join(format!(
        ".whisper_translate_perm_{}_{}",
        std::process::id(),
        nanos
    ));
    fs::write(&probe_path, b"ok")
        .map_err(|e| format!("Output directory '{}' is not writable: {}", dir.display(), e))?;
    let _ = fs::remove_file(&probe_path);
    Ok(())
}

fn write_output_file_atomic(path: &Path, content: &str) -> Result<(), String> {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let tmp_path = path.with_file_name({
        let mut name = path.file_name().unwrap_or_default().to_os_string();
        name.push(format!(".tmp.{}_{}", std::process::id(), nanos));
        name
    });
    fs::write(&tmp_path, content)
        .map_err(|e| format!("Failed to write temp translated file {}: {}", tmp_path.display(), e))?;
    match crate::settings::atomic_replace_file(&tmp_path, path) {
        Ok(()) => Ok(()),
        Err(e) => {
            let _ = fs::remove_file(&tmp_path);
            Err(format!("Failed to write output translated file {}: {}", path.display(), e))
        }
    }
}

/// Sends one chunk to the LLM with transport-level retries, cancellation
/// racing, and reactive context-limit / output-cap / parameter negotiation detection.
#[allow(clippy::too_many_arguments)]
async fn translate_chunk(
    app: &AppHandle,
    session: Arc<Mutex<crate::TranscriptionSession>>,
    client: &reqwest::Client,
    provider: &AiProvider,
    api_format: ApiFormat,
    api_key: &str,
    model: &str,
    system_prompt: &str,
    user_content: &str,
    chunk: &[(usize, String)],
    last_progress: f64,
    max_output_override: Option<u32>,
    options: &mut crate::translation::provider::RequestOptions,
    allow_positional_fallback: bool,
    logs: &AppLogs,
) -> Result<ChunkOutcome, String> {
    if api_format == ApiFormat::AnthropicMessages {
        options.max_output_tokens = Some(estimate_max_output_tokens(
            system_prompt.len() + user_content.len(),
            max_output_override,
        ));
    }
    let request_url = build_request_url(api_format, &provider.base_url, model);

    let mut attempt: u32 = 0;
    loop {
        let request_body = provider
            .format_request_body_ext(model, system_prompt, user_content, options)?;

        let req = apply_auth_headers(
            client.post(&request_url).json(&request_body),
            api_format,
            api_key,
        );

        let res = tokio::select! {
            biased;
            _ = cancellation_poller(session.clone()) => {
                emit_cancelled(app, last_progress);
                return Err(TRANSLATION_CANCELLED_MSG.to_string());
            }
            res = req.send() => res,
        };

        let res = match res {
            Ok(r) => r,
            Err(e) => {
                let err_msg = sanitize_reqwest_error(e);
                if attempt < MAX_TRANSIENT_RETRIES {
                    attempt += 1;
                    logs.log(app, "Translate", &format!("Network error ({}), retry {}/{} in {}s", err_msg, attempt, MAX_TRANSIENT_RETRIES, attempt));
                    tokio::select! {
                        biased;
                        _ = cancellation_poller(session.clone()) => {
                            emit_cancelled(app, last_progress);
                            return Err(TRANSLATION_CANCELLED_MSG.to_string());
                        }
                        _ = tokio::time::sleep(std::time::Duration::from_secs(attempt as u64)) => {}
                    }
                    continue;
                }
                return Err(format!("HTTP request to {} failed: {}", provider.name, err_msg));
            }
        };

        if !res.status().is_success() {
            let status = res.status();
            // Read before `text()` consumes the response.
            let retry_after_hdr = res
                .headers()
                .get(reqwest::header::RETRY_AFTER)
                .and_then(|v| v.to_str().ok())
                .and_then(|s| s.trim().parse::<u64>().ok())
                .map(|s| s.min(RETRY_AFTER_CAP_SECS));
            let err_text = tokio::select! {
                biased;
                _ = cancellation_poller(session.clone()) => {
                    emit_cancelled(app, last_progress);
                    return Err(TRANSLATION_CANCELLED_MSG.to_string());
                }
                text_res = res.text() => text_res.unwrap_or_default(),
            };

            match classify_non_success_error(api_format, status.as_u16(), &err_text, options) {
                NonSuccessAction::Outcome(outcome) => {
                    match &outcome {
                        ChunkOutcome::ContextLimitExceeded(Some(exact)) => {
                            logs.log(app, "Translate", &format!("Context limit hit; API reported exact window: {} tokens", exact));
                        }
                        ChunkOutcome::ContextLimitExceeded(None) => {
                            logs.log(app, "Translate", "Context limit hit; no exact number in error, will halve the window");
                        }
                        ChunkOutcome::OutputCapExceeded(Some(cap)) => {
                            logs.log(app, "Translate", &format!("max_tokens rejected; learned exact output cap: {} tokens", cap));
                        }
                        ChunkOutcome::OutputCapExceeded(None) => {
                            logs.log(app, "Translate", "max_tokens rejected; no exact number in error, will halve the cap");
                        }
                        ChunkOutcome::Translated(_) => {}
                    }
                    return Ok(outcome);
                }
                NonSuccessAction::NegotiateRetry(msg) => {
                    logs.log(app, "Translate", msg);
                    continue;
                }
                NonSuccessAction::CheckTransientOrFail => {}
            }

            // 4. Transient server-side failures are worth another try. When the
            // API sends `Retry-After` we honour it (bounded) instead of
            // guessing; otherwise linear backoff.
            if (status.as_u16() == 429 || status.is_server_error())
                && attempt < MAX_TRANSIENT_RETRIES
            {
                attempt += 1;
                let delay = retry_after_hdr.unwrap_or(attempt as u64);
                logs.log(app, "Translate", &format!("Transient HTTP {} — retry {}/{} in {}s{}", status, attempt, MAX_TRANSIENT_RETRIES, delay,
                    if retry_after_hdr.is_some() { " (Retry-After)" } else { "" }));
                tokio::select! {
                    biased;
                    _ = cancellation_poller(session.clone()) => {
                        emit_cancelled(app, last_progress);
                        return Err(TRANSLATION_CANCELLED_MSG.to_string());
                    }
                    _ = tokio::time::sleep(std::time::Duration::from_secs(delay)) => {}
                }
                continue;
            }

            return Err(format!(
                "API returned error status ({}): {}",
                status,
                redact_url_secrets(&safe_truncate(&err_text, 600))
            ));
        }

        let res_json: Value = tokio::select! {
            biased;
            _ = cancellation_poller(session.clone()) => {
                emit_cancelled(app, last_progress);
                return Err(TRANSLATION_CANCELLED_MSG.to_string());
            }
            json_res = res.json() => json_res.map_err(|e| format!("Failed to parse response JSON: {}", sanitize_reqwest_error(e)))?,
        };

        let response_text = parse_response_content(api_format, &res_json)?;
        return Ok(ChunkOutcome::Translated(align_translations(
            chunk,
            &response_text,
            allow_positional_fallback,
        )));
    }
}

/// Core function to execute translation on a file list.
#[allow(clippy::too_many_arguments)]
pub async fn translate_files(
    app: AppHandle,
    session: Arc<Mutex<crate::TranscriptionSession>>,
    logs: Arc<AppLogs>,
    settings: WhisperSettings,
    generated_files: Vec<String>,
    parent_dir: String,
    output_dir: Option<String>,
) -> Result<Vec<String>, String> {
    if !settings.translate_ai_enabled || generated_files.is_empty() {
        return Ok(Vec::new());
    }

    let target_dir = match output_dir {
        Some(ref dir) if !dir.trim().is_empty() => dir.trim().to_string(),
        _ => parent_dir.clone(),
    };

    let model_id = settings.translate_ai_model.trim();
    if model_id.is_empty() {
        return Err("No active translation model is selected. Please configure and select a model under your active provider first.".to_string());
    }

    // Deserialize providers list to find the active one
    let providers_list: Vec<AiProvider> = serde_json::from_str(&settings.translate_ai_providers)
        .map_err(|e| format!("Failed to parse translation providers: {}", e))?;

    let provider = providers_list
        .iter()
        .find(|p| p.name == settings.translate_ai_provider)
        .ok_or_else(|| {
            format!(
                "Active provider '{}' not found in config.",
                settings.translate_ai_provider
            )
        })?;

    crate::translation::validate_provider_base_url(&provider.base_url)?;

    // Validate the wire protocol ONCE, up front: an unknown format string is
    // a configuration error and must fail loudly instead of silently
    // degrading to the OpenAI-compatible request shape.
    let api_format = ApiFormat::parse(&provider.api_format)?;

    // Mark the session as translating and install a guard BEFORE blocking on
    // the OS keyring so a cancel request during a keyring prompt is honoured
    // immediately instead of failing with "No active transcription or translation session".
    let mut session_busy = false;
    with_session(&session, |s| {
        if s.phase != crate::SessionPhase::Idle {
            session_busy = true;
        } else {
            s.phase = crate::SessionPhase::Translating;
            s.cancel_requested = false;
        }
    });
    if session_busy {
        return Err(
            "Another transcription or translation task is already active. Wait for it to finish or cancel it first."
                .to_string(),
        );
    }
    let _guard = TranslationSessionGuard {
        session: session.clone(),
    };

    ensure_output_dir_writable(Path::new(&target_dir))?;

    // Fetch API Key (Keyring or plaintext) raced against cancellation.
    let api_key = if provider.use_keyring {
        let pname = provider.name.clone();
        let keyring_fut = tokio::task::spawn_blocking(move || get_keyring_key(&pname));
        tokio::select! {
            biased;
            _ = cancellation_poller(session.clone()) => {
                emit_cancelled(&app, 0.0);
                return Err(TRANSLATION_CANCELLED_MSG.to_string());
            }
            res = keyring_fut => {
                res.map_err(|e| format!("Keyring task failed: {}", e))?
                    .map_err(|e| format!("Could not retrieve key from system keyring: {}", e))?
            }
        }
    } else {
        provider.api_key.clone()
    };

    // Check if model exists and get its limits. These mutable copies live
    // OUTSIDE the file loop so reactively-discovered limits propagate to
    // subsequent files instead of being re-learned per file.
    let active_model = provider
        .models
        .iter()
        .find(|m| m.id == model_id);
    let mut context_window = active_model
        .map(|m| m.context_window)
        .filter(|&w| w > 0)
        .unwrap_or(DEFAULT_CONTEXT_TOKENS);
    // Per-model output cap: user-configured or learned from a prior 400.
    // `None` = auto mode (conservative default, reactive discovery).
    let mut max_output_override = active_model.and_then(|m| m.max_output_tokens).filter(|&t| t >= MIN_OUTPUT_TOKENS);

    let mut request_options = build_initial_request_options(
        api_format,
        active_model,
        0,
        settings.translate_ai_temperature,
    );
    let effective_custom_prompt = resolve_effective_custom_prompt(
        &settings.translate_ai_custom_prompt,
        &provider.custom_prompt,
    );
    let system_prompt = build_system_prompt(
        effective_custom_prompt,
        &settings.translate_ai_target_lang,
        settings.translate_ai_polish,
    );

    let lang_code = get_language_code(&settings.translate_ai_target_lang);
    let mut successfully_translated = Vec::new();
    let mut skipped_reasons: Vec<String> = Vec::new();

    let mut status_guard = TranslationStatusGuard::new(app.clone());
    if !generated_files.is_empty() {
        emit_status(&app, 0.0, "Translating with AI…", true, None);
        logs.log(&app, "Translate", &format!(
            "Starting AI translation of {} file(s) → '{}' via '{}' (model: {}, ctx: {} tokens, max_output: {})",
            generated_files.len(),
            settings.translate_ai_target_lang,
            provider.name,
            model_id,
            context_window,
            match max_output_override { Some(t) => t.to_string(), None => "auto".to_string() }
        ));
    } else {
        status_guard.disarm();
    }

    let client = build_http_client();
    let mut last_progress = 0.0_f64;
    let mut last_extras: ProgressExtras = None;

    for (file_idx, file_name) in generated_files.iter().enumerate() {
        // Honour a cancel request between files.
        if is_cancelled(&session) {
            status_guard.disarm();
            emit_cancelled(&app, last_progress);
            return Err(TRANSLATION_CANCELLED_MSG.to_string());
        }

        let input_path = Path::new(&parent_dir).join(file_name);
        if !input_path.exists() {
            logs.log(&app, "Translate", &format!("Skipped '{}': file not found", file_name));
            skipped_reasons.push(format!("Source subtitle file not found: '{}'", file_name));
            continue;
        }

        let ext = match input_path.extension().and_then(|s| s.to_str()) {
            Some(e) => e.to_lowercase(),
            None => {
                logs.log(&app, "Translate", &format!("Skipped '{}': no extension", file_name));
                skipped_reasons.push(format!("Unsupported subtitle format for '{}'", file_name));
                continue;
            }
        };

        if ext != "srt" && ext != "vtt" && ext != "lrc" && ext != "txt" {
            logs.log(&app, "Translate", &format!("Skipped '.{}': unsupported subtitle format", ext));
            skipped_reasons.push(format!("Unsupported subtitle format for '{}'", file_name));
            continue;
        }

        // Output file path: e.g. "movie.fa.srt"
        let base_stem = input_path.file_stem().unwrap_or_default().to_string_lossy();
        let output_file_name = format!("{}.{}.{}", base_stem, lang_code, ext);
        let output_path = Path::new(&target_dir).join(&output_file_name);

        let content = read_subtitle_string(&input_path)?;

        let parsed = ParsedSubtitle::parse(&content, &ext);

        // Extract non-empty dialogue entries (1-based index, text)
        let original_entries = extract_translatable_entries(&parsed);

        if original_entries.is_empty() {
            // Empty dialogues, just clone the file atomically
            write_output_file_atomic(&output_path, &content)?;
            successfully_translated.push(output_file_name);
            continue;
        }

        let total_lines = original_entries.len();
        let mut translations_map = HashMap::new();
        let mut remaining_entries = original_entries.clone();

        // ---- Resume from checkpoint (crash / power loss / disconnect / cancel) ----
        // A valid checkpoint for this exact source+target restores every line
        // already translated in a previous run, so work is never repeated.
        let mut resumed_lines: usize = 0;
        let loaded_ckpt = crate::translation::checkpoint::load(
            Path::new(&target_dir),
            &output_file_name,
            file_name,
            &lang_code,
            &ext,
            &settings.translate_ai_provider,
            model_id,
            &system_prompt,
            &content,
        ).or_else(|| {
            if target_dir != parent_dir {
                crate::translation::checkpoint::load(
                    Path::new(&parent_dir),
                    &output_file_name,
                    file_name,
                    &lang_code,
                    &ext,
                    &settings.translate_ai_provider,
                    model_id,
                    &system_prompt,
                    &content,
                )
            } else {
                None
            }
        });
        if let Some(ckpt) = loaded_ckpt {
            let restored = ckpt.translations.len();
            translations_map.extend(ckpt.translations);
            remaining_entries.retain(|(idx, _)| !translations_map.contains_key(idx));
            resumed_lines = translations_map.len().min(total_lines);
            logs.log(&app, "Translate", &format!(
                "Resuming '{}': restored {} line(s) from checkpoint, {} remaining",
                file_name, restored, remaining_entries.len()
            ));
        }

        let total_files = generated_files.len();
        let initial_progress =
            compute_progress(file_idx, total_files, translations_map.len(), total_lines);

        let initial_msg = if resumed_lines > 0 {
            // Make resumption visible so users trust it actually skipped work.
            if total_files > 1 {
                format!(
                    "Resuming translation [{}/{}]: {}/{} lines already done ({})",
                    file_idx + 1,
                    total_files,
                    resumed_lines,
                    total_lines,
                    file_name
                )
            } else {
                format!(
                    "Resuming translation: {}/{} lines already done ({})",
                    resumed_lines, total_lines, file_name
                )
            }
        } else if total_files > 1 {
            format!(
                "Translating AI [{}/{}]: 0/{} lines ({})",
                file_idx + 1,
                total_files,
                total_lines,
                file_name
            )
        } else {
            format!("Translating AI: 0/{} lines ({})", total_lines, file_name)
        };
        let initial_extras = Some((
            translations_map.len(),
            total_lines,
            file_idx + 1,
            total_files,
        ));
        emit_status(
            &app,
            initial_progress,
            &initial_msg,
            true,
            initial_extras,
        );
        last_extras = initial_extras;
        last_progress = initial_progress;
        status_guard.set_progress(last_progress);

        let mut stall_rounds: usize = 0;
        let mut is_first_resumed_chunk = resumed_lines > 0;
        let initial_batch_cap = resolve_batch_size_cap(settings.translate_ai_batch_size);
        let mut effective_max_items: usize = initial_batch_cap;

        'chunk_loop: while !remaining_entries.is_empty() {
            // Honour a cancel request between chunks.
            if is_cancelled(&session) {
                status_guard.disarm();
                emit_cancelled(&app, last_progress);
                return Err(TRANSLATION_CANCELLED_MSG.to_string());
            }

            let chunks = chunk_dialogues_with_cap(&remaining_entries, context_window, effective_max_items);
            let Some(chunk) = chunks.into_iter().next() else {
                break;
            };

            if is_first_resumed_chunk {
                is_first_resumed_chunk = false;
            } else {
                // Emit current in-flight chunk status
                let current_translated_lines = translations_map.len();
                let global_progress =
                    compute_progress(file_idx, total_files, current_translated_lines, total_lines);

                let msg = if total_files > 1 {
                    format!(
                        "Translating AI [{}/{}]: {}/{} lines ({})",
                        file_idx + 1,
                        total_files,
                        current_translated_lines,
                        total_lines,
                        file_name
                    )
                } else {
                    format!(
                        "Translating AI: {}/{} lines ({})",
                        current_translated_lines, total_lines, file_name
                    )
                };
                let chunk_extras = Some((
                    current_translated_lines,
                    total_lines,
                    file_idx + 1,
                    total_files,
                ));
                emit_status(
                    &app,
                    global_progress,
                    &msg,
                    true,
                    chunk_extras,
                );
                last_extras = chunk_extras;
                last_progress = global_progress;
                status_guard.set_progress(last_progress);
            }

            // Previous context (up to 3 preceding lines) for narrative continuity.
            // Prefer our own translations when available so the model sees the
            // terminology it already chose.
            let first_chunk_idx = chunk.first().map(|(idx, _)| *idx).unwrap_or(1);
            let context_lines: Vec<String> = if first_chunk_idx > 1 {
                original_entries
                    .iter()
                    .filter(|(idx, _)| {
                        *idx < first_chunk_idx && *idx >= first_chunk_idx.saturating_sub(3)
                    })
                    .map(|(idx, orig_text)| {
                        let trans_text = translations_map
                            .get(idx)
                            .cloned()
                            .unwrap_or_else(|| orig_text.clone());
                        format!("{}: {}", idx, trans_text)
                    })
                    .collect()
            } else {
                Vec::new()
            };

            let mut user_content = String::new();
            if !context_lines.is_empty() {
                user_content.push_str(
                    "[Previous Context for Continuity - DO NOT translate or output these lines]:\n",
                );
                user_content.push_str(&context_lines.join("\n"));
                user_content.push_str("\n\n[Lines to Translate]:\n");
            }
            user_content.push_str(
                &chunk
                    .iter()
                    .map(|(idx, text)| format!("{}: {}", idx, text))
                    .collect::<Vec<String>>()
                    .join("\n"),
            );

            let outcome = match translate_chunk(
                &app,
                session.clone(),
                &client,
                provider,
                api_format,
                &api_key,
                model_id,
                &system_prompt,
                &user_content,
                &chunk,
                last_progress,
                max_output_override,
                &mut request_options,
                // The positional rescue is gated: it may only fire after a
                // numbered-protocol round already failed (stall_rounds > 0),
                // so a sloppy model gets its fair retry first and the
                // order-preserving fallback never masks round-one violations.
                stall_rounds >= 1,
                &logs,
            )
            .await
            {
                Ok(o) => o,
                Err(e) => {
                    if e == TRANSLATION_CANCELLED_MSG {
                        status_guard.disarm();
                    }
                    return Err(e);
                }
            };

            match outcome {
                ChunkOutcome::ContextLimitExceeded(parsed_exact) => {
                    // Shrink chunk item cap monotonically so identical chunks are never
                    // retried, even when the window hits MIN_USABLE_TOKENS or on 413s.
                    // Only persist context_window when the API reported an exact limit.
                    let (new_window, new_max_items, persist_window) = resolve_next_context_shrink(
                        context_window,
                        chunk.len(),
                        effective_max_items,
                        parsed_exact,
                    )?;
                    context_window = new_window;
                    effective_max_items = new_max_items;
                    if let Some(persisted_limit) = persist_window {
                        if let Ok(Some(updated_providers)) = update_model_limits(
                            &settings.translate_ai_provider,
                            model_id,
                            Some(persisted_limit),
                            None,
                        ) {
                            let _ = app.emit(
                                "translation-model-limits-updated",
                                serde_json::json!({
                                    "provider": settings.translate_ai_provider,
                                    "model": model_id,
                                    "contextWindow": persisted_limit,
                                    "maxOutputTokens": serde_json::Value::Null,
                                    "translateAiProviders": updated_providers,
                                }),
                            );
                        }
                    }
                    continue 'chunk_loop;
                }
                ChunkOutcome::OutputCapExceeded(exact_cap) => {
                    // Anthropic rejected max_tokens as too large. Use the
                    // exact cap when the error named it, otherwise halve —
                    // then persist so future runs start correct.
                    let new_cap = resolve_next_output_cap(
                        max_output_override,
                        request_options.max_output_tokens,
                        exact_cap,
                    )?;
                    max_output_override = Some(new_cap);
                    if let Ok(Some(updated_providers)) = update_model_limits(
                        &settings.translate_ai_provider,
                        model_id,
                        None,
                        Some(new_cap),
                    ) {
                        let _ = app.emit(
                            "translation-model-limits-updated",
                            serde_json::json!({
                                "provider": settings.translate_ai_provider,
                                "model": model_id,
                                "contextWindow": serde_json::Value::Null,
                                "maxOutputTokens": new_cap,
                                "translateAiProviders": updated_providers,
                            }),
                        );
                    }
                    continue 'chunk_loop;
                }
                ChunkOutcome::Translated(chunk_translations) => {
                    let before = translations_map.len();
                    translations_map.extend(chunk_translations);
                    remaining_entries.retain(|(idx, _)| !translations_map.contains_key(idx));

                    // Stall detection: a chunk that yields zero parseable
                    // translations means the model ignored the numbered
                    // protocol. Retry a couple of times, then fail loudly
                    // instead of writing untranslated originals.
                    if translations_map.len() == before {
                        stall_rounds += 1;
                        if stall_rounds >= MAX_STALL_ROUNDS {
                            let sample: Vec<String> = remaining_entries
                                .iter()
                                .take(3)
                                .map(|(idx, _)| idx.to_string())
                                .collect();
                            logs.log(&app, "Translate", &format!(
                                "Aborting '{}': model ignored the numbered format for {} consecutive rounds (pending lines: {})",
                                file_name, stall_rounds, remaining_entries.len()
                            ));
                            return Err(format!(
                                "The model repeatedly failed to follow the numbered translation format (no progress on pending lines {}). Check the model's instruction-following or try a different model.",
                                sample.join(", ")
                            ));
                        }
                    } else {
                        stall_rounds = 0;

                        // Persist progress so a crash / power cut / dropped
                        // connection never repeats already-paid API work.
                        // Best-effort: a failed write only costs a re-run.
                        let ckpt = crate::translation::checkpoint::TranslationCheckpoint::new(
                            file_name,
                            &lang_code,
                            &ext,
                            &settings.translate_ai_provider,
                            model_id,
                            &system_prompt,
                            &content,
                            translations_map.clone(),
                        );
                        if let Err(e) = crate::translation::checkpoint::save(
                            Path::new(&target_dir),
                            &output_file_name,
                            &ckpt,
                        ) {
                            logs.log(&app, "Translate", &format!(
                                "Warning: checkpoint save failed for '{}' ({}). A crash would repeat this chunk's work.",
                                output_file_name, e
                            ));
                        }
                    }

                    // Emit real-time progress event for completed chunk
                    let current_translated_lines = translations_map.len();
                    let global_progress =
                        compute_progress(file_idx, total_files, current_translated_lines, total_lines);

                    let msg = if total_files > 1 {
                        format!(
                            "Translating AI [{}/{}]: {}/{} lines ({})",
                            file_idx + 1,
                            total_files,
                            current_translated_lines,
                            total_lines,
                            file_name
                        )
                    } else {
                        format!(
                            "Translating AI: {}/{} lines ({})",
                            current_translated_lines, total_lines, file_name
                        )
                    };
                    let chunk_extras = Some((
                        current_translated_lines,
                        total_lines,
                        file_idx + 1,
                        total_files,
                    ));
                    emit_status(
                        &app,
                        global_progress,
                        &msg,
                        true,
                        chunk_extras,
                    );
                    last_extras = chunk_extras;
                    last_progress = global_progress;
                    status_guard.set_progress(last_progress);
                }
            }
        }

        // Check cancellation before writing the file to prevent completing
        // even when the in-flight poll missed the flag (e.g. fast API response).
        if is_cancelled(&session) {
            status_guard.disarm();
            emit_cancelled(&app, last_progress);
            return Err(TRANSLATION_CANCELLED_MSG.to_string());
        }

        // Reconstruct and save atomically
        let reconstructed = parsed.reconstruct(&translations_map);
        write_output_file_atomic(&output_path, &reconstructed)?;

        // File is fully written: the checkpoint has served its purpose.
        crate::translation::checkpoint::remove(Path::new(&target_dir), &output_file_name);
        if target_dir != parent_dir {
            crate::translation::checkpoint::remove(Path::new(&parent_dir), &output_file_name);
        }

        successfully_translated.push(output_file_name);
    }

    // Terminal event is UNCONDITIONAL: even when every file was skipped
    // (missing / unsupported extension) the frontend must be released from
    // its active state instead of waiting on an event that never arrives.
    if successfully_translated.is_empty() {
        if let Some(err_msg) = finalize_empty_translation_error(&skipped_reasons) {
            logs.log(&app, "Translate", &format!("Failed: {}", err_msg));
            return Err(err_msg);
        }
        status_guard.disarm();
        emit_status(&app, 1.0, "Nothing to translate", false, None);
        logs.log(&app, "Translate", "Finished: no file produced a translation");
    } else {
        status_guard.disarm();
        let final_extras = last_extras.map(|(_, total_lines, file_idx, total_files)| {
            (total_lines, total_lines, file_idx, total_files)
        });
        emit_status(&app, 1.0, "AI translation complete", false, final_extras);
        logs.log(&app, "Translate", &format!(
            "Finished: {} file(s) translated successfully",
            successfully_translated.len()
        ));
    }

    Ok(successfully_translated)
}

/// Pure progress math shared by all emission sites so it can be unit-tested.
/// Each file owns an equal slice of [0,1]; within a file, progress scales
/// with completed lines. Returns a value in [0, 1]; division-by-zero safe.
fn compute_progress(file_idx: usize, total_files: usize, done_lines: usize, total_lines: usize) -> f64 {
    if total_files == 0 || total_lines == 0 {
        return 0.0;
    }
    let file_weight = 1.0 / total_files as f64;
    let line_ratio = (done_lines.min(total_lines) as f64) / (total_lines as f64);
    ((file_idx as f64 * file_weight) + (line_ratio * file_weight)).clamp(0.0, 1.0)
}

/// Translates first 3 lines for testing/preview. Strict mode: unlike the main
#[derive(serde::Serialize, serde::Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct PreviewLine {
    pub index: usize,
    pub original: String,
    pub translated: String,
    pub is_fallback: bool,
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CheckpointInfo {
    pub translated_lines: usize,
    pub total_lines: usize,
}

pub(crate) fn resolve_effective_custom_prompt<'a>(
    override_prompt: &'a str,
    provider_prompt: &'a str,
) -> &'a str {
    let trimmed_override = override_prompt.trim();
    if !trimmed_override.is_empty() {
        trimmed_override
    } else {
        provider_prompt.trim()
    }
}

pub(crate) fn resolve_batch_size_cap(batch_size: i32) -> usize {
    if batch_size <= 0 {
        MAX_ITEMS_PER_CHUNK
    } else {
        (batch_size as usize).clamp(1, MAX_ITEMS_PER_CHUNK)
    }
}

pub(crate) fn normalize_translation_temperature(temp: f64) -> f64 {
    if temp.is_finite() {
        ((temp * 100.0).round() / 100.0).clamp(0.0, 2.0)
    } else {
        0.3
    }
}

struct CheckpointLookupContext {
    parent_dir: String,
    target_dir: String,
    file_name: String,
    output_file_name: String,
    lang_code: String,
    ext: String,
    model_id: String,
    system_prompt: String,
    content: String,
    total_lines: usize,
}

fn build_checkpoint_lookup_context(
    settings: &WhisperSettings,
    subtitle_path: &str,
    output_dir: Option<&str>,
) -> Option<CheckpointLookupContext> {
    let clean_sub = subtitle_path.trim();
    if clean_sub.is_empty() {
        return None;
    }
    let path = Path::new(clean_sub);
    if !path.exists() {
        return None;
    }
    let parent_dir = path.parent()?.to_string_lossy().to_string();
    let file_name = path.file_name()?.to_string_lossy().to_string();
    let ext = path.extension()?.to_str()?.to_lowercase();
    if ext != "srt" && ext != "vtt" && ext != "lrc" && ext != "txt" {
        return None;
    }
    let model_id = settings.translate_ai_model.trim();
    if model_id.is_empty() || settings.translate_ai_provider.trim().is_empty() {
        return None;
    }

    let providers_list: Vec<AiProvider> = serde_json::from_str(&settings.translate_ai_providers).ok()?;
    let provider = providers_list
        .iter()
        .find(|p| p.name == settings.translate_ai_provider)?;

    let effective_prompt = resolve_effective_custom_prompt(
        &settings.translate_ai_custom_prompt,
        &provider.custom_prompt,
    );
    let system_prompt = build_system_prompt(
        effective_prompt,
        &settings.translate_ai_target_lang,
        settings.translate_ai_polish,
    );
    let lang_code = get_language_code(&settings.translate_ai_target_lang);
    let stem = path.file_stem()?.to_string_lossy();
    let output_file_name = format!("{}.{}.{}", stem, lang_code, ext);
    let target_dir = match output_dir {
        Some(dir) if !dir.trim().is_empty() => dir.trim().to_string(),
        _ => parent_dir.clone(),
    };
    let content = read_subtitle_string(path).ok()?;
    let parsed = ParsedSubtitle::parse(&content, &ext);
    let total_lines = extract_translatable_entries(&parsed).len();
    if total_lines == 0 {
        return None;
    }

    Some(CheckpointLookupContext {
        parent_dir,
        target_dir,
        file_name,
        output_file_name,
        lang_code,
        ext,
        model_id: model_id.to_string(),
        system_prompt,
        content,
        total_lines,
    })
}

pub fn inspect_checkpoint(
    settings: &WhisperSettings,
    subtitle_path: &str,
    output_dir: Option<&str>,
) -> Option<CheckpointInfo> {
    let ctx = build_checkpoint_lookup_context(settings, subtitle_path, output_dir)?;
    let loaded = crate::translation::checkpoint::load(
        Path::new(&ctx.target_dir),
        &ctx.output_file_name,
        &ctx.file_name,
        &ctx.lang_code,
        &ctx.ext,
        &settings.translate_ai_provider,
        &ctx.model_id,
        &ctx.system_prompt,
        &ctx.content,
    )
    .or_else(|| {
        if ctx.target_dir != ctx.parent_dir {
            crate::translation::checkpoint::load(
                Path::new(&ctx.parent_dir),
                &ctx.output_file_name,
                &ctx.file_name,
                &ctx.lang_code,
                &ctx.ext,
                &settings.translate_ai_provider,
                &ctx.model_id,
                &ctx.system_prompt,
                &ctx.content,
            )
        } else {
            None
        }
    })?;

    let translated_lines = loaded.translations.len().min(ctx.total_lines);
    if translated_lines == 0 {
        return None;
    }
    Some(CheckpointInfo {
        translated_lines,
        total_lines: ctx.total_lines,
    })
}

pub fn clear_checkpoint(
    settings: &WhisperSettings,
    subtitle_path: &str,
    output_dir: Option<&str>,
) -> bool {
    let Some(ctx) = build_checkpoint_lookup_context(settings, subtitle_path, output_dir) else {
        return false;
    };
    let removed_target =
        crate::translation::checkpoint::remove_if_exists(Path::new(&ctx.target_dir), &ctx.output_file_name);
    let removed_parent = if ctx.target_dir != ctx.parent_dir {
        crate::translation::checkpoint::remove_if_exists(Path::new(&ctx.parent_dir), &ctx.output_file_name)
    } else {
        false
    };
    removed_target || removed_parent
}

/// Builds initial per-model `RequestOptions` shared by both real translation and
/// Settings preview tests so reasoning effort and output caps never drift apart.
fn build_initial_request_options(
    api_format: ApiFormat,
    active_model: Option<&AiModel>,
    prompt_char_len: usize,
    temperature: f64,
) -> RequestOptions {
    let max_output_override = active_model
        .and_then(|m| m.max_output_tokens)
        .filter(|&t| t >= MIN_OUTPUT_TOKENS);

    RequestOptions {
        temperature: normalize_translation_temperature(temperature),
        max_output_tokens: if api_format == ApiFormat::AnthropicMessages {
            Some(estimate_max_output_tokens(prompt_char_len, max_output_override))
        } else {
            None
        },
        reasoning_effort: active_model.and_then(|m| {
            if m.supports_reasoning == Some(false) {
                return None;
            }
            let r = m.reasoning.trim().to_lowercase();
            if matches!(
                r.as_str(),
                "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | "ultra"
            ) {
                Some(m.reasoning.clone())
            } else {
                None
            }
        }),
        ..RequestOptions::default()
    }
}

/// Run a quick test translation on the first few cues of a subtitle file.
///
/// Unlike the full subtitle translation pipeline, this directly returns errors
/// encountered during translation so the user can verify their API configuration.
pub async fn preview_translate(
    app: AppHandle,
    logs: Arc<AppLogs>,
    settings: WhisperSettings,
    file_content: String,
) -> Result<Vec<PreviewLine>, String> {
    PREVIEW_CANCELLED.store(false, Ordering::SeqCst);

    let providers_list: Vec<AiProvider> = serde_json::from_str(&settings.translate_ai_providers)
        .map_err(|e| format!("Failed to parse providers: {}", e))?;

    let provider = providers_list
        .iter()
        .find(|p| p.name == settings.translate_ai_provider)
        .ok_or_else(|| {
            format!(
                "Active provider '{}' not found in config.",
                settings.translate_ai_provider
            )
        })?;

    let model = if !settings.translate_ai_model.trim().is_empty()
        && (provider.models.is_empty() || provider.models.iter().any(|m| m.id == settings.translate_ai_model.trim()))
    {
        settings.translate_ai_model.trim().to_string()
    } else if let Some(m) = provider.models.iter().find(|m| m.enabled) {
        m.id.clone()
    } else if let Some(m) = provider.models.first() {
        m.id.clone()
    } else if !settings.translate_ai_model.trim().is_empty() {
        settings.translate_ai_model.trim().to_string()
    } else {
        return Err("No active translation model is selected. Please configure and select a model under your active provider first.".to_string());
    };

    logs.log(&app, "Translate", &format!(
        "Preview requested (provider: '{}', model: '{}')",
        settings.translate_ai_provider, model
    ));

    let trimmed_base_url = provider.base_url.trim();
    if trimmed_base_url.is_empty() {
        return Err(format!(
            "Provider '{}' has no Base URL configured.",
            provider.name
        ));
    }
    if !trimmed_base_url.starts_with("http://") && !trimmed_base_url.starts_with("https://") {
        return Err(format!(
            "Provider '{}' has an invalid Base URL '{}'. URL must begin with http:// or https://",
            provider.name, trimmed_base_url
        ));
    }

    let api_format = ApiFormat::parse(&provider.api_format)?;

    let api_key = if provider.use_keyring {
        get_keyring_key(&provider.name)
            .map_err(|e| format!("Could not retrieve key from system keyring: {}", e))?
    } else {
        provider.api_key.clone()
    };

    let format = detect_preview_subtitle_format(&file_content);

    let parsed = ParsedSubtitle::parse(&file_content, format);
    let original_entries: Vec<(usize, String)> = extract_translatable_entries(&parsed)
        .into_iter()
        .take(3) // preview only first 3 lines
        .collect();

    if original_entries.is_empty() {
        return Err("No dialogues found in the provided preview content.".to_string());
    }

    let client = build_preview_http_client();
    let effective_custom_prompt = resolve_effective_custom_prompt(
        &settings.translate_ai_custom_prompt,
        &provider.custom_prompt,
    );
    let system_prompt = build_system_prompt(
        effective_custom_prompt,
        &settings.translate_ai_target_lang,
        settings.translate_ai_polish,
    );

    let user_content = original_entries
        .iter()
        .map(|(idx, text)| format!("{}: {}", idx, text))
        .collect::<Vec<String>>()
        .join("\n");

    let active_model = provider.models.iter().find(|m| m.id == model);
    let mut request_options = build_initial_request_options(
        api_format,
        active_model,
        system_prompt.len() + user_content.len(),
        settings.translate_ai_temperature,
    );

    let cancel_watcher = async {
        loop {
            if PREVIEW_CANCELLED.load(Ordering::SeqCst) {
                return;
            }
            tokio::select! {
                _ = preview_notify().notified() => {},
                _ = tokio::time::sleep(std::time::Duration::from_millis(50)) => {},
            }
        }
    };

    let request_task = async {
        let mut attempt: usize = 0;
        loop {
            if PREVIEW_CANCELLED.load(Ordering::SeqCst) {
                return Err("Connection test cancelled by user.".to_string());
            }
            let request_body = provider.format_request_body_ext(
                &model,
                &system_prompt,
                &user_content,
                &request_options,
            )?;
            let request_url = build_request_url(
                api_format,
                &provider.base_url,
                &model,
            );
            let req = apply_auth_headers(
                client.post(&request_url).json(&request_body),
                api_format,
                &api_key,
            );

            let res = req
                .send()
                .await
                .map_err(|e| {
                    let is_timeout = e.is_timeout();
                    let is_connect = e.is_connect();
                    let err_str = sanitize_reqwest_error(e);
                    let err_lower = err_str.to_lowercase();
                    if is_timeout {
                        format!("Connection timed out after {} seconds. Check network connection or proxy/VPN. Note: If using a free-tier (:free) or heavy model, the provider's public queue may be busy; try selecting a lighter/faster model.", PREVIEW_TIMEOUT_SECS)
                    } else if err_lower.contains("certificate") || err_lower.contains("unknownissuer") {
                        format!("SSL/TLS certificate verification failed ({}). The connection may be intercepted or blocked. Please verify your proxy or VPN.", err_str)
                    } else if err_lower.contains("reset by peer") || err_lower.contains("broken pipe") {
                        format!("Connection was reset by peer. The endpoint may be blocked or interrupted by network filtering. Please check your proxy/VPN: {}", err_str)
                    } else if is_connect {
                        format!("Failed to connect to provider endpoint: {}. Please check your internet connection or proxy settings.", err_str)
                    } else {
                        format!("Request failed: {}", err_str)
                    }
                })?;

            if !res.status().is_success() {
                let status = res.status();
                let err_text = res.text().await.unwrap_or_default();
                if (status.as_u16() == 400 || status.as_u16() == 422)
                    && attempt < 2
                    && negotiate_parameter_error(api_format, &err_text, &mut request_options, &app, &logs)
                {
                    attempt += 1;
                    continue;
                }
                return Err(format!(
                    "API returned error status ({}): {}",
                    status,
                    redact_url_secrets(&safe_truncate(&err_text, 600))
                ));
            }

            let res_json: Value = res
                .json()
                .await
                .map_err(|e| format!("Failed to parse JSON response: {}", sanitize_reqwest_error(e)))?;

            return parse_response_content(api_format, &res_json);
        }
    };

    let timed_request = tokio::time::timeout(
        std::time::Duration::from_secs(PREVIEW_TIMEOUT_SECS),
        request_task,
    );

    let outcome = tokio::select! {
        _ = cancel_watcher => {
            logs.log(&app, "Translate", "Preview cancelled by user");
            return Err("Connection test cancelled by user.".to_string());
        }
        res = timed_request => {
            match res {
                Ok(Ok(content)) => content,
                Ok(Err(e)) => return Err(e),
                Err(_) => {
                    logs.log(&app, "Translate", &format!("Preview timed out after {}s", PREVIEW_TIMEOUT_SECS));
                    return Err(format!(
                        "Connection test timed out after {} seconds. Please check your network connection, proxy, or provider endpoint URL.",
                        PREVIEW_TIMEOUT_SECS
                    ));
                }
            }
        }
    };

    let chunk_translations = align_translations(&original_entries, &outcome, true);
    if chunk_translations.is_empty() {
        logs.log(&app, "Translate", "Preview failed: response could not be aligned to numbered lines");
        return Err(format!(
            "Connection works, but the model response could not be aligned to the numbered lines. Raw response begins with: \"{}\"",
            safe_truncate(outcome.trim(), 200)
        ));
    }
    logs.log(&app, "Translate", "Preview succeeded");

    let mut preview_lines = Vec::new();
    for entry in &original_entries {
        let (translated, is_fallback) = match chunk_translations.get(&entry.0) {
            Some(t) if !t.is_empty() && t != &entry.1 => (t.clone(), false),
            _ => (entry.1.clone(), true),
        };
        preview_lines.push(PreviewLine {
            index: entry.0,
            original: entry.1.clone(),
            translated,
            is_fallback,
        });
    }

    Ok(preview_lines)
}

fn context_limit_patterns() -> &'static [regex::Regex] {
    static PATTERNS: OnceLock<Vec<regex::Regex>> = OnceLock::new();
    PATTERNS.get_or_init(|| {
        vec![
            regex::Regex::new(r"max_model_len\s*(?:is\s*)?[:=(]?\s*(\d{4,})").expect("static regex"),
            regex::Regex::new(r"maximum model length\s*(?:is\s*)?[:=(]?\s*(\d{4,})").expect("static regex"),
            regex::Regex::new(r"(?:max(?:imum)?|limit)\s+context\s*(?:length|size|window)?\s*(?:is|of|:)?\s*(\d{4,})").expect("static regex"),
            regex::Regex::new(r"context\s*(?:length|size|window)\s*(?:is|of|:)?\s*(\d{4,})").expect("static regex"),
            regex::Regex::new(r"(\d{4,})\s*(?:tokens?\s*)?context").expect("static regex"),
            regex::Regex::new(r"(?:input|prompt)\s*(?:length|size|tokens?)\s*(?:exceeds?|limit|maximum|max)\s*(?:is|of|:)?\s*(\d{4,})").expect("static regex"),
            // Anthropic: "prompt is too long: 205000 tokens > 200000 maximum"
            regex::Regex::new(r"prompt\s+is\s+too\s+long[^\n]{0,60}?>\s*(\d{4,})").expect("static regex"),
            // Combined context overflow: "input length and max_tokens exceed context limit: 180000 + 25000 > 200000"
            regex::Regex::new(r"exceed\s+context\s+limit[^\n]{0,80}?>\s*(\d{4,})").expect("static regex"),
            // Gemini: "The input token count (1200000) exceeds the maximum number of tokens allowed (1048576)."
            regex::Regex::new(r"input\s+token\s+count[^\n]{0,80}?(?:maximum|max|allowed)[^\n]{0,30}?\(?\s*(\d{4,})\s*\)?").expect("static regex"),
        ]
    })
}

fn mentions_output_cap_field(error_lower: &str) -> bool {
    error_lower.contains("max_tokens")
        || error_lower.contains("max tokens")
        || error_lower.contains("max_output_tokens")
        || error_lower.contains("max_completion_tokens")
}

fn mentions_context_or_input_limit(error_lower: &str) -> bool {
    error_lower.contains("context")
        || error_lower.contains("max_model_len")
        || error_lower.contains("maximum model length")
        || error_lower.contains("prompt is too long")
        || error_lower.contains("input token")
        || error_lower.contains("input length")
        || error_lower.contains("prompt length")
        || error_lower.contains("too many tokens")
}

fn is_rate_limit_or_quota_error(error_lower: &str) -> bool {
    error_lower.contains("rate limit")
        || error_lower.contains("rate_limit")
        || error_lower.contains("tokens per min")
        || error_lower.contains("requests per min")
        || error_lower.contains("tpm")
        || error_lower.contains("rpm")
        || error_lower.contains("quota")
}

fn parse_context_limit_from_error(error_msg: &str) -> Option<usize> {
    let error_lower = error_msg.to_lowercase();
    if is_rate_limit_or_quota_error(&error_lower) {
        return None;
    }
    for re in context_limit_patterns() {
        if let Some(caps) = re.captures(&error_lower) {
            if let Some(num_match) = caps.get(1) {
                if let Ok(limit) = num_match.as_str().parse::<usize>() {
                    if (1024..=10_000_000).contains(&limit) {
                        return Some(limit);
                    }
                }
            }
        }
    }
    None
}

fn detect_preview_subtitle_format(content: &str) -> &'static str {
    let cleaned = content.trim_start_matches('\u{feff}');
    if cleaned.contains("-->") {
        if cleaned.trim_start().starts_with("WEBVTT") {
            "vtt"
        } else {
            "srt"
        }
    } else if cleaned.lines().any(|l| l.trim_start().starts_with('[') && l.contains(']')) {
        "lrc"
    } else {
        "txt"
    }
}

fn is_context_length_error(error_msg: &str) -> bool {
    let error_lower = error_msg.to_lowercase();
    if is_rate_limit_or_quota_error(&error_lower) {
        return false;
    }
    let has_context_phrase = error_lower.contains("context")
        && (error_lower.contains("exceed")
            || error_lower.contains("too long")
            || error_lower.contains("too large")
            || error_lower.contains("overflow")
            || error_lower.contains("limit"));
    let has_anthropic_prompt_limit = error_lower.contains("prompt is too long");
    let has_gemini_input_limit = error_lower.contains("input token")
        && (error_lower.contains("exceed")
            || error_lower.contains("maximum")
            || error_lower.contains("limit"));
    let has_payload_too_large = error_lower.contains("request_too_large")
        || error_lower.contains("payload too large")
        || error_lower.contains("request entity too large")
        || error_lower.contains("request exceeds the maximum size");
    has_context_phrase
        || has_anthropic_prompt_limit
        || has_gemini_input_limit
        || has_payload_too_large
}

fn output_cap_patterns() -> &'static [regex::Regex] {
    static PATTERNS: OnceLock<Vec<regex::Regex>> = OnceLock::new();
    PATTERNS.get_or_init(|| {
        vec![
            // Anthropic: "max_tokens: 100000 > 64000 (maximum allowed)"
            regex::Regex::new(r"maximum\s+(?:allowed|permitted)\s*(?:is|:)?\s*(\d{3,})").expect("static regex"),
            regex::Regex::new(r"(?:max_tokens|max tokens|max_output_tokens|max_completion_tokens)[^\n]{0,80}?(?:maximum|max)\s*(?:allowed|permitted|value|of|is|:)?\s*(\d{3,})").expect("static regex"),
            regex::Regex::new(r"max_tokens[^\n]{0,80}?(\d{3,})\s*\([^)]*maximum").expect("static regex"),
            regex::Regex::new(r"(\d{3,})\s*(?:is\s*)?the\s*(?:maximum|max)\s*(?:allowed|value)").expect("static regex"),
        ]
    })
}

/// Extracts the model's exact `max_tokens` cap from an API rejection body.
/// Bounded to [1024, 200_000] so prose numbers never poison the setting.
/// Requires an explicit output-cap field and excludes context/input overflow errors.
fn parse_output_cap_from_error(error_msg: &str) -> Option<u32> {
    let error_lower = error_msg.to_lowercase();
    if !mentions_output_cap_field(&error_lower) || mentions_context_or_input_limit(&error_lower) {
        return None;
    }
    for re in output_cap_patterns() {
        if let Some(caps) = re.captures(&error_lower) {
            if let Some(m) = caps.get(1) {
                if let Ok(cap) = m.as_str().parse::<u32>() {
                    if (1024..=200_000).contains(&cap) {
                        return Some(cap);
                    }
                }
            }
        }
    }
    None
}

/// Heuristic for "your max_tokens value is invalid/too large" 400 errors
/// when the exact number cannot be parsed. Halving recovers in O(log n).
fn is_max_tokens_error(error_msg: &str) -> bool {
    let e = error_msg.to_lowercase();
    mentions_output_cap_field(&e)
        && !mentions_context_or_input_limit(&e)
        && (e.contains("exceed") || e.contains("too large") || e.contains("too big")
            || e.contains("invalid") || e.contains("greater than")
            || e.contains("above") || e.contains("over") || e.contains("maximum"))
}

/// Persists reactively-discovered per-model limits. Best-effort: the settings
/// file may concurrently be written by the frontend; losing this update only
/// costs one extra failed request on the next run, so failures are ignored.
/// `None` fields leave the stored value untouched.
fn update_model_limits(
    provider_name: &str,
    model_id: &str,
    context_window: Option<usize>,
    max_output_tokens: Option<u32>,
) -> Result<Option<String>, String> {
    // Runs under the global settings write lock so a concurrent frontend
    // save cannot silently drop this update between our read and write.
    crate::settings::update_settings_locked(|settings| {
        let mut providers: Vec<AiProvider> = serde_json::from_str(&settings.translate_ai_providers)
            .map_err(|e| format!("Failed to parse translation providers: {}", e))?;

        if let Some(provider) = providers.iter_mut().find(|p| p.name == provider_name) {
            if let Some(model) = provider.models.iter_mut().find(|m| m.id == model_id) {
                if let Some(w) = context_window {
                    model.context_window = w;
                }
                if let Some(t) = max_output_tokens {
                    model.max_output_tokens = Some(t);
                }
                let updated_json = serde_json::to_string(&providers)
                    .map_err(|e| format!("Failed to serialize providers: {}", e))?;
                settings.translate_ai_providers = updated_json.clone();
                return Ok::<Option<String>, String>(Some(updated_json));
            }
        }
        Ok::<Option<String>, String>(None)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_preview_cancel_request() {
        PREVIEW_CANCELLED.store(false, Ordering::SeqCst);
        assert!(!PREVIEW_CANCELLED.load(Ordering::SeqCst));

        let handle = tokio::spawn(async {
            loop {
                if PREVIEW_CANCELLED.load(Ordering::SeqCst) {
                    return true;
                }
                preview_notify().notified().await;
            }
        });

        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        cancel_preview_request();
        assert!(PREVIEW_CANCELLED.load(Ordering::SeqCst));
        let notified = tokio::time::timeout(std::time::Duration::from_secs(1), handle)
            .await
            .expect("timeout")
            .unwrap();
        assert!(notified);
    }

    #[test]
    fn test_align_translations_positional_fallback_single_line() {
        let entries = vec![(1, "Hello world".to_string())];
        // Model returns single translation without numbering
        let response = "سلام دنیا";
        let aligned = align_translations(&entries, response, true);
        assert_eq!(aligned.get(&1), Some(&"سلام دنیا".to_string()));

        // With positional fallback false, it fails to match unnumbered line
        let aligned_no_pos = align_translations(&entries, response, false);
        assert!(aligned_no_pos.is_empty());
    }

    #[test]
    fn compute_progress_is_monotonic_and_bounded() {
        // 3 files, 100 lines each: file 0 done 0/100 -> 0%
        assert_eq!(compute_progress(0, 3, 0, 100), 0.0);
        // file 0 done 50/100 -> ~16.6%
        let half = compute_progress(0, 3, 50, 100);
        assert!((half - 1.0 / 6.0).abs() < 1e-9);
        // file 2 done 100/100 -> exactly 1.0
        assert_eq!(compute_progress(2, 3, 100, 100), 1.0);
        // never exceeds 1.0 even with bogus over-counts
        assert_eq!(compute_progress(2, 3, 500, 100), 1.0);
    }

    #[test]
    fn compute_progress_handles_degenerate_inputs() {
        assert_eq!(compute_progress(0, 0, 0, 0), 0.0);
        assert_eq!(compute_progress(0, 1, 10, 0), 0.0);
        assert_eq!(compute_progress(5, 1, 10, 10), 1.0);
    }

    #[test]
    fn parse_rejects_empty_translations_but_keeps_continuations_of_previous() {
        // "4:" with no text at all must NOT store an empty translation for line 4.
        let map = parse_translated_lines("3: سلام\n4:\n", &[1, 2, 3, 4]);
        assert!(!map.contains_key(&4));
        assert!(map.contains_key(&3));

        // A multi-line continuation after "4:\n" belongs to slot 4,
        // never bleeding into line 3's translation.
        let map = parse_translated_lines("3: سلام\n4:\nادامهٔ چهار\n", &[1, 2, 3, 4]);
        assert_eq!(map.get(&3).unwrap(), "سلام");
        assert_eq!(map.get(&4).unwrap(), "ادامهٔ چهار");
    }

    #[test]
    fn parse_preserves_persian_arabic_digits_in_dialogue_text() {
        // The line index "۱:" is normalized to 1, but the dialogue digits (۱۰:۳۰, ۱۴۰۳)
        // must remain untouched as native Persian numerals.
        let map = parse_translated_lines("۱: ساعت ۱۰:۳۰ سال ۱۴۰۳\n", &[1]);
        assert_eq!(map.get(&1).unwrap(), "ساعت ۱۰:۳۰ سال ۱۴۰۳");
    }

    #[test]
    fn parse_output_cap_from_anthropic_error() {
        let err = "invalid_request_error: max_tokens: 100000 > 64000 (maximum allowed)";
        assert_eq!(parse_output_cap_from_error(err), Some(64_000));
    }

    #[test]
    fn output_cap_heuristic_matches_without_number() {
        assert!(is_max_tokens_error(
            "max_tokens: 999999 is too large for this model"
        ));
        assert!(!is_max_tokens_error(
            "context length exceeded: too many input tokens"
        ));
    }

    #[test]
    fn estimate_respects_per_model_override_as_upper_bound() {
        // Huge estimate clamps DOWN to override.
        assert_eq!(
            estimate_max_output_tokens(1_000_000, Some(16_384)),
            16_384
        );
        // Small request still respects the floor.
        assert_eq!(estimate_max_output_tokens(100, Some(65_536)), MIN_OUTPUT_TOKENS);
        // No override -> conservative default cap, not the old global 8192.
        assert_eq!(
            estimate_max_output_tokens(1_000_000, None),
            DEFAULT_MAX_OUTPUT_TOKENS
        );
    }

    #[test]
    fn timecode_dialogue_does_not_hijack_unexpected_slot() {
        // Chunk sends cues 5..7. The model glitches on cue 5 and its content
        // "9:00 صبح بود" leaks out as a bare line: must NOT overwrite cue 9.
        let order = vec![5usize, 6, 7];
        let map = parse_translated_lines(
            "5: \n9:00 صبح بود\n6: خوبی؟\n7: باشه\n",
            &order,
        );
        assert!(!map.contains_key(&9), "cue 9 must not be hijacked");
    }

    #[test]
    fn genuine_cue_whose_text_starts_with_time_is_accepted() {
        // Cue 5 legitimately translates to a sentence starting with a time;
        // since 5 IS the next expected index it must be accepted verbatim.
        let order = vec![5usize, 6];
        let map = parse_translated_lines(
            "5: 9:00 صبح بود\n6: سلام\n",
            &order,
        );
        assert_eq!(map.get(&5).unwrap(), "9:00 صبح بود");
        assert_eq!(map.get(&6).unwrap(), "سلام");
    }

    #[test]
    fn persian_digit_numbering_is_normalized() {
        let map = parse_translated_lines("۱: سلام\n۲: دنیا\n", &[1, 2]);
        assert_eq!(map.get(&1).unwrap(), "سلام");
        assert_eq!(map.get(&2).unwrap(), "دنیا");
    }
}

#[cfg(test)]
mod alignment_tests {
    use super::*;

    fn entries(pairs: &[(usize, &str)]) -> Vec<(usize, String)> {
        pairs.iter().map(|(i, s)| (*i, s.to_string())).collect()
    }

    #[test]
    fn positional_fallback_disabled_on_first_round() {
        let chunk = entries(&[(1, "Hello"), (2, "World")]);
        // Model dropped numbering entirely — round one must NOT rescue.
        let map = align_translations(&chunk, "Hola\nMundo\n", false);
        assert!(map.is_empty(), "positional fallback must stay gated");
    }

    #[test]
    fn positional_fallback_rescues_after_stall() {
        let chunk = entries(&[(1, "Hello"), (2, "World")]);
        let map = align_translations(&chunk, "Hola\nMundo\n", true);
        assert_eq!(map.get(&1).unwrap(), "Hola");
        assert_eq!(map.get(&2).unwrap(), "Mundo");
    }

    #[test]
    fn positional_fallback_rejects_chat_boilerplate() {
        let chunk = entries(&[(1, "Hello"), (2, "World")]);
        // Model added intro line "Here is the translation:" + 1 line (total 2 lines)
        let map = align_translations(&chunk, "Here is the translation:\nHola\n", true);
        assert!(map.is_empty(), "positional fallback must reject boilerplate");
    }

    #[test]
    fn en_dash_speaker_prefix_is_preserved() {
        let chunk = entries(&[(1, "– Hello there")]);
        let map = align_translations(&chunk, "1: سلام آنجا\n", false);
        assert_eq!(map.get(&1).unwrap(), "- سلام آنجا");
    }

    #[test]
    fn em_dash_prefix_not_duplicated() {
        let chunk = entries(&[(1, "— Hi")]);
        let map = align_translations(&chunk, "1: — سلام\n", false);
        assert_eq!(map.get(&1).unwrap(), "— سلام");
    }

    #[test]
    fn latin1_file_reads_with_correct_accents() {
        let dir = std::env::temp_dir().join(format!("whisper-enc-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("legacy.srt");
        // "café" in Windows-1252: 0xE9 = é
        let bytes = vec![b'c', b'a', b'f', 0xE9];
        std::fs::write(&path, &bytes).unwrap();

        let decoded = read_subtitle_string(&path).unwrap();
        assert!(!decoded.contains('\u{FFFD}'), "windows-1252 é must decode cleanly");
        assert!(decoded.starts_with("caf"));

        // UTF-8 fast path untouched
        let path8 = dir.join("utf8.srt");
        std::fs::write(&path8, "café").unwrap();
        assert_eq!(read_subtitle_string(&path8).unwrap(), "café");

        // Slightly corrupted UTF-8 with 1 invalid byte in Persian text
        let path_corrupt = dir.join("persian_corrupt.srt");
        let mut pbytes = "سلام دنیا".as_bytes().to_vec();
        pbytes.push(0xFF); // corrupted trailing byte
        std::fs::write(&path_corrupt, &pbytes).unwrap();
        let decoded_corrupt = read_subtitle_string(&path_corrupt).unwrap();
        assert!(decoded_corrupt.starts_with("سلام دنیا"), "mostly valid UTF-8 must decode as UTF-8, not Windows-1252");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn multi_line_speaker_dashes_preserved_across_all_lines() {
        let chunk = entries(&[(1, "- Hello.\n- How are you?")]);
        let map = align_translations(&chunk, "1: سلام.\nخوبی؟\n", false);
        assert_eq!(map.get(&1).unwrap(), "- سلام.\n- خوبی؟");
    }

    #[test]
    fn skipped_cue_whose_text_starts_with_time_is_accepted_as_upcoming_cue() {
        // Expected cues: 5, 6, 7. Model skips 6 and outputs 7 starting with a timecode text.
        let order = vec![5usize, 6, 7];
        let map = parse_translated_lines(
            "5: سلام\n7: 10:30 شب بود\n",
            &order,
        );
        assert_eq!(map.get(&5).unwrap(), "سلام");
        assert_eq!(map.get(&7).unwrap(), "10:30 شب بود");
    }

    #[test]
    fn strip_reasoning_blocks_removes_think_and_thought_tags() {
        let text = "<think>\n1: internal thought\nLet's translate carefully\n</think>\n1: سلام دنیا\n2: حال شما چطوره؟\n";
        let cleaned = strip_reasoning_blocks(text);
        assert!(!cleaned.contains("internal thought"));
        assert!(cleaned.contains("1: سلام دنیا"));
        assert!(cleaned.contains("2: حال شما چطوره؟"));

        let unclosed = "<thought>Thinking without closing tag...\n1: سلام";
        assert_eq!(strip_reasoning_blocks(unclosed).trim(), "");
    }

    #[test]
    fn align_translations_handles_deepseek_r1_thinking_tags() {
        let chunk = entries(&[(1, "Hello world"), (2, "How are you?")]);
        let response = "<think>\nOkay, translating:\n1: English -> Persian\n</think>\n1: سلام دنیا\n2: حالت چطوره؟\n";
        let map = align_translations(&chunk, response, false);
        assert_eq!(map.get(&1).unwrap(), "سلام دنیا");
        assert_eq!(map.get(&2).unwrap(), "حالت چطوره؟");
    }

    #[test]
    fn parameter_error_detection_matches_various_provider_signatures() {
        assert!(is_unsupported_parameter_error("Unsupported parameter: 'temperature'", "temperature"));
        assert!(is_unsupported_parameter_error("temperature is not supported with this model", "temperature"));
        assert!(is_unsupported_parameter_error("unknown parameter: temperature", "temperature"));
        assert!(is_unsupported_parameter_error("Extra inputs are not permitted: max_tokens", "max_tokens"));
        assert!(is_unsupported_parameter_error("unrecognized request argument: reasoning_effort", "reasoning_effort"));

        assert!(!is_unsupported_parameter_error("Rate limit exceeded: 429", "temperature"));
    }

    #[test]
    fn system_role_error_detection_matches_gemma_and_reasoning_errors() {
        assert!(is_unsupported_system_role_error("Unsupported value: 'system' for messages[0].role"));
        assert!(is_unsupported_system_role_error("Developer instruction is not enabled"));
        assert!(is_unsupported_system_role_error("System prompt not supported, only user messages allowed"));
        assert!(!is_unsupported_system_role_error("Internal server error in system backend"));
    }

    #[test]
    fn build_initial_request_options_aligns_reasoning_and_anthropic_cap() {
        let reasoning_model = AiModel {
            id: "claude-sonnet".to_string(),
            context_window: 200_000,
            max_output_tokens: Some(4096),
            reasoning: "Low".to_string(),
            supports_reasoning: Some(true),
            vision: false,
            enabled: true,
        };
        let anthropic_opts = build_initial_request_options(
            ApiFormat::AnthropicMessages,
            Some(&reasoning_model),
            120_000,
            0.3,
        );
        assert_eq!(anthropic_opts.reasoning_effort.as_deref(), Some("Low"));
        assert_eq!(anthropic_opts.max_output_tokens, Some(4096));
        assert!((anthropic_opts.temperature - 0.3).abs() < f64::EPSILON);

        let blocked_reasoning = AiModel {
            supports_reasoning: Some(false),
            ..reasoning_model.clone()
        };
        let openai_opts = build_initial_request_options(
            ApiFormat::OpenAiCompatible,
            Some(&blocked_reasoning),
            500,
            0.6,
        );
        assert_eq!(openai_opts.reasoning_effort, None);
        assert_eq!(openai_opts.max_output_tokens, None);
        assert!((openai_opts.temperature - 0.6).abs() < f64::EPSILON);
    }

    #[test]
    fn gemini_request_url_never_embeds_api_key_and_redacts_secrets() {
        let url = build_request_url(
            ApiFormat::GeminiResponses,
            "  https://generativelanguage.googleapis.com  ",
            "gemini-2.5-flash",
        );
        assert_eq!(
            url,
            "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"
        );
        assert!(!url.contains("key="));

        let sanitized = redact_url_secrets(
            "error sending request for url (https://generativelanguage.googleapis.com/v1beta/models?key=AIzaSecret123&foo=bar)",
        );
        assert!(!sanitized.contains("AIzaSecret123"));
        assert!(sanitized.contains("?key=<redacted>&foo=bar"));
    }

    #[test]
    fn resolve_next_output_cap_terminates_without_infinite_loop() {
        // Auto mode (None override) with rejected 4096 halves cleanly to 2048 instead of failing immediately
        assert_eq!(resolve_next_output_cap(None, Some(4096), None).unwrap(), 2048);
        assert!(resolve_next_output_cap(None, Some(1024), None).is_err());
        // High override with smaller sent chunk halves from the actual sent cap
        assert_eq!(resolve_next_output_cap(Some(65_536), Some(3000), None).unwrap(), 1500);
        // First hit with exact cap >= default stores override
        assert_eq!(resolve_next_output_cap(None, Some(8192), Some(4096)).unwrap(), 4096);
        // Repeated rejection with same exact cap halves monotonically down to MIN_OUTPUT_TOKENS
        assert_eq!(resolve_next_output_cap(Some(4096), Some(4096), Some(4096)).unwrap(), 2048);
        assert_eq!(resolve_next_output_cap(Some(2048), Some(2048), Some(4096)).unwrap(), 1024);
        // At MIN_OUTPUT_TOKENS, even with Some(exact_cap), it must fail instead of looping forever
        assert!(resolve_next_output_cap(Some(1024), Some(1024), Some(4096)).is_err());
        assert!(resolve_next_output_cap(Some(1024), Some(1024), None).is_err());
    }

    #[test]
    fn parse_response_content_skips_gemini_thought_parts_and_anthropic_thinking_blocks() {
        let gemini_resp = serde_json::json!({
            "candidates": [{
                "content": {
                    "parts": [
                        { "thought": true, "text": "Let me analyze the subtitle context..." },
                        { "text": "1: سلام دنیا\n2: حالت چطوره؟" }
                    ]
                }
            }]
        });
        let gemini_out = parse_response_content(ApiFormat::GeminiResponses, &gemini_resp).unwrap();
        assert_eq!(gemini_out, "1: سلام دنیا\n2: حالت چطوره؟");

        let anthropic_resp = serde_json::json!({
            "content": [
                { "type": "thinking", "thinking": "Internal reasoning..." },
                { "type": "text", "text": "1: سلام دنیا" }
            ]
        });
        let anthropic_out = parse_response_content(ApiFormat::AnthropicMessages, &anthropic_resp).unwrap();
        assert_eq!(anthropic_out, "1: سلام دنیا");

        // All-thought Gemini response must fail cleanly instead of passing thoughts as subtitles
        let thought_only = serde_json::json!({
            "candidates": [{
                "content": { "parts": [{ "thought": true, "text": "Only thinking" }] }
            }]
        });
        assert!(parse_response_content(ApiFormat::GeminiResponses, &thought_only).is_err());
    }

    #[test]
    fn extract_translatable_entries_filters_empty_and_whitespace_cues() {
        let content = "1\n00:00:01,000 --> 00:00:02,000\nHello\n\n2\n00:00:03,000 --> 00:00:04,000\n   \n\n3\n00:00:05,000 --> 00:00:06,000\nWorld\n";
        let parsed = ParsedSubtitle::parse(content, "srt");
        assert_eq!(parsed.cues.len(), 3);

        let entries = extract_translatable_entries(&parsed);
        assert_eq!(entries, vec![(1, "Hello".to_string()), (3, "World".to_string())]);
    }

    #[test]
    fn reasoning_effort_stays_omitted_after_parameter_negotiation() {
        let provider = AiProvider {
            name: "Custom".to_string(),
            base_url: "https://api.example.com/v1".to_string(),
            api_key: "sk-test".to_string(),
            api_format: "Chat completions".to_string(),
            use_keyring: false,
            models: vec![AiModel {
                id: "model-with-reasoning".to_string(),
                context_window: 128000,
                max_output_tokens: None,
                reasoning: "low".to_string(),
                supports_reasoning: Some(true),
                vision: false,
                enabled: true,
            }],
            custom_prompt: "".to_string(),
        };

        let mut opts = build_initial_request_options(
            ApiFormat::OpenAiCompatible,
            Some(&provider.models[0]),
            100,
            0.3,
        );
        assert_eq!(opts.reasoning_effort.as_deref(), Some("low"));
        assert!(opts.include_reasoning_effort);

        let action = classify_non_success_error(
            ApiFormat::OpenAiCompatible,
            400,
            "Unrecognized request argument supplied: reasoning_effort",
            &mut opts,
        );
        assert!(matches!(action, NonSuccessAction::NegotiateRetry(_)));
        assert!(!opts.include_reasoning_effort);
        assert_eq!(opts.reasoning_effort, None);

        let retry_body = provider
            .format_request_body_ext("model-with-reasoning", "sys", "usr", &opts)
            .unwrap();
        assert!(retry_body.get("reasoning_effort").is_none());
    }

    #[test]
    fn anthropic_output_cap_error_is_not_hijacked_by_parameter_negotiation() {
        let mut opts = RequestOptions {
            max_output_tokens: Some(100_000),
            ..RequestOptions::default()
        };
        let err = "invalid_request_error: max_tokens: 100000 > 64000 (maximum allowed)";

        let action = classify_non_success_error(ApiFormat::AnthropicMessages, 400, err, &mut opts);
        assert!(matches!(
            action,
            NonSuccessAction::Outcome(ChunkOutcome::OutputCapExceeded(Some(64_000)))
        ));
        assert_eq!(opts.max_output_tokens, Some(100_000));

        // Even if negotiate_parameter_error_step is called directly for Anthropic, max_output_tokens must remain Some
        assert!(negotiate_parameter_error_step(ApiFormat::AnthropicMessages, err, &mut opts).is_none());
        assert_eq!(opts.max_output_tokens, Some(100_000));
    }

    #[test]
    fn ensure_output_dir_writable_and_write_output_file_atomic_work() {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("whisper-translator-io-{}-{}", std::process::id(), nonce));

        ensure_output_dir_writable(&dir).unwrap();
        assert!(dir.is_dir());

        let out_file = dir.join("movie.fa.srt");
        write_output_file_atomic(&out_file, "1\n00:00:01,000 --> 00:00:02,000\nسلام\n").unwrap();
        write_output_file_atomic(&out_file, "1\n00:00:01,000 --> 00:00:02,000\nدرود\n").unwrap();
        assert_eq!(
            std::fs::read_to_string(&out_file).unwrap(),
            "1\n00:00:01,000 --> 00:00:02,000\nدرود\n"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn http_429_rate_limit_tpm_is_never_classified_as_context_limit() {
        let mut opts = RequestOptions::default();
        let err = "Rate limit reached for gpt-4o in organization org-xyz on tokens per min (TPM): Limit 30000, Used 29500, Requested 1200";
        let action = classify_non_success_error(ApiFormat::OpenAiCompatible, 429, err, &mut opts);
        assert!(matches!(action, NonSuccessAction::CheckTransientOrFail));
        assert_eq!(parse_context_limit_from_error(err), None);
        assert!(!is_context_length_error(err));
    }

    #[test]
    fn max_tokens_exceeds_maximum_of_is_classified_as_output_cap_not_context_limit() {
        let mut opts = RequestOptions {
            max_output_tokens: Some(16_384),
            ..RequestOptions::default()
        };
        let err = "max_tokens: 16384 exceeds the maximum of 8192";
        let action = classify_non_success_error(ApiFormat::AnthropicMessages, 400, err, &mut opts);
        assert!(matches!(
            action,
            NonSuccessAction::Outcome(ChunkOutcome::OutputCapExceeded(Some(8192)))
        ));
    }

    #[test]
    fn bare_clock_time_inside_chunk_stays_continuation_and_does_not_hijack_slot() {
        let order: Vec<usize> = (1..=30).collect();
        let response = "5: جلسه ساعت\n9:00 صبح است\n6: باشه میام\n9: عالیه\n";
        let map = parse_translated_lines(response, &order);
        assert_eq!(map.get(&5).unwrap(), "جلسه ساعت\n9:00 صبح است");
        assert_eq!(map.get(&6).unwrap(), "باشه میام");
        assert_eq!(map.get(&9).unwrap(), "عالیه");

        let persian_time_resp = "5: قرار ما\n۹:۰۰ صبح\n9: حتما\n";
        let map_fa = parse_translated_lines(persian_time_resp, &order);
        assert_eq!(map_fa.get(&5).unwrap(), "قرار ما\n۹:۰۰ صبح");
        assert_eq!(map_fa.get(&9).unwrap(), "حتما");
    }

    #[test]
    fn build_request_url_handles_models_endpoint_and_proxies_cleanly() {
        assert_eq!(
            build_request_url(
                ApiFormat::GeminiResponses,
                "https://generativelanguage.googleapis.com/v1beta/models",
                "gemini-2.5-flash"
            ),
            "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"
        );
        assert_eq!(
            build_request_url(
                ApiFormat::GeminiResponses,
                "https://generativelanguage.googleapis.com/v1beta/models/",
                "gemini-2.5-flash"
            ),
            "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"
        );
        assert_eq!(
            build_request_url(
                ApiFormat::AnthropicMessages,
                "https://proxy.example.com/messages-proxy/v1",
                "claude-sonnet-4"
            ),
            "https://proxy.example.com/messages-proxy/v1/messages"
        );
    }

    #[test]
    fn get_language_code_matches_all_frontend_target_variants() {
        assert_eq!(get_language_code("Simplified Chinese"), "zh");
        assert_eq!(get_language_code("Traditional Chinese"), "zh-TW");
        assert_eq!(get_language_code("Portuguese (Brazil)"), "pt-BR");
        assert_eq!(get_language_code("Portuguese (Portugal)"), "pt-PT");
        assert_eq!(get_language_code("Norwegian Bokmål"), "nb");
        assert_eq!(get_language_code("Dari"), "fa-AF");
        assert_eq!(get_language_code("Central Kurdish"), "ckb");
        assert_eq!(get_language_code("Northern Kurdish"), "kmr");
        assert_eq!(get_language_code("Cantonese"), "yue");
    }

    #[test]
    fn out_of_range_numbered_lines_do_not_bleed_into_previous_cue() {
        let order: Vec<usize> = vec![10, 11, 12];
        let response = "10: دهم\n11: یازدهم\n12: دوازدهم\n13: خط اضافه\nادامه خط اضافه\n7: خط قبلی\nادامه خط قبلی\n";
        let map = parse_translated_lines(response, &order);
        assert_eq!(map.get(&10).unwrap(), "دهم");
        assert_eq!(map.get(&11).unwrap(), "یازدهم");
        assert_eq!(map.get(&12).unwrap(), "دوازدهم");
        assert!(!map.contains_key(&13));
        assert!(!map.contains_key(&7));
    }

    #[test]
    fn compact_numbered_cues_without_space_are_not_dropped_as_clock_times() {
        let order: Vec<usize> = vec![1, 2, 3, 5];
        let response = "1：10分钟后\n2：30块钱\n3:20 دلار\n5:99 درصد\n";
        let map = parse_translated_lines(response, &order);
        assert_eq!(map.get(&1).unwrap(), "10分钟后");
        assert_eq!(map.get(&2).unwrap(), "30块钱");
        assert_eq!(map.get(&3).unwrap(), "20 دلار");
        assert_eq!(map.get(&5).unwrap(), "99 درصد");
    }

    #[test]
    fn compact_ratio_and_behind_cursor_numbers_stay_continuations_without_overwriting() {
        let order: Vec<usize> = (1..=10).collect();
        let response = "\
1: خط اول
2: بازی تموم شد
8: نتیجه شد
2:1 به نفع تیم ما شد
24:00 بسته می‌شود
9: خط نهم";
        let map = parse_translated_lines(response, &order);
        assert_eq!(map.get(&1).unwrap(), "خط اول");
        assert_eq!(map.get(&2).unwrap(), "بازی تموم شد");
        assert_eq!(
            map.get(&8).unwrap(),
            "نتیجه شد\n2:1 به نفع تیم ما شد\n24:00 بسته می‌شود"
        );
        assert_eq!(map.get(&9).unwrap(), "خط نهم");
    }

    #[test]
    fn anthropic_and_gemini_context_limit_errors_are_classified_and_parsed() {
        let mut opts = RequestOptions::default();

        let anthropic_err = "prompt is too long: 205000 tokens > 200000 maximum";
        let anthropic_action =
            classify_non_success_error(ApiFormat::AnthropicMessages, 400, anthropic_err, &mut opts);
        assert!(matches!(
            anthropic_action,
            NonSuccessAction::Outcome(ChunkOutcome::ContextLimitExceeded(Some(200_000)))
        ));

        let gemini_err =
            "The input token count (1200000) exceeds the maximum number of tokens allowed (1048576).";
        let gemini_action =
            classify_non_success_error(ApiFormat::GeminiResponses, 400, gemini_err, &mut opts);
        assert!(matches!(
            gemini_action,
            NonSuccessAction::Outcome(ChunkOutcome::ContextLimitExceeded(Some(1_048_576)))
        ));

        let tpm_err = "Rate limit reached on tokens per min (TPM): prompt is too long for 100000 TPM";
        let tpm_action =
            classify_non_success_error(ApiFormat::AnthropicMessages, 429, tpm_err, &mut opts);
        assert!(matches!(tpm_action, NonSuccessAction::CheckTransientOrFail));
        assert!(!is_context_length_error(tpm_err));
    }

    #[test]
    fn redact_url_secrets_masks_query_keys_in_error_bodies() {
        let raw = "Upstream failed calling https://generativelanguage.googleapis.com/v1beta/models?key=AIzaTopSecret999&alt=json&access_token=ya29.SecretTok&token=abc123";
        let sanitized = redact_url_secrets(&safe_truncate(raw, 600));
        assert!(!sanitized.contains("AIzaTopSecret999"));
        assert!(!sanitized.contains("ya29.SecretTok"));
        assert!(!sanitized.contains("abc123"));
        assert!(sanitized.contains("?key=<redacted>&alt=json&access_token=<redacted>&token=<redacted>"));
    }

    #[test]
    fn align_translations_normalizes_compact_speaker_dash_without_doubling_or_touching_negatives() {
        let originals = vec![
            (1, "- Hello!\n- Goodbye.".to_string()),
            (2, "- How cold is it?".to_string()),
        ];
        let response = "1: -سلام!\n- خداحافظ.\n2: -5 درجه";
        let aligned = align_translations(&originals, response, false);
        assert_eq!(aligned.get(&1).map(String::as_str), Some("-سلام!\n- خداحافظ."));
        assert_eq!(aligned.get(&2).map(String::as_str), Some("- -5 درجه"));

        let neg_orig = vec![(1, "- -5°C".to_string())];
        let neg_aligned = align_translations(&neg_orig, "1: -5 درجه", false);
        assert_eq!(neg_aligned.get(&1).map(String::as_str), Some("- -5 درجه"));
    }

    #[test]
    fn combined_context_and_max_tokens_errors_classify_as_context_limit_not_output_cap() {
        let mut opts = RequestOptions {
            max_output_tokens: Some(16_384),
            ..Default::default()
        };

        let anthropic_combined =
            "input length and max_tokens exceed context limit: 180000 + 25000 > 200000, decrease input length or max_tokens and try again";
        let action = classify_non_success_error(
            ApiFormat::AnthropicMessages,
            400,
            anthropic_combined,
            &mut opts,
        );
        assert!(matches!(
            action,
            NonSuccessAction::Outcome(ChunkOutcome::ContextLimitExceeded(Some(200_000)))
        ));

        let openai_combined =
            "This model's maximum context length is 8192 tokens, however you requested 9000 tokens (7000 in the messages, 2000 in the completion). Please reduce the length of the messages or max_tokens.";
        let openai_action = classify_non_success_error(
            ApiFormat::OpenAiCompatible,
            400,
            openai_combined,
            &mut opts,
        );
        assert!(matches!(
            openai_action,
            NonSuccessAction::Outcome(ChunkOutcome::ContextLimitExceeded(Some(8192)))
        ));

        let pure_output_cap = "max_tokens: 100000 > 64000 (maximum allowed)";
        let output_action = classify_non_success_error(
            ApiFormat::AnthropicMessages,
            400,
            pure_output_cap,
            &mut opts,
        );
        assert!(matches!(
            output_action,
            NonSuccessAction::Outcome(ChunkOutcome::OutputCapExceeded(Some(64_000)))
        ));
    }

    #[test]
    fn classify_413_request_too_large_triggers_context_shrink() {
        let mut opts = RequestOptions::default();

        let anthropic_413 = r#"{"type":"error","error":{"type":"request_too_large","message":"Request exceeds the maximum size."}}"#;
        let action_anthropic = classify_non_success_error(
            ApiFormat::AnthropicMessages,
            413,
            anthropic_413,
            &mut opts,
        );
        assert!(matches!(
            action_anthropic,
            NonSuccessAction::Outcome(ChunkOutcome::ContextLimitExceeded(None))
        ));

        let proxy_413 = "413 Payload Too Large";
        let action_proxy = classify_non_success_error(
            ApiFormat::OpenAiCompatible,
            413,
            proxy_413,
            &mut opts,
        );
        assert!(matches!(
            action_proxy,
            NonSuccessAction::Outcome(ChunkOutcome::ContextLimitExceeded(None))
        ));

        let empty_413_action = classify_non_success_error(
            ApiFormat::OpenAiCompatible,
            413,
            "",
            &mut opts,
        );
        assert!(matches!(
            empty_413_action,
            NonSuccessAction::Outcome(ChunkOutcome::ContextLimitExceeded(None))
        ));
    }

    #[test]
    fn classify_413_rate_limit_tpm_does_not_shrink_context() {
        let mut opts = RequestOptions::default();
        let groq_tpm_413 =
            "Request too large for model `llama-3.3-70b-versatile` on tokens per minute (TPM): Limit 12000, Requested 15000";
        let action = classify_non_success_error(
            ApiFormat::OpenAiCompatible,
            413,
            groq_tpm_413,
            &mut opts,
        );
        assert!(matches!(action, NonSuccessAction::CheckTransientOrFail));
        assert!(!is_context_length_error(groq_tpm_413));
    }

    #[test]
    fn windows_1256_persian_subtitle_decodes_cleanly() {
        let dir = std::env::temp_dir().join(format!("whisper-win1256-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();

        let persian_srt = "1\n00:00:01,000 --> 00:00:03,000\nسلام دنيا، چه خبر؟\n\n2\n00:00:04,000 --> 00:00:06,000\nپدر و مادر گفتند چشم\n";
        let (encoded, _, had_errors) = encoding_rs::WINDOWS_1256.encode(persian_srt);
        assert!(!had_errors);

        let p_path = dir.join("legacy_fa.srt");
        std::fs::write(&p_path, encoded.as_ref()).unwrap();
        let decoded = read_subtitle_string(&p_path).unwrap();
        assert_eq!(decoded, persian_srt);

        // Isolated European accented bytes must still use Windows-1252
        let fr_srt = "1\n00:00:01,000 --> 00:00:02,000\ncaf\u{E9} cr\u{E8}me\n";
        let (encoded_fr, _, _) = encoding_rs::WINDOWS_1252.encode(fr_srt);
        let fr_path = dir.join("legacy_fr.srt");
        std::fs::write(&fr_path, encoded_fr.as_ref()).unwrap();
        assert_eq!(read_subtitle_string(&fr_path).unwrap(), fr_srt);

        // German Windows-1252 subtitles with ß / ä / ö / ü must never be misdetected as Windows-1256
        let de_srt = "1\n00:00:01,000 --> 00:00:04,000\nGroß, größer, am größten. Straße, Maße, Füße.\n\n2\n00:00:05,000 --> 00:00:08,000\nÜbermäßige Größe und schöne Straße für äußere Übungen.\n";
        let (encoded_de, _, had_de_errors) = encoding_rs::WINDOWS_1252.encode(de_srt);
        assert!(!had_de_errors);
        let de_path = dir.join("legacy_de.srt");
        std::fs::write(&de_path, encoded_de.as_ref()).unwrap();
        assert_eq!(read_subtitle_string(&de_path).unwrap(), de_srt);

        // Persian Windows-1256 mixed with HTML tags and English words still decodes cleanly
        let mixed_fa = "1\n00:00:01,000 --> 00:00:03,000\n<i>Hello سلام دنيا</i>\n";
        let (encoded_mixed_fa, _, had_mixed_errors) = encoding_rs::WINDOWS_1256.encode(mixed_fa);
        assert!(!had_mixed_errors);
        let mixed_fa_path = dir.join("legacy_mixed_fa.srt");
        std::fs::write(&mixed_fa_path, encoded_mixed_fa.as_ref()).unwrap();
        assert_eq!(read_subtitle_string(&mixed_fa_path).unwrap(), mixed_fa);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn resolve_next_context_shrink_reduces_chunk_items_monotonically_and_persists_only_exact_limits() {
        // Without exact API limit (e.g. HTTP 413), shrinks chunk cap 30 -> 15 -> 7 -> 3 -> 1 without overwriting model window
        let (w1, m1, p1) = resolve_next_context_shrink(128_000, 30, 30, None).unwrap();
        assert_eq!((w1, m1, p1), (128_000, 15, None));
        let (w2, m2, p2) = resolve_next_context_shrink(w1, 15, m1, None).unwrap();
        assert_eq!((w2, m2, p2), (128_000, 7, None));
        let (w3, m3, p3) = resolve_next_context_shrink(w2, 7, m2, None).unwrap();
        assert_eq!((w3, m3, p3), (128_000, 3, None));
        let (w4, m4, p4) = resolve_next_context_shrink(w3, 3, m3, None).unwrap();
        assert_eq!((w4, m4, p4), (128_000, 1, None));
        // Even on a small local window (2048), chunk size still shrinks down to 1 before failing
        let (ws, ms, ps) = resolve_next_context_shrink(2048, 12, 30, None).unwrap();
        assert_eq!((ws, ms, ps), (2048, 6, None));
        // When single line fails, errors cleanly
        assert!(resolve_next_context_shrink(2048, 1, 1, None).is_err());

        // Exact API context limit smaller than current window is persisted
        let (we, me, pe) = resolve_next_context_shrink(128_000, 30, 30, Some(32_768)).unwrap();
        assert_eq!((we, me, pe), (32_768, 15, Some(32_768)));
    }

    #[test]
    fn finalize_empty_translation_error_reports_skipped_reasons() {
        assert_eq!(finalize_empty_translation_error(&[]), None);
        assert_eq!(
            finalize_empty_translation_error(&["Source subtitle file not found: 'missing.srt'".to_string()]),
            Some("Source subtitle file not found: 'missing.srt'".to_string())
        );
    }

    #[test]
    fn preview_format_detection_handles_utf8_bom_vtt() {
        let vtt_bom = "\u{feff}WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHello";
        assert_eq!(detect_preview_subtitle_format(vtt_bom), "vtt");
        assert_eq!(
            detect_preview_subtitle_format("1\n00:00:01,000 --> 00:00:02,000\nHello"),
            "srt"
        );
        assert_eq!(
            detect_preview_subtitle_format("[00:12.34]Lyric line"),
            "lrc"
        );
        assert_eq!(
            detect_preview_subtitle_format("Plain line one\nPlain line two"),
            "txt"
        );
    }

    #[test]
    fn read_subtitle_string_prefers_windows_1252_over_lossy_utf8_when_accidental_pair_is_outnumbered() {
        let dir = std::env::temp_dir().join(format!("whisper-win1252-pair-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();

        // German Windows-1252 text containing `ß…` ([0xDF, 0x85], an accidental valid 2-byte UTF-8 sequence)
        // plus several invalid UTF-8 high bytes (`ü`, `ä`, `ö`, `ß` followed by ASCII).
        let de_with_ellipsis = "1\n00:00:01,000 --> 00:00:04,000\nStra\u{DF}e \u{FC}ber M\u{FC}nchen \u{2014} Ich wei\u{DF}\u{2026} gr\u{F6}\u{DF}er\n";
        let (encoded_de, _, had_de_errors) = encoding_rs::WINDOWS_1252.encode(de_with_ellipsis);
        assert!(!had_de_errors);
        let de_path = dir.join("de_ellipsis.srt");
        std::fs::write(&de_path, encoded_de.as_ref()).unwrap();
        assert_eq!(read_subtitle_string(&de_path).unwrap(), de_with_ellipsis);

        // French Windows-1252 text with `É… été` (`[0xC9, 0x85]` accidental valid 2-byte UTF-8 pair).
        let fr_with_ellipsis = "1\n00:00:01,000 --> 00:00:03,000\n\u{C9}\u{2026} l\u{27}\u{E9}t\u{E9} \u{E0} c\u{F4}t\u{E9}\n";
        let (encoded_fr, _, had_fr_errors) = encoding_rs::WINDOWS_1252.encode(fr_with_ellipsis);
        assert!(!had_fr_errors);
        let fr_path = dir.join("fr_ellipsis.srt");
        std::fs::write(&fr_path, encoded_fr.as_ref()).unwrap();
        assert_eq!(read_subtitle_string(&fr_path).unwrap(), fr_with_ellipsis);

        // Mostly-valid corrupted UTF-8 (`valid_multibyte_utf8 >= fffd_count`) must still stay UTF-8 lossy.
        let mut corrupted_utf8 = "سلام دنیا".as_bytes().to_vec();
        corrupted_utf8.push(0xFF);
        let utf8_path = dir.join("corrupted_utf8.srt");
        std::fs::write(&utf8_path, &corrupted_utf8).unwrap();
        let decoded_utf8 = read_subtitle_string(&utf8_path).unwrap();
        assert!(decoded_utf8.contains("سلام دنیا"));
        assert!(decoded_utf8.contains('\u{FFFD}'));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn parse_translated_lines_reclaims_tentative_clock_time_when_genuine_cue_follows() {
        let order: Vec<usize> = vec![1, 2, 3, 4];
        let response = "\
1: سلام
2: قرارمون توی ایستگاه
3:30 بعدازظهر دقیقاً.
3: متوجه شدم، ممنون!
4: خداحافظ";
        let map = parse_translated_lines(response, &order);
        assert_eq!(map.get(&1).map(String::as_str), Some("سلام"));
        assert_eq!(
            map.get(&2).map(String::as_str),
            Some("قرارمون توی ایستگاه\n3:30 بعدازظهر دقیقاً.")
        );
        assert_eq!(map.get(&3).map(String::as_str), Some("متوجه شدم، ممنون!"));
        assert_eq!(map.get(&4).map(String::as_str), Some("خداحافظ"));

        // Variant with an unnumbered continuation line between the clock time and the genuine cue 3.
        let response_with_cont = "\
1: سلام
2: قرارمون توی ایستگاه
3:30 بعدازظهر دقیقاً
تا ساعت چهار.
3: متوجه شدم!
4: خداحافظ";
        let map_cont = parse_translated_lines(response_with_cont, &order);
        assert_eq!(
            map_cont.get(&2).map(String::as_str),
            Some("قرارمون توی ایستگاه\n3:30 بعدازظهر دقیقاً\nتا ساعت چهار.")
        );
        assert_eq!(map_cont.get(&3).map(String::as_str), Some("متوجه شدم!"));
        assert_eq!(map_cont.get(&4).map(String::as_str), Some("خداحافظ"));
    }

    #[test]
    fn build_request_url_strips_duplicate_models_prefix_for_gemini() {
        let expected = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";
        assert_eq!(
            build_request_url(
                ApiFormat::GeminiResponses,
                "https://generativelanguage.googleapis.com",
                "models/gemini-2.5-flash"
            ),
            expected
        );
        assert_eq!(
            build_request_url(
                ApiFormat::GeminiResponses,
                "https://generativelanguage.googleapis.com/v1beta",
                " models/gemini-2.5-flash "
            ),
            expected
        );
        assert_eq!(
            build_request_url(
                ApiFormat::GeminiResponses,
                "https://generativelanguage.googleapis.com/v1beta/models",
                "models/gemini-2.5-flash"
            ),
            expected
        );
    }

    #[test]
    fn parse_translated_lines_reclaims_stacked_consecutive_clock_times_and_compact_cues() {
        // Two consecutive bare clock times inside cue 2, followed by genuine cues 3 and 4.
        let order: Vec<usize> = vec![1, 2, 3, 4];
        let stacked_resp = "\
1: سلام
2: جلسه از ساعت
3:30 بعدازظهر تا
4:00 عصر ادامه دارد.
3: حتماً شرکت می‌کنم.
4: خداحافظ.";
        let map = parse_translated_lines(stacked_resp, &order);
        assert_eq!(map.get(&1).map(String::as_str), Some("سلام"));
        assert_eq!(
            map.get(&2).map(String::as_str),
            Some("جلسه از ساعت\n3:30 بعدازظهر تا\n4:00 عصر ادامه دارد.")
        );
        assert_eq!(map.get(&3).map(String::as_str), Some("حتماً شرکت می‌کنم."));
        assert_eq!(map.get(&4).map(String::as_str), Some("خداحافظ."));

        // Compact non-spaced genuine cue (`3：متوجه شدم` / `3:متوجه شدم`) reclaims tentative clock line.
        let compact_fullwidth = "\
1: سلام
2: قرارمون
3:30 بعدازظهر
3：متوجه شدم
4: خداحافظ";
        let map_fw = parse_translated_lines(compact_fullwidth, &order);
        assert_eq!(
            map_fw.get(&2).map(String::as_str),
            Some("قرارمون\n3:30 بعدازظهر")
        );
        assert_eq!(map_fw.get(&3).map(String::as_str), Some("متوجه شدم"));
        assert_eq!(map_fw.get(&4).map(String::as_str), Some("خداحافظ"));

        let compact_ascii = "\
1: سلام
2: قرارمون
3:30 بعدازظهر
3:متوجه شدم
4: خداحافظ";
        let map_ascii = parse_translated_lines(compact_ascii, &order);
        assert_eq!(
            map_ascii.get(&2).map(String::as_str),
            Some("قرارمون\n3:30 بعدازظهر")
        );
        assert_eq!(map_ascii.get(&3).map(String::as_str), Some("متوجه شدم"));
        assert_eq!(map_ascii.get(&4).map(String::as_str), Some("خداحافظ"));
    }

    #[test]
    fn apply_auth_headers_trims_api_key_whitespace_and_newlines() {
        let client = reqwest::Client::new();
        let req_openai = apply_auth_headers(
            client.post("https://example.com/v1/chat/completions"),
            ApiFormat::OpenAiCompatible,
            "  sk-test-123\n ",
        )
        .build()
        .expect("OpenAI header must build cleanly with trimmed key");
        assert_eq!(
            req_openai.headers().get("authorization").and_then(|v| v.to_str().ok()),
            Some("Bearer sk-test-123")
        );

        let req_anthropic = apply_auth_headers(
            client.post("https://example.com/v1/messages"),
            ApiFormat::AnthropicMessages,
            "\tsk-ant-456\r\n",
        )
        .build()
        .expect("Anthropic header must build cleanly with trimmed key");
        assert_eq!(
            req_anthropic.headers().get("x-api-key").and_then(|v| v.to_str().ok()),
            Some("sk-ant-456")
        );

        let req_gemini = apply_auth_headers(
            client.post("https://example.com/v1beta/models/gemini:generateContent"),
            ApiFormat::GeminiResponses,
            " AIzaTest789 \n",
        )
        .build()
        .expect("Gemini header must build cleanly with trimmed key");
        assert_eq!(
            req_gemini.headers().get("x-goog-api-key").and_then(|v| v.to_str().ok()),
            Some("AIzaTest789")
        );
    }

    #[test]
    fn phase2_translation_knobs_resolve_and_checkpoint_inspect_clear_work() {
        assert_eq!(
            resolve_effective_custom_prompt("  Project tone  ", "Provider default"),
            "Project tone"
        );
        assert_eq!(
            resolve_effective_custom_prompt("   ", "  Provider default  "),
            "Provider default"
        );
        assert_eq!(resolve_batch_size_cap(0), MAX_ITEMS_PER_CHUNK);
        assert_eq!(resolve_batch_size_cap(10), 10);
        assert_eq!(resolve_batch_size_cap(99), MAX_ITEMS_PER_CHUNK);
        assert!((normalize_translation_temperature(f64::NAN) - 0.3).abs() < f64::EPSILON);
        assert!((normalize_translation_temperature(5.0) - 2.0).abs() < f64::EPSILON);

        let base_dir = std::env::temp_dir().join(format!(
            "whisper-trans-ckpt-cmd-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&base_dir).unwrap();
        let sub_path = base_dir.join("movie.srt");
        let content = "1\n00:00:01,000 --> 00:00:02,000\nHello\n\n2\n00:00:03,000 --> 00:00:04,000\nWorld\n";
        fs::write(&sub_path, content).unwrap();

        let provider = AiProvider {
            name: "OpenAI".to_string(),
            base_url: "https://api.openai.com/v1".to_string(),
            api_key: "sk-test".to_string(),
            api_format: "Chat completions".to_string(),
            use_keyring: false,
            models: vec![AiModel {
                id: "gpt-4o".to_string(),
                context_window: 128_000,
                max_output_tokens: None,
                reasoning: "None".to_string(),
                supports_reasoning: None,
                vision: false,
                enabled: true,
            }],
            custom_prompt: "Provider default".to_string(),
        };

        let mut settings = WhisperSettings::default_settings();
        settings.translate_ai_provider = "OpenAI".to_string();
        settings.translate_ai_model = "gpt-4o".to_string();
        settings.translate_ai_target_lang = "Persian".to_string();
        settings.translate_ai_custom_prompt = "Override prompt".to_string();
        settings.translate_ai_providers = serde_json::to_string(&vec![provider]).unwrap();

        let effective_prompt = build_system_prompt(
            resolve_effective_custom_prompt(&settings.translate_ai_custom_prompt, "Provider default"),
            &settings.translate_ai_target_lang,
            settings.translate_ai_polish,
        );
        let mut map = HashMap::new();
        map.insert(1usize, "سلام".to_string());
        let ckpt = crate::translation::checkpoint::TranslationCheckpoint::new(
            "movie.srt",
            "fa",
            "srt",
            "OpenAI",
            "gpt-4o",
            &effective_prompt,
            content,
            map,
        );
        crate::translation::checkpoint::save(&base_dir, "movie.fa.srt", &ckpt).unwrap();

        let info = inspect_checkpoint(&settings, sub_path.to_str().unwrap(), None).unwrap();
        assert_eq!(info.translated_lines, 1);
        assert_eq!(info.total_lines, 2);

        assert!(clear_checkpoint(&settings, sub_path.to_str().unwrap(), None));
        assert!(inspect_checkpoint(&settings, sub_path.to_str().unwrap(), None).is_none());
        assert!(!clear_checkpoint(&settings, sub_path.to_str().unwrap(), None));

        let _ = fs::remove_dir_all(&base_dir);
    }
}
