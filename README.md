<div align="center">

# Household Finances

**A shared household finance dashboard for two people — income, bills, credits and who owes what, at a glance.**

![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)
![Prisma](https://img.shields.io/badge/Prisma-SQLite-2D3748?logo=prisma&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-38B2AC?logo=tailwindcss&logoColor=white)
![100% vibe coded](https://img.shields.io/badge/100%25-vibe_coded-699070)

</div>

> **This project is 100% vibe coded.**
> No starter template, no copy-pasted tutorial code — the database schema, API routes, shared-cost split logic, bilingual dictionary, earth-tone glass UI and every icon were designed and built end-to-end in conversational sessions with an AI coding agent. The human brought taste, feedback and plain-language requests ("make it more natural", "i prefer a side bar"); the agent turned them into working software, one prompt at a time.

---

## About

Household Finances is a local-first web app for couples or flatmates who manage money together. Each person has their own region of the dashboard — salary and meal card on one side, theirs on the other — while shared bills can be split 50/50 (adjustable) or by actual paid amounts. A month picker keeps every view anchored to the right period, and charts show where the money went.

## Features

- **Dual-region dashboard** — per-person income cards (salary + meal card) and household totals (income, expenses, remaining balance) with month switching
- **Bills & credits** — full CRUD with name, amount, due date, category, owner, paid status and notes; a positive *credit* entry (refund, meal card top-up, bonus) increases the available balance
- **Shared cost splitting** — mark a bill as shared with an adjustable 50/50 split, or enter each person's actual paid amount and let the app derive the split automatically
- **Filters** — by month, person, category and paid status
- **Charts** — category breakdown, per-person comparison and monthly evolution (Recharts)
- **EN / PT bilingual UI** — one click switches the entire interface, persisted in `localStorage`
- **Dark & light mode** — natural, minimalistic earth-tone palette (sage / clay / ochre) with glassmorphism styling
- **Responsive** — sidebar navigation on desktop, collapsible drawer on mobile

## Security & privacy

This app handles personal financial data, so privacy was a design requirement, not an afterthought:

- **Local-first storage** — all data lives in a single SQLite file on your machine (`db/custom.db`). There is no cloud, no sync, no server-side account. Nothing leaves your device.
- **Zero external requests** — no analytics, no tracking, no telemetry, no third-party CDN calls. Fonts are downloaded once at build time and self-hosted by Next.js (`next/font`); every asset is served from your own app.
- **Injection-proofed** — SQL, XML, CSS and CSV outputs are hardened: parameterized queries only (Prisma on the web, prepared statements in the Rust core), strict zod validation on every API input, database-level `CHECK` constraints, and escape/sanitization guardrails for XML, CSV (formula injection) and CSS. Verified by 37 web + 48 Rust security tests.
- **Hardened HTTP surface** — nonce-based CSP, `X-Frame-Options`, `nosniff`, strict referrer/permissions policies, HSTS, same-origin enforcement on mutations, request-size caps and rate limiting.
- **Secrets hygiene** — `.env` and `db/` are git-ignored, so no connection strings, tokens or personal data can enter the repository. The published git history starts from a single clean initial commit.
- **Auditable by design** — a small, readable TypeScript codebase: you can verify in minutes that data never leaves the app.
- **Honest limitation** — there is no built-in authentication. The app is designed to run on `localhost` for personal use; if you ever expose it beyond your machine, put it behind an authenticating reverse proxy (Tailscale, Cloudflare Access, basic-auth proxy) first.

The full threat model, the protection matrix for **both the web and the Rust/Tauri desktop codebases**, and the verification commands live in [SECURITY.md](./SECURITY.md).

## Getting started

### Prerequisites

- Node.js 18+ (or [Bun](https://bun.sh))
- A local SQLite database file (created in step 3 below)

### Setup

```bash
# 1. clone and install dependencies
git clone https://github.com/joaosaraiva1999/household-finances.git
cd household-finances
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

## Tech stack

Next.js 16 (App Router) · TypeScript · Tailwind CSS 4 · shadcn/ui · lucide-react · Recharts · Prisma · SQLite

## Project structure

```
src/
  app/                 # App Router pages + API routes (/api/expenses, /api/income, /api/finance)
  components/finance/  # Dashboard, expense dialog/list, person cards, charts, sidebar
  components/ui/       # shadcn/ui primitives
  lib/                 # Finance logic, i18n dictionary, category icons, db client
prisma/schema.prisma   # Income & Expense models
```

## License

All rights reserved. Personal project — if you want to use or adapt it, just ask.
