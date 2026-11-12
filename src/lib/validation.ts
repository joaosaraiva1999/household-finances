// ─── Single source of truth for every untrusted input reaching the API ──────
//
// Every route handler validates its payload through these zod schemas before
// anything touches the database. Unknown fields are stripped (no mass
// assignment), strings are cleaned of control characters and length-capped,
// enums are closed sets, amounts are finite numbers within sane bounds and
// dates must be real calendar dates.
//
// The Rust desktop core (crates/finances-core/src/validation.rs) mirrors
// these rules 1:1 — see SECURITY.md for the parity matrix.

import { z } from "zod";
import { CATEGORIES } from "@/lib/finance";
import { stripControlChars } from "@/lib/sanitize";

// ─── Limits (mirrored in Rust) ───────────────────────────────────────────────

export const LIMITS = {
  /** Max length of an expense name, in characters. */
  name: 120,
  /** Max length of the notes field, in characters. */
  notes: 500,
  /** Max single-entry amount, in euros (€10,000,000.00). */
  amountMax: 10_000_000,
  /** Max income field value, in euros (€100,000,000.00). */
  incomeMax: 100_000_000,
  /** Max accepted JSON body size for API requests, in bytes. */
  bodyBytes: 65_536,
} as const;

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
const DATE_RE = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** Reject strings that are only control characters; clean + cap the rest. */
const cleanString = (max: number, label: string) =>
  z
    .string({ message: `${label} must be text` })
    .transform((s) => stripControlChars(s).trim())
    .pipe(z.string().min(1, `${label} is required`).max(max, `${label} is too long`));

/** "YYYY-MM" with a real month (01-12). */
export const monthSchema = z
  .string({ message: "Month must be text" })
  .regex(MONTH_RE, "Month must look like YYYY-MM");

/**
 * "YYYY-MM-DD" that is a real calendar date (rejects 2026-02-31, 2026-13-01,
 * "2026-99-99"…). The previous regex-only check accepted impossible dates.
 */
export const dueDateSchema = z
  .string()
  .regex(DATE_RE, "Due date must look like YYYY-MM-DD")
  .refine((value) => {
    const [y, m, d] = value.split("-").map(Number);
    const utc = new Date(Date.UTC(y, m - 1, d));
    return (
      utc.getUTCFullYear() === y && utc.getUTCMonth() === m - 1 && utc.getUTCDate() === d
    );
  }, "Due date is not a real calendar date");

/** Database ids: alphanumerics with -/_ only, bounded length. */
export const idSchema = z
  .string()
  .min(1, "Id is required")
  .max(64, "Id is too long")
  .regex(/^[a-zA-Z0-9_-]+$/, "Id contains invalid characters");

const amountSchema = z
  .number({ message: "Amount must be a number" })
  .refine(Number.isFinite, "Amount must be a finite number")
  .gt(0, "Amount must be greater than zero")
  .max(LIMITS.amountMax, "Amount is too large")
  .transform((v) => Math.round(v * 100) / 100);

const incomeFieldSchema = z
  .number({ message: "Value must be a number" })
  .refine(Number.isFinite, "Value must be a finite number")
  .min(0, "Value cannot be negative")
  .max(LIMITS.incomeMax, "Value is too large")
  .transform((v) => Math.round(v * 100) / 100);

const personSchema = z.enum(["joao", "anna"]);
const responsibleSchema = z.enum(["joao", "anna", "shared"]);
const kindSchema = z.enum(["expense", "credit"]);
// Invalid categories fall back to "Other" — same behaviour as before.
const categorySchema = z.enum(CATEGORIES).catch("Other");

const shareSchema = z
  .number()
  .refine(Number.isFinite)
  .min(0)
  .max(100)
  .transform((v) => Math.round(v * 10) / 10);

const notesSchema = z
  .string()
  .transform((s) => stripControlChars(s).trim())
  .transform((s) => (s.length > 0 ? s.slice(0, LIMITS.notes) : null))
  .nullable();

// ─── Payload schemas ─────────────────────────────────────────────────────────

/** POST /api/expenses */
export const expenseCreateSchema = z.object({
  name: cleanString(LIMITS.name, "Name"),
  amount: amountSchema,
  kind: kindSchema.default("expense"),
  category: categorySchema.default("Other"),
  responsible: responsibleSchema.default("shared"),
  joaoShare: shareSchema.nullish(),
  joaoPaid: z.number().refine(Number.isFinite).nullish(),
  annaPaid: z.number().refine(Number.isFinite).nullish(),
  dueDate: dueDateSchema.nullish(),
  notes: notesSchema.nullish(),
  paid: z.boolean().default(false),
  month: monthSchema.catch(""), // resolved in the route when invalid/missing
});

/** PATCH /api/expenses/[id] — every field optional, unknown keys stripped. */
export const expensePatchSchema = z
  .object({
    name: cleanString(LIMITS.name, "Name").optional(),
    amount: amountSchema.optional(),
    kind: kindSchema.optional(),
    category: categorySchema.optional(),
    responsible: responsibleSchema.optional(),
    joaoShare: shareSchema.nullish(),
    joaoPaid: z.number().refine(Number.isFinite).nullish(),
    annaPaid: z.number().refine(Number.isFinite).nullish(),
    dueDate: dueDateSchema.nullish(),
    notes: notesSchema.nullish(),
    paid: z.boolean().optional(),
  })
  .refine(
    (patch) => Object.keys(patch).length > 0,
    "Provide at least one field to update",
  );

/** POST /api/income */
export const incomeUpsertSchema = z
  .object({
    person: personSchema,
    month: monthSchema.catch(""), // resolved in the route when invalid/missing
    amount: incomeFieldSchema.nullish(),
    mealCard: incomeFieldSchema.nullish(),
  })
  .refine(
    (body) => body.amount !== undefined && body.amount !== null
      || body.mealCard !== undefined && body.mealCard !== null,
    "Provide amount or mealCard",
  );

/** GET /api/finance?month=YYYY-MM */
export const financeQuerySchema = z.object({ month: monthSchema.catch("") });

/** Extract the first human-readable issue from a failed parse. */
export function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Invalid input";
}
