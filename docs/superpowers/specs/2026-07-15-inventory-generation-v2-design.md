# Inventory-Aware Generation & Smart Pantry — Design Spec

**Date:** 2026-07-15
**Status:** Approved

## Overview

Eight interconnected features that make the pantry the center of the cooking workflow: free-form ingredient management with amountless tracking, inventory-aware AI generation, a "surprise me" suggestion flow, recipe import from URLs and text, missing-ingredient warnings before cooking, automatic pantry deduction after cooking, custom tags for organization, and an "Ausprobiert" cooking journal flow with photos.

## 1. Schema: Amountless Pantry Items

### Change

Add `amountless` column to the `pantry` table via a new migration (`0002_pantry_amountless.sql`):

```sql
ALTER TABLE pantry ADD COLUMN amountless INTEGER NOT NULL DEFAULT 0;
```

### Behavior

- `amountless = 1`: ingredient is always-available (water, salt, olive oil, common spices). Quantity is ignored for shopping math and cooking-mode deduction.
- `amountless = 0` (default): current behavior — quantity tracked in canonical unit.
- This is a per-user pantry decision, not an ingredient-catalog property.

### UI (Vorrat page)

- Each pantry item row gets a toggle icon to flip amountless on/off.
- When amountless is on: quantity stepper hides, replaced by an "Immer da" badge.
- When amountless is off: current stepper behavior.

### API

`PUT /api/pantry` accepts an optional `amountless` boolean alongside `ingredient_id` and `quantity`.

## 2. Free-Form Ingredient Add

### Problem

Currently, ingredients can only be added to the pantry from the existing catalog. The catalog only grows when recipes are saved (via `resolveIngredients`). Users can't stock ingredients they haven't cooked with yet.

### Solution

When the user searches on the Vorrat page and gets no catalog match, a **"Neue Zutat erstellen"** card appears at the bottom of the search results.

Tapping it opens a creation form:

| Field | Type | Details |
|-------|------|---------|
| Name | text input | Pre-filled with search text |
| Kategorie | dropdown | 8 existing categories |
| Einheit | radio group | Gramm (mass) · Milliliter (volume) · Stück (count) |
| Mengenfrei? | toggle | Default off. If on, adds as amountless (skips quantity). |

### Backend

New endpoint `POST /api/ingredients` — creates a row in the `ingredients` table and immediately creates a `pantry` row with default quantity (100g / 100ml / 1 Stück) or amountless.

Validation: reject duplicate names (case-insensitive). Return the created ingredient + pantry entry.

## 3. Inventory-Aware Generation

### Change

Every generation call (regular wish-based and surprise-me) injects the user's pantry into the system prompt.

### Prompt Section

Appended to the system prompt built by `buildSystemPrompt()`:

```
## Vorrat des Nutzers
Folgende Zutaten sind verfügbar:
- Hähnchenbrust: 500 g
- Zwiebel: 3 Stück
- Olivenöl: immer da
- Salz: immer da
- Reis: 800 g
...

Bevorzuge Zutaten aus dem Vorrat wenn möglich, aber schränke dich nicht darauf ein.
Wenn der Nutzer einen konkreten Wunsch hat, hat dieser Vorrang vor dem Vorrat.
```

- Amountless items display as "immer da" (no quantity).
- Mass/volume items display in canonical unit (g / ml).
- Count items display as "N Stück".

### Backend Changes

`worker/generate.ts`: load pantry contents (joined with ingredient names) alongside equipment/settings/canonicalNames. Pass to `buildSystemPrompt()`.

`worker/prompt.ts`: `buildSystemPrompt()` gets a new `pantry` parameter. Appends the inventory section.

## 4. "Surprise Me" Suggestions

### Flow

1. **Generieren page** gets a new button: **"Überrasch mich!"** below the wish textarea, styled as a secondary action.

2. User taps it → `POST /api/generate/suggest` with `{ portionen, extraGeraeteErlaubt }`.

3. Backend builds a lightweight prompt with pantry, diet bias, and equipment. Asks the AI for exactly 3 recipe suggestions. Uses structured output (JSON schema), no web search tool. Small token budget (~500 output tokens).

4. UI shows 3 suggestion cards, each with:
   - Title (bold)
   - One-line description
   - Selectable (checkbox/tap-to-select indicator)

5. User selects one or more cards, taps a confirm button.

6. Selected recipes generate **one at a time** sequentially:
   - First selection generates via the existing `POST /api/generate` endpoint (wish text = selected title).
   - User sees the full recipe preview, saves or discards.
   - If saved/discarded and more selections remain, the next one generates automatically.
   - User can cancel remaining generations at any point.

