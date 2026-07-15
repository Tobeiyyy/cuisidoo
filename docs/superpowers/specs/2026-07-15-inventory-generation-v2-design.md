# Inventory-Aware Generation & Smart Pantry — Design Spec

**Date:** 2026-07-15
**Status:** Approved

## Overview

Five interconnected features that make the pantry the center of the cooking workflow: free-form ingredient management with amountless tracking, inventory-aware AI generation, a "surprise me" suggestion flow, missing-ingredient warnings before cooking, and automatic pantry deduction after cooking.

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

## Files to Modify

| File | Changes |
|------|---------|
| `migrations/0002_pantry_amountless.sql` | New migration: add amountless column |
| `shared/types.ts` | Add `amountless` to pantry types, add `SuggestionResponse` type |
| `worker/settings.ts` | Update pantry PUT to accept amountless, add POST /api/ingredients |
| `worker/generate.ts` | Load pantry, pass to buildSystemPrompt |
| `worker/prompt.ts` | Add pantry section to system prompt, add suggest prompt builder |
| `worker/shopping.ts` | Update cookedHandler to skip amountless; update subtractPantry for amountless |
| New: `worker/suggest.ts` | Suggest endpoint handler |
| `src/pages/Vorrat.tsx` | Amountless toggle, free-form ingredient creation form |
| `src/pages/Generieren.tsx` | "Überrasch mich!" button, suggestion cards UI, sequential generation flow |
| `src/pages/Kochmodus.tsx` | Missing-ingredient banner, auto-deduct on finish, remove abbuchen button |
| `src/api.ts` | New API helpers: suggest, check-pantry, create-ingredient |
| `src/pages/Einkaufen.tsx` | No changes (shopping already handles ingredient_id items) |

## Out of Scope

- Expiry dates / freshness tracking
- Per-ingredient deduction toggles in cooking mode
- Undo for pantry deductions
- Recipe sharing or multi-user pantry
- Barcode scanning for pantry adds
