use regex::Regex;
use std::collections::HashMap;
use std::sync::LazyLock;

static LRC_TS_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^\[(\d{2,3}:\d{2}(?:[.:]\d{2,3})?)\]").expect("valid lrc timestamp regex")
});

/// Determines if a text line contains meaningful translatable content.
/// Pure separators ("---", "***") and music markers ("♪ ♪") carry no
/// translatable content and only pollute the prompt. Meaningful subtitles
/// with alphanumeric characters (including dates, numbers, currencies) are preserved.
fn is_translatable_text(text: &str) -> bool {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return false;
    }
    // Filter pure visual separators
    let is_separator = trimmed
        .chars()
        .all(|c| c == '-' || c == '=' || c == '*' || c == '_' || c == '~' || c == '#' || c == '/');
    if is_separator {
        return false;
    }
    // Filter pure musical notation markers
    let is_music_symbol_only = trimmed
        .chars()
        .all(|c| c == '♪' || c == '♫' || c == '♩' || c == '♬' || c.is_whitespace());
    if is_music_symbol_only {
        return false;
    }
    // Retain anything with alphanumeric characters or standard sentence punctuation
    trimmed.chars().any(|c| c.is_alphanumeric())
}

#[derive(Clone, Debug)]
pub struct TimedCue {
    pub index: usize,           // 1-based index
    pub cue_id: Option<String>, // e.g. "1" in SRT
    pub timeline: String,       // e.g. "00:00:10,000 --> 00:00:12,000" or "[00:12.34]"
    pub text: String,           //Dialogue text
}

#[derive(Clone, Debug)]
pub enum FileLine {
    CueTimeline(usize), // Index into the timed_cues vector
    Empty,
    Other(String),
}

pub struct ParsedSubtitle {
    pub cues: Vec<TimedCue>,
    pub file_lines: Vec<FileLine>,
    pub format: String, // "srt" | "vtt" | "lrc" | "txt"
}

