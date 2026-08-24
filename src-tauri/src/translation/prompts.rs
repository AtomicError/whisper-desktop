//! System prompt definitions and generator.

pub const DEFAULT_SYSTEM_PROMPT: &str =
    "You are a professional translator. Respond only with the content, either translated or rewritten. Do not add explanations, comments, or any extra text.";

pub fn build_system_prompt(custom_prompt: &str, target_lang: &str, polish: bool) -> String {
    let base_prompt = if custom_prompt.trim().is_empty() {
        DEFAULT_SYSTEM_PROMPT
    } else {
        custom_prompt
    };

    let mut prompt = format!(
        "{}\n\n\
        You are translating spoken subtitle dialogues into {}.\n\
        Maintain absolute narrative continuity, character speech tone, and consistent gender pronouns across all dialogue lines.\n",
        base_prompt, target_lang
    );

    if polish {
        prompt.push_str(
            "Translation Quality Directive: Deliver an accurate, high-quality translation of spoken dialogue. \
            Ensure the translation is fully faithful to the original content and nuances, maintaining complete narrative integrity while expressing the dialogue in natural, idiomatic, and fluent spoken language.\n"
        );
    } else {
        prompt.push_str(
            "Translation Quality Directive: Translate accurately with full contextual understanding, maintaining original speech tone and nuances.\n"
        );
    }

    prompt.push_str(
        "Strict Formatting Rules:\n\
        1. Output ONLY the lines requested under '[Lines to Translate]' in the exact numbered format: 'Number: Translated Text'.\n\
        2. If previous lines are provided under '[Previous Context]', use them for narrative understanding ONLY — do NOT translate or output them.\n\
        3. Output exactly one translation line per numbered entry.\n\
        4. Do NOT skip any numbers, do NOT merge lines, and do NOT alter the sequence numbers.\n\
        5. If a line contains only punctuation, formatting tags, or sound effects, preserve it accurately.\n\
        6. Preserve speaker dashes (such as '- ') at the beginning of dialogue lines if present in the original text.\n\
        7. Return ONLY the translated numbered list without any preambles, explanations, markdown fences, or closing notes."
    );

    prompt
}