### Suggest Endpoint

`POST /api/generate/suggest`

Request: `{ portionen: number, extraGeraeteErlaubt: boolean }`

Response: `{ suggestions: [{ title: string, description: string }] }`

Implementation:
- Load pantry, equipment, settings (diet_bias), canonical ingredient names.
- Build a focused prompt: "Based on the user's pantry and preferences, suggest exactly 3 TM6 recipe ideas. Return title and a one-sentence description for each."
- Use `output_config.format` with a JSON schema (like nutrition scoring) instead of tool_use — simpler for structured output without tools.
- No `web_search` tool — these are creative suggestions, not research.
- `max_tokens`: 1024 (generous buffer for thinking + 3 short suggestions).
- Same model as regular generation (`settings.generation_model`).

### Cost

The suggest call is cheap: ~1K output tokens, no web search. Full recipe generation (with web search, ~4K output) only fires on user confirmation of a specific suggestion.

## 5. Missing Ingredient Warning (Cooking Mode)

### When Entering Cooking Mode

On mount, `Kochmodus` compares the recipe's ingredients (scaled to chosen portions) against the pantry:

For each ingredient:
- **Amountless in pantry** → always available, skip.
- **Informal unit** (Prise, TL, EL, Spritzer, Msp.) → check presence only. Missing if not in pantry at all.
- **Canonical unit** → compare `scaledQuantity` against `pantry.quantity`. Missing if not in pantry; insufficient if `pantry.quantity < scaledQuantity`.

### UI

If any ingredients are missing or insufficient, a **non-blocking banner** appears at the top of the first step:

- Heading: "Fehlende Zutaten"
- List of missing items with needed quantities (e.g., "200 g Mehl", "2 Stück Eier")
- **"Zur Einkaufsliste"** button — adds all missing items to the shopping list in one tap
- Dismiss button (X) — banner closes, cooking proceeds normally

The banner does not block cooking. User can swipe to next step or dismiss it.

### Adding to Shopping List

`POST /api/shopping` for each missing item, with:
- `ingredient_id` set (so shopping completion flows back to pantry)
- `quantity` = needed amount minus pantry amount (or full amount if not in pantry)
- `unit` = canonical unit for the ingredient's dimension
- `source` = "kochmodus"
- `category` = ingredient's category

### API

New endpoint `GET /api/recipes/:id/check-pantry?servings=N` — returns `{ missing: [{ ingredient_id, name, needed, available, unit }] }`. This keeps the comparison logic on the server where pantry data lives.

## 6. Automatic Pantry Deduction After Cooking

### Change

Replace the opt-in "Zutaten aus Vorrat abbuchen" button with automatic deduction.

### Behavior

When the user advances past the last step in cooking mode:
1. `POST /api/recipes/:id/cooked` fires automatically with `{ servings }`.
2. The `cookedHandler` skips amountless ingredients (new check: `WHERE amountless = 0`).
3. Informal-unit ingredients are skipped as before.
4. All other ingredients: subtract scaled quantity from pantry, clamp to 0, delete row if result ≤ 0.

### Finish Screen

The "Guten Appetit!" screen changes:
- Remove the "Zutaten aus Vorrat abbuchen" button.
- Show "Vorrat aktualisiert ✓" confirmation line instead.
- Keep the "Schließen" button to navigate back.

### Error Handling

If the deduction call fails (network error, etc.), show "Vorrat konnte nicht aktualisiert werden" with a retry button. Don't block the user from closing.

## 7. Recipe Import (URL + Text Paste + YouTube via Bot)

### Problem

