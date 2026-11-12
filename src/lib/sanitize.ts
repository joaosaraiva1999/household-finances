// ─── Output-encoding & injection guardrails (shared) ─────────────────────────
//
// The application currently renders user data through React (auto-escaped)
// and stores it through Prisma (parameterized). These helpers are the
// mandatory guardrails for every place that produces a non-HTML context:
// XML/SVG output, CSS custom properties (chart theming), CSV exports, etc.
//
// Policy: any code that emits XML, builds CSS strings from dynamic values,
// or writes spreadsheet files MUST encode through this module. The unit
// tests in `src/lib/__tests__/sanitize.test.ts` pin the behaviour.

/**
 * Remove control characters (except tab) that could poison logs, CSV files,
 * XML output or database content. Mirrors the Rust `validation::clean_text`.
 */
export function stripControlChars(input: string): string {
  return input.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, "");
}

// ─── XML / SVG escaping ──────────────────────────────────────────────────────

/** Escape a string for safe inclusion in XML/SVG element text. */
export function escapeXml(text: string): string {
  return stripControlChars(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Escape a string for safe inclusion inside a double- or single-quoted
 * XML/SVG attribute. Escapes the quote characters as well, so the value
 * can never break out of the attribute.
 */
export function escapeXmlAttribute(value: string): string {
  return stripControlChars(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    .replace(/\n/g, "&#10;")
    .replace(/\r/g, "&#13;");
}

// ─── CSV / spreadsheet formula-injection protection ──────────────────────────

/**
 * Neutralize spreadsheet formula injection (OWASP): when a cell begins with
 * `=`, `+`, `-`, `@`, TAB or CR a leading `'` is inserted so Excel/LibreOffice
 * treat it as text. Contains tab/CR anywhere → also quoted.
 */
export function sanitizeCsvCell(value: string): string {
  const v = stripControlChars(value).replace(/\r|\n/g, " ");
  if (/^[=+\-@\t]/.test(v) || v.includes("\t")) return `'${v}`;
  return v;
}

/** Encode one CSV row (RFC 4180 quoting, CRLF, formula-safe). */
export function encodeCsvRow(cells: string[]): string {
  const quoted = cells.map((c) => {
    const safe = sanitizeCsvCell(c);
    return /[",;]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  });
  return `${quoted.join(",")}\r\n`;
}

/** Prepend a UTF-8 BOM so Excel detects UTF-8 (accents: João, ção…). */
export const CSV_BOM = "\uFEFF";

// ─── CSS custom-property safety (chart theming) ──────────────────────────────

/**
 * Only allow safe custom-property key characters. Anything else is dropped
 * so a hostile key can never close the rule block or inject declarations.
 */
export function sanitizeCssCustomPropKey(key: string): string | null {
  const cleaned = key.replace(/[^a-zA-Z0-9_-]/g, "");
  return cleaned.length > 0 ? cleaned : null;
}

const COLOR_RE =
  /^(#[0-9a-fA-F]{3,8}|rgba?\(\s*[\d.%\s,]+\s*\)|hsla?\(\s*[\d.%\s,deg]+\s*\)|var\(--[a-zA-Z0-9_-]+\)|transparent|currentcolor|[a-zA-Z]+)$/;

/** Return the color only if it is a plain CSS color literal; else null. */
export function sanitizeCssColor(color: string): string | null {
  const cleaned = stripControlChars(color).trim();
  return COLOR_RE.test(cleaned) ? cleaned : null;
}
