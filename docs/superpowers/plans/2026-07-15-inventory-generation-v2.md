# Inventory-Aware Generation & Smart Pantry — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the pantry the center of the cooking workflow — amountless tracking, free-form ingredients, inventory-aware generation, "surprise me" suggestions, recipe import, missing-ingredient warnings, auto-deduct after cooking, custom tags, and an "Ausprobiert" journal flow.

**Architecture:** D1 schema gains an `amountless` column on `pantry` and a relaxed `source` CHECK on `shopping_items`. The generation system prompt injects pantry contents. Two new API endpoints (`/api/generate/suggest`, `/api/generate/import`) use structured output (JSON schema via `output_config.format`) and the existing `SAVE_RECIPE_TOOL`. The Generieren page gains three modes (generate, surprise, import) via a segmented control. Cooking mode auto-deducts on finish and shows a missing-ingredient banner on enter.

**Tech Stack:** Cloudflare Workers + Hono + D1, React 18 + Vite + TanStack Query, Anthropic SDK (`@anthropic-ai/sdk`), TypeScript.

## Global Constraints

- All UI text in German.
- Phone-first PWA — test at 375px width.
- Ember design system: bg `#111113`, accent `#E8734A`, Space Grotesk font.
- All quantities in canonical units: g (mass), ml (volume), Stück (count).
- `strict: true` on Anthropic tool schemas — no `enum` on nullable union types.
- Existing tests must keep passing (`npm test`). Add tests for new pure functions.
- Commit after each task.

---

### Task 1: Schema Migration + Amountless Pantry Backend

**Files:**
- Create: `migrations/0002_pantry_amountless.sql`
- Modify: `worker/settings.ts:5-27` (pantryRoutes)
- Modify: `shared/types.ts` (add PantryItem type)
- Test: `tests/shopping.test.ts` (add amountless subtractPantry tests)

**Interfaces:**
- Produces: `PantryItem` type in `shared/types.ts` (used by Vorrat.tsx, Kochmodus.tsx, generate endpoints), `PUT /api/pantry` accepts `amountless` field, `subtractPantry` respects amountless items, migration file ready for `npx wrangler d1 migrations apply`.

- [ ] **Step 1: Create migration file**

```sql
-- migrations/0002_pantry_amountless.sql
ALTER TABLE pantry ADD COLUMN amountless INTEGER NOT NULL DEFAULT 0;
```

- [ ] **Step 2: Add PantryItem type to shared/types.ts**

At the end of `shared/types.ts`, add:

```ts
export interface PantryItem {
  ingredient_id: number;
  name: string;
  category: string;
  unit_dim: UnitDim;
  quantity: number;
  amountless: boolean;
  updated_at: string;
}
```

- [ ] **Step 3: Update pantry GET to include amountless**

In `worker/settings.ts`, update the pantryRoutes GET handler's SQL to include `p.amountless` and map `amountless: !!r.amountless` in the return:

```ts
export const pantryRoutes = new Hono<{ Bindings: Env }>()
  .get("/", async (c) => {
    const rows = await qAll<any>(c.env.DB.prepare(
      "SELECT p.ingredient_id, i.name, i.category, i.unit_dim, p.quantity, p.amountless, p.updated_at " +
      "FROM pantry p JOIN ingredients i ON i.id = p.ingredient_id " +
      "ORDER BY i.category, i.name"));
    return c.json(rows.map((r: any) => ({ ...r, amountless: !!r.amountless })));
  })
```

- [ ] **Step 4: Update pantry PUT to accept amountless**

In `worker/settings.ts`, update the PUT handler to accept and store `amountless`:

```ts
  .put("/", async (c) => {
    const { ingredient_id, quantity, amountless } = await c.req.json<{
      ingredient_id: number; quantity: number; amountless?: boolean;
    }>();
    if (!Number.isFinite(quantity) && !amountless) {
      return c.json({ error: "quantity must be a finite number" }, 400);
    }
    if (!amountless && quantity <= 0) {
      await c.env.DB.prepare("DELETE FROM pantry WHERE ingredient_id=?").bind(ingredient_id).run();
    } else {
      await c.env.DB.prepare(
        "INSERT INTO pantry (ingredient_id, quantity, amountless, updated_at) VALUES (?,?,?,datetime('now')) " +
        "ON CONFLICT(ingredient_id) DO UPDATE SET quantity=excluded.quantity, amountless=excluded.amountless, updated_at=excluded.updated_at",
      ).bind(ingredient_id, amountless ? 0 : quantity, amountless ? 1 : 0).run();
    }
    return c.json({ ok: true });
  });
```

- [ ] **Step 5: Update subtractPantry to respect amountless**

In `worker/shopping.ts`, update `loadPantryMap` to also load `amountless`, and update `subtractPantry` to skip amountless items. Change the pantry map type:

```ts
export interface PantryEntry { quantity: number; amountless: boolean }

export function subtractPantry(needs: Need[], pantry: Map<number, PantryEntry>): Need[] {
  const result: Need[] = [];
  for (const need of needs) {
    const entry = pantry.get(need.ingredient_id);
    if (entry?.amountless) continue;
    if (need.informal) {
      if (!entry) result.push(need);
      continue;
    }
    const remainder = need.quantity - (entry?.quantity ?? 0);
    if (remainder > 0) result.push({ ...need, quantity: remainder });
  }
  return result;
}

async function loadPantryMap(db: D1Database): Promise<Map<number, PantryEntry>> {
  const rows = await qAll<{ ingredient_id: number; quantity: number; amountless: number }>(
    db.prepare("SELECT ingredient_id, quantity, amountless FROM pantry"),
  );
  return new Map(rows.map((r) => [r.ingredient_id, { quantity: r.quantity, amountless: !!r.amountless }]));
}
```

- [ ] **Step 6: Update cookedHandler to skip amountless**

In `worker/shopping.ts`, update `cookedHandler` to use the new `PantryEntry` type:

```ts
export async function cookedHandler(c: Context<{ Bindings: Env }>) {
  const recipeId = Number(c.req.param("id"));
  const recipe = await getFullRecipe(c.env.DB, recipeId);
  if (!recipe) return c.json({ error: "not found" }, 404);
  const { servings } = await c.req.json<{ servings: number }>();
  if (!Number.isInteger(servings) || servings < 1) {
    return c.json({ error: "servings must be >= 1" }, 400);
  }
  const factor = servings / recipe.servings_base;
  const pantry = await loadPantryMap(c.env.DB);
  const stmts: D1PreparedStatement[] = [];
  for (const ing of recipe.ingredients) {
    if (isInformalUnit(ing.unit)) continue;
    const entry = pantry.get(ing.ingredient_id);
    if (!entry || entry.amountless) continue;
    const scaled = scaleQuantity(ing.quantity, ing.scaling, factor, ing.unit);
    const next = Math.max(0, entry.quantity - scaled);
    if (next <= 0) {
      stmts.push(c.env.DB.prepare("DELETE FROM pantry WHERE ingredient_id=?").bind(ing.ingredient_id));
    } else {
      stmts.push(c.env.DB.prepare("UPDATE pantry SET quantity=?, updated_at=datetime('now') WHERE ingredient_id=?")
        .bind(next, ing.ingredient_id));
    }
  }
  if (stmts.length) await c.env.DB.batch(stmts);
  return c.json({ ok: true });
}
```

- [ ] **Step 7: Update shopping `complete` handler for pantry amountless**

In the `.post("/complete", ...)` handler in `worker/shopping.ts`, the pantry INSERT ON CONFLICT already works — amountless items just won't appear as shopping items, so no change needed. Confirm by reviewing.

- [ ] **Step 8: Write tests for amountless subtractPantry**

In `tests/shopping.test.ts`, add:

```ts
describe("subtractPantry with amountless", () => {
  it("skips amountless items entirely", () => {
    const needs = aggregateNeeds([{ servings: 2, servings_base: 2, ingredients: [zwiebel] }]);
    const pantry = new Map([[1, { quantity: 0, amountless: true }]]);
    expect(subtractPantry(needs, pantry)).toHaveLength(0);
  });
  it("still subtracts tracked items", () => {
    const needs = aggregateNeeds([{ servings: 4, servings_base: 2, ingredients: [zwiebel] }]);
    const pantry = new Map([[1, { quantity: 0.5, amountless: false }]]);
    expect(subtractPantry(needs, pantry)[0].quantity).toBe(1.5);
  });
});
```

Update existing tests to use the new `PantryEntry` type:
- `new Map([[1, 0.5]])` → `new Map([[1, { quantity: 0.5, amountless: false }]])`
- `new Map([[1, 5]])` → `new Map([[1, { quantity: 5, amountless: false }]])`
- `new Map([[2, 1]])` → `new Map([[2, { quantity: 1, amountless: false }]])`

- [ ] **Step 9: Run tests**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 10: Apply migration locally**

Run: `npm run migrate:local`

- [ ] **Step 11: Commit**

```bash
git add migrations/0002_pantry_amountless.sql shared/types.ts worker/settings.ts worker/shopping.ts tests/shopping.test.ts
git commit -m "feat: amountless pantry items — schema, backend, shopping math"
```

---

### Task 2: Amountless UI + Free-Form Ingredient Add (Vorrat Page)

**Files:**
- Modify: `src/pages/Vorrat.tsx`
- Modify: `worker/ingredients.ts:47-64` (add POST endpoint)
- Modify: `worker/index.ts:64` (route wiring — already wired, ingredients POST goes into existing ingredientRoutes)
- Modify: `src/api.ts` (add createIngredient helper)

**Interfaces:**
- Consumes: `PantryItem` from `shared/types.ts` (Task 1), `PUT /api/pantry` with `amountless` field (Task 1).
- Produces: `POST /api/ingredients` endpoint (creates ingredient + pantry row), `createIngredient()` in `src/api.ts`, updated Vorrat page with amountless toggle and free-form ingredient creation.

- [ ] **Step 1: Add POST /api/ingredients endpoint**

In `worker/ingredients.ts`, add a `.post("/", ...)` handler to `ingredientRoutes`:

```ts
  .post("/", async (c) => {
    const { name, category, unit_dim, amountless } = await c.req.json<{
      name: string; category: string; unit_dim: UnitDim; amountless?: boolean;
    }>();
    if (!name?.trim()) return c.json({ error: "Name ist erforderlich" }, 400);
    if (!category?.trim()) return c.json({ error: "Kategorie ist erforderlich" }, 400);
    if (!["mass", "volume", "count"].includes(unit_dim)) {
      return c.json({ error: "Einheit muss mass, volume oder count sein" }, 400);
    }
    const existing = await c.env.DB.prepare(
      "SELECT id FROM ingredients WHERE LOWER(name) = LOWER(?)",
    ).bind(name.trim()).first();
    if (existing) return c.json({ error: "Zutat existiert bereits" }, 409);

    const res = await c.env.DB.prepare(
      "INSERT INTO ingredients (name, category, unit_dim) VALUES (?,?,?) RETURNING id",
    ).bind(name.trim(), category.trim(), unit_dim).first<{ id: number }>();
    const ingredientId = res!.id;

    const defaultQty = unit_dim === "count" ? 1 : 100;
    await c.env.DB.prepare(
      "INSERT INTO pantry (ingredient_id, quantity, amountless, updated_at) VALUES (?,?,?,datetime('now'))",
    ).bind(ingredientId, amountless ? 0 : defaultQty, amountless ? 1 : 0).run();

    return c.json({ id: ingredientId }, 201);
  });
```

- [ ] **Step 2: Add createIngredient API helper**

In `src/api.ts`, add:

```ts
export async function createIngredient(data: {
  name: string; category: string; unit_dim: UnitDim; amountless?: boolean;
}): Promise<{ id: number }> {
  return api<{ id: number }>("/api/ingredients", {
    method: "POST",
    body: JSON.stringify(data),
  });
}
```

Add `UnitDim` to the import from `../../shared/types`.

- [ ] **Step 3: Update Vorrat page — use PantryItem type with amountless**

In `src/pages/Vorrat.tsx`, replace the local `PantryItem` interface with the import from `shared/types.ts`:

```ts
import type { PantryItem } from "../../shared/types";
```

Remove the local `PantryItem` interface (lines 7-14).

- [ ] **Step 4: Add amountless toggle to pantry item rows**

In `src/pages/Vorrat.tsx`, update each pantry item row to show either the quantity stepper (when not amountless) or an "Immer da" badge (when amountless), plus a toggle button:

```tsx
{items.map((item) => (
  <div key={item.ingredient_id}>
    <div className="list-row">
      <span style={{ flex: 1, fontSize: 15, color: "var(--tx)" }}>{item.name}</span>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {item.amountless ? (
          <span style={{ fontSize: 12, color: "var(--tx3)", background: "var(--line)", padding: "4px 10px", borderRadius: 6 }}>
            Immer da
          </span>
        ) : (
          <>
            <button
              type="button"
              onClick={() => adjustQuantity(item.ingredient_id, -stepFor(item.unit_dim))}
              aria-label={`${item.name} weniger`}
              style={{
                width: 30, height: 30, border: "1.5px solid var(--border2)", background: "none",
                borderRadius: "var(--r-sm)", color: "var(--tx3)", fontSize: 16, cursor: "pointer",
              }}
            >
              −
            </button>
            <span style={{ fontSize: 14, color: "var(--tx)", minWidth: 64, textAlign: "center" }}>
              {formatQuantity(item.quantity, item.unit_dim === "count" ? "Stück" : "g")} {unitLabel(item.unit_dim)}
            </span>
            <button
              type="button"
              onClick={() => adjustQuantity(item.ingredient_id, stepFor(item.unit_dim))}
              aria-label={`${item.name} mehr`}
              style={{
                width: 30, height: 30, border: "none", background: "var(--accent)",
                borderRadius: "var(--r-sm)", color: "#fff", fontSize: 16, cursor: "pointer",
              }}
            >
              +
            </button>
          </>
        )}
        <button
          type="button"
          onClick={() => toggleAmountless(item.ingredient_id, !item.amountless)}
          aria-label={item.amountless ? "Menge tracken" : "Als immer da markieren"}
          title={item.amountless ? "Menge tracken" : "Immer da"}
          style={{
            width: 30, height: 30, border: "1px solid var(--border2)", background: "none",
            borderRadius: "var(--r-sm)", color: item.amountless ? "var(--accent)" : "var(--tx4)",
            fontSize: 14, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          ∞
        </button>
      </div>
    </div>
    {writeErrors.has(item.ingredient_id) && (
      <p style={{ color: "var(--accent)", fontSize: 12, margin: "0 0 8px" }} role="alert">
        Speichern fehlgeschlagen
      </p>
    )}
  </div>
))}
```

- [ ] **Step 5: Add toggleAmountless function**

In `src/pages/Vorrat.tsx`, add a function to toggle the amountless state:

```ts
async function toggleAmountless(ingredientId: number, amountless: boolean) {
  queryClient.setQueryData<PantryItem[]>(["pantry"], (old) =>
    old?.map((p) => p.ingredient_id === ingredientId ? { ...p, amountless } : p));
  try {
    const item = pantry.find((p) => p.ingredient_id === ingredientId);
    await api("/api/pantry", {
      method: "PUT",
      body: JSON.stringify({
        ingredient_id: ingredientId,
        quantity: item?.quantity ?? 0,
        amountless,
      }),
    });
  } catch {
    setWriteErrors((prev) => new Set(prev).add(ingredientId));
    queryClient.invalidateQueries({ queryKey: ["pantry"] });
  }
}
```

- [ ] **Step 6: Add free-form ingredient creation form**

In `src/pages/Vorrat.tsx`, when `searchResults.length === 0` and `addQuery.trim()` is non-empty, show a "Neue Zutat erstellen" card instead of just "Keine Treffer". Add state for the creation form:

```ts
const [creating, setCreating] = useState(false);
const [newCategory, setNewCategory] = useState("Sonstiges");
const [newUnitDim, setNewUnitDim] = useState<UnitDim>("mass");
const [newAmountless, setNewAmountless] = useState(false);
const [createError, setCreateError] = useState<string | null>(null);
```

Replace the "Keine Treffer" block:

```tsx
{searchResults.length === 0 && addQuery.trim() ? (
  creating ? (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: 14, color: "var(--tx)", fontWeight: 500 }}>
        „{addQuery.trim()}" erstellen
      </div>
      <select className="input" value={newCategory} onChange={(e) => setNewCategory(e.target.value)}>
        {["Gemüse & Obst","Fleisch & Fisch","Milchprodukte","Grundnahrungsmittel","Gewürze","Tiefkühl","Getränke","Sonstiges"]
          .map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
      <div style={{ display: "flex", gap: 8 }}>
        {([["mass","Gramm"],["volume","Milliliter"],["count","Stück"]] as const).map(([dim, label]) => (
          <label key={dim} style={{
            flex: 1, padding: "8px 0", textAlign: "center", fontSize: 13, cursor: "pointer",
            background: newUnitDim === dim ? "var(--accent)" : "var(--elev)",
            color: newUnitDim === dim ? "#fff" : "var(--tx3)",
            borderRadius: "var(--r-sm)", border: "1px solid var(--line)",
          }}>
            <input type="radio" name="unitDim" value={dim} checked={newUnitDim === dim}
              onChange={() => setNewUnitDim(dim)} style={{ display: "none" }} />
            {label}
          </label>
        ))}
      </div>
      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--tx3)", cursor: "pointer" }}>
        <input type="checkbox" checked={newAmountless} onChange={(e) => setNewAmountless(e.target.checked)}
          style={{ accentColor: "var(--accent)" }} />
        Mengenfrei (immer da)
      </label>
      {createError && <p style={{ color: "var(--accent)", fontSize: 12, margin: 0 }}>{createError}</p>}
      <button type="button" className="btn-accent" onClick={handleCreateIngredient}>
        Erstellen & hinzufügen
      </button>
    </div>
  ) : (
    <button type="button" className="btn-ghost" onClick={() => setCreating(true)}
      style={{ width: "100%", fontSize: 13 }}>
      „{addQuery.trim()}" als neue Zutat erstellen
    </button>
  )
) : searchResults.length === 0 ? (
  <p style={{ color: "var(--tx4)", fontSize: 13, margin: 0 }}>Keine Treffer.</p>
) : (
  /* existing search results list */
)}
```

- [ ] **Step 7: Add handleCreateIngredient function**

```ts
async function handleCreateIngredient() {
  setCreateError(null);
  try {
    await createIngredient({
      name: addQuery.trim(),
      category: newCategory,
      unit_dim: newUnitDim,
      amountless: newAmountless,
    });
    setCreating(false);
    setAddQuery("");
    setNewCategory("Sonstiges");
    setNewUnitDim("mass");
    setNewAmountless(false);
    queryClient.invalidateQueries({ queryKey: ["pantry"] });
    queryClient.invalidateQueries({ queryKey: ["ingredients"] });
  } catch (err) {
    setCreateError(err instanceof Error ? err.message : "Erstellen fehlgeschlagen");
  }
}
```

Add `createIngredient` to the import from `../api` and `UnitDim` to the import from `../../shared/types`.

- [ ] **Step 8: Run tests + typecheck**

Run: `npm test && npx tsc -b --noEmit`
Expected: All pass.

- [ ] **Step 9: Commit**

```bash
git add worker/ingredients.ts src/pages/Vorrat.tsx src/api.ts shared/types.ts
git commit -m "feat: amountless toggle + free-form ingredient creation on Vorrat page"
```

---

### Task 3: Inventory-Aware Generation

**Files:**
- Modify: `worker/prompt.ts:1-32` (buildSystemPrompt)
- Modify: `worker/generate.ts:7-63` (load pantry, pass to prompt)
- Test: `tests/prompt.test.ts` (add pantry section test)

**Interfaces:**
- Consumes: `loadPantryMap()` pattern from `worker/shopping.ts` (Task 1), `PantryEntry` type (Task 1).
- Produces: `buildSystemPrompt()` now accepts a `pantry` parameter and appends inventory section. All generation calls include pantry data.

- [ ] **Step 1: Add pantry parameter to buildSystemPrompt**

In `worker/prompt.ts`, update the function signature and append the pantry section:

```ts
export interface PantryPromptItem {
  name: string;
  quantity: number;
  unit_dim: UnitDim;
  amountless: boolean;
}

export function buildSystemPrompt(opts: {
  equipmentOwned: string[]; dietBias: string; canonicalNames: string[];
  extraGeraeteErlaubt: boolean; pantry?: PantryPromptItem[];
}): string {
```

At the end of the returned string (before the final backtick), append:

```ts
  let prompt = `Du bist ein Experte...`; // existing content

  if (opts.pantry && opts.pantry.length > 0) {
    const lines = opts.pantry.map((p) => {
      if (p.amountless) return `- ${p.name}: immer da`;
      const unit = p.unit_dim === "mass" ? "g" : p.unit_dim === "volume" ? "ml" : "Stück";
      return `- ${p.name}: ${p.quantity} ${unit}`;
    });
    prompt += `\n\n## Vorrat des Nutzers\nFolgende Zutaten sind verfügbar:\n${lines.join("\n")}\n\nBevorzuge Zutaten aus dem Vorrat wenn möglich, aber schränke dich nicht darauf ein.\nWenn der Nutzer einen konkreten Wunsch hat, hat dieser Vorrang vor dem Vorrat.`;
  }

  return prompt;
}
```

Add `import type { UnitDim } from "../shared/types";` at the top.

- [ ] **Step 2: Load pantry in generate endpoint**

In `worker/generate.ts`, load pantry contents and pass to `buildSystemPrompt`:

```ts
import type { PantryPromptItem } from "./prompt";

// Inside the POST handler, after loading canonicalNames:
const pantryRows = await qAll<{ name: string; quantity: number; unit_dim: string; amountless: number }>(
  db.prepare(
    "SELECT i.name, p.quantity, i.unit_dim, p.amountless FROM pantry p " +
    "JOIN ingredients i ON i.id = p.ingredient_id ORDER BY i.name"
  ),
);
const pantry: PantryPromptItem[] = pantryRows.map((r) => ({
  name: r.name, quantity: r.quantity,
  unit_dim: r.unit_dim as UnitDim, amountless: !!r.amountless,
}));

const system = buildSystemPrompt({
  equipmentOwned, dietBias: settings.diet_bias ?? "", canonicalNames,
  extraGeraeteErlaubt: !!extraGeraeteErlaubt, pantry,
});
```

Add `UnitDim` to the import from `../shared/types` (or get it from `PantryPromptItem`).

- [ ] **Step 3: Add test for pantry section in prompt**

In `tests/prompt.test.ts`, add:

```ts
import { describe, it, expect } from "vitest";
import { buildSystemPrompt } from "../worker/prompt";

describe("buildSystemPrompt pantry section", () => {
  it("includes pantry items when provided", () => {
    const prompt = buildSystemPrompt({
      equipmentOwned: [], dietBias: "", canonicalNames: [],
      extraGeraeteErlaubt: false,
      pantry: [
        { name: "Zwiebel", quantity: 3, unit_dim: "count", amountless: false },
        { name: "Salz", quantity: 0, unit_dim: "mass", amountless: true },
      ],
    });
    expect(prompt).toContain("Zwiebel: 3 Stück");
    expect(prompt).toContain("Salz: immer da");
    expect(prompt).toContain("Bevorzuge Zutaten aus dem Vorrat");
  });
  it("omits pantry section when empty", () => {
    const prompt = buildSystemPrompt({
      equipmentOwned: [], dietBias: "", canonicalNames: [],
      extraGeraeteErlaubt: false, pantry: [],
    });
    expect(prompt).not.toContain("Vorrat des Nutzers");
  });
});
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: All pass.