impl ParsedSubtitle {
    /// Parses SRT, VTT, LRC, or TXT subtitle contents.
    pub fn parse(content: &str, format: &str) -> Self {
        let mut timed_cues = Vec::new();
        let mut file_lines = Vec::new();

        // Strip a UTF-8 BOM so it doesn't corrupt the first cue-id check.
        let content = content.strip_prefix('\u{feff}').unwrap_or(content);
        let lines: Vec<String> = content
            .replace("\r\n", "\n")
            .split('\n')
            .map(|s| s.to_string())
            .collect();

        let format_lower = format.to_lowercase();

        if format_lower == "srt" || format_lower == "vtt" {
            let mut i = 0;
            while i < lines.len() {
                let line = &lines[i];

                // VTT metadata blocks (NOTE/STYLE/REGION) may legally contain
                // "-->" inside their text; consume the whole block verbatim
                // instead of misparsing a note as a cue timeline.
                if format_lower == "vtt" {
                    let trimmed_tag = line.trim_start();
                    if trimmed_tag.starts_with("NOTE")
                        || trimmed_tag.starts_with("STYLE")
                        || trimmed_tag.starts_with("REGION")
                    {
                        file_lines.push(FileLine::Other(line.clone()));
                        i += 1;
                        while i < lines.len() && !lines[i].trim().is_empty() {
                            file_lines.push(FileLine::Other(lines[i].clone()));
                            i += 1;
                        }
                        continue;
                    }
                }

                if line.contains("-->") {
                    let timeline = line.clone();
                    let mut cue_id = None;

                    // Check if last line added was a cue ID
                    if let Some(FileLine::Other(prev_str)) = file_lines.last() {
                        let trimmed = prev_str.trim();
                        // NOTE: empty guard — `chars().all()` returns true on
                        // "" and would let a blank line masquerade as a cue ID.
                        let is_valid_cue_id = !trimmed.is_empty()
                            && if format_lower == "srt" {
                                trimmed.chars().all(|c| c.is_ascii_digit())
                            } else {
                                !trimmed.contains("-->")
                                    && !trimmed.starts_with("NOTE")
                                    && !trimmed.starts_with("WEBVTT")
                            };
                        if is_valid_cue_id {
                            cue_id = Some(prev_str.clone());
                            file_lines.pop(); // Remove it from lines, it belongs to the Cue
                        }
                    }

                    // Read dialogue lines
                    let mut dialogue_lines = Vec::new();
                    i += 1;
                    while i < lines.len()
                        && !lines[i].trim().is_empty()
                        && !lines[i].contains("-->")
                    {
                        // If it is a sequence number and the NEXT line is a timeline, then this line is actually the start of the next cue
                        if lines[i].trim().chars().all(|c| c.is_ascii_digit())
                            && i + 1 < lines.len()
                            && lines[i + 1].contains("-->")
                        {
                            break;
                        }
                        dialogue_lines.push(lines[i].clone());
                        i += 1;
                    }

                    let cue_index = timed_cues.len();
                    timed_cues.push(TimedCue {
                        index: cue_index + 1,
                        cue_id,
                        timeline,
                        text: dialogue_lines.join("\n"),
                    });
                    file_lines.push(FileLine::CueTimeline(cue_index));

                    // If we stopped because of an empty line, push it as empty line
                    if i < lines.len() && lines[i].trim().is_empty() {
                        file_lines.push(FileLine::Empty);
                        i += 1;
                    }
                } else if line.trim().is_empty() {
                    file_lines.push(FileLine::Empty);
                    i += 1;
                } else {
                    file_lines.push(FileLine::Other(line.clone()));
                    i += 1;
                }
            }
        } else if format_lower == "lrc" {
            for line in lines {
                // Support repeated timestamps on one line:
                // "[00:12.34][00:45.00]Same lyric" -> one cue per timestamp.
                let mut timestamps: Vec<String> = Vec::new();
                let mut rest = line.as_str();
                while let Some(caps) = LRC_TS_RE.captures(rest) {
                    // Keep the full "[..]" token so reconstruction is verbatim.
                    timestamps.push(caps.get(0).expect("lrc ts match").as_str().to_string());
                    rest = &rest[caps.get(0).expect("lrc ts match").end()..];
                }

                if !timestamps.is_empty() {
                    // Instrumental markers ("♪ ♪") are preserved verbatim.
                    if !is_translatable_text(rest) {
                        file_lines.push(FileLine::Other(line));
                        continue;
                    }
                    // One cue per LINE (not per timestamp) so a single
                    // translation is reused and the original structure
                    // "[t1][t2] lyric" survives reconstruction.
                    let timeline = timestamps.concat();
                    let cue_index = timed_cues.len();
                    timed_cues.push(TimedCue {
                        index: cue_index + 1,
                        cue_id: None,
                        timeline,
                        text: rest.trim().to_string(),
                    });
                    file_lines.push(FileLine::CueTimeline(cue_index));
                } else if line.trim().is_empty() {
                    file_lines.push(FileLine::Empty);
                } else {
                    file_lines.push(FileLine::Other(line));
                }
            }
        } else {
            // Treat as raw plain text: each non-empty translatable line is a
            // cue; separators and symbol-only lines are preserved verbatim.
            for line in lines {
                if line.trim().is_empty() {
                    file_lines.push(FileLine::Empty);
                } else if !is_translatable_text(&line) {
                    file_lines.push(FileLine::Other(line));
                } else {
                    let cue_index = timed_cues.len();
                    timed_cues.push(TimedCue {
                        index: cue_index + 1,
                        cue_id: None,
                        timeline: "".to_string(),
                        text: line.clone(),
                    });
                    file_lines.push(FileLine::CueTimeline(cue_index));
                }
            }
        }

        ParsedSubtitle {
            cues: timed_cues,
            file_lines,
            format: format_lower,
        }
    }

