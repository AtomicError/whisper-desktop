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

    // Use a conservative token estimation where 1 character = 1 token.
    // Ensure we keep a small safety buffer (e.g. 5000 characters).
    let safety_limit = if context_limit > 5000 {
        context_limit - 5000
    } else {
        context_limit
    };

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
