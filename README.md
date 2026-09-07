# Cuisidoo

A self-hosted recipe app for the Thermomix TM6, built as a personal Cookidoo alternative. The UI is German, it's single-user, and it runs on Cloudflare Workers. AI generates TM6-formatted recipes on demand, aware of what's actually in your pantry.

Built in about five weeks as a personal tool. I eventually went back to a Cookidoo subscription (thousands of tested recipes beat generated ones), but the app works and the code is here as a reference, especially the receipt-scanning and structured-output parts.

## What it does

- **Recipe library** with photos, tags, servings scaling and a step-by-step cooking mode
- **AI recipe generation** (`worker/generate.ts`): describe what you want and get a TM6 recipe with proper Varoma/speed/time settings. Uses Anthropic's web search tool for grounding and a strict tool schema for the save format. The prompt includes your current pantry, so generated recipes prefer ingredients you already have
- **"Überrasch mich"** (`worker/suggest.ts`): three recipe ideas based on your pantry, via structured JSON output
- **Recipe import** (`worker/import.ts`): paste a URL or recipe text, get it adapted for the TM6
- **Pantry** (`worker/settings.ts`): quantities per ingredient, or "always there" for staples like salt. Cooking a recipe deducts what you used (`worker/shopping.ts`)
- **Receipt scan** (`worker/scan.ts`): photograph a grocery receipt, Claude's vision reads the items, matches them against the ingredient catalog (including aliases and unit conversion) and tops up the pantry after you confirm
- **Cooking mode** warns which ingredients are missing for your serving count and can put them on the shopping list
- **Weekly plan + shopping list** (`worker/plan.ts`, `worker/shopping.ts`), with offline support: the list is mirrored to IndexedDB and check-offs sync back when you're online again (`src/offline.ts`)
- **Nutrition scoring** (`worker/nutrition.ts`): cached per-recipe health score
- **PWA**: installable, works offline for cached recipes and the shopping list

## Stack

- **Backend**: Cloudflare Workers, [Hono](https://hono.dev), D1 (SQLite), R2 for photos
- **Frontend**: React 18, Vite 6, TanStack Query, vite-plugin-pwa
- **AI**: Anthropic API (`@anthropic-ai/sdk`): web search tool, strict tool schemas, structured outputs, vision
- **Tests**: Vitest (69 tests)

## Prerequisites

- Node 18+
- A Cloudflare account (free tier is enough)
- An Anthropic API key

## Setup

```bash
npm install
cp .dev.vars.example .dev.vars   # fill in your values
npm run migrate:local
npm run dev
```

The app runs at `http://localhost:5173`. Log in with whatever you set as `AUTH_PASSPHRASE`.

## Configuration

All secrets live in `.dev.vars` locally and in Worker secrets in production (`wrangler secret put <NAME>`):

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Recipe generation, import, suggestions, receipt scan, nutrition scoring |
| `AUTH_PASSPHRASE` | The single login passphrase |
| `AUTH_SECRET` | Signs the auth cookie (any long random string) |

`wrangler.jsonc` expects a D1 database named `cuisidoo` and an R2 bucket named `cuisidoo-images`. Create your own and swap in your `database_id`.

## Deploy

```bash
npm run migrate:remote
npm run deploy
```

## Tests

```bash
npm test        # vitest
npm run check   # typecheck
```

## Known limitations

- The receipt-scan endpoint is unit-tested and code-reviewed but hasn't been exercised end-to-end against the live vision API yet
- Multi-recipe detection during import only works for pasted text, not URLs (the detection pass has no web access)
- Single-user by design: one passphrase, one pantry
- UI is German only

## License

MIT
