/// Dialogue line chunker.
///
/// The model context window is expressed in TOKENS, but we measure dialogue
/// lines in BYTES (`String::len()`). We bridge the units with a conservative
/// bytes-per-token factor: English averages ~4 B/token, Persian/Arabic run
/// ~4–6 B/token (multi-byte characters), CJK up to 9. Choosing a LOW estimate
/// shrinks chunks — the safe direction.
///
/// A fixed token reserve is subtracted first to pay for parts of the prompt
/// that are not counted per-line: the system prompt, the previous-context
/// lines and numbering overhead.
pub const PROMPT_RESERVE_TOKENS: usize = 2_048;

/// Conservative lower-bound bytes per token across supported languages.
const ESTIMATED_BYTES_PER_TOKEN: usize = 3;

/// Never let the reserve consume the whole budget of small local models.
const MIN_USABLE_TOKENS: usize = 512;

/// Hard cap on items per chunk: keeps LLM output accuracy high and gives
/// fine-grained real-time progress updates.
const MAX_ITEMS_PER_CHUNK: usize = 30;

/// Per-entry overhead beyond raw text: index digits, ": " separator,
/// response-side duplication and JSON escaping slack.
const ENTRY_OVERHEAD_BYTES: usize = 15;

/// Byte budget available for dialogue lines given a model's token window.
pub fn chunk_byte_budget(context_limit_tokens: usize) -> usize {
    let usable_tokens = context_limit_tokens
        .saturating_sub(PROMPT_RESERVE_TOKENS)
        .max(MIN_USABLE_TOKENS);
    let budget_bytes = usable_tokens * ESTIMATED_BYTES_PER_TOKEN;
    // Proportional safety margin for estimation slop, capped so tiny windows
    // don't get squeezed to nothing.
    let margin = (budget_bytes / 5).min(5000);
    budget_bytes.saturating_sub(margin).max(256)
}

pub fn chunk_dialogues(
    entries: &[(usize, String)],
    context_limit_tokens: usize,
) -> Vec<Vec<(usize, String)>> {
    let mut chunks = Vec::new();
    let mut current_chunk = Vec::new();
    let mut current_len = 0;

    let safety_limit = chunk_byte_budget(context_limit_tokens);

    for entry in entries {
        let entry_len = entry.1.len() + ENTRY_OVERHEAD_BYTES;

        if !current_chunk.is_empty()
            && (current_len + entry_len > safety_limit
                || current_chunk.len() >= MAX_ITEMS_PER_CHUNK)
        {
            chunks.push(current_chunk);
            current_chunk = Vec::new();
            current_len = 0;
        }

        current_len += entry_len;
        current_chunk.push(entry.clone());
    }

    if !current_chunk.is_empty() {
        chunks.push(current_chunk);
    }

    chunks
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entries(n: usize, text_len: usize) -> Vec<(usize, String)> {
        (1..=n).map(|i| (i, "x".repeat(text_len))).collect()
    }

    #[test]
    fn empty_input_gives_no_chunks() {
        assert!(chunk_dialogues(&[], 100_000).is_empty());
    }

    #[test]
    fn small_input_is_single_chunk() {
        let chunks = chunk_dialogues(&entries(5, 50), 100_000);
        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0].len(), 5);
    }

    #[test]
    fn respects_item_cap() {
        // 35 items, huge limit -> capped at 30 per chunk
        let chunks = chunk_dialogues(&entries(35, 10), 10_000_000);
        assert_eq!(chunks.len(), 2);
        assert_eq!(chunks[0].len(), 30);
        assert_eq!(chunks[1].len(), 5);
    }

    #[test]
    fn respects_byte_budget_derived_from_token_window() {
        let budget = chunk_byte_budget(2000);
        // Each entry ~ 300 + 15 chars; entries must never exceed the budget.
        let chunks = chunk_dialogues(&entries(10, 300), 2000);
        assert!(chunks.len() > 1);
        for chunk in &chunks {
            let total: usize = chunk
                .iter()
                .map(|(_, t)| t.len() + ENTRY_OVERHEAD_BYTES)
                .sum();
            assert!(total <= budget);
        }
    }

    #[test]
    fn multibyte_text_shrinks_chunks() {
        // Same character count as ASCII test but Persian text is ~2x the
        // bytes, so it must produce at least as many chunks.
        let persian = "سلام علیکم و رحمة الله ".repeat(14); // ~300 chars, ~600 bytes
        let persian_entries: Vec<(usize, String)> =
            (1..=10).map(|i| (i, persian.clone())).collect();
        let ascii_chunks = chunk_dialogues(&entries(10, 300), 8000);
        let persian_chunks = chunk_dialogues(&persian_entries, 8000);
        assert!(persian_chunks.len() >= ascii_chunks.len());
    }

    #[test]
    fn oversized_single_entry_still_included() {
        let chunks = chunk_dialogues(&[(1, "y".repeat(5000))], 6000);
        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0][0].0, 1);
    }

    #[test]
    fn tiny_window_still_yields_progress() {
        // Even an absurdly small window must produce chunks, not panic or loop.
        let chunks = chunk_dialogues(&entries(3, 100), 100);
        assert!(!chunks.is_empty());
    }
}
