# Cuisidoo — Design Spec

**Date:** 2026-07-13
**Status:** Approved (brainstorming session, this date)

A self-hosted, phone-first PWA replacing the Cookidoo subscription: generate,
store, plan, shop, and cook Thermomix TM6 recipes. Single user, personal use,
German-language recipes and UI.

## Decisions made in brainstorming

| Question | Decision |
|---|---|
| Language | German only — UI, recipes, generation, ingredient names |
| Offline | Cooking mode + recipe detail + shopping list offline; rest online-only |
| Images | Optional user photo upload (R2); typographic placeholder otherwise |
| Ingredients | Normalized canonical table, AI-assisted matching, auto-create unmatched |
| Units | Canonical unit dimension per ingredient (mass g / volume ml / count Stück) |
| Auth | Passphrase + long-lived signed HttpOnly cookie (~180 days) |
| Framework | React + Vite + TypeScript |
| Deployment | Single Cloudflare Worker: API + static assets binding (not Pages) |

## 1. Architecture

One wrangler project. A single Cloudflare Worker serves:

- `/api/*` — JSON API, built with **Hono** (routing + auth middleware)
- everything else — the built React SPA via the static assets binding

Bindings: **D1** (all app data), **R2** (recipe photos). Secrets:
`ANTHROPIC_API_KEY`, `AUTH_PASSPHRASE`, `AUTH_SECRET` (cookie HMAC key).

Frontend: React + Vite + TypeScript, `vite-plugin-pwa` (Workbox) for the
service worker, **plain CSS on the Ember token system** (no Tailwind).
Server state via TanStack Query; a thin IndexedDB layer for offline mirrors.

## 2. Data model (D1)

```sql
ingredients(
  id INTEGER PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,            -- canonical German name, e.g. "Zwiebel"
  category TEXT NOT NULL,               -- shopping-list category, e.g. "Gemüse & Obst"
  unit_dim TEXT NOT NULL CHECK (unit_dim IN ('mass','volume','count')),
  grams_per_piece REAL                  -- count-dim only, for nutrition math
);

ingredient_aliases(
  alias TEXT PRIMARY KEY,               -- "Zwiebeln", "rote Zwiebel"
  ingredient_id INTEGER NOT NULL REFERENCES ingredients(id)
);

recipes(
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  servings_base INTEGER NOT NULL,
  total_time_min INTEGER,
  active_time_min INTEGER,
  source TEXT NOT NULL CHECK (source IN ('generated','manual')),
  favorite INTEGER NOT NULL DEFAULT 0,
  image_key TEXT,                       -- R2 object key, nullable
  nutrition_json TEXT,                  -- cached score result, nullable
  nutrition_scored_at TEXT,
  created_at TEXT NOT NULL
);

recipe_tags(recipe_id, tag);            -- PK (recipe_id, tag)

recipe_ingredients(
  recipe_id INTEGER NOT NULL REFERENCES recipes(id),
  position INTEGER NOT NULL,
  ingredient_id INTEGER NOT NULL REFERENCES ingredients(id),
  quantity REAL NOT NULL,               -- in the ingredient's canonical dimension
  unit TEXT NOT NULL,                   -- display unit: "g", "ml", "Stück", "Prise"
  scaling TEXT NOT NULL DEFAULT 'linear' CHECK (scaling IN ('linear','damped','fixed')),
  note TEXT,                            -- "gehackt", "in Scheiben"
  section TEXT,                         -- optional grouping: "Für das Pesto"
  PRIMARY KEY (recipe_id, position)
);

recipe_steps(
  recipe_id INTEGER NOT NULL REFERENCES recipes(id),
  position INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('tm6','off_device')),
  text TEXT NOT NULL,
  seconds INTEGER,                      -- tm6 only
  temp TEXT,                            -- '37'..'160' or 'Varoma'
  speed TEXT,                           -- '0.5'..'10', 'Turbo', 'Teigstufe'
  reverse INTEGER NOT NULL DEFAULT 0,   -- Linkslauf
  mode TEXT,                            -- TM6-Modus: 'Slow Cooking', 'Sous-vide', ...
  accessory TEXT,                       -- 'Varoma', 'Gareinsatz', 'Rühraufsatz', ...
  device TEXT,                          -- off_device only: 'Backofen', 'Herd', ...
  PRIMARY KEY (recipe_id, position)
);

equipment(id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL, owned INTEGER NOT NULL DEFAULT 0);
recipe_equipment(recipe_id, equipment_id);   -- PK (recipe_id, equipment_id)

pantry(
  ingredient_id INTEGER PRIMARY KEY REFERENCES ingredients(id),
  quantity REAL NOT NULL,
  updated_at TEXT NOT NULL
);

plan_entries(
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL,                   -- ISO date
  slot TEXT NOT NULL,                   -- 'mittag' | 'abend' | 'sonstiges'
  recipe_id INTEGER NOT NULL REFERENCES recipes(id),
  servings INTEGER NOT NULL
);

shopping_items(
  id INTEGER PRIMARY KEY,
  ingredient_id INTEGER REFERENCES ingredients(id),  -- nullable (manual free-text)
  label TEXT NOT NULL,
  quantity REAL,
  unit TEXT,
  category TEXT NOT NULL,
  checked INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL CHECK (source IN ('plan','manual'))
);

settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
-- keys: diet_bias (text), default_servings, ...
```

