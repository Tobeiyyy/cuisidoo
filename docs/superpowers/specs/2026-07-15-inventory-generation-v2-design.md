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

## 7. Recipe Import (URL + Text Paste)

### Problem

Users have recipes from websites, cookbooks, or other sources they want to cook in TM6-optimized form. Currently the only way in is manual entry (tedious) or generation from a wish (doesn't reproduce a specific recipe).

### Flow

A new tab/mode on the Generieren page: **"Rezept importieren"** — a segmented control or toggle alongside the existing generation form.

**Two input modes:**

1. **URL paste** — User pastes a recipe URL. The backend uses the existing `web_search_20260209` server tool to fetch the page content. The AI reads the recipe and adapts it to TM6.

2. **Text paste** — User pastes raw recipe text (copied from a website, typed from a cookbook, or from a photo's OCR). The AI adapts the pasted text to TM6.

Both share a single textarea with a placeholder like "URL oder Rezepttext einfügen…". The backend detects whether the input starts with `http://` or `https://` to choose the mode.

**Shared controls:**
- Portionen stepper (same as regular generation)
- Extra-Geräte-erlaubt checkbox (same as regular generation)

### Backend

New endpoint `POST /api/generate/import` with `{ input: string, portionen: number, extraGeraeteErlaubt: boolean }`.

Implementation:
- If `input` starts with `http(s)://`: use `web_search` tool with a targeted search query containing the URL to fetch the page. The AI then extracts the recipe and adapts it.
- If `input` is plain text: the AI receives it directly as user context and adapts it.
- Both paths use the `SAVE_RECIPE_TOOL` schema for structured output (same as regular generation).
- System prompt variation: instead of "create a recipe for [wish]", it says "adapt this recipe for TM6 while preserving the dish's identity. Keep non-TM6 steps as off_device where appropriate (oven, stove, grill). Optimize cooking times and temperatures for TM6 where possible."
- Pantry contents are included (per section 3) so the AI can note substitution opportunities.
- `source` on save: add `"imported"` to the allowed values in the D1 CHECK constraint and TypeScript type.

### Result

Same preview flow as regular generation — user sees the adapted recipe and can save or discard. The recipe is a full TM6-optimized version with both `tm6` and `off_device` steps as appropriate.

### Migration

`ALTER TABLE recipes` to update the CHECK constraint:
```sql
-- D1 doesn't support ALTER CHECK, so this is handled in the new migration
-- by recreating the constraint or using a less restrictive check
```

Since D1/SQLite CHECK constraints can't be altered in place, the pragmatic approach: the existing CHECK already covers `'generated'` and `'manual'`. We add `'imported'` by using a new migration that creates a trigger or simply relaxes the constraint. Alternatively, since this is a single-user app, we can treat imported recipes as `source = 'generated'` with a tag to distinguish them — simpler, no schema change needed. **Decision: use `source = 'generated'` and auto-add an "Importiert" tag.** This avoids a schema migration while still letting the user filter imported recipes.

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
