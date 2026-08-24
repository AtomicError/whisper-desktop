use crate::settings::WhisperSettings;
use crate::logger::AppLogs;
use crate::translation::chunker::chunk_dialogues;
use crate::translation::formatter::ParsedSubtitle;
use crate::translation::prompts::build_system_prompt;
use crate::translation::provider::{get_keyring_key, AiProvider, ApiFormat, ANTHROPIC_VERSION};
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
    RE.get_or_init(|| {
        regex::Regex::new(r"^\d{1,3}\s*[:：]\s*\d{1,2}\s*[:：]").expect("static regex")
    })
    .is_match(line)
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

/// Maps common target languages to their standard ISO 2-letter codes.
/// Falls back to the lowercase language name if not found.
pub fn get_language_code(lang: &str) -> String {
    match lang.to_lowercase().as_str() {
        "persian" | "farsi" => "fa".to_string(),
        "spanish" => "es".to_string(),
        "french" => "fr".to_string(),
        "german" => "de".to_string(),
        "italian" => "it".to_string(),
        "russian" => "ru".to_string(),
        "chinese" | "chinese (simplified)" => "zh".to_string(),
        "chinese (traditional)" => "zh-TW".to_string(),
        "arabic" => "ar".to_string(),
        "turkish" => "tr".to_string(),
        "portuguese" => "pt".to_string(),
        "japanese" => "ja".to_string(),
        "korean" => "ko".to_string(),
        "english" => "en".to_string(),
        "dutch" => "nl".to_string(),
        "polish" => "pl".to_string(),
        "swedish" => "sv".to_string(),
        "norwegian" => "no".to_string(),
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
        "pashto" => "ps".to_string(),
        "azerbaijani" => "az".to_string(),
        "uzbek" => "uz".to_string(),
        "kazakh" => "kk".to_string(),
        "tagalog" | "filipino" => "tl".to_string(),
        "swahili" => "sw".to_string(),
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
fn parse_response_content(api_format: ApiFormat, response_val: &Value) -> Result<String, String> {
    let trunc = |v: &Value| safe_truncate(&format!("{:?}", v), 500);
    match api_format {
        ApiFormat::AnthropicMessages => response_val["content"][0]["text"]
            .as_str()
            .map(|s| s.to_string())
            .ok_or_else(|| format!("Invalid Anthropic response format: {}", trunc(response_val))),
        ApiFormat::GeminiResponses => {
            // Gemini
            response_val["candidates"][0]["content"]["parts"][0]["text"]
                .as_str()
                .map(|s| s.to_string())
                .ok_or_else(|| format!("Invalid Gemini response format: {}", trunc(response_val)))
        }
        ApiFormat::OpenAiCompatible => {
            // OpenAI compatible
            response_val["choices"][0]["message"]["content"]
                .as_str()
                .map(|s| s.to_string())
                .ok_or_else(|| format!("Invalid OpenAI response format: {}", trunc(response_val)))
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
                    // Disambiguation: "12:30 نیمه‌شب" where 12 was NOT the
                    // cue we were waiting for and is not an allowed cue is
                    // dialogue starting with a time. If it IS an allowed future
                    // cue and has dialogue text, accept it.
                    let next_expected = expected_order.get(expect_pos).copied();
                    let is_expected_ahead = expected_order.get(expect_pos..)
                        .map(|slice| slice.contains(&idx))
                        .unwrap_or(false);
                    let is_timecode_like = looks_like_numbered_timecode(trimmed);

                    let should_accept = Some(idx) == next_expected
                        || (!is_timecode_like && in_allowed(idx))
                        || (is_expected_ahead && in_allowed(idx) && !val_cap.as_str().trim().is_empty());

                    if should_accept {
                        if !in_allowed(idx) {
                            continue;
                        }
                        if let Some(pos) = expected_order.iter().position(|&e| e == idx) {
                            expect_pos = pos + 1;
                        }
                        let text = val_cap.as_str().trim().to_string();
                        if !text.is_empty() {
                            map.insert(idx, text);
                        }
                        current_idx = Some(idx);
                        continue;
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

pub fn negotiate_parameter_error(
    err_text: &str,
    options: &mut crate::translation::provider::RequestOptions,
    app: &AppHandle,
    logs: &AppLogs,
) -> bool {
    if options.include_temperature && is_unsupported_parameter_error(err_text, "temperature") {
        logs.log(
            app,
            "Translate",
            "API rejected 'temperature'; disabling temperature and retrying immediately",
        );
        options.include_temperature = false;
        return true;
    }

    if is_unsupported_parameter_error(err_text, "max_tokens") {
        let lower = err_text.to_lowercase();
        if lower.contains("max_completion_tokens") && !options.use_max_completion_tokens {
            logs.log(
                app,
                "Translate",
                "API requires 'max_completion_tokens' instead of 'max_tokens'; switching and retrying",
            );
            options.use_max_completion_tokens = true;
            return true;
        } else if options.max_output_tokens.is_some() {
            logs.log(
                app,
                "Translate",
                "API rejected 'max_tokens'; omitting parameter and retrying",
            );
            options.max_output_tokens = None;
            return true;
        }
    }

    if options.reasoning_effort.is_some() && is_unsupported_parameter_error(err_text, "reasoning_effort") {
        logs.log(
            app,
            "Translate",
            "API rejected 'reasoning_effort'; omitting parameter and retrying",
        );
        options.reasoning_effort = None;
        return true;
    }

    if !options.system_in_user && is_unsupported_system_role_error(err_text) {
        logs.log(
            app,
            "Translate",
            "API rejected 'system' message role; merging system prompt into user message and retrying",
        );
        options.system_in_user = true;
        return true;
    }

    false
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
                s.starts_with("- ") || s.starts_with('—') || s.starts_with('–') || s == "-"
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

/// Minimal percent-encoding for query parameter values (API keys).
fn percent_encode(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for b in value.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}

/// Reads a subtitle file tolerating non-UTF-8 encodings.
///
/// Multi-tier decoding:
/// 1. Fast path: exact UTF-8 (the vast majority of modern subtitles).
/// 2. UTF-16 LE/BE with BOM (common from specialized subtitle tools).
/// 3. UTF-8 with BOM or lossy UTF-8: if the file is mostly valid UTF-8
///    (e.g. Persian/Arabic text with isolated byte corruption), lossy decode
///    preserves the text instead of ruining the entire file into Windows-1252 mojibake.
/// 4. Windows-1252 / Latin-1 decode for genuine legacy European subtitles.
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

    // If the file contains valid multi-byte non-ASCII UTF-8 characters (e.g.
    // Persian, Arabic, Cyrillic, CJK, or multi-byte accented letters), it is
    // genuinely a UTF-8 file with isolated byte errors — preserve it as lossy
    // UTF-8 rather than corrupting the entire text into Windows-1252 mojibake.
    let has_valid_multibyte_utf8 = decoded_utf8
        .chars()
        .any(|c| c > '\u{7F}' && c != '\u{FFFD}');

    if has_valid_multibyte_utf8 {
        return Ok(decoded_utf8.into_owned());
    }

    // 4. Legacy single-byte subtitle encodings (Latin-1 / Windows-1252 family)
    let (decoded_1252, _, _) = encoding_rs::WINDOWS_1252.decode(&bytes);
    Ok(decoded_1252.into_owned())
}

pub(crate) fn append_query_param(url: &str, key: &str, value: &str) -> String {
    let sep = if url.contains('?') { '&' } else { '?' };
    format!("{}{}{}={}", url, sep, key, percent_encode(value))
}

/// Builds the final request URL from provider settings. Shared by
/// `translate_files` and `preview_translate` so both paths cannot drift apart.
fn build_request_url(
    api_format: ApiFormat,
    base_url: &str,
    model: &str,
    api_key: &str,
) -> String {
    let mut request_url = base_url.to_string();
    match api_format {
        ApiFormat::AnthropicMessages => {
            if !request_url.contains("/messages") {
                let clean_base = request_url.trim_end_matches('/');
                if clean_base.ends_with("/v1") {
                    request_url = format!("{}/messages", clean_base);
                } else {
                    request_url = format!("{}/v1/messages", clean_base);
                }
            }
        }
        ApiFormat::GeminiResponses => {
            if !request_url.contains("/models/") {
                let clean_base = request_url.trim_end_matches('/');
                if clean_base.ends_with("/v1beta") {
                    request_url = format!("{}/models/{}:generateContent", clean_base, model);
                } else {
                    request_url = format!("{}/v1beta/models/{}:generateContent", clean_base, model);
                }
            }
            // Key travels in the query string (Gemini convention). Encode it
            // and respect pre-existing query parameters.
            if !api_key.is_empty() {
                request_url = append_query_param(&request_url, "key", api_key);
            }
        }
        ApiFormat::OpenAiCompatible => {
            if !request_url.contains("/chat/completions") {
                let clean_base = request_url.trim_end_matches('/');
                request_url = format!("{}/chat/completions", clean_base);
            }
        }
    }
    request_url
}

/// Applies auth headers. Gemini needs none (key lives in the URL).
fn apply_auth_headers(
    req: reqwest::RequestBuilder,
    api_format: ApiFormat,
    api_key: &str,
) -> reqwest::RequestBuilder {
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
        ApiFormat::GeminiResponses => req,
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
    let request_url = build_request_url(api_format, &provider.base_url, model, api_key);

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
                if attempt < MAX_TRANSIENT_RETRIES {
                    attempt += 1;
                    logs.log(app, "Translate", &format!("Network error ({}), retry {}/{} in {}s", e, attempt, MAX_TRANSIENT_RETRIES, attempt));
                    tokio::time::sleep(std::time::Duration::from_secs(attempt as u64)).await;
                    continue;
                }
                return Err(format!("HTTP request to {} failed: {}", provider.name, e));
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

            // 1. Universal Parameter Negotiation: If the API rejected any parameter,
            // adapt options in-place and retry immediately.
            if (status.as_u16() == 400 || status.as_u16() == 422)
                && negotiate_parameter_error(&err_text, options, app, logs)
            {
                continue;
            }

            // 2. Reactive context-limit recovery: report back so the caller can
            // shrink the window and re-chunk.
            if let Some(exact) = parse_context_limit_from_error(&err_text) {
                logs.log(app, "Translate", &format!("Context limit hit; API reported exact window: {} tokens", exact));
                return Ok(ChunkOutcome::ContextLimitExceeded(Some(exact)));
            }
            if is_context_length_error(&err_text) {
                logs.log(app, "Translate", "Context limit hit; no exact number in error, will halve the window");
                return Ok(ChunkOutcome::ContextLimitExceeded(None));
            }

            // 3. Reactive output-cap recovery: Anthropic rejects an oversized
            // `max_tokens` with 400 + the exact allowed value. Learn it once,
            // persist it, and every later request is right from the start.
            if status.as_u16() == 400 {
                if let Some(cap) = parse_output_cap_from_error(&err_text) {
                    logs.log(app, "Translate", &format!("max_tokens rejected; learned exact output cap: {} tokens", cap));
                    return Ok(ChunkOutcome::OutputCapExceeded(Some(cap)));
                }
                if is_max_tokens_error(&err_text) {
                    logs.log(app, "Translate", "max_tokens rejected; no exact number in error, will halve the cap");
                    return Ok(ChunkOutcome::OutputCapExceeded(None));
                }
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
                tokio::time::sleep(std::time::Duration::from_secs(delay)).await;
                continue;
            }

            return Err(format!(
                "API returned error status ({}): {}",
                status, err_text
            ));
        }

        let res_json: Value = tokio::select! {
            biased;
            _ = cancellation_poller(session.clone()) => {
                emit_cancelled(app, last_progress);
                return Err(TRANSLATION_CANCELLED_MSG.to_string());
            }
            json_res = res.json() => json_res.map_err(|e| format!("Failed to parse response JSON: {}", e))?,
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
) -> Result<Vec<String>, String> {
    if !settings.translate_ai_enabled {
        return Ok(Vec::new());
    }

    if settings.translate_ai_model.trim().is_empty() {
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

    if provider.base_url.trim().is_empty() {
        return Err(format!(
            "Provider '{}' has no Base URL configured.",
            provider.name
        ));
    }

    // Validate the wire protocol ONCE, up front: an unknown format string is
    // a configuration error and must fail loudly instead of silently
    // degrading to the OpenAI-compatible request shape.
    let api_format = ApiFormat::parse(&provider.api_format)?;

    // Fetch API Key (Keyring or plaintext)
    let api_key = if provider.use_keyring {
        get_keyring_key(&provider.name)
            .map_err(|e| format!("Could not retrieve key from system keyring: {}", e))?
    } else {
        provider.api_key.clone()
    };

    // Check if model exists and get its limits. These mutable copies live
    // OUTSIDE the file loop so reactively-discovered limits propagate to
    // subsequent files instead of being re-learned per file.
    let active_model = provider
        .models
        .iter()
        .find(|m| m.id == settings.translate_ai_model);
    let mut context_window = active_model
        .map(|m| m.context_window)
        .filter(|&w| w > 0)
        .unwrap_or(DEFAULT_CONTEXT_TOKENS);
    // Per-model output cap: user-configured or learned from a prior 400.
    // `None` = auto mode (conservative default, reactive discovery).
    let mut max_output_override = active_model.and_then(|m| m.max_output_tokens).filter(|&t| t >= MIN_OUTPUT_TOKENS);

    let mut request_options = crate::translation::provider::RequestOptions {
        max_output_tokens: if api_format == ApiFormat::AnthropicMessages {
            Some(estimate_max_output_tokens(0, max_output_override))
        } else {
            None
        },
        reasoning_effort: active_model.and_then(|m| {
            let r = m.reasoning.trim().to_lowercase();
            if r == "low" || r == "medium" || r == "high" {
                Some(m.reasoning.clone())
            } else {
                None
            }
        }),
        ..crate::translation::provider::RequestOptions::default()
    };

    let lang_code = get_language_code(&settings.translate_ai_target_lang);
    let mut successfully_translated = Vec::new();

    // Mark the session as translating and install a guard that resets the
    // state (phase + cancel flag) no matter how this function exits.
    // Refuses to clobber an ACTIVE session: unlike transcription paths this
    // check was historically missing, letting a parallel translation reset
    // a running transcription's phase to Idle mid-flight.
    let mut session_busy = false;
    with_session(&session, |s| {
        if s.phase != crate::SessionPhase::Idle {
            session_busy = true;
        } else {
            s.phase = crate::SessionPhase::Translating;
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

    if !generated_files.is_empty() {
        emit_status(&app, 0.0, "Translating with AI…", true, None);
        logs.log(&app, "Translate", &format!(
            "Starting AI translation of {} file(s) → '{}' via '{}' (model: {}, ctx: {} tokens, max_output: {})",
            generated_files.len(),
            settings.translate_ai_target_lang,
            provider.name,
            settings.translate_ai_model,
            context_window,
            match max_output_override { Some(t) => t.to_string(), None => "auto".to_string() }
        ));
    }

    let client = build_http_client();
    let mut last_progress = 0.0_f64;

    for (file_idx, file_name) in generated_files.iter().enumerate() {
        // Honour a cancel request between files.
        if is_cancelled(&session) {
            emit_cancelled(&app, last_progress);
            return Err(TRANSLATION_CANCELLED_MSG.to_string());
        }

        let input_path = Path::new(&parent_dir).join(file_name);
        if !input_path.exists() {
            logs.log(&app, "Translate", &format!("Skipped '{}': file not found", file_name));
            continue;
        }

        let ext = match input_path.extension().and_then(|s| s.to_str()) {
            Some(e) => e.to_lowercase(),
            None => {
                logs.log(&app, "Translate", &format!("Skipped '{}': no extension", file_name));
                continue;
            }
        };

        if ext != "srt" && ext != "vtt" && ext != "lrc" && ext != "txt" {
            logs.log(&app, "Translate", &format!("Skipped '.{}': unsupported subtitle format", ext));
            continue;
        }

        // Output file path: e.g. "movie.fa.srt"
        let base_stem = input_path.file_stem().unwrap_or_default().to_string_lossy();
        let output_file_name = format!("{}.{}.{}", base_stem, lang_code, ext);
        let output_path = Path::new(&parent_dir).join(&output_file_name);

        let content = read_subtitle_string(&input_path)?;

        let parsed = ParsedSubtitle::parse(&content, &ext);

        // Extract dialogue entries (1-based index, text)
        let original_entries: Vec<(usize, String)> = parsed
            .cues
            .iter()
            .map(|c| (c.index, c.text.clone()))
            .collect();

        if original_entries.is_empty() {
            // Empty dialogues, just clone the file
            fs::write(&output_path, &content)
                .map_err(|e| format!("Failed to write output translated file: {}", e))?;
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
        if let Some(ckpt) = crate::translation::checkpoint::load(
            Path::new(&parent_dir),
            &output_file_name,
            file_name,
            &lang_code,
            &ext,
            &settings.translate_ai_provider,
            &settings.translate_ai_model,
            &content,
        ) {
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
        emit_status(
            &app,
            initial_progress,
            &initial_msg,
            true,
            Some((
                translations_map.len(),
                total_lines,
                file_idx + 1,
                total_files,
            )),
        );
        last_progress = initial_progress;

        let mut stall_rounds: usize = 0;

        'chunk_loop: while !remaining_entries.is_empty() {
            // Honour a cancel request between chunks.
            if is_cancelled(&session) {
                emit_cancelled(&app, last_progress);
                return Err(TRANSLATION_CANCELLED_MSG.to_string());
            }

            let chunks = chunk_dialogues(&remaining_entries, context_window);
            let Some(chunk) = chunks.into_iter().next() else {
                break;
            };

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
            emit_status(
                &app,
                global_progress,
                &msg,
                true,
                Some((
                    current_translated_lines,
                    total_lines,
                    file_idx + 1,
                    total_files,
                )),
            );
            last_progress = global_progress;

            let system_prompt = build_system_prompt(
                &provider.custom_prompt,
                &settings.translate_ai_target_lang,
                settings.translate_ai_polish,
            );

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

            let outcome = translate_chunk(
                &app,
                session.clone(),
                &client,
                provider,
                api_format,
                &api_key,
                &settings.translate_ai_model,
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
            .await?;

            match outcome {
                ChunkOutcome::ContextLimitExceeded(parsed_exact) => {
                    // Prefer the exact limit reported by the API; fall back
                    // to halving. Then let the outer loop re-chunk.
                    let new_limit = parsed_exact
                        .filter(|&limit| limit < context_window)
                        .unwrap_or(context_window / 2);
                    if new_limit < 1024 {
                        return Err(format!(
                            "Model context window ({}) is too small to translate even a single dialogue line.",
                            new_limit
                        ));
                    }
                    context_window = new_limit;
                    let _ = update_model_limits(
                        &settings.translate_ai_provider,
                        &settings.translate_ai_model,
                        Some(new_limit),
                        None,
                    );
                    continue 'chunk_loop;
                }
                ChunkOutcome::OutputCapExceeded(exact_cap) => {
                    // Anthropic rejected max_tokens as too large. Use the
                    // exact cap when the error named it, otherwise halve —
                    // then persist so future runs start correct.
                    let current = max_output_override.unwrap_or_else(|| {
                        estimate_max_output_tokens(0, None)
                    });
                    if current <= MIN_OUTPUT_TOKENS && exact_cap.is_none() {
                        return Err(format!(
                            "Model rejected every output cap down to {} tokens; its max_tokens limit could not be satisfied.",
                            MIN_OUTPUT_TOKENS
                        ));
                    }
                    let new_cap = exact_cap
                        .filter(|&cap| cap < max_output_override.unwrap_or(u32::MAX))
                        .unwrap_or_else(|| {
                            (current / 2).max(MIN_OUTPUT_TOKENS)
                        });
                    if new_cap < MIN_OUTPUT_TOKENS {
                        return Err(format!(
                            "Model output cap ({} tokens) is too small to translate dialogue lines.",
                            new_cap
                        ));
                    }
                    max_output_override = Some(new_cap);
                    let _ = update_model_limits(
                        &settings.translate_ai_provider,
                        &settings.translate_ai_model,
                        None,
                        Some(new_cap),
                    );
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
                            &settings.translate_ai_model,
                            &content,
                            translations_map.clone(),
                        );
                        if let Err(e) = crate::translation::checkpoint::save(
                            Path::new(&parent_dir),
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
                    emit_status(
                        &app,
                        global_progress,
                        &msg,
                        true,
                        Some((
                            current_translated_lines,
                            total_lines,
                            file_idx + 1,
                            total_files,
                        )),
                    );
                    last_progress = global_progress;
                }
            }
        }

        // Check cancellation before writing the file to prevent completing
        // even when the in-flight poll missed the flag (e.g. fast API response).
        if is_cancelled(&session) {
            emit_cancelled(&app, last_progress);
            return Err(TRANSLATION_CANCELLED_MSG.to_string());
        }

        // Report any cues that could not be translated (they fall back to the
        // original text at reconstruction time) instead of hiding the gap.
        let untranslated = original_entries
            .iter()
            .filter(|(idx, _)| !translations_map.contains_key(idx))
            .count();
        if untranslated > 0 {
            emit_status(
                &app,
                last_progress,
                &format!(
                    "{} line(s) could not be translated and were kept in the original language.",
                    untranslated
                ),
                true,
                Some((
                    total_lines - untranslated,
                    total_lines,
                    file_idx + 1,
                    total_files,
                )),
            );
        }

        // Reconstruct and save
        let reconstructed = parsed.reconstruct(&translations_map);
        fs::write(&output_path, reconstructed)
            .map_err(|e| format!("Failed to write output translated file: {}", e))?;

        // File is fully written: the checkpoint has served its purpose.
        crate::translation::checkpoint::remove(Path::new(&parent_dir), &output_file_name);

        successfully_translated.push(output_file_name);
    }

    // Terminal event is UNCONDITIONAL: even when every file was skipped
    // (missing / unsupported extension) the frontend must be released from
    // its active state instead of waiting on an event that never arrives.
    if successfully_translated.is_empty() {
        emit_status(&app, 1.0, "Nothing to translate", false, None);
        logs.log(&app, "Translate", "Finished: no file produced a translation");
    } else {
        emit_status(&app, 1.0, "AI translation complete", false, None);
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
/// pipeline there is no fallback-to-original masking here, because this path
/// exists precisely to detect broken configurations.
pub async fn preview_translate(
    app: AppHandle,
    logs: Arc<AppLogs>,
    settings: WhisperSettings,
    file_content: String,
) -> Result<String, String> {
    logs.log(&app, "Translate", &format!(
        "Preview requested (provider: '{}', model: '{}')",
        settings.translate_ai_provider, settings.translate_ai_model
    ));
    if settings.translate_ai_model.trim().is_empty() {
        return Err("No active translation model is selected. Please configure and select a model under your active provider first.".to_string());
    }

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

    if provider.base_url.trim().is_empty() {
        return Err(format!(
            "Provider '{}' has no Base URL configured.",
            provider.name
        ));
    }

    let api_format = ApiFormat::parse(&provider.api_format)?;

    let api_key = if provider.use_keyring {
        get_keyring_key(&provider.name)
            .map_err(|e| format!("Could not retrieve key from system keyring: {}", e))?
    } else {
        provider.api_key.clone()
    };

    let format = if file_content.contains("-->") {
        if file_content.trim_start().starts_with("WEBVTT") {
            "vtt"
        } else {
            "srt"
        }
    } else if file_content.lines().any(|l| l.trim_start().starts_with('[') && l.contains(']')) {
        "lrc"
    } else {
        "txt"
    };

    let parsed = ParsedSubtitle::parse(&file_content, format);
    let original_entries: Vec<(usize, String)> = parsed
        .cues
        .iter()
        .take(3) // preview only first 3 lines
        .map(|c| (c.index, c.text.clone()))
        .collect();

    if original_entries.is_empty() {
        return Err("No dialogues found in the provided preview content.".to_string());
    }

    let client = build_http_client();
    let system_prompt = build_system_prompt(
        &provider.custom_prompt,
        &settings.translate_ai_target_lang,
        settings.translate_ai_polish,
    );

    let user_content = original_entries
        .iter()
        .map(|(idx, text)| format!("{}: {}", idx, text))
        .collect::<Vec<String>>()
        .join("\n");

    let mut request_options = crate::translation::provider::RequestOptions {
        max_output_tokens: if api_format == ApiFormat::AnthropicMessages {
            Some(estimate_max_output_tokens(system_prompt.len() + user_content.len(), None))
        } else {
            None
        },
        ..crate::translation::provider::RequestOptions::default()
    };

    // Preview has no cancel channel, but the client timeout still bounds it.
    let outcome = tokio::time::timeout(
        std::time::Duration::from_secs(REQUEST_TIMEOUT_SECS),
        async {
            let mut attempt: usize = 0;
            loop {
                let request_body = provider.format_request_body_ext(
                    &settings.translate_ai_model,
                    &system_prompt,
                    &user_content,
                    &request_options,
                )?;
                let request_url = build_request_url(
                    api_format,
                    &provider.base_url,
                    &settings.translate_ai_model,
                    &api_key,
                );
                let req = apply_auth_headers(
                    client.post(&request_url).json(&request_body),
                    api_format,
                    &api_key,
                );

                let res = req
                    .send()
                    .await
                    .map_err(|e| format!("Request failed: {}", e))?;

                if !res.status().is_success() {
                    let status = res.status();
                    let err_text = res.text().await.unwrap_or_default();
                    if (status.as_u16() == 400 || status.as_u16() == 422)
                        && attempt < 3
                        && negotiate_parameter_error(&err_text, &mut request_options, &app, &logs)
                    {
                        attempt += 1;
                        continue;
                    }
                    return Err(format!(
                        "API returned error status ({}): {}",
                        status, err_text
                    ));
                }

                let res_json: Value = res
                    .json()
                    .await
                    .map_err(|e| format!("Failed to parse JSON response: {}", e))?;

                return parse_response_content(api_format, &res_json);
            }
        },
    )
    .await
    .map_err(|_| format!("Request timed out after {} seconds.", REQUEST_TIMEOUT_SECS))??;

    let chunk_translations = align_translations(&original_entries, &outcome, false);
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
        let (translated, marker) = match chunk_translations.get(&entry.0) {
            Some(t) if !t.is_empty() && t != &entry.1 => (t.clone(), ""),
            _ => (entry.1.clone(), "  [not translated]"),
        };
        preview_lines.push(format!(
            "Original ({}): {}\nTranslated: {}{}",
            entry.0, entry.1, translated, marker
        ));
    }

    Ok(preview_lines.join("\n\n"))
}

fn context_limit_patterns() -> &'static [regex::Regex] {
    static PATTERNS: OnceLock<Vec<regex::Regex>> = OnceLock::new();
    PATTERNS.get_or_init(|| {
        vec![
            regex::Regex::new(r"max_model_len\s*(?:is\s*)?[:=(]?\s*(\d{4,})").expect("static regex"),
            regex::Regex::new(r"maximum model length\s*(?:is\s*)?[:=(]?\s*(\d{4,})").expect("static regex"),
            regex::Regex::new(r"(?:max(?:imum)?|limit)\s*(?:context\s*)?(?:length|size|window)?\s*(?:is|of|:)?\s*(\d{4,})").expect("static regex"),
            regex::Regex::new(r"context\s*(?:length|size|window)\s*(?:is|of|:)?\s*(\d{4,})").expect("static regex"),
            regex::Regex::new(r"(\d{4,})\s*(?:token)?\s*(?:context|limit)").expect("static regex"),
            regex::Regex::new(r">\s*(\d{4,})\s*(?:max|limit|token)").expect("static regex"),
            regex::Regex::new(r"(\d{4,})\s*(?:max(?:imum)?)\b").expect("static regex"),
        ]
    })
}

fn parse_context_limit_from_error(error_msg: &str) -> Option<usize> {
    let error_lower = error_msg.to_lowercase();
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

fn is_context_length_error(error_msg: &str) -> bool {
    let error_lower = error_msg.to_lowercase();
    error_lower.contains("context")
        && (error_lower.contains("exceed")
            || error_lower.contains("too long")
            || error_lower.contains("too large")
            || error_lower.contains("overflow")
            || error_lower.contains("limit"))
}

fn output_cap_patterns() -> &'static [regex::Regex] {
    static PATTERNS: OnceLock<Vec<regex::Regex>> = OnceLock::new();
    PATTERNS.get_or_init(|| {
        vec![
            // Anthropic: "max_tokens: 100000 > 64000 (maximum allowed)"
            regex::Regex::new(r"maximum\s+(?:allowed|permitted)\s*(?:is|:)?\s*(\d{3,})").expect("static regex"),
            regex::Regex::new(r"max_tokens[^\n]{0,80}?(\d{3,})\s*\([^)]*maximum").expect("static regex"),
            regex::Regex::new(r"(\d{3,})\s*(?:is\s*)?the\s*(?:maximum|max)\s*(?:allowed|value)").expect("static regex"),
        ]
    })
}

/// Extracts the model's exact `max_tokens` cap from an API rejection body.
/// Bounded to [1024, 200_000] so prose numbers never poison the setting.
fn parse_output_cap_from_error(error_msg: &str) -> Option<u32> {
    let error_lower = error_msg.to_lowercase();
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
    (e.contains("max_tokens") || e.contains("max tokens"))
        && (e.contains("exceed") || e.contains("too large") || e.contains("too big")
            || e.contains("invalid") || e.contains("greater than")
            || e.contains("above") || e.contains("over"))
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
) -> Result<(), String> {
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
                settings.translate_ai_providers = serde_json::to_string(&providers)
                    .map_err(|e| format!("Failed to serialize providers: {}", e))?;
            }
        }
        Ok::<(), String>(())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

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
        assert!(map.get(&9).is_none(), "cue 9 must not be hijacked");
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
}
