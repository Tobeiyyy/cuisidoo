import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, createIngredient } from "../api";
import type { Ingredient, PantryItem, UnitDim } from "../../shared/types";
import { formatQuantity } from "../format";

type CatalogIngredient = Ingredient & { aliases: string | null };

const CATEGORIES = [
  "Gemüse & Obst", "Fleisch & Fisch", "Milchprodukte", "Grundnahrungsmittel",
  "Gewürze", "Tiefkühl", "Getränke", "Sonstiges",
] as const;

const UNIT_DIM_OPTIONS = [
  ["mass", "Gramm"],
  ["volume", "Milliliter"],
  ["count", "Stück"],
] as const;

function unitLabel(dim: UnitDim): string {
  if (dim === "mass") return "g";
  if (dim === "volume") return "ml";
  return "Stück";
}

function stepFor(dim: UnitDim): number {
  return dim === "count" ? 1 : 50;
}

function defaultQuantityFor(dim: UnitDim): number {
  return dim === "count" ? 1 : 100;
}

function PlusIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

const FLUSH_DELAY_MS = 400;

export default function Vorrat() {
  const queryClient = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [addQuery, setAddQuery] = useState("");
  const [writeErrors, setWriteErrors] = useState<Set<number>>(new Set());
  const [creating, setCreating] = useState(false);
  const [newCategory, setNewCategory] = useState("Sonstiges");
  const [newUnitDim, setNewUnitDim] = useState<UnitDim>("mass");
  const [newAmountless, setNewAmountless] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Per-ingredient pending target quantity and debounce timer. Rapid stepper taps only update
  // these synchronously; a single PUT per ingredient fires after the debounce window with
  // whatever the latest target was, so out-of-order network completions can't clobber state.
  const pendingQuantities = useRef(new Map<number, number>());
  const flushTimers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const timers = flushTimers.current;
    const pending = pendingQuantities.current;
    return () => {
      // A pending debounced quantity would otherwise be silently discarded if the user navigates
      // away before the debounce window elapses — flush each one immediately instead (best
      // effort; nothing left mounted to show a failure, so just swallow errors) before clearing
      // the timers that would have fired them.
      for (const [ingredientId, quantity] of pending.entries()) {
        api("/api/pantry", {
          method: "PUT",
          body: JSON.stringify({ ingredient_id: ingredientId, quantity }),
        }).catch(() => {});
      }
      for (const timer of timers.values()) clearTimeout(timer);
    };
  }, []);

  const pantryQuery = useQuery({
    queryKey: ["pantry"],
    queryFn: () => api<PantryItem[]>("/api/pantry"),
  });
  const ingredientsQuery = useQuery({
    queryKey: ["ingredients"],
    queryFn: () => api<CatalogIngredient[]>("/api/ingredients"),
  });

  const pantry = pantryQuery.data ?? [];
  const catalog = ingredientsQuery.data ?? [];

  const grouped = useMemo(() => {
    const map = new Map<string, PantryItem[]>();
    for (const item of pantry) {
      if (!map.has(item.category)) map.set(item.category, []);
      map.get(item.category)!.push(item);
    }
    return [...map.entries()];
  }, [pantry]);

  const pantryIds = useMemo(() => new Set(pantry.map((p) => p.ingredient_id)), [pantry]);

  const searchResults = useMemo(() => {
    const q = addQuery.trim().toLowerCase();
    return catalog
      .filter((c) => !pantryIds.has(c.id))
      .filter((c) => !q || c.name.toLowerCase().includes(q))
      .slice(0, 30);
  }, [catalog, pantryIds, addQuery]);

  function clearWriteError(ingredientId: number) {
    setWriteErrors((prev) => {
      if (!prev.has(ingredientId)) return prev;
      const next = new Set(prev);
      next.delete(ingredientId);
      return next;
    });
  }

  // Fires once the debounce window elapses: PUTs whatever the latest pending target quantity is
  // (coalescing any taps that landed during the window) rather than one request per tap. Success
  // does not invalidate the ["pantry"] query — the optimistic cache update is already correct.
  // Failure invalidates to resync with the server and surfaces an inline error.
  function flushQuantity(ingredientId: number) {
    flushTimers.current.delete(ingredientId);
    const target = pendingQuantities.current.get(ingredientId);
    if (target === undefined) return;
    pendingQuantities.current.delete(ingredientId);
    api("/api/pantry", {
      method: "PUT",
      body: JSON.stringify({ ingredient_id: ingredientId, quantity: target }),
    })
      .then(() => clearWriteError(ingredientId))
      .catch(() => {
        setWriteErrors((prev) => new Set(prev).add(ingredientId));
        queryClient.invalidateQueries({ queryKey: ["pantry"] });
      });
  }

  // Updates the cached quantity synchronously so rapid consecutive taps (before a re-render
  // lands) each see the previous tap's result instead of a stale closed-over value, then
  // (re)starts a per-ingredient debounce timer that flushes only the latest target quantity.
  function adjustQuantity(ingredientId: number, delta: number) {
    let resolvedQuantity = 0;
    queryClient.setQueryData<PantryItem[]>(["pantry"], (old) => {
      if (!old) return old;
      return old.flatMap((p) => {
        if (p.ingredient_id !== ingredientId) return [p];
        resolvedQuantity = Math.max(0, p.quantity + delta);
        return resolvedQuantity <= 0 ? [] : [{ ...p, quantity: resolvedQuantity }];
      });
    });
    pendingQuantities.current.set(ingredientId, resolvedQuantity);
    const existingTimer = flushTimers.current.get(ingredientId);
    if (existingTimer) clearTimeout(existingTimer);
    flushTimers.current.set(
      ingredientId,
      setTimeout(() => flushQuantity(ingredientId), FLUSH_DELAY_MS),
    );
  }

  async function addIngredient(ing: CatalogIngredient) {
    const quantity = defaultQuantityFor(ing.unit_dim);
    queryClient.setQueryData<PantryItem[]>(["pantry"], (old) => {
      const next: PantryItem = {
        ingredient_id: ing.id, name: ing.name, category: ing.category,
        unit_dim: ing.unit_dim, quantity, amountless: false, updated_at: new Date().toISOString(),
      };
      return old ? [...old, next] : [next];
    });
    setAddQuery("");
    try {
      await api("/api/pantry", {
        method: "PUT",
        body: JSON.stringify({ ingredient_id: ing.id, quantity }),
      });
    } finally {
      queryClient.invalidateQueries({ queryKey: ["pantry"] });
    }
  }

  async function toggleAmountless(ingredientId: number, amountless: boolean) {
    const item = pantry.find((p) => p.ingredient_id === ingredientId);
    const quantity = amountless ? 0 : defaultQuantityFor(item?.unit_dim ?? "count");
    queryClient.setQueryData<PantryItem[]>(["pantry"], (old) =>
      old?.map((p) => (p.ingredient_id === ingredientId ? { ...p, amountless, quantity } : p)));
    try {
      await api("/api/pantry", {
        method: "PUT",
        body: JSON.stringify({
          ingredient_id: ingredientId,
          quantity,
          amountless,
        }),
      });
    } catch {
      setWriteErrors((prev) => new Set(prev).add(ingredientId));
      queryClient.invalidateQueries({ queryKey: ["pantry"] });
    }
  }

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

  const isEmpty = pantryQuery.isSuccess && pantry.length === 0;

  return (
    <div className="page">
      <div className="page-header">
        <h1>Vorrat</h1>
      </div>

      <button
        type="button"
        className="btn-ghost"
        onClick={() => setShowAdd((v) => !v)}
        style={{ marginBottom: 16, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}
      >
        <PlusIcon />
        Zutat hinzufügen
      </button>

      {showAdd && (
        <div className="card" style={{ padding: 12, marginBottom: 20 }}>
          <input
            className="input"
            placeholder="Zutat suchen…"
            value={addQuery}
            onChange={(e) => setAddQuery(e.target.value)}
            autoFocus
            style={{ marginBottom: 10 }}
          />
          {searchResults.length === 0 && addQuery.trim() ? (
            creating ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ fontSize: 14, color: "var(--tx)", fontWeight: 500 }}>
                  „{addQuery.trim()}" erstellen
                </div>
                <select className="input" value={newCategory} onChange={(e) => setNewCategory(e.target.value)}>
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <div style={{ display: "flex", gap: 8 }}>
                  {UNIT_DIM_OPTIONS.map(([dim, label]) => (
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
            <div style={{ display: "flex", flexDirection: "column", maxHeight: 240, overflowY: "auto" }}>
              {searchResults.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => addIngredient(c)}
                  className="list-row"
                  style={{
                    background: "none", border: "none", width: "100%", textAlign: "left",
                    cursor: "pointer", color: "var(--tx)", font: "inherit",
                  }}
                >
                  <span style={{ flex: 1 }}>{c.name}</span>
                  <span style={{ fontSize: 11, color: "var(--tx4)" }}>{c.category}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {isEmpty && !showAdd && (
        <p style={{ textAlign: "center", color: "var(--tx3)", padding: "24px 0" }}>
          Noch keine Vorräte hinterlegt.
        </p>
      )}

      {grouped.map(([category, items]) => (
        <div key={category} style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 13, color: "var(--tx4)", textTransform: "uppercase", letterSpacing: 1, margin: "0 0 4px" }}>
            {category}
          </h2>
          <div className="card" style={{ padding: "0 16px" }}>
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
          </div>
        </div>
      ))}
    </div>
  );
}