- [ ] **Step 5: Commit**

```bash
git add worker/prompt.ts worker/generate.ts tests/prompt.test.ts
git commit -m "feat: inventory-aware generation — pantry injected into system prompt"
```

---

### Task 4: "Surprise Me" Suggest Endpoint

**Files:**
- Create: `worker/suggest.ts`
- Modify: `worker/index.ts:66` (mount suggest route under `/api/generate`)
- Modify: `worker/generate.ts` (mount suggest as sub-route on generateRoutes, OR wire in index.ts)
- Modify: `src/api.ts` (add suggest helper)

**Interfaces:**
- Consumes: `buildSystemPrompt()` with pantry param (Task 3), `PantryPromptItem` (Task 3), Anthropic SDK, `qAll` from `worker/db.ts`.
- Produces: `POST /api/generate/suggest` → `{ suggestions: [{ title: string, description: string }] }`, `fetchSuggestions()` in `src/api.ts`.

- [ ] **Step 1: Create worker/suggest.ts**

```ts
import { Hono } from "hono";
import Anthropic from "@anthropic-ai/sdk";
import type { Env } from "./index";
import { buildSystemPrompt, type PantryPromptItem } from "./prompt";
import { qAll } from "./db";
import type { UnitDim } from "../shared/types";

export interface Suggestion {
  title: string;
  description: string;
}

export const suggestRoutes = new Hono<{ Bindings: Env }>().post("/", async (c) => {
  const { portionen, extraGeraeteErlaubt } = await c.req.json<{
    portionen: number; extraGeraeteErlaubt?: boolean;
  }>();
  if (!Number.isFinite(portionen) || portionen < 1) {
    return c.json({ error: "portionen muss ≥ 1 sein" }, 400);
  }

  const db = c.env.DB;
  const equipmentOwned = (await qAll<{ name: string }>(
    db.prepare("SELECT name FROM equipment WHERE owned=1"))).map((e) => e.name);
  const settings = Object.fromEntries((await qAll<{ key: string; value: string }>(
    db.prepare("SELECT key, value FROM settings"))).map((s) => [s.key, s.value]));
  const canonicalNames = (await qAll<{ name: string }>(
    db.prepare("SELECT name FROM ingredients ORDER BY name"))).map((i) => i.name);
  const pantryRows = await qAll<{ name: string; quantity: number; unit_dim: string; amountless: number }>(
    db.prepare(
      "SELECT i.name, p.quantity, i.unit_dim, p.amountless FROM pantry p " +
      "JOIN ingredients i ON i.id = p.ingredient_id ORDER BY i.name",
    ),
  );
  const pantry: PantryPromptItem[] = pantryRows.map((r) => ({
    name: r.name, quantity: r.quantity,
    unit_dim: r.unit_dim as UnitDim, amountless: !!r.amountless,
  }));

  const system = buildSystemPrompt({
    equipmentOwned, dietBias: settings.diet_bias ?? "", canonicalNames,
    extraGeraeteErlaubt: !!extraGeraeteErlaubt, pantry,
  });

  const client = new Anthropic({ apiKey: c.env.ANTHROPIC_API_KEY });
  try {
    const resp = await client.messages.create({
      model: settings.generation_model ?? "claude-sonnet-5",
      max_tokens: 1024,
      system,
      messages: [{
        role: "user",
        content: `Schlage genau 3 verschiedene TM6-Rezeptideen vor, die zu meinem Vorrat und meinen Präferenzen passen. Für ${portionen} Portionen. Gib nur Titel und eine kurze Beschreibung (1 Satz) pro Vorschlag.`,
      }],
      output_config: {
        format: {
          type: "json_schema",
          schema: {
            type: "object", additionalProperties: false,
            required: ["suggestions"],
            properties: {
              suggestions: {
                type: "array",
                items: {
                  type: "object", additionalProperties: false,
                  required: ["title", "description"],
                  properties: {
                    title: { type: "string" },
                    description: { type: "string" },
                  },
                },
              },
            },
          },
        },
      },
    });
    const textBlock = resp.content.find((b): b is Anthropic.TextBlock => b.type === "text");
    if (!textBlock) throw new Error("no text block");
    return c.json(JSON.parse(textBlock.text));
  } catch (err) {
    console.error("suggest: Anthropic API error", err instanceof Error ? err.message : err);
    return c.json({ error: "Vorschläge konnten nicht generiert werden." }, 502);
  }
});
```

- [ ] **Step 2: Wire suggest route**

In `worker/generate.ts`, import and mount the suggest route:

```ts
import { suggestRoutes } from "./suggest";

export const generateRoutes = new Hono<{ Bindings: Env }>()
  .route("/suggest", suggestRoutes)
  .post("/", async (c) => {
    // ... existing generate handler
  });
```

- [ ] **Step 3: Add fetchSuggestions API helper**

In `src/api.ts`, add:

```ts
import type { Suggestion } from "../worker/suggest";

export async function fetchSuggestions(portionen: number, extraGeraeteErlaubt: boolean): Promise<Suggestion[]> {
  const res = await api<{ suggestions: Suggestion[] }>("/api/generate/suggest", {
    method: "POST",
    body: JSON.stringify({ portionen, extraGeraeteErlaubt }),
  });
  return res.suggestions;
}
```

- [ ] **Step 4: Run typecheck**

Run: `npx tsc -b --noEmit`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add worker/suggest.ts worker/generate.ts src/api.ts
git commit -m "feat: surprise-me suggest endpoint — 3 pantry-based recipe ideas"
```

---

### Task 5: Recipe Import Endpoint

**Files:**
- Create: `worker/import.ts`
- Modify: `worker/generate.ts` (mount import route)
- Modify: `worker/prompt.ts` (add buildImportPrompt)
- Modify: `src/api.ts` (add importRecipe helper)

**Interfaces:**
- Consumes: `buildSystemPrompt()` with pantry (Task 3), `SAVE_RECIPE_TOOL` from `worker/prompt.ts`, `PantryPromptItem` (Task 3), Anthropic SDK.
- Produces: `POST /api/generate/import` → either `RecipeSaveInput` (single recipe) or `{ multi: true, suggestions: [...] }` (multi-recipe detection), `importRecipe()` in `src/api.ts`.

- [ ] **Step 1: Add buildImportPrompt to worker/prompt.ts**

```ts
export function buildImportPrompt(opts: {
  equipmentOwned: string[]; canonicalNames: string[];
  extraGeraeteErlaubt: boolean; pantry?: PantryPromptItem[];
}): string {
  const geraeteRegel = opts.extraGeraeteErlaubt
    ? `Zusätzlich zum TM6 dürfen verwendet werden: ${opts.equipmentOwned.join(", ")}.`
    : `Verwende den TM6 als einziges Kochgerät wenn möglich. Falls doch nötig: ${opts.equipmentOwned.join(", ")}.`;

  let prompt = `Du bist ein Experte für Thermomix-TM6-Rezepte. Deine Aufgabe ist es, ein vorgegebenes Rezept in ein TM6-optimiertes Rezept umzuwandeln.

## Anweisungen
- Bewahre die Identität des Gerichts — Name, Geschmack und Charakter sollen erhalten bleiben.
- Wandle Schritte in TM6-Schritte (kind="tm6") um wo der TM6 das zuverlässig und sinnvoll erledigen kann.
- Behalte Schritte als off_device bei, wo der TM6 nicht geeignet ist (Backofen, Grill, Pfanne für Röstaromen, etc.).
- ${geraeteRegel}
- Optimiere Garzeiten und Temperaturen für den TM6 wo möglich.
- Behalte Zutaten möglichst bei, passe Mengen an kanonische Einheiten an (g, ml, Stück).

## TM6-Fähigkeiten
- Stufen: 0,5 bis 10 sowie Turbo. Teigstufe für Knetteig. Linkslauf für schonendes Rühren.
- Temperaturen: 37–160 °C sowie Varoma-Stufe zum Dämpfen.
- Modi: Slow Cooking, Sous-vide, Fermentieren, Reiskocher, Wasserkocher, Eierkocher, Eindicken, Aufwärmen, Anbraten/Karamellisieren, Vorreinigen.
- Zubehör: Mixtopf (2,2 l), Varoma (Behälter + Einlegeboden), Gareinsatz, Rühraufsatz (Schmetterling), Spatel, ZWEI Messbecher, Gemüse-Styler.

## Zutaten-Regeln
- Mengen in der kanonischen Dimension: mass→g, volume→ml, count→Stück. Informelle Einheiten (Prise, TL, EL, Spritzer) nur für Gewürze/Kleinstmengen.
- Für count-Zutaten grams_per_piece schätzen.
- scaling: "linear" (Standard), "damped" (intensive Gewürze), "fixed" (z.B. Wasser für Varoma-Tank).
- Verwende für bekannte Zutaten EXAKT den gelisteten Namen: ${opts.canonicalNames.join(", ") || "(noch keine)"}
- Kategorien: Gemüse & Obst, Fleisch & Fisch, Milchprodukte, Grundnahrungsmittel, Gewürze, Tiefkühl, Getränke, Sonstiges.

Wenn das Rezept fertig umgewandelt ist, gib es GENAU EINMAL über das Tool save_recipe aus.`;

  if (opts.pantry && opts.pantry.length > 0) {
    const lines = opts.pantry.map((p) => {
      if (p.amountless) return `- ${p.name}: immer da`;
      const unit = p.unit_dim === "mass" ? "g" : p.unit_dim === "volume" ? "ml" : "Stück";
      return `- ${p.name}: ${p.quantity} ${unit}`;
    });
    prompt += `\n\n## Vorrat des Nutzers\n${lines.join("\n")}\n\nHinweis: Du kannst auf Substitutionsmöglichkeiten aus dem Vorrat hinweisen, aber verändere das Originalrezept nicht grundlegend.`;
  }

  return prompt;
}
```

- [ ] **Step 2: Create worker/import.ts**

```ts
import { Hono } from "hono";
import Anthropic from "@anthropic-ai/sdk";
import type { Env } from "./index";
import { buildImportPrompt, SAVE_RECIPE_TOOL, type PantryPromptItem } from "./prompt";
import { qAll } from "./db";
import type { UnitDim } from "../shared/types";