Users have recipes from websites, cookbooks, YouTube videos, and other sources they want to cook in TM6-optimized form. Currently the only way in is manual entry (tedious) or generation from a wish (doesn't reproduce a specific recipe).

### Flow

A new tab/mode on the Generieren page: **"Rezept importieren"** — a segmented control or toggle alongside the existing generation form.

**Two input modes:**

1. **URL paste** — User pastes a recipe URL (website, not YouTube). The backend uses the existing `web_search_20260209` server tool to fetch the page content. The AI reads the recipe and adapts it to TM6.

2. **Text paste** — User pastes raw recipe text. This covers:
   - Copied from a website
   - Typed from a cookbook
   - **Output from the YouTube summarizer bot** (see Schema E below)

Both share a single textarea with a placeholder like "URL oder Rezepttext einfügen…". The backend detects whether the input starts with `http://` or `https://` to choose the mode.

**Shared controls:**
- Portionen stepper (same as regular generation)
- Extra-Geräte-erlaubt checkbox (same as regular generation)

### Multi-Recipe Handling

When the pasted text contains multiple recipes (e.g., from a compilation video or a "10 best recipes" article), the import endpoint detects this and returns them as selectable suggestions — same pick-then-generate pattern as surprise-me:

1. `POST /api/generate/import` with the full text.
2. If the AI detects multiple recipes, it returns `{ multi: true, suggestions: [{ title, description }] }` without generating any full recipe.
3. UI shows selectable cards. User picks which ones to import.
4. Each selected recipe generates one at a time: the import endpoint is called again with `{ input: <original text>, selectedTitle: <picked title> }` so the AI knows which recipe to extract and adapt.
5. User reviews each preview, saves or discards, then the next one generates.

For single-recipe input, the endpoint returns the full adapted recipe directly (no selection step).

### YouTube Integration via Summarizer Bot

The user has an existing Discord bot that summarizes YouTube videos into Obsidian-formatted notes using transcript access. For YouTube cooking videos, the bot uses a dedicated **Schema E: Recipe Extract** (see appendix) that outputs structured recipe data.

**Workflow:** Share YouTube URL in Discord → bot outputs recipe-formatted note → user copies the note content → pastes into the app's text import → AI adapts for TM6.

This is the recommended path for YouTube recipes because:
- The bot has full transcript access (the app's web_search cannot reliably extract YouTube transcripts).
- Schema E outputs structured ingredients and steps, making TM6 adaptation more accurate.
- Compilation videos with multiple recipes are handled: Schema E outputs each recipe as a separate section, and the app's multi-recipe detection picks them up as selectable cards.

### Backend

New endpoint `POST /api/generate/import` with `{ input: string, portionen: number, extraGeraeteErlaubt: boolean, selectedTitle?: string }`.

Implementation:
- If `input` starts with `http(s)://`: use `web_search` tool with a targeted search query containing the URL to fetch the page. The AI then extracts the recipe and adapts it.
- If `input` is plain text: the AI receives it directly as user context and adapts it.
- If the AI detects multiple recipes and no `selectedTitle` is provided: return suggestions only (no full generation, cheap).
- If `selectedTitle` is provided: extract and adapt only that specific recipe from the input.
- Both paths use the `SAVE_RECIPE_TOOL` schema for structured output (same as regular generation).
- System prompt variation: instead of "create a recipe for [wish]", it says "adapt this recipe for TM6 while preserving the dish's identity. Keep non-TM6 steps as off_device where appropriate (oven, stove, grill). Optimize cooking times and temperatures for TM6 where possible."
- Pantry contents are included (per section 3) so the AI can note substitution opportunities.
- `source` on save: use `source = 'generated'` and auto-add an "Importiert" tag. This avoids a schema migration (D1/SQLite CHECK constraints can't be altered in place) while still letting the user filter imported recipes in the library.

## 8. Custom Tags & Cooking Journal

### Current State

Tags already work: free-form strings stored in `recipe_tags`, displayed as filter pills in the library, editable via comma-separated input in the recipe form. The AI also assigns tags during generation.

### What's Missing

- **No inline tag creation from the recipe detail page** — user must edit the recipe to change tags.
- **Tags aren't shown on the recipe detail page** at all.
- **No quick "Ausprobiert" / "tried it" flow** after cooking.

### Changes

**Recipe detail page (`RezeptDetail.tsx`):**
- Display tags below the recipe title as tappable chips.
- Add a "+" chip at the end — tapping it opens an inline input. User types a new tag name, hits enter, tag is added immediately (optimistic update + `PUT /api/recipes/:id`).
- Tapping an existing tag chip shows a remove option (long-press or X icon).

**Cooking mode finish screen (`Kochmodus.tsx`):**
- After auto-deduct, show a **"Ausprobiert markieren?"** prompt with a camera icon.
- Tapping it: adds an "Ausprobiert" tag to the recipe (if not already tagged) and opens the existing photo upload flow so the user can snap a picture of their cooked dish.
- Skippable — the "Schließen" button is always available.
- This naturally turns the app into a cooking journal: recipes tagged "Ausprobiert" with photos of the actual cooked result, filterable in the library.

**Library page (`Rezepte.tsx`):**
- Already handles tag filtering via pills — custom tags appear automatically alongside AI-assigned ones.
- No changes needed beyond what already works.

**Recipe form (`RezeptForm.tsx`):**
- Current comma-separated input stays as-is for bulk editing.
- No changes needed.

### API

Tag add/remove on the detail page uses the existing `PUT /api/recipes/:id` endpoint which already replaces all tags. The frontend sends the full updated tags array.

For the photo flow: the existing `POST /api/recipes/:id/image` upload endpoint is reused — no changes needed.

## Files to Modify

| File | Changes |
|------|---------|
| `migrations/0002_pantry_amountless.sql` | New migration: add amountless column |
| `shared/types.ts` | Add `amountless` to pantry types, add `SuggestionResponse` type |
| `worker/settings.ts` | Update pantry PUT to accept amountless, add POST /api/ingredients |
| `worker/generate.ts` | Load pantry, pass to buildSystemPrompt; add import endpoint |
| `worker/prompt.ts` | Add pantry section to system prompt, add suggest + import prompt builders |
| `worker/shopping.ts` | Update cookedHandler to skip amountless; update subtractPantry for amountless |
| New: `worker/suggest.ts` | Suggest endpoint handler |
| `src/pages/Vorrat.tsx` | Amountless toggle, free-form ingredient creation form |
| `src/pages/Generieren.tsx` | "Überrasch mich!" button, suggestion cards, import tab, sequential generation flow |
| `src/pages/Kochmodus.tsx` | Missing-ingredient banner, auto-deduct on finish, "Ausprobiert" prompt with photo |
| `src/pages/RezeptDetail.tsx` | Display tags as chips, inline tag add/remove |
| `src/api.ts` | New API helpers: suggest, check-pantry, create-ingredient, import |
| `src/pages/Einkaufen.tsx` | No changes (shopping already handles ingredient_id items) |
| `src/pages/Rezepte.tsx` | No changes (tag filtering already works for custom tags) |

## Out of Scope

- Expiry dates / freshness tracking
- Per-ingredient deduction toggles in cooking mode
- Undo for pantry deductions
- Recipe sharing or multi-user pantry
- Barcode scanning for pantry adds
- OCR from cookbook photos (user pastes text manually)
- Recipe version history / diff between original and adapted
- Direct YouTube transcript extraction in the app (use the bot pipeline instead)

## Appendix A: Schema E for YouTube Summarizer Bot

Add this schema to the existing bot prompt alongside Schemas A–D.

### Schema Detection

```
#### Schema E: The Recipe Extract
* **Trigger:** Content demonstrates cooking, baking, food preparation, or is a recipe compilation/list
* **Structure:**
    1. **Dish** — Name of the dish, cuisine origin if mentioned, approximate total time
    2. **Servings** — How many portions the recipe yields (if stated; otherwise `Servings not stated`)
    3. **Ingredients** — One line per ingredient: `- {quantity} {unit} {name}` (e.g., `- 500 g Hähnchenbrust`). Group under `### Für {section}` sub-headers when the recipe has distinct components (dough, filling, sauce, etc.). If quantity is vague ("a handful", "some"), write it as-is
    4. **Steps** — Numbered list, each step is one discrete action. Include time and temperature where mentioned. Flag equipment in brackets: `[Ofen]`, `[Standmixer]`, `[Pfanne]`, etc.
    5. **Tips & Variations** — Substitutions, common mistakes, or variations the creator mentions. Omit if none
* **Multi-recipe rule:** If the video contains multiple distinct recipes (compilation, "top 10", meal prep series), apply this schema **once per recipe** as separate sections under `## Recipe N: {Title} [{timestamp}]`. Each gets its own Ingredients + Steps
```

### Reference Output (Single Recipe)

```
# One-Pan Lemon Herb Chicken

**Tags:** [[youtube]], [[chicken]], [[one-pan]], [[meal-prep]]
**Source:** https://youtube.com/watch?v=example
**Author:** Pro Home Cooks
**Schema Applied:** E

## Dish

One-Pan Lemon Herb Chicken — Mediterranean-inspired, ~45 min total [00:15](https://youtu.be/example?t=15s)

## Servings

4 portions

## Ingredients

- 4 Stück Hähnchenschenkel (bone-in)
- 500 g Kartoffeln (gewürfelt)
- 2 Stück Zitronen
- 4 Zehen Knoblauch
- 3 EL Olivenöl
- 1 TL Thymian (getrocknet)
- 1 TL Rosmarin (getrocknet)
- Salz und Pfeffer nach Geschmack

## Steps

1. Ofen auf 200°C vorheizen [01:30](https://youtu.be/example?t=1m30s) [Ofen]
2. Kartoffeln würfeln und auf ein Backblech verteilen [02:10](https://youtu.be/example?t=2m10s)
3. Hähnchen mit Olivenöl, Kräutern, Salz und Pfeffer einreiben [03:45](https://youtu.be/example?t=3m45s)
4. Zitrone halbieren, Saft über Kartoffeln und Hähnchen verteilen [04:20](https://youtu.be/example?t=4m20s)
5. Knoblauch zerdrücken und zwischen die Kartoffeln geben [04:50](https://youtu.be/example?t=4m50s)
6. Hähnchen auf die Kartoffeln setzen, 35–40 Min backen bis goldbraun [05:15](https://youtu.be/example?t=5m15s) [Ofen]
7. 5 Min ruhen lassen vor dem Servieren [06:30](https://youtu.be/example?t=6m30s)

## Tips & Variations

> Kartoffeln möglichst gleichmäßig würfeln damit sie gleichzeitig gar werden [03:00](https://youtu.be/example?t=3m)

> Variante: Süßkartoffeln statt normaler Kartoffeln für mehr Süße [06:45](https://youtu.be/example?t=6m45s)
```

### Reference Output (Multi-Recipe Compilation)

```
# 5 Easy 15-Minute Dinners

**Tags:** [[youtube]], [[meal-prep]], [[quick-meals]], [[weeknight-dinner]]
**Source:** https://youtube.com/watch?v=example
**Author:** Joshua Weissman
**Schema Applied:** E

> Note: Multi-recipe compilation — 5 recipes extracted individually.

## Recipe 1: Garlic Butter Shrimp Pasta [00:30](https://youtu.be/example?t=30s)

### Dish
Garlic Butter Shrimp Pasta — Italian-inspired, ~12 min

### Servings
2 portions

### Ingredients
- 200 g Spaghetti
- 250 g Garnelen (geschält)
- 4 Zehen Knoblauch (gehackt)
- 2 EL Butter
- 1 EL Olivenöl
- Prise Chiliflocken
- Salz und Pfeffer nach Geschmack

### Steps
1. Pasta in Salzwasser kochen [00:45](https://youtu.be/example?t=45s) [Herd]
2. Garnelen in Olivenöl scharf anbraten, 2 Min pro Seite [02:10](https://youtu.be/example?t=2m10s) [Pfanne]
3. Knoblauch und Chiliflocken dazu, 30 Sek anbraten [03:30](https://youtu.be/example?t=3m30s) [Pfanne]
4. Butter und 2 EL Pastawasser einrühren [04:00](https://youtu.be/example?t=4m)
5. Pasta unterheben, durchschwenken [04:20](https://youtu.be/example?t=4m20s)

## Recipe 2: Teriyaki Chicken Bowl [05:00](https://youtu.be/example?t=5m)

### Dish
Teriyaki Chicken Bowl — Japanese-inspired, ~15 min

### Servings
2 portions

### Ingredients
- 300 g Hähnchenbrust (in Streifen)
- 200 g Reis (gekocht)
- 3 EL Sojasauce
- 2 EL Honig
- 1 EL Reisessig
- 1 TL Ingwer (gerieben)
- 1 Stück Frühlingszwiebel

### Steps
1. Hähnchen in Streifen schneiden [05:15](https://youtu.be/example?t=5m15s)
2. In heißer Pfanne anbraten bis goldbraun, 4–5 Min [05:45](https://youtu.be/example?t=5m45s) [Pfanne]
3. Sojasauce, Honig, Reisessig und Ingwer mischen [06:30](https://youtu.be/example?t=6m30s)
4. Sauce zum Hähnchen geben, einkochen lassen bis glasig [07:00](https://youtu.be/example?t=7m)
5. Auf Reis anrichten, mit Frühlingszwiebeln garnieren [07:30](https://youtu.be/example?t=7m30s)

[... Recipe 3–5 continue in same pattern ...]
```

### Integration with Existing Bot Prompt

Add Schema E to the `INTELLIGENT SCHEMA DETECTION` section after Schema D. Add to the schema selection priority rule: "Cooking content always triggers Schema E regardless of secondary schema matches (a cooking tutorial is Schema E, not Schema A)."

### Short-Form Exception for Schema E

For videos under 8 minutes with a single recipe, compress by merging Dish + Servings into one line and omitting Tips if none exist. Multi-recipe compilations under 8 minutes are unlikely but handled normally if they occur.
