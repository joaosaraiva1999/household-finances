//! CSV encoding with spreadsheet formula-injection protection.
//!
//! Following the OWASP CSV Injection guidance: a cell that begins with `=`,
//! `+`, `-`, `@`, TAB or CR is prefixed with a single quote so Excel,
//! LibreOffice and Google Sheets treat it as text instead of executing it.
//! Output uses RFC 4180 quoting, CRLF line endings and a UTF-8 BOM so
//! accented text (João, ção) survives Excel's default code page.

/// Prepend a UTF-8 BOM (Excel UTF-8 detection).
pub const BOM: &str = "\u{FEFF}";

/// Sanitize one cell: control characters stripped, newlines flattened,
/// formula-leading characters neutralized with a leading `'`.
#[must_use]
pub fn sanitize_cell(raw: &str) -> String {
    // Keep tab/newline alive here (like the web stripControlChars) so the
    // newline flattening below can turn them into spaces.
    let cleaned: String = raw
        .chars()
        .filter(|c| !c.is_control() || *c == '\t' || *c == '\n')
        .collect::<String>()
        .replace(['\r', '\n'], " ");
    if cleaned.starts_with(['=', '+', '-', '@', '\t']) || cleaned.contains('\t') {
        format!("'{cleaned}")
    } else {
        cleaned
    }
}

/// Encode one row: cells sanitized, quoted when needed, CRLF-terminated.
#[must_use]
pub fn encode_row(cells: &[&str]) -> String {
    let line: Vec<String> = cells
        .iter()
        .map(|c| {
            let safe = sanitize_cell(c);
            if safe.contains([',', '"', ';']) {
                format!("\"{}\"", safe.replace('"', "\"\""))
            } else {
                safe
            }
        })
        .collect();
    format!("{}\r\n", line.join(","))
}

/// Encode a full document (BOM + rows).
#[must_use]
pub fn encode_document(header: &[&str], rows: &[Vec<&str>]) -> String {
    let mut out = String::from(BOM);
    out.push_str(&encode_row(header));
    for row in rows {
        out.push_str(&encode_row(row));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn neutralizes_formula_leading_cells() {
        assert_eq!(sanitize_cell("=SUM(A1:A2)"), "'=SUM(A1:A2)");
        assert_eq!(sanitize_cell("+cmd|'/C calc'"), "'+cmd|'/C calc'");
        assert_eq!(sanitize_cell("-2+3+cmd"), "'-2+3+cmd");
        assert_eq!(sanitize_cell("@SUM(1)"), "'@SUM(1)");
        assert_eq!(sanitize_cell("\t=cmd"), "'\t=cmd");
    }

    #[test]
    fn keeps_normal_text() {
        assert_eq!(sanitize_cell("Groceries – Pingo Doce"), "Groceries – Pingo Doce");
        assert_eq!(sanitize_cell("Renda 800"), "Renda 800");
        // A safe leading minus number is still prefixed — conservative by design.
        assert_eq!(sanitize_cell("-5"), "'-5");
    }

    #[test]
    fn quoting_and_crlf() {
        assert_eq!(encode_row(&["Renda, Casa"]), "\"Renda, Casa\"\r\n");
        assert_eq!(
            encode_row(&["He said \"ok\""]),
            "\"He said \"\"ok\"\"\"\r\n"
        );
        assert_eq!(encode_row(&["a", "b"]), "a,b\r\n");
    }

    #[test]
    fn injected_note_cannot_execute() {
        let doc = encode_document(
            &["Name", "Notes"],
            &[vec!["Mercado", "=HYPERLINK(\"http://evil\",\"click\")"]],
        );
        assert!(doc.contains("'=HYPERLINK"));
        assert!(doc.starts_with(BOM));
    }

    #[test]
    fn newlines_flattened() {
        assert_eq!(sanitize_cell("line1\nline2"), "line1 line2");
    }
}