export const importRoutes = new Hono<{ Bindings: Env }>().post("/", async (c) => {
  const { input, portionen, extraGeraeteErlaubt, selectedTitle } = await c.req.json<{
    input: string; portionen: number; extraGeraeteErlaubt?: boolean; selectedTitle?: string;
  }>();
  if (!input?.trim()) return c.json({ error: "Eingabe ist erforderlich" }, 400);
  if (!Number.isFinite(portionen) || portionen < 1) {
    return c.json({ error: "portionen muss ≥ 1 sein" }, 400);
  }

  const db = c.env.DB;
  const equipmentOwned = (await qAll<{ name: string }>(
    db.prepare("SELECT name FROM equipment WHERE owned=1"))).map((e) => e.name);
  const settings = Object.fromEntries((await qAll<{ key: string; value: string }>(
    db.prepare("SELECT key, value FROM settings"))).map((s) => [s.key, s.value]));
  const canonicalNames = (await qAll<{ name: string }>(
    db.prepare("SELECT name FROM ingredients ORDER BY name"))).map((i) => i.name);
  const pantryRows = await qAll<{ name: string; quantity: number; unit_dim: string; amountless: number }>(
    db.prepare(
      "SELECT i.name, p.quantity, i.unit_dim, p.amountless FROM pantry p " +
      "JOIN ingredients i ON i.id = p.ingredient_id ORDER BY i.name",
    ),
  );
  const pantry: PantryPromptItem[] = pantryRows.map((r) => ({
    name: r.name, quantity: r.quantity,
    unit_dim: r.unit_dim as UnitDim, amountless: !!r.amountless,
  }));

  const isUrl = /^https?:\/\//i.test(input.trim());
  const system = buildImportPrompt({
    equipmentOwned, canonicalNames,
    extraGeraeteErlaubt: !!extraGeraeteErlaubt, pantry,
  });

  const client = new Anthropic({ apiKey: c.env.ANTHROPIC_API_KEY });

  // Multi-recipe detection pass (no selectedTitle yet)
  if (!selectedTitle) {
    const multiCheckResp = await client.messages.create({
      model: settings.generation_model ?? "claude-sonnet-5",
      max_tokens: 1024,
      system: "Analysiere den folgenden Text. Enthält er mehrere verschiedene Rezepte? Wenn ja, liste Titel und eine kurze Beschreibung für jedes. Wenn nur ein Rezept enthalten ist, setze multi auf false.",
      messages: [{ role: "user", content: input.trim() }],
      output_config: {
        format: {
          type: "json_schema",
          schema: {
            type: "object", additionalProperties: false,
            required: ["multi", "suggestions"],
            properties: {
              multi: { type: "boolean" },
              suggestions: {
                type: "array",
                items: {
                  type: "object", additionalProperties: false,
                  required: ["title", "description"],
                  properties: {
                    title: { type: "string" },
                    description: { type: "string" },
                  },
                },
              },
            },
          },
        },
      },
    });
    const textBlock = multiCheckResp.content.find((b): b is Anthropic.TextBlock => b.type === "text");
    if (textBlock) {
      const parsed = JSON.parse(textBlock.text);
      if (parsed.multi && parsed.suggestions.length > 1) {
        return c.json(parsed);
      }
    }
  }

  // Single recipe import (or selected from multi)
  const userContent = selectedTitle
    ? `Wandle folgendes Rezept für den TM6 um (nur das Rezept "${selectedTitle}"):\n\n${input.trim()}\n\nPortionen: ${portionen}`
    : `Wandle folgendes Rezept für den TM6 um:\n\n${input.trim()}\n\nPortionen: ${portionen}`;

  const tools: any[] = isUrl
    ? [{ type: "web_search_20260209", name: "web_search", max_uses: 3 }, SAVE_RECIPE_TOOL]
    : [SAVE_RECIPE_TOOL];

  let messages: Anthropic.MessageParam[] = [{ role: "user", content: userContent }];

  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const resp = await client.messages.create({
        model: settings.generation_model ?? "claude-sonnet-5",
        max_tokens: 16000,
        system, tools, messages,
      });
      const toolUse = resp.content.find(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === "save_recipe");
      if (toolUse) {
        const recipe = toolUse.input as any;
        if (!recipe.tags) recipe.tags = [];
        if (!recipe.tags.includes("Importiert")) recipe.tags.push("Importiert");
        return c.json(recipe);
      }
      messages = [...messages, { role: "assistant", content: resp.content }];
      if (resp.stop_reason === "pause_turn") continue;
      if (resp.stop_reason === "refusal") return c.json({ error: "Anfrage abgelehnt" }, 422);
      messages = [...messages, {
        role: "user",
        content: "Bitte gib das umgewandelte Rezept jetzt genau einmal über das Tool save_recipe aus.",
      }];
    } catch (err) {
      console.error("import: Anthropic API error", err instanceof Error ? err.message : err);
      return c.json({ error: "Import fehlgeschlagen. Bitte erneut versuchen." }, 502);
    }
  }
  return c.json({ error: "Import fehlgeschlagen (kein save_recipe)" }, 502);
});
```

- [ ] **Step 3: Mount import route**

In `worker/generate.ts`, add:

```ts
import { importRoutes } from "./import";

export const generateRoutes = new Hono<{ Bindings: Env }>()
  .route("/suggest", suggestRoutes)
  .route("/import", importRoutes)
  .post("/", async (c) => {
    // ... existing
  });
```

- [ ] **Step 4: Add importRecipe API helper**

In `src/api.ts`:

```ts
export interface ImportResult {
  multi?: boolean;
  suggestions?: Suggestion[];
  title?: string;
  // ... all RecipeSaveInput fields when single recipe
  [key: string]: any;
}

