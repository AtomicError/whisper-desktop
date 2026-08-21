/// Dialogue line chunker.
/// Groups numbered lines into chunks such that the total estimated size (in characters)
/// of each chunk remains within the specified context limit.

pub fn chunk_dialogues(
    entries: &[(usize, String)],
    context_limit: usize,
) -> Vec<Vec<(usize, String)>> {
    let mut chunks = Vec::new();
    let mut current_chunk = Vec::new();
    let mut current_len = 0;

    // Use conservative estimation with a proportional safety margin (up to 20% of context, capped at 5000)
    let safety_margin = (context_limit / 5).min(5000);
    let safety_limit = context_limit.saturating_sub(safety_margin).max(100);

    // Limit the maximum number of items in a single chunk to 30 for fast real-time progress updates and optimal LLM output accuracy
    let max_items = 30;

    for entry in entries {
        // Estimate entry length: the line index digits + separator + text length
        let entry_len = entry.1.len() + 15; 
        
        if !current_chunk.is_empty() && (current_len + entry_len > safety_limit || current_chunk.len() >= max_items) {
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
    fn respects_context_limit() {
        // Each entry ~ 300 + 15 chars; safety limit 2000 forces ~6 per chunk
        let chunks = chunk_dialogues(&entries(10, 300), 2000);
        assert!(chunks.len() > 1);
        for chunk in &chunks {
            let total: usize = chunk.iter().map(|(_, t)| t.len() + 15).sum();
            assert!(total <= 2000);
        }
    }

    #[test]
    fn oversized_single_entry_still_included() {
        let chunks = chunk_dialogues(&[(1, "y".repeat(5000))], 6000);
        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0][0].0, 1);
    }
}
