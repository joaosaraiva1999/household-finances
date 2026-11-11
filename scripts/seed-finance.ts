/**
 * Seeds demo data for the João & Anna household finance app.
 * - November 2026 (current month): exactly the example from the brief —
 *   João €2,000 / Anna €1,800, personal €300 / €200, shared €1,000 @ 50/50
 *   → João available €1,200 · Anna available €1,100 · household €2,300
 * - October 2026: a smaller historical month so browsing previous months works.
 *
 * Idempotent: skips seeding if the current month already has incomes.
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const CURRENT = "2026-11";
const PREVIOUS = "2026-10";

async function main() {
  const existing = await db.income.findFirst({ where: { month: CURRENT } });
  if (existing) {
    console.log("Seed skipped — data already present.");
    return;
  }

  await db.income.createMany({
    data: [
      { person: "joao", month: CURRENT, amount: 2000 },
      { person: "anna", month: CURRENT, amount: 1800 },
    ],
  });

  await db.expense.createMany({
    data: [
      // ── Shared (total €1,000, split 50/50) ──
      { name: "Rent", amount: 800, category: "Housing", responsible: "shared", joaoShare: 50, dueDate: `${CURRENT}-05`, paid: true, notes: "Apartment rent", month: CURRENT },
      { name: "Electricity", amount: 120, category: "Utilities", responsible: "shared", joaoShare: 50, dueDate: `${CURRENT}-15`, paid: false, month: CURRENT },
      { name: "Internet", amount: 80, category: "Internet & Phone", responsible: "shared", joaoShare: 50, dueDate: `${CURRENT}-20`, paid: false, month: CURRENT },
      // ── João personal (total €300) ──
      { name: "Car fuel", amount: 180, category: "Transport", responsible: "joao", joaoShare: 100, dueDate: `${CURRENT}-18`, paid: false, month: CURRENT },
      { name: "Gym membership", amount: 60, category: "Health", responsible: "joao", joaoShare: 100, dueDate: `${CURRENT}-10`, paid: true, notes: "Monthly plan", month: CURRENT },
      { name: "Dining out", amount: 60, category: "Entertainment", responsible: "joao", joaoShare: 100, dueDate: null, paid: false, month: CURRENT },
      // ── Anna personal (total €200) ──
      { name: "Beauty salon", amount: 90, category: "Personal", responsible: "anna", joaoShare: 0, dueDate: `${CURRENT}-22`, paid: false, month: CURRENT },
      { name: "Books", amount: 60, category: "Education", responsible: "anna", joaoShare: 0, dueDate: null, paid: false, month: CURRENT },
      { name: "Yoga class", amount: 50, category: "Health", responsible: "anna", joaoShare: 0, dueDate: `${CURRENT}-12`, paid: false, month: CURRENT },
    ],
  });

  // ── October 2026 — historical month for reviewing previous months ──
  await db.income.createMany({
    data: [
      { person: "joao", month: PREVIOUS, amount: 2000 },
      { person: "anna", month: PREVIOUS, amount: 1800 },
    ],
  });

  await db.expense.createMany({
    data: [
      { name: "Rent", amount: 800, category: "Housing", responsible: "shared", joaoShare: 50, dueDate: `${PREVIOUS}-05`, paid: true, notes: "Apartment rent", month: PREVIOUS },
      { name: "Electricity", amount: 95, category: "Utilities", responsible: "shared", joaoShare: 50, dueDate: `${PREVIOUS}-14`, paid: true, month: PREVIOUS },
      { name: "Groceries", amount: 160, category: "Groceries", responsible: "shared", joaoShare: 50, dueDate: null, paid: true, month: PREVIOUS },
      { name: "Car fuel", amount: 170, category: "Transport", responsible: "joao", joaoShare: 100, dueDate: `${PREVIOUS}-17`, paid: true, month: PREVIOUS },
      { name: "Gym membership", amount: 60, category: "Health", responsible: "joao", joaoShare: 100, dueDate: `${PREVIOUS}-10`, paid: true, month: PREVIOUS },
      { name: "Streaming services", amount: 15, category: "Entertainment", responsible: "joao", joaoShare: 100, dueDate: `${PREVIOUS}-28`, paid: false, month: PREVIOUS },
      { name: "Yoga class", amount: 50, category: "Health", responsible: "anna", joaoShare: 0, dueDate: `${PREVIOUS}-12`, paid: true, month: PREVIOUS },
      { name: "Books", amount: 45, category: "Education", responsible: "anna", joaoShare: 0, dueDate: null, paid: true, month: PREVIOUS },
      { name: "Hairdresser", amount: 75, category: "Personal", responsible: "anna", joaoShare: 0, dueDate: `${PREVIOUS}-25`, paid: false, month: PREVIOUS },
    ],
  });

  console.log("Seed complete: November 2026 (example) + October 2026 (history).");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
