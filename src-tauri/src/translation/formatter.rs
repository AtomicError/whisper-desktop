use std::collections::HashMap;
use regex::Regex;

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
                    
                    // Check if last line added was a cue ID (pure integer)
                    if let Some(FileLine::Other(prev_str)) = file_lines.last() {
                        if prev_str.trim().chars().all(|c| c.is_ascii_digit()) {
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
            // LRC parser: matching timestamps like [00:12.34] or [00:12:34]
            let lrc_re = Regex::new(r"^(\s*\[\d{2,3}:\d{2}(?:[.:]\d{2,3})?\])(.*)$").expect("static regex");
            for line in lines {
                if let Some(caps) = lrc_re.captures(&line) {
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
                            output_lines.push(format!("{} {}", cue.timeline, text));
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