export async function importRecipe(data: {
  input: string; portionen: number; extraGeraeteErlaubt: boolean; selectedTitle?: string;
}): Promise<ImportResult> {
  return api<ImportResult>("/api/generate/import", {
    method: "POST",
    body: JSON.stringify(data),
  });
}
```

- [ ] **Step 5: Run typecheck**

Run: `npx tsc -b --noEmit`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add worker/import.ts worker/prompt.ts worker/generate.ts src/api.ts
git commit -m "feat: recipe import endpoint — URL, text paste, multi-recipe detection"
```

---

### Task 6: Generieren Page — Surprise Me + Import UI

**Files:**
- Modify: `src/pages/Generieren.tsx` (add tabs, surprise flow, import flow)

**Interfaces:**
- Consumes: `fetchSuggestions()` (Task 4), `importRecipe()` (Task 5), existing `POST /api/generate`, existing `POST /api/recipes?source=generated`.
- Produces: Complete three-mode Generieren page (generate, surprise, import).

- [ ] **Step 1: Add mode state and segmented control**

At the top of the Generieren component, add:

```ts
type Mode = "generate" | "surprise" | "import";
const [mode, setMode] = useState<Mode>("generate");
```

Add a segmented control at the top of the page (below the header):

```tsx
<div style={{ display: "flex", gap: 0, marginBottom: 20, background: "var(--elev)", borderRadius: "var(--r-md)", overflow: "hidden", border: "1px solid var(--line)" }}>
  {([["generate", "Generieren"], ["surprise", "Überrasch mich!"], ["import", "Importieren"]] as const).map(([m, label]) => (
    <button key={m} type="button" onClick={() => { setMode(m); setPhase("form"); }}
      style={{
        flex: 1, padding: "10px 0", fontSize: 13, fontWeight: 600, border: "none", cursor: "pointer",
        background: mode === m ? "var(--accent)" : "transparent",
        color: mode === m ? "#fff" : "var(--tx3)",
      }}>
      {label}
    </button>
  ))}
</div>
```

- [ ] **Step 2: Add surprise-me state and flow**

Add state:

```ts
const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
const [selectedSuggestions, setSelectedSuggestions] = useState<Set<number>>(new Set());
const [suggestQueue, setSuggestQueue] = useState<string[]>([]);
```

Add the suggest phase handling:

```ts
type Phase = "form" | "loading" | "error" | "preview" | "suggesting" | "picking";
```

Add the surprise-me form UI (shown when `mode === "surprise"` and `phase === "form"`):

```tsx
{mode === "surprise" && phase === "form" && (
  <div>
    {/* Shared portionen + extra-geräte controls */}
    {/* ... reuse from generate form */}
    <button type="button" className="btn-accent" onClick={runSuggest}
      style={{ marginTop: 16 }}>
      Rezeptvorschläge laden
    </button>
  </div>
)}
```

- [ ] **Step 3: Implement runSuggest**

```ts
async function runSuggest() {
  setPhase("suggesting");
  setErrorMsg(null);
  try {
    const s = await fetchSuggestions(portionen, extraGeraeteErlaubt);
    setSuggestions(s);
    setSelectedSuggestions(new Set());
    setPhase("picking");
  } catch {
    setErrorMsg("Vorschläge konnten nicht geladen werden.");
    setPhase("error");
  }
}
```

- [ ] **Step 4: Implement picking phase UI**

```tsx
{phase === "picking" && (
  <div>
    <h2 style={{ fontSize: 16, marginBottom: 16 }}>Rezeptvorschläge</h2>
    {suggestions.map((s, i) => (
      <button key={i} type="button"
        onClick={() => setSelectedSuggestions((prev) => {
          const next = new Set(prev);
          next.has(i) ? next.delete(i) : next.add(i);
          return next;
        })}
        className="card" style={{
          display: "block", width: "100%", textAlign: "left", padding: 16, marginBottom: 10,
          border: selectedSuggestions.has(i) ? "2px solid var(--accent)" : "1px solid var(--line)",
          background: "var(--raise)", cursor: "pointer",
        }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: "var(--tx)", marginBottom: 4 }}>{s.title}</div>
        <div style={{ fontSize: 13, color: "var(--tx3)" }}>{s.description}</div>
      </button>
    ))}
    <button type="button" className="btn-accent" disabled={selectedSuggestions.size === 0}
      onClick={() => {
        const queue = [...selectedSuggestions].map((i) => suggestions[i].title);
        setSuggestQueue(queue);
        setWunsch(queue[0]);
        runGenerate();
      }}
      style={{ marginTop: 8 }}>
      {selectedSuggestions.size === 1 ? "Rezept generieren" : `${selectedSuggestions.size} Rezepte generieren`}
    </button>
    <button type="button" className="btn-ghost" onClick={() => setPhase("form")} style={{ marginTop: 8 }}>
      Zurück
    </button>
  </div>
)}
```

- [ ] **Step 5: Handle surprise-me queue in save/discard**

Update `handleSave` to advance the queue after saving, and `handleDiscard` to advance after discarding:

```ts
function advanceSuggestQueue() {
  const remaining = suggestQueue.slice(1);
  setSuggestQueue(remaining);
  if (remaining.length > 0) {
    setWunsch(remaining[0]);
    setDraft(null);
    setSaveError(null);
    runGenerate();
  } else {
    setPhase("form");
    setWunsch("");
  }
}
```

In `handleSave`, after `navigate(...)`:
```ts
if (suggestQueue.length > 1) {
  // Don't navigate — stay on page for next recipe
  advanceSuggestQueue();
  return;
}
```

In `handleDiscard`:
```ts
function handleDiscard() {
  setDraft(null);
  setSaveError(null);
  if (suggestQueue.length > 1) {
    advanceSuggestQueue();
  } else {
    setSuggestQueue([]);
    setPhase("form");
  }
}
```

- [ ] **Step 6: Add import mode UI**

Add import-specific state:

```ts
const [importInput, setImportInput] = useState("");
const [importSuggestions, setImportSuggestions] = useState<Suggestion[]>([]);
const [selectedImports, setSelectedImports] = useState<Set<number>>(new Set());
const [importQueue, setImportQueue] = useState<{ input: string; title: string }[]>([]);
```

Add import form (shown when `mode === "import"` and `phase === "form"`):

```tsx
{mode === "import" && phase === "form" && (
  <div>
    <textarea className="input" placeholder="URL oder Rezepttext einfügen…"
      value={importInput} onChange={(e) => setImportInput(e.target.value)}
      rows={6} autoFocus style={{ resize: "vertical", marginBottom: 16 }} />
    {/* Shared portionen + extra-geräte controls */}
    <button type="button" className="btn-accent" disabled={!importInput.trim()}
      onClick={runImport} style={{ marginTop: 16 }}>
      Rezept importieren
    </button>
  </div>
)}
```

- [ ] **Step 7: Implement runImport**

```ts
async function runImport(selectedTitle?: string) {
  setPhase("loading");
  setErrorMsg(null);
  try {
    const res = await importRecipe({
      input: importInput.trim(), portionen, extraGeraeteErlaubt, selectedTitle,
    });
    if (res.multi && res.suggestions) {
      setImportSuggestions(res.suggestions);
      setSelectedImports(new Set());
      setPhase("picking");
      return;
    }
    setDraft(res as any);
    setPhase("preview");
  } catch {
    setErrorMsg("Import fehlgeschlagen. Bitte erneut versuchen.");
    setPhase("error");
  }
}
```

Handle import picking phase — reuse the picking UI but with import-specific state, and the confirm button calls `runImport(selectedTitle)` for each selected title sequentially (same queue pattern as surprise-me).

- [ ] **Step 8: Extract shared portionen/extra-geräte controls into a fragment**

To avoid duplicating the portionen stepper and extra-geräte checkbox across three modes, extract them into a local component or a rendered fragment that all three forms share.

- [ ] **Step 9: Run typecheck**

Run: `npx tsc -b --noEmit`
Expected: No errors.

