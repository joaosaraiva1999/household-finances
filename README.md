# Household Finances

A shared household finance dashboard for two people (João &amp; Anna) — track monthly income, bills and credits, split shared costs, and see each person's live balance at a glance.

Built with Next.js (App Router), TypeScript, Tailwind CSS, shadcn/ui and Prisma + SQLite.

## Features

- **Dual-region dashboard** — per-person income cards (salary + meal card) and household totals (income, expenses, remaining balance) with month switching
- **Bills & credits** — add, edit and delete entries with name, amount, due date, category, owner, paid status and notes; a positive *credit* entry (refund, meal card top-up, bonus) increases the available balance
- **Shared cost splitting** — mark a bill as shared with an adjustable 50/50 split, or enter each person's actual paid amount and let the app derive the split automatically
- **Filters** — by month, person, category and paid status
- **Charts** — category breakdown, per-person comparison and monthly evolution (Recharts)
- **EN / PT language switch** — full bilingual interface, persisted in `localStorage`
- **Dark & light mode** — natural, minimalistic earth-tone palette (sage / clay / ochre) with glassmorphism styling
- **Responsive layout** — sidebar navigation on desktop, collapsible drawer on mobile

## Getting started

### Prerequisites

- Node.js 18+ (or [Bun](https://bun.sh))
- A local SQLite database file

### Setup

```bash
# 1. install dependencies
bun install   # or: npm install

# 2. configure the database URL
echo 'DATABASE_URL="file:./db/custom.db"' > .env

# 3. create the database and generate the Prisma client
bun run db:push      # or: npx prisma db push
bun run db:generate  # or: npx prisma generate

# 4. (optional) seed demo data
bunx tsx scripts/seed-finance.ts

# 5. start the dev server
bun run dev          # or: npm run dev
```

Open http://localhost:3000.

## Scripts

| Command | Description |
| --- | --- |
| `bun run dev` | Start the development server on port 3000 |
| `bun run build` | Create a production build |
| `bun run start` | Run the production build |
| `bun run lint` | Run ESLint |
| `bun run db:push` | Push the Prisma schema to SQLite |
| `bun run db:generate` | Generate the Prisma client |

## Privacy

All data stays in your local SQLite database (`db/custom.db`). The `.env` file and the database are git-ignored — no personal financial data is ever committed or sent anywhere.

## Project structure

```
src/
  app/                 # App Router pages + API routes (/api/expenses, /api/income, /api/finance)
  components/finance/  # Dashboard, expense dialog/list, person cards, charts, sidebar
  components/ui/       # shadcn/ui primitives
  lib/                 # Finance logic, i18n dictionary, category icons, db client
prisma/schema.prisma   # Income & Expense models
```
