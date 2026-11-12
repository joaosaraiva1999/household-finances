// ─── Security unit tests for the shared guardrails ──────────────────────────
// Run with: bun test src/lib/__tests__/security.test.ts

import { describe, expect, test } from "bun:test";
import {
  CSV_BOM,
  encodeCsvRow,
  escapeXml,
  escapeXmlAttribute,
  sanitizeCsvCell,
  sanitizeCssColor,
  sanitizeCssCustomPropKey,
  stripControlChars,
} from "@/lib/sanitize";
import {
  dueDateSchema,
  expenseCreateSchema,
  expensePatchSchema,
  idSchema,
  incomeUpsertSchema,
  monthSchema,
} from "@/lib/validation";

describe("sanitize — XML escaping", () => {
  test("escapes element text", () => {
    expect(escapeXml(`<script>alert("x")</script>`)).toBe(
      "&lt;script&gt;alert(\"x\")&lt;/script&gt;",
    );
  });

  test("escapes ampersands and entities first", () => {
    expect(escapeXml("&amp;")).toBe("&amp;amp;");
  });

  test("attribute values cannot break out of quotes", () => {
    const payload = `" onmouseover="alert(1)" x="`;
    const out = escapeXmlAttribute(payload);
    expect(out).not.toContain('"');
    expect(out).toBe("&quot; onmouseover=&quot;alert(1)&quot; x=&quot;");
  });

  test("attribute single-quote breakout fails", () => {
    const out = escapeXmlAttribute(`' onclick='evil`);
    expect(out).not.toContain("'");
    expect(out).toContain("&apos;");
  });

  test("control characters are stripped from XML output", () => {
    expect(escapeXml("a\u0000b\u0007c")).toBe("abc");
  });
});

describe("sanitize — CSV formula injection (OWASP)", () => {
  test.each([
    ["=SUM(A1:A2)", "'=SUM(A1:A2)"],
    ["+cmd", "'+cmd"],
    ["-2+3", "'-2+3"],
    ["@import", "'@import"],
    ["\tx", "'\tx"],
  ])("neutralizes %s", (input, expected) => {
    expect(sanitizeCsvCell(input)).toBe(expected);
  });

  test("normal text is untouched", () => {
    expect(sanitizeCsvCell("Groceries – Mercadona")).toBe("Groceries – Mercadona");
  });

  test("row encoding quotes separators and doubles quotes", () => {
    expect(encodeCsvRow(["Renda, Casa", 'He said "ok"'])).toBe(
      `"Renda, Casa","He said ""ok"""\r\n`,
    );
  });

  test("an injected formula cannot execute from a note", () => {
    const note = '=HYPERLINK("http://evil","click")';
    const row = encodeCsvRow(["Mercado", note]);
    expect(row).toContain("'=HYPERLINK");
  });

  test("CSV_BOM present for Excel UTF-8 detection", () => {
    expect(CSV_BOM).toBe("\uFEFF");
  });
});

describe("sanitize — CSS custom properties", () => {
  test("drops keys with rule-breaking characters", () => {
    expect(sanitizeCssCustomPropKey("groceries")).toBe("groceries");
    expect(sanitizeCssCustomPropKey("a}; *{display:none} .x{")).toBe(
      "adisplaynonex",
    );
    expect(sanitizeCssCustomPropKey(";;;")).toBeNull();
  });

  test("allows sane colors, rejects CSS injection payloads", () => {
    expect(sanitizeCssColor("#94b897")).toBe("#94b897");
    expect(sanitizeCssColor("var(--sage)")).toBe("var(--sage)");
    expect(sanitizeCssColor("rgb(148, 184, 151)")).toBe("rgb(148, 184, 151)");
    expect(sanitizeCssColor("red;} body{background:url(evil)")).toBeNull();
    expect(sanitizeCssColor("expression(alert(1))")).toBeNull();
  });
});

describe("sanitize — control characters", () => {
  test("strips NUL, bell, C1 range but keeps tab/newline", () => {
    expect(stripControlChars("a\u0000b\u001bc\u007fd\u0085e")).toBe("abcde");
    expect(stripControlChars("line1\nline2\tok")).toBe("line1\nline2\tok");
  });
});

describe("validation — month", () => {
  test("accepts real months", () => {
    expect(monthSchema.safeParse("2026-11").success).toBe(true);
    expect(monthSchema.safeParse("1999-01").success).toBe(true);
  });
  test("rejects impossible months and junk", () => {
    for (const bad of ["2026-13", "2026-00", "26-11", "2026-1", "2026-11; DROP", ""])
      expect(monthSchema.safeParse(bad).success).toBe(false);
  });
});