- [ ] **Step 10: Commit**

```bash
git add src/pages/Generieren.tsx
git commit -m "feat: Generieren page — surprise-me suggestions + recipe import UI"
```

---

### Task 7: Missing Ingredient Warning + Auto-Deduct (Cooking Mode)

**Files:**
- Modify: `worker/shopping.ts` (add check-pantry endpoint)
- Modify: `worker/recipes.ts` (mount check-pantry route)
- Modify: `src/pages/Kochmodus.tsx` (banner, auto-deduct, remove abbuchen button)
- Modify: `src/api.ts` (add checkPantry + addMissingToShopping helpers)

**Interfaces:**
- Consumes: `PantryEntry` (Task 1), `loadPantryMap()` (Task 1), `cookedHandler` (Task 1, updated for amountless), `scaleQuantity()`, `isInformalUnit()`, existing `POST /api/shopping`.
- Produces: `GET /api/recipes/:id/check-pantry?servings=N` → `{ missing: [...] }`, auto-deduction on cooking finish, missing-ingredient banner UI.

- [ ] **Step 1: Add check-pantry endpoint**

In `worker/shopping.ts`, add and export `checkPantryHandler`:

```ts
export async function checkPantryHandler(c: Context<{ Bindings: Env }>) {
  const recipeId = Number(c.req.param("id"));
  const recipe = await getFullRecipe(c.env.DB, recipeId);
  if (!recipe) return c.json({ error: "not found" }, 404);
  const servings = Number(c.req.query("servings") ?? recipe.servings_base);
  if (!Number.isFinite(servings) || servings < 1) {
    return c.json({ error: "servings must be >= 1" }, 400);
  }
  const factor = servings / recipe.servings_base;
  const pantry = await loadPantryMap(c.env.DB);

  const missing: { ingredient_id: number; name: string; needed: number; available: number; unit: string; category: string }[] = [];
  for (const ing of recipe.ingredients) {
    const entry = pantry.get(ing.ingredient_id);
    if (entry?.amountless) continue;
    if (isInformalUnit(ing.unit)) {
      if (!entry) missing.push({ ingredient_id: ing.ingredient_id, name: ing.name, needed: ing.quantity, available: 0, unit: ing.unit, category: "" });
      continue;
    }
    const scaled = scaleQuantity(ing.quantity, ing.scaling, factor, ing.unit);
    const available = entry?.quantity ?? 0;
    if (available < scaled) {
      missing.push({ ingredient_id: ing.ingredient_id, name: ing.name, needed: scaled, available, unit: ing.unit, category: "" });
    }
  }
  return c.json({ missing });
}
```

- [ ] **Step 2: Mount check-pantry route**

In `worker/recipes.ts`, add:

```ts
import { cookedHandler, checkPantryHandler } from "./shopping";

// In recipeRoutes chain, add:
  .get("/:id/check-pantry", checkPantryHandler)
```

- [ ] **Step 3: Add API helpers**

In `src/api.ts`:

```ts
export interface MissingIngredient {
  ingredient_id: number; name: string; needed: number; available: number; unit: string;
}

export async function checkPantry(recipeId: string | number, servings: number): Promise<MissingIngredient[]> {
  const res = await api<{ missing: MissingIngredient[] }>(`/api/recipes/${recipeId}/check-pantry?servings=${servings}`);
  return res.missing;
}

export async function addToShoppingList(items: { ingredient_id: number; label: string; quantity: number; unit: string; category: string }[]): Promise<void> {
  for (const item of items) {
    await api("/api/shopping", {
      method: "POST",
      body: JSON.stringify({
        label: item.label,
        quantity: item.quantity,
        unit: item.unit,
        category: item.category || "Sonstiges",
      }),
    });
  }
}
```

- [ ] **Step 4: Update Kochmodus — add missing-ingredient banner on mount**

In `src/pages/Kochmodus.tsx`, add state and effect for missing ingredients:

```ts
const [missingItems, setMissingItems] = useState<MissingIngredient[]>([]);
const [missingDismissed, setMissingDismissed] = useState(false);
const [addingToList, setAddingToList] = useState(false);

useEffect(() => {
  if (!id || !recipe) return;
  checkPantry(id, portions).then(setMissingItems).catch(() => {});
}, [id, recipe, portions]);
```

Add the banner UI at the top of the step display (after the header, before `isTm6 ? ...`), shown only on the first step and when not dismissed:

```tsx
{stepIndex === 0 && missingItems.length > 0 && !missingDismissed && (
  <div style={{
    background: "var(--raise)", border: "1px solid var(--line)", borderRadius: "var(--r-md)",
    padding: 14, marginBottom: 16,
  }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
      <span style={{ fontSize: 14, fontWeight: 600, color: "var(--accent)" }}>Fehlende Zutaten</span>
      <button type="button" onClick={() => setMissingDismissed(true)}
        style={{ background: "none", border: "none", color: "var(--tx4)", cursor: "pointer", fontSize: 16 }}>
        ✕
      </button>
    </div>
    {missingItems.map((m) => (
      <div key={m.ingredient_id} style={{ fontSize: 13, color: "var(--tx3)", marginBottom: 2 }}>
        {formatQuantity(m.needed - m.available, m.unit)} {m.unit} {m.name}
      </div>
    ))}
    <button type="button" className="btn-ghost" disabled={addingToList}
      onClick={async () => {
        setAddingToList(true);
        try {
          await addToShoppingList(missingItems.map((m) => ({
            ingredient_id: m.ingredient_id, label: m.name,
            quantity: m.needed - m.available, unit: m.unit, category: "",
          })));
          setMissingDismissed(true);
          queryClient.invalidateQueries({ queryKey: ["shopping"] });
        } catch {} finally { setAddingToList(false); }
      }}
      style={{ marginTop: 8, fontSize: 13 }}>
      {addingToList ? "Wird hinzugefügt…" : "Zur Einkaufsliste"}
    </button>
  </div>
)}
```

Import `checkPantry`, `addToShoppingList`, `formatQuantity`, and `MissingIngredient` from the respective modules.

- [ ] **Step 5: Auto-deduct on finish**

Replace the finish screen in Kochmodus. Remove the "Zutaten aus Vorrat abbuchen" button. Auto-call on entering finished state:

```ts
const [deductState, setDeductState] = useState<"pending" | "done" | "error">("pending");

useEffect(() => {
  if (!finished || !id) return;
  api(`/api/recipes/${id}/cooked`, {
    method: "POST",
    body: JSON.stringify({ servings: Math.round(portions) }),
  })
    .then(() => {
      setDeductState("done");
      queryClient.invalidateQueries({ queryKey: ["pantry"] });
    })
    .catch(() => setDeductState("error"));
}, [finished, id, portions]);
```

Update the finish screen:

```tsx
if (finished) {
  return (
    <div style={{
      background: "var(--cook-bg)", minHeight: "100vh", padding: "32px 20px 40px",
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center",
    }}>
      <h1 style={{ fontSize: 26, margin: "0 0 8px" }}>Guten Appetit!</h1>
      <p style={{ color: "var(--tx3)", fontSize: 15, margin: 0 }}>{recipe.title}</p>
      {deductState === "done" && (
        <p style={{ color: "var(--tx3)", fontSize: 13, marginTop: 16 }}>Vorrat aktualisiert ✓</p>
      )}
      {deductState === "error" && (
        <div style={{ marginTop: 16 }}>
          <p style={{ color: "var(--accent)", fontSize: 13, marginBottom: 8 }}>
            Vorrat konnte nicht aktualisiert werden.
          </p>
          <button className="btn-ghost" onClick={() => {
            setDeductState("pending");
            // re-trigger the effect
            setFinished(false);
            setTimeout(() => setFinished(true), 0);
          }}>
            Erneut versuchen
          </button>
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 12, width: "100%", marginTop: 32 }}>
        <button className="btn-ghost" onClick={() => navigate(`/rezept/${id}`)}>
          Schließen
        </button>
      </div>
    </div>
  );
}
```

