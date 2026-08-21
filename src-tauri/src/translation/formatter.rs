use std::collections::HashMap;
use std::sync::LazyLock;
use regex::Regex;

static LRC_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^(\s*\[\d{2,3}:\d{2}(?:[.:]\d{2,3})?\])(.*)$").expect("valid lrc regex")
});

#[derive(Clone, Debug)]
pub struct TimedCue {
    pub index: usize,             // 1-based index
    pub cue_id: Option<String>,   // e.g. "1" in SRT
    pub timeline: String,         // e.g. "00:00:10,000 --> 00:00:12,000" or "[00:12.34]"
    pub text: String,             //Dialogue text
}

#[derive(Clone, Debug)]
pub enum FileLine {
    CueTimeline(usize),           // Index into the timed_cues vector
    Empty,
    Other(String),
}

pub struct ParsedSubtitle {
    pub cues: Vec<TimedCue>,
    pub file_lines: Vec<FileLine>,
    pub format: String,           // "srt" | "vtt" | "lrc" | "txt"
}

impl ParsedSubtitle {
    /// Parses SRT, VTT, LRC, or TXT subtitle contents.
    pub fn parse(content: &str, format: &str) -> Self {
        let mut timed_cues = Vec::new();
        let mut file_lines = Vec::new();
        
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
                if line.contains("-->") {
                    let timeline = line.clone();
                    let mut cue_id = None;
                    
                    // Check if last line added was a cue ID
                    if let Some(FileLine::Other(prev_str)) = file_lines.last() {
                        let trimmed = prev_str.trim();
                        let is_valid_cue_id = if format_lower == "srt" {
                            trimmed.chars().all(|c| c.is_ascii_digit())
                        } else {
                            !trimmed.is_empty() && !trimmed.contains("-->") && !trimmed.starts_with("NOTE") && !trimmed.starts_with("WEBVTT")
                        };
                        if is_valid_cue_id {
                            cue_id = Some(prev_str.clone());
                            file_lines.pop(); // Remove it from lines, it belongs to the Cue
                        }
                    }
                    
                    // Read dialogue lines
                    let mut dialogue_lines = Vec::new();
                    i += 1;
                    while i < lines.len() && !lines[i].trim().is_empty() && !lines[i].contains("-->") {
                        // If it is a sequence number and the NEXT line is a timeline, then this line is actually the start of the next cue
                        if lines[i].trim().chars().all(|c| c.is_ascii_digit()) && i + 1 < lines.len() && lines[i + 1].contains("-->") {
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
                if let Some(caps) = LRC_RE.captures(&line) {
                    let timeline = caps.get(1).expect("lrc regex group 1").as_str().to_string();
                    let text = caps.get(2).expect("lrc regex group 2").as_str().to_string();
                    
                    let cue_index = timed_cues.len();
                    timed_cues.push(TimedCue {
                        index: cue_index + 1,
                        cue_id: None,
                        timeline,
                        text: text.trim().to_string(),
                    });
                    file_lines.push(FileLine::CueTimeline(cue_index));
                } else if line.trim().is_empty() {
                    file_lines.push(FileLine::Empty);
                } else {
                    file_lines.push(FileLine::Other(line));
                }
            }
        } else {
            // Treat as raw plain text: each non-empty line is a translatable cue
            for line in lines {
                if line.trim().is_empty() {
                    file_lines.push(FileLine::Empty);
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
        let content = "1\n00:00:10,000 --> 00:00:12,000\nHello\n\n2\n00:00:13,000 --> 00:00:15,000\nWorld\n";
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