Design rules:

- **TM6 settings are structured columns, never free text.** The UI renders
  "3 Min. / 100°C / Stufe 2" + Linkslauf/Varoma badges from data. Steps of
  `kind='off_device'` must have `device` set and are rendered visually distinct.
- **Quantities live in the ingredient's canonical dimension**, so pantry
  subtraction is plain arithmetic — cross-dimension mismatches cannot occur.
  Exception: informal display units (`Prise`, `TL`, `EL`, `Spritzer`) carry
  their display quantity instead. Such rows are excluded from pantry
  arithmetic and appear on the shopping list presence-only (added only if
  the ingredient is absent from the pantry entirely).
- Equipment is its own table (per handoff brief) so recipes declare
  requirements and the library can filter "mit meiner Küche kochbar".
  TM6 + its accessories are implicit and never listed as equipment.

## 3. API surface

All routes under `/api`, cookie-guarded except `POST /api/auth/login`.

```
POST   /api/auth/login            {passphrase} → Set-Cookie (HMAC, ~180d)
GET    /api/recipes               ?q=&tag=&favorite=&cookable=
GET    /api/recipes/:id           full recipe (ingredients, steps, equipment)
POST   /api/recipes               create (from generation draft or manual form)
PUT    /api/recipes/:id           update
DELETE /api/recipes/:id
POST   /api/recipes/:id/image     photo upload → R2
POST   /api/recipes/:id/score     nutrition score (one API call, cached)
POST   /api/recipes/:id/cooked    optional pantry deduction after cooking
POST   /api/generate              {wunsch, portionen, extraGeraeteErlaubt?} → draft JSON
GET    /api/ingredients           canonical list (+aliases)
PUT    /api/ingredients/:id       edit category/unit/aliases
GET|PUT /api/pantry               list / upsert quantities
GET|POST|DELETE /api/plan         week entries CRUD
POST   /api/shopping/generate     {from, to} → build list from plan − pantry
GET    /api/shopping              current list
PATCH  /api/shopping/:id          check/uncheck/edit
POST   /api/shopping/complete     move checked items into pantry, clear them
GET|PUT /api/settings             diet bias, defaults
GET|PUT /api/equipment            kitchen profile
```

## 4. Recipe generation

`POST /api/generate`. The Worker assembles a system prompt from:

1. **Full TM6 capability spec** (from the handoff brief): speeds 0.5–10 +
   Turbo, temps 37–160 °C, Varoma level, Linkslauf, Teigstufe, TM6 modes
   (Slow Cooking, Sous-vide, Fermentieren, Reiskocher, Wasserkocher,
   Eierkocher, Eindicken, Aufwärmen, Anbraten/Karamellisieren, Vorreinigen).
   Accessories: Mixtopf, Varoma (Behälter + Einlegeboden), Gareinsatz,
   Rühraufsatz (Schmetterling), Spatel, ZWEI Messbecher, Gemüse-Styler.
   Nothing else may be assumed.
2. **Kitchen equipment profile** from D1. Default posture TM6-primary:
   recipes use the TM6 as sole device unless the request implies other
   equipment or `extraGeraeteErlaubt` is set. Off-device steps must name
   their device and appear interleaved in correct chronological order.
   Fridge/freezer gate storage suggestions only, never cooking steps.
3. **Diet bias** from settings (default: muscle building in caloric surplus —
   prioritize protein, iron, fibre, nuts, vegetables/fruit), overridable
   per request.
4. **Canonical ingredient list** (names only) with the instruction to reuse
   those names verbatim where the ingredient matches.
5. Output rules: German, strict step notation (every TM6 step carries
   time/temp/speed), per-ingredient `scaling` classification, quantities in
   canonical dimensions.