Remove `handleAbbuchen`, the `cookedState` state, and the old abbuchen button.

- [ ] **Step 6: Run typecheck**

Run: `npx tsc -b --noEmit`
Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add worker/shopping.ts worker/recipes.ts src/pages/Kochmodus.tsx src/api.ts
git commit -m "feat: missing-ingredient banner + auto-deduct after cooking"
```

---

### Task 8: Custom Tags + Ausprobiert Journal Flow

**Files:**
- Modify: `src/pages/RezeptDetail.tsx` (tag chips, inline add/remove)
- Modify: `src/pages/Kochmodus.tsx` (Ausprobiert prompt on finish screen)

**Interfaces:**
- Consumes: `PUT /api/recipes/:id` (existing, replaces tags), `POST /api/recipes/:id/image` (existing photo upload), `useRecipe()`, `api()`.
- Produces: Tag chips on recipe detail page with inline creation, "Ausprobiert markieren?" prompt on cooking finish screen.

- [ ] **Step 1: Add tag chips to RezeptDetail**

In `src/pages/RezeptDetail.tsx`, after the portions/time line and before the portion stepper, add tag display:

```tsx
{recipe.tags.length > 0 && (
  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
    {recipe.tags.map((tag) => (
      <span key={tag} className="chip" style={{ fontSize: 12, position: "relative" }}
        onClick={() => handleRemoveTag(tag)}>
        {tag} ×
      </span>
    ))}
  </div>
)}
```

- [ ] **Step 2: Add inline tag creation**

Add state:

```ts
const [addingTag, setAddingTag] = useState(false);
const [newTag, setNewTag] = useState("");
```

Add a "+" button after the tag chips:

```tsx
<div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
  {recipe.tags.map((tag) => (
    <span key={tag} className="chip" style={{ fontSize: 12, cursor: "pointer" }}
      onClick={() => handleRemoveTag(tag)}>
      {tag} ×
    </span>
  ))}
  {addingTag ? (
    <input className="input" autoFocus placeholder="Tag…" value={newTag}
      onChange={(e) => setNewTag(e.target.value)}
      onKeyDown={(e) => { if (e.key === "Enter" && newTag.trim()) handleAddTag(); if (e.key === "Escape") setAddingTag(false); }}
      onBlur={() => { if (newTag.trim()) handleAddTag(); else setAddingTag(false); }}
      style={{ width: 100, fontSize: 12, padding: "4px 8px" }} />
  ) : (
    <button type="button" onClick={() => setAddingTag(true)}
      style={{
        fontSize: 12, padding: "4px 10px", background: "none", border: "1px dashed var(--border2)",
        borderRadius: 12, color: "var(--tx4)", cursor: "pointer",
      }}>
      +
    </button>
  )}
</div>
```

- [ ] **Step 3: Implement handleAddTag and handleRemoveTag**

```ts
async function handleAddTag() {
  if (!recipe || !newTag.trim()) return;
  const tag = newTag.trim();
  if (recipe.tags.includes(tag)) { setNewTag(""); setAddingTag(false); return; }
  const updatedTags = [...recipe.tags, tag];
  // Optimistic update
  queryClient.setQueryData(["recipe", id], { ...recipe, tags: updatedTags });
  setNewTag("");
  setAddingTag(false);
  try {
    await api(`/api/recipes/${recipe.id}`, {
      method: "PUT",
      body: JSON.stringify({ ...recipe, tags: updatedTags, ingredients: recipe.ingredients, steps: recipe.steps }),
    });
    queryClient.invalidateQueries({ queryKey: ["recipes"] });
  } catch {
    queryClient.invalidateQueries({ queryKey: ["recipe", id] });
    setActionError("Tag konnte nicht hinzugefügt werden.");
  }
}

async function handleRemoveTag(tag: string) {
  if (!recipe || !confirm(`Tag „${tag}" entfernen?`)) return;
  const updatedTags = recipe.tags.filter((t) => t !== tag);
  queryClient.setQueryData(["recipe", id], { ...recipe, tags: updatedTags });
  try {
    await api(`/api/recipes/${recipe.id}`, {
      method: "PUT",
      body: JSON.stringify({ ...recipe, tags: updatedTags, ingredients: recipe.ingredients, steps: recipe.steps }),
    });
    queryClient.invalidateQueries({ queryKey: ["recipes"] });
  } catch {
    queryClient.invalidateQueries({ queryKey: ["recipe", id] });
    setActionError("Tag konnte nicht entfernt werden.");
  }
}
```

- [ ] **Step 4: Add "Ausprobiert" prompt to Kochmodus finish screen**

In `src/pages/Kochmodus.tsx`, update the finish screen to add the Ausprobiert flow after the deduct confirmation:

```tsx
const [ausprobiert, setAusprobiert] = useState(false);
const fileInputRef = useRef<HTMLInputElement>(null);
```

Add to the finish screen, after the deduct status and before the "Schließen" button:

```tsx
{deductState === "done" && !recipe.tags.includes("Ausprobiert") && !ausprobiert && (
  <div style={{ marginTop: 20 }}>
    <button className="btn-ghost" onClick={async () => {
      try {
        const updatedTags = [...recipe.tags, "Ausprobiert"];
        await api(`/api/recipes/${id}`, {
          method: "PUT",
          body: JSON.stringify({ ...recipe, tags: updatedTags, ingredients: recipe.ingredients, steps: recipe.steps }),
        });
        setAusprobiert(true);
        queryClient.invalidateQueries({ queryKey: ["recipe", id] });
        queryClient.invalidateQueries({ queryKey: ["recipes"] });
        fileInputRef.current?.click();
      } catch {}
    }} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
      📸 Ausprobiert markieren & Foto
    </button>
    <input ref={fileInputRef} type="file" accept="image/*" capture="environment"
      onChange={async (e) => {
        const file = e.target.files?.[0];
        e.target.value = "";
        if (!file || !id) return;
        try {
          const blob = await downscaleImage(file);
          await uploadRecipeImage(id, blob);
          queryClient.invalidateQueries({ queryKey: ["recipe", id] });
        } catch {}
      }}
      style={{ display: "none" }} />
  </div>
)}
{ausprobiert && (
  <p style={{ color: "var(--tx3)", fontSize: 13, marginTop: 12 }}>Als ausprobiert markiert ✓</p>
)}
```

Import `downscaleImage`, `uploadRecipeImage` from `../api`.

- [ ] **Step 5: Run typecheck**

Run: `npx tsc -b --noEmit`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add src/pages/RezeptDetail.tsx src/pages/Kochmodus.tsx
git commit -m "feat: custom tags on recipe detail + Ausprobiert journal flow after cooking"
```

---

### Task 9: Deploy + Verify

**Files:**
- No code changes. Deploy, migrate production D1, push to GitHub.

**Interfaces:**
- Consumes: All tasks 1-8 committed and passing.

- [ ] **Step 1: Run full test suite**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 2: Run typecheck**

Run: `npx tsc -b --noEmit`
Expected: No errors.

- [ ] **Step 3: Apply migration to production D1**

Run: `npx wrangler d1 migrations apply cuisidoo --remote`

- [ ] **Step 4: Deploy to Cloudflare Workers**

Run: `npm run deploy`

- [ ] **Step 5: Push to GitHub**

Run: `git push`

- [ ] **Step 6: Verify in browser**

Test the following flows on the deployed app:
1. Vorrat: toggle an item amountless, verify "Immer da" badge appears
2. Vorrat: search for a non-existent ingredient, create it with the form
3. Generieren: regular generation (should still work)
4. Generieren: switch to "Überrasch mich!", get 3 suggestions, pick one, generate
5. Generieren: switch to "Importieren", paste a recipe URL, verify adaptation
6. Kochen starten: verify missing-ingredient banner appears if pantry lacks items
7. Finish cooking: verify auto-deduct and "Vorrat aktualisiert ✓"
8. Finish cooking: verify "Ausprobiert markieren & Foto" prompt
9. Recipe detail: add a custom tag, verify it appears in library filter