    /// Reconstructs the file string using translated dialogue lines.
    pub fn reconstruct(&self, translations: &HashMap<usize, String>) -> String {
        let mut output_lines = Vec::new();

        for line in &self.file_lines {
            match line {
                FileLine::CueTimeline(idx) => {
                    if let Some(cue) = self.cues.get(*idx) {
                        let text = translations.get(&cue.index).unwrap_or(&cue.text);

                        if self.format == "srt" || self.format == "vtt" {
                            if let Some(id) = &cue.cue_id {
                                output_lines.push(id.clone());
                            }
                            output_lines.push(cue.timeline.clone());
                            output_lines.push(text.clone());
                        } else if self.format == "lrc" {
                            if text.is_empty() {
                                output_lines.push(cue.timeline.clone());
                            } else {
                                output_lines.push(format!("{} {}", cue.timeline, text));
                            }
                        } else {
                            // TXT
                            output_lines.push(text.clone());
                        }
                    }
                }
                FileLine::Empty => {
                    output_lines.push("".to_string());
                }
                FileLine::Other(s) => {
                    output_lines.push(s.clone());
                }
            }
        }

        output_lines.join("\n")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(content: &str, format: &str) -> ParsedSubtitle {
        ParsedSubtitle::parse(content, format)
    }

    fn map(pairs: &[(usize, &str)]) -> HashMap<usize, String> {
        pairs.iter().map(|(i, s)| (*i, s.to_string())).collect()
    }

    #[test]
    fn srt_roundtrip_with_translation() {
        let content =
            "1\n00:00:10,000 --> 00:00:12,000\nHello\n\n2\n00:00:13,000 --> 00:00:15,000\nWorld\n";
        let p = parse(content, "srt");
        assert_eq!(p.cues.len(), 2);
        assert_eq!(p.cues[0].cue_id.as_deref(), Some("1"));
        assert_eq!(p.cues[0].text, "Hello");

        let out = p.reconstruct(&map(&[(1, "سلام"), (2, "دنیا")]));
        assert_eq!(
            out,
            "1\n00:00:10,000 --> 00:00:12,000\nسلام\n\n2\n00:00:13,000 --> 00:00:15,000\nدنیا\n"
        );
    }

    #[test]
    fn vtt_header_preserved() {
        let content = "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHi\n";
        let p = parse(content, "vtt");
        assert_eq!(p.cues.len(), 1);
        let out = p.reconstruct(&HashMap::new());
        // Untranslated reconstruct must be byte-identical (incl. trailing newline)
        assert_eq!(out, content);
    }

    #[test]
    fn lrc_multiple_timestamps_parse() {
        let content = "[00:12.34]First line\n[01:05.00]Second line\nnot a cue\n";
        let p = parse(content, "lrc");
        assert_eq!(p.cues.len(), 2);
        assert_eq!(p.cues[0].timeline, "[00:12.34]");
        assert_eq!(p.cues[1].text, "Second line");
    }

    #[test]
    fn lrc_repeated_timestamps_share_one_cue_and_roundtrip() {
        let content = "[00:12.34][00:45.00]Chorus line\n";
        let p = parse(content, "lrc");
        assert_eq!(p.cues.len(), 1);
        assert_eq!(p.cues[0].text, "Chorus line");
        let out = p.reconstruct(&map(&[(1, "متن همخوان")]));
        assert_eq!(out, "[00:12.34][00:45.00] متن همخوان\n");
    }

    #[test]
    fn lrc_instrumental_marker_preserved_verbatim() {
        let content = "[00:10.00]♪ ♪ ♪\n[00:20.00]Real lyric\n";
        let p = parse(content, "lrc");
        assert_eq!(p.cues.len(), 1);
        assert_eq!(p.cues[0].text, "Real lyric");
        let out = p.reconstruct(&map(&[(1, "ترجمه")]));
        assert!(out.contains("♪ ♪ ♪"));
        assert!(out.contains("ترجمه"));
    }

    #[test]
    fn srt_bom_is_stripped_and_first_cue_id_kept() {
        let content = "\u{feff}1\n00:00:10,000 --> 00:00:12,000\nHi\n";
        let p = parse(content, "srt");
        assert_eq!(p.cues.len(), 1);
        assert_eq!(p.cues[0].cue_id.as_deref(), Some("1"));
    }

    #[test]
    fn vtt_note_block_with_arrow_not_misparsed() {
        let content = "WEBVTT\n\nNOTE This block mentions 00:00:01.000 --> 00:00:02.000 inside text\n\n00:00:03.000 --> 00:00:04.000\nHello\n";
        let p = parse(content, "vtt");
        // Only the real cue is parsed; the NOTE stays a verbatim block.
        assert_eq!(p.cues.len(), 1);
        assert_eq!(p.cues[0].text, "Hello");
        let out = p.reconstruct(&map(&[(1, "سلام")]));
        assert!(out.contains("NOTE This block mentions"));
        assert!(out.contains("سلام"));
    }

    #[test]
    fn txt_symbol_only_lines_are_not_sent_to_translation() {
        let content = "---\nalpha\n***\nbeta\n";
        let p = parse(content, "txt");
        assert_eq!(p.cues.len(), 2);
        assert_eq!(p.cues[0].text, "alpha");
        let out = p.reconstruct(&map(&[(1, "یک"), (2, "دو")]));
        assert!(out.contains("---"));
        assert!(out.contains("***"));
    }

    #[test]
    fn txt_each_line_is_cue() {
        let p = parse("alpha\n\nbeta\n", "txt");
        assert_eq!(p.cues.len(), 2);
        let out = p.reconstruct(&map(&[(1, "one")]));
        assert!(out.contains("one"));
        assert!(out.contains("beta"));
    }

    #[test]
    fn missing_translations_fall_back_to_original() {
        let content = "1\n00:00:10,000 --> 00:00:12,000\nKeep\n";
        let p = parse(content, "srt");
        let out = p.reconstruct(&HashMap::new());
        assert!(out.contains("Keep"));
    }
}