The Messages API call runs with the **web search tool** enabled for grounding
(no scraping pipelines — search is Anthropic's server-side tool). The final
answer is forced through a `save_recipe` tool whose JSON schema mirrors the
data model — no free-text parsing. Model: `claude-sonnet-5`.

The client shows the draft as a **preview**; saving is an explicit second step
(`POST /api/recipes`). On save, each ingredient is matched: exact name →
alias → else auto-create as new canonical ingredient (with the
category/unit_dim the generation supplied).

Manual entry is a plain form posting to the same endpoint.

## 5. Portion scaling

Recipe detail opens with a serving stepper (default `servings_base`).
Recompute is client-side and pure:

- `linear` — quantity × factor (default)
- `damped` — quantity × factor^0.6 — seasoning/sharpness (salt, chili,
  strong spices); UI adds a "nach Geschmack anpassen" hint
- `fixed` — unchanged ("1 Prise", Varoma tank water)

Rounding to sensible increments (≥100 g → 5 g steps, <100 g → 1 g,
count → whole pieces, ml analog to g). Step times/settings do not scale in v1.
The same scaling function feeds the shopping-list aggregation (scaled by
plan-entry servings).

## 6. Nutrition score

`POST /api/recipes/:id/score` — exactly one Anthropic call, result cached in
`recipes.nutrition_json`, "Neu bewerten" re-fires and overwrites.

The user's **HealthScore prompt is the scoring spec**. Kept verbatim: the
0–100 scale and tier bands, the Scoring Weight Hierarchy (35/25/20/15/5),
Per-Factor Calibration anchors, Conflict Resolution Rule, Special Item Rules,
and the constraint set (no medical advice, WHO/evidence consensus, no diet
philosophies). Dropped as inapplicable to a one-shot recipe input: image
protocol, error-handling table, follow-up-turn protocol, Markdown output
format. Output is forced through a tool schema:

```json
{ "score": 0-100, "tier": "Optimal|Excellent|Moderate|Poor|Very Poor|Toxic",
  "kcal_per_serving": int, "pros": ["…"], "cons": ["…"] }
```

Input: recipe title + ingredient list with per-serving quantities (derived
from `servings_base`). The UI renders the result in the visual spirit of the
original Markdown block (score, tier, ~kcal, pros/cons bullets).

## 7. Pantry → plan → shopping list

- **Plan:** week view; assign recipe to date + slot with servings count.
- **Generate list:** for a date range, sum scaled ingredient needs across
  plan entries, subtract pantry stock, keep positive remainders, group by
  ingredient category, write `shopping_items` (replacing previous
  `source='plan'` items; manual items persist).
- **Shop:** checkable list, offline-safe (outbox).
- **Close the loop:** "Einkauf abschließen" moves checked items into pantry
  stock; after cooking, an optional confirmation deducts the recipe's
  (scaled) ingredients from the pantry. Both single-tap, both skippable.

## 8. Offline / PWA

- `vite-plugin-pwa` precaches the app shell → installable, instant loads.
- **Recipes:** on save and on open, the full recipe JSON is mirrored into
  IndexedDB. Recipe detail and cooking mode read IndexedDB-first, network
  to refresh. A Wi-Fi blip mid-cooking is a non-event.
- **Shopping list:** mirrored in IndexedDB; check/uncheck writes locally and
  queues into an outbox replayed on reconnect (supermarket dead zones).
- Generation, planning, pantry edits: online-only, with clear offline states.
- **Cooking mode requests a screen wake lock** (no screen-off with wet hands).

## 9. Auth

`POST /api/auth/login` compares against `AUTH_PASSPHRASE`, sets an HttpOnly,
Secure, SameSite=Lax cookie containing an HMAC-signed token (`AUTH_SECRET`),
valid ~180 days. Hono middleware guards all other `/api/*` routes. The static
shell is public (contains no data); all data and the generation endpoint
(API credits) sit behind the cookie.

## 10. UI

**Design ground truth: the Ember mockups in `design-reference/mockups/`** —
`App Screens.dc.html` (2a Home/Rezeptbibliothek, 2b Wochenplan,
2c Einkaufsliste), `Recipe Prototype.dc.html` (recipe detail prototype), and
`Recipe Detail.dc.html` (imported from the live Claude Design project via
DesignSync; **only option 1c "Ember" is authoritative** — it is the sole
cooking-mode reference: settings grid, Linkslauf/Varoma badges, circular
timer, Pause/Weiter controls, progress segments. Options 1a Kupfer and
1b Fjord in the same file are discarded directions). The `_ds/organic-*`
stylesheet inside the export belongs to a different system — **ignore it**.

Ember token system (extracted from the mockups):

- Dark-first: bg `#111113`, cooking-canvas `#0A0A0A`, surface `#1A1A1C`,
  elevated `#161618`
- Borders: `#2C2C2E`, `#3A3A3C`
- Text: `#E8E8ED`, bright `#D0D0D5`, secondary `#8E8E93`, muted `#6E6E73`
- Accent: coral `#E8734A`
- Typography: **Space Grotesk** (400/500/600/700), self-hosted (offline PWA)

Structure: bottom tab bar — **Rezepte** (card library: search, tags,
favorites, "kochbar" filter), **Planen** (week view), **Generieren**,
**Einkaufen** (category-grouped, checkable), **Vorrat**. Settings (equipment
profile, diet bias, defaults) behind a header icon.

**Cooking mode:** fullscreen, one step at a time, the TM6 setting as the
dominant element (large coral chip: Zeit / Temperatur / Stufe, plus
Linkslauf-/Varoma-/Modus-badges), off-device steps visually distinct with
device name, step ingredients listed on the step, giant prev/next tap zones,
progress indicator, wake lock. Screens without a mockup (Generieren, Vorrat,
Settings) derive from the same tokens — no new design language.

Cookidoo screenshots in `design-reference/screenshots/` inform layout
patterns and information hierarchy in spirit, not pixel-for-pixel.

## 11. Testing

- **Vitest unit tests** for all pure logic: scaling math + rounding, pantry
  subtraction, ingredient matching (exact/alias/create), shopping-list
  aggregation, cookie signing/verification.
- **API integration tests** against local D1 (`wrangler dev` / vitest-pool-workers).
- **Generation quality:** manual checklist per generated recipe — notation
  compliance, equipment compliance, scaling labels, canonical-name reuse.
  Structure is enforced by the tool JSON schema.

## Scope fences (unchanged from brief)

No TM6 device communication. No Chronometer integration. No automated
scraping/import from recipe sites. No multi-user/social. No native builds —
PWA only.
