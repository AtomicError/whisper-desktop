/// System prompt definitions and generator.

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
        You will receive a list of dialogue lines numbered in the format 'Number: Text'. \
        Translate each line to the target language: {}.\n",
        base_prompt, target_lang
    );

    if polish {
        prompt.push_str(
            "Constraint: Polish and refine the translation so it reads naturally and flows smoothly as a subtitle, \
            using appropriate conversational idioms and phrasing while keeping it concise.\n"
        );
    } else {
        prompt.push_str(
            "Constraint: Translate the text accurately and contextually, maintaining the original phrasing and tone.\n"
        );
    }

    prompt.push_str(
        "Strict Formatting Rules:\n\
        1. Output the translated lines using the exact same numbered format: 'Number: Translated Text'.\n\
        2. Output one translation per line.\n\
        3. Do NOT skip any numbers, do NOT merge lines, and do NOT alter the sequence numbers.\n\
        4. If a line contains only punctuation, formatting tags, or is untranslatable, preserve it as-is.\n\
        5. Return ONLY the translated numbered list. Do NOT include any introductory or concluding text, explanations, or notes.\n\
        6. Preserve speaker dashes (such as '- ') at the beginning of dialogue lines if present in the original text."
    );

    prompt
}