describe("validation — dueDate", () => {
  test("accepts real calendar dates", () => {
    expect(dueDateSchema.safeParse("2026-02-28").success).toBe(true);
    expect(dueDateSchema.safeParse("2024-02-29").success).toBe(true); // leap year
  });
  test("rejects impossible dates the old regex accepted", () => {
    for (const bad of ["2026-02-31", "2026-13-01", "2026-00-10", "2026-99-99"])
      expect(dueDateSchema.safeParse(bad).success).toBe(false);
  });
});

describe("validation — ids", () => {
  test("accepts cuid-like ids", () => {
    expect(idSchema.safeParse("cmh2xj0qg000914idck1b6l8l").success).toBe(true);
  });
  test("rejects injection-looking or oversized ids", () => {
    for (const bad of ["", "a'.cookie", "id; DROP TABLE expenses;--", "x".repeat(65)])
      expect(idSchema.safeParse(bad).success).toBe(false);
  });
});

describe("validation — expense create", () => {
  const base = { name: "Supermercado", amount: 85.4 };

  test("applies defaults and cleans strings", () => {
    const parsed = expenseCreateSchema.safeParse({
      ...base,
      notes: "  pão \u0000 e leite  ",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.kind).toBe("expense");
      expect(parsed.data.responsible).toBe("shared");
      expect(parsed.data.notes).toBe("pão  e leite");
      expect(parsed.data.paid).toBe(false);
    }
  });

  test("rejects non-finite, negative, boolean and oversized amounts", () => {
    for (const amount of [NaN, Infinity, -5, 0, true, 10_000_001])
      expect(expenseCreateSchema.safeParse({ ...base, amount }).success).toBe(false);
  });

  test("rejects numeric strings (no silent coercion)", () => {
    expect(expenseCreateSchema.safeParse({ ...base, amount: "85.40" }).success).toBe(
      false,
    );
  });

  test("paid must be a real boolean (fixes Boolean('false') === true)", () => {
    expect(expenseCreateSchema.safeParse({ ...base, paid: "false" }).success).toBe(
      false,
    );
    expect(expenseCreateSchema.safeParse({ ...base, paid: false }).success).toBe(true);
  });

  test("unknown fields are stripped (no mass assignment)", () => {
    const parsed = expenseCreateSchema.safeParse({
      ...base,
      id: "injected",
      owner: "hacker",
      $where: "{}",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).not.toHaveProperty("id");
      expect(parsed.data).not.toHaveProperty("owner");
      expect(parsed.data).not.toHaveProperty("$where");
    }
  });

  test("invalid month falls back via catch (route resolves to current month)", () => {
    const parsed = expenseCreateSchema.safeParse({ ...base, month: "2026-13" });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.month).toBe("");
  });

  test("name cannot be empty or control-character only", () => {
    expect(expenseCreateSchema.safeParse({ ...base, name: "   " }).success).toBe(false);
    expect(expenseCreateSchema.safeParse({ ...base, name: "\u0007" }).success).toBe(
      false,
    );
  });

  test("name over 120 chars is rejected", () => {
    expect(
      expenseCreateSchema.safeParse({ ...base, name: "x".repeat(121) }).success,
    ).toBe(false);
  });

  test("notes over 500 chars are truncated (same as previous behaviour)", () => {
    const parsed = expenseCreateSchema.safeParse({ ...base, notes: "x".repeat(501) });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.notes).toBe("x".repeat(500));
  });
});

describe("validation — expense patch", () => {
  test("empty patch is rejected", () => {
    expect(expensePatchSchema.safeParse({}).success).toBe(false);
  });

  test("partial update works", () => {
    const parsed = expensePatchSchema.safeParse({ paid: true });
    expect(parsed.success).toBe(true);
  });

  test("SQL/NoSQL injection payloads in text fields are just text", () => {
    const parsed = expensePatchSchema.safeParse({
      name: "Robert'); DROP TABLE Expenses;--",
      notes: "' OR '1'='1",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.name).toBe("Robert'); DROP TABLE Expenses;--");
      expect(parsed.data.notes).toBe("' OR '1'='1");
    }
  });
});

describe("validation — income upsert", () => {
  test("requires person and one of amount/mealCard", () => {
    expect(incomeUpsertSchema.safeParse({ person: "joao" }).success).toBe(false);
    expect(
      incomeUpsertSchema.safeParse({ person: "joao", amount: 1200 }).success,
    ).toBe(true);
  });

  test("rejects invalid person and negative values", () => {
    expect(
      incomeUpsertSchema.safeParse({ person: "admin", amount: 1200 }).success,
    ).toBe(false);
    expect(
      incomeUpsertSchema.safeParse({ person: "anna", amount: -1 }).success,
    ).toBe(false);
  });
});
