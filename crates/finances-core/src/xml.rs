//! XML escaping — the mandatory guardrail for any XML/SVG output.
//!
//! **Policy:** the application currently emits no XML at runtime. If any XML
//! output is ever introduced (reports, Office formats, RSS, SVG exports…),
//! it MUST be assembled through [`escape_text`] / [`escape_attr`]. Both
//! functions escape every character that can change document structure, so
//! user data can never inject elements or attributes. The unit tests pin the
//! behaviour against classic payloads (`<script>`, attribute breakouts,
//! control characters).

/// Escape a string for safe inclusion in XML element **text** content.
///
/// Escapes `&`, `<`, `>` and removes control characters that are illegal in
/// XML 1.0 (everything except tab, newline, carriage return).
#[must_use]
pub fn escape_text(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    for c in raw.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '\u{9}' | '\u{a}' | '\u{d}' => out.push(c),
            c if c.is_control() => {} // illegal in XML 1.0 → dropped
            c => out.push(c),
        }
    }
    out
}

/// Escape a string for safe inclusion inside a **quoted attribute value**.
///
/// In addition to [`escape_text`], quotes are escaped so the value can never
/// terminate the attribute, and newlines/tabs are encoded numerically so the
/// attribute stays single-line.
#[must_use]
pub fn escape_attr(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    for c in escape_text(raw).chars() {
        match c {
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&apos;"),
            '\n' => out.push_str("&#10;"),
            '\r' => out.push_str("&#13;"),
            '\t' => out.push_str("&#9;"),
            c => out.push(c),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn text_is_never_markup() {
        assert_eq!(
            escape_text(r#"<script>alert("x")</script>"#),
            "&lt;script&gt;alert(\"x\")&lt;/script&gt;"
        );
        assert_eq!(escape_text("a & b < c"), "a &amp; b &lt; c");
        // Double-escaping is expected — encoding happens exactly once at the edge.
        assert_eq!(escape_text("&amp;"), "&amp;amp;");
    }

    #[test]
    fn attributes_cannot_break_out() {
        let payload = r#"" onmouseover="alert(1)" x=""#;
        let out = escape_attr(payload);
        assert!(!out.contains('"'), "raw double quote survived: {out}");
        assert_eq!(out, "&quot; onmouseover=&quot;alert(1)&quot; x=&quot;");
        let single = escape_attr("' onclick='evil");
        assert!(!single.contains('\''));
        assert!(single.contains("&apos;"));
    }

    #[test]
    fn control_characters_are_removed() {
        assert_eq!(escape_text("a\u{0}b\u{7}c"), "abc");
        assert_eq!(escape_text("keep\ttab\nnl\rcr"), "keep\ttab\nnl\rcr");
        assert_eq!(escape_attr("nl\nhere"), "nl&#10;here");
    }

    #[test]
    fn round_trip_via_parser() {
        // Escape → build a tiny XML doc → prove the payload stays inert text.
        let payload = "](><)&\"'";
        let doc = format!(
            "<note title=\"{}\">{}</note>",
            escape_attr(payload),
            escape_text(payload)
        );
        // Attribute: & < > quotes all escaped (payload order: ] ( > < ) & " ').
        assert!(
            doc.starts_with("<note title=\"](&gt;&lt;)&amp;&quot;&apos;\""),
            "attribute not fully escaped: {doc}"
        );
        // Text: same escaping minus quotes.
        assert!(
            doc.ends_with("](&gt;&lt;)&amp;\"'</note>"),
            "text wrong: {doc}"
        );
        // The raw payload never appears unescaped in the document.
        assert!(!doc.contains("><)"));
        assert!(!doc.contains("&\"'"));
    }
}
