# Number Calculator

A React web app that calculates totals based on custom number rules (with WP pair logic).

## Run Locally

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173)

## Build

```bash
npm run build
```

## Automated Testing

```bash
npm run test
```

Useful test commands:

```bash
npm run test:watch
npm run test:coverage
```

Parser regression tests live in `src/calcUtils.test.ts` and reuse scenarios from
`src/testScenarios.ts`.

## Deploy to Vercel

### Option 1 — Vercel CLI (fastest)

```bash
npm install -g vercel
vercel
```

Follow the prompts. Vercel auto-detects Vite.

### Option 2 — Vercel Dashboard

1. Push this folder to a GitHub repository
2. Go to [vercel.com](https://vercel.com) → **Add New Project**
3. Import your GitHub repo
4. Vercel auto-detects the framework as **Vite**
5. Click **Deploy** — done!

## How It Works

Each line of input contains:
- 2-digit numbers separated by any symbol (`*`, `-`, `_`, `.`, `:`, space…)
- A rate in brackets like `(50)`
- Optional `WP` keyword

**Without WP:** counts unique numbers × rate

**With WP:** counts each number + its reverse as a pair (e.g. `47 ↔ 74` = 2), avoids double-counting, then × rate
