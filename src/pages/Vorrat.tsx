import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, createIngredient, scanReceipt, downscaleImage } from "../api";
import type { ScannedItem } from "../api";
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

  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanResults, setScanResults] = useState<ScannedItem[] | null>(null);
  const [scanChecked, setScanChecked] = useState<Set<number>>(new Set());
  const [applying, setApplying] = useState(false);
  const scanInputRef = useRef<HTMLInputElement>(null);

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

  async function handleScanFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setScanning(true);
    setScanError(null);
    setScanResults(null);
    try {
      const blob = await downscaleImage(file);
      const items = await scanReceipt(blob);
      if (items.length === 0) {
        setScanError("Keine Lebensmittel auf dem Bon erkannt.");
      } else {
        setScanResults(items);
        setScanChecked(new Set(items.map((_, i) => i)));
      }
    } catch (err) {
      setScanError(err instanceof Error && err.message ? err.message : "Scan fehlgeschlagen");
    } finally {
      setScanning(false);
    }
  }

  async function applyScanResults() {
    if (!scanResults) return;
    setApplying(true);
    setScanError(null);
    const applied = new Set<number>();
    try {
      // A receipt can list the same product twice (or the model can split one product into two
      // rows), so aggregate selected rows per ingredient first — otherwise each row would
      // compute its additive update from the same stale base and the last write would win.
      const byIngredient = new Map<number, { qty: number; indices: number[] }>();
      const newItems = new Map<string, { item: ScannedItem; qty: number; indices: number[] }>();
      scanResults.forEach((item, i) => {
        if (!scanChecked.has(i)) return;
        if (item.ingredient_id) {
          const cur = byIngredient.get(item.ingredient_id) ?? { qty: 0, indices: [] };
          cur.qty += item.quantity;
          cur.indices.push(i);
          byIngredient.set(item.ingredient_id, cur);
        } else {
          const key = (item.matched_name ?? item.receipt_name).trim().toLowerCase();
          const cur = newItems.get(key) ?? { item, qty: 0, indices: [] };
          cur.qty += item.quantity;
          cur.indices.push(i);
          newItems.set(key, cur);
        }
      });

      for (const [ingredientId, { qty, indices }] of byIngredient) {
        const existing = pantry.find((p) => p.ingredient_id === ingredientId);
        // "Immer da" items track no amount — a plain quantity PUT would silently flip them
        // back to tracked, so leave them untouched.
        if (existing?.amountless) {
          for (const i of indices) applied.add(i);
          continue;
        }
        // A pending debounced stepper write is superseded by this one: the optimistic cache
        // (and thus `existing.quantity`) already includes its target, and letting it fire
        // later would overwrite the scan result with the pre-scan value.
        const timer = flushTimers.current.get(ingredientId);
        if (timer) clearTimeout(timer);
        flushTimers.current.delete(ingredientId);
        pendingQuantities.current.delete(ingredientId);
        await api("/api/pantry", {
          method: "PUT",
          body: JSON.stringify({ ingredient_id: ingredientId, quantity: (existing?.quantity ?? 0) + qty }),
        });
        for (const i of indices) applied.add(i);
      }

      // createIngredient seeds the pantry row with a default quantity; the follow-up PUT
      // replaces it with the scanned amount.
      for (const { item, qty, indices } of newItems.values()) {
        const { id } = await createIngredient({
          name: item.matched_name ?? item.receipt_name,
          category: item.category,
          unit_dim: item.unit_dim as UnitDim,
        });
        await api("/api/pantry", {
          method: "PUT",
          body: JSON.stringify({ ingredient_id: id, quantity: qty }),
        });
        for (const i of indices) applied.add(i);
      }

      setScanResults(null);
      setScanChecked(new Set());
    } catch {
      // Drop the rows that were already written so a retry can't double-apply them, and
      // remap the checked set to the surviving rows' new indices.
      const remaining: ScannedItem[] = [];
      const remainingChecked = new Set<number>();
      scanResults.forEach((item, i) => {
        if (applied.has(i)) return;
        if (scanChecked.has(i)) remainingChecked.add(remaining.length);
        remaining.push(item);
      });
      setScanResults(remaining.length ? remaining : null);
      setScanChecked(remainingChecked);
      setScanError("Einige Einträge konnten nicht gespeichert werden.");
    } finally {
      queryClient.invalidateQueries({ queryKey: ["pantry"] });
      queryClient.invalidateQueries({ queryKey: ["ingredients"] });
      setApplying(false);
    }
  }

  const isEmpty = pantryQuery.isSuccess && pantry.length === 0;

  return (
    <div className="page">
      <div className="page-header">
        <h1>Vorrat</h1>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button
          type="button"
          className="btn-ghost"
          onClick={() => setShowAdd((v) => !v)}
          style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}
        >
          <PlusIcon />
          Zutat hinzufügen
        </button>
        <button
          type="button"
          className="btn-ghost"
          onClick={() => scanInputRef.current?.click()}
          disabled={scanning}
          style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, opacity: scanning ? 0.5 : 1 }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <path d="M7 9h10M7 13h10M7 17h6" />
          </svg>
          {scanning ? "Scannt…" : "Bon scannen"}
        </button>
        <input
          ref={scanInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleScanFile}
          style={{ display: "none" }}
        />
      </div>

      {scanError && (
        <p style={{ color: "var(--accent)", fontSize: 13, margin: "0 0 16px", textAlign: "center" }}>
          {scanError}
        </p>
      )}

      {scanResults && (
        <div className="card" style={{ padding: 16, marginBottom: 20 }}>
          <h3 style={{ margin: "0 0 12px", fontSize: 15 }}>
            Erkannte Artikel ({scanResults.filter((_, i) => scanChecked.has(i)).length}/{scanResults.length})
          </h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 320, overflowY: "auto" }}>
            {scanResults.map((item, i) => (
              <label key={i} style={{
                display: "flex", alignItems: "center", gap: 10, padding: "8px 0",
                borderBottom: i < scanResults.length - 1 ? "1px solid var(--line)" : "none",
                opacity: scanChecked.has(i) ? 1 : 0.4, cursor: "pointer",
              }}>
                <input
                  type="checkbox"
                  checked={scanChecked.has(i)}
                  onChange={() => setScanChecked((prev) => {
                    const next = new Set(prev);
                    if (next.has(i)) next.delete(i);
                    else next.add(i);
                    return next;
                  })}
                  style={{ accentColor: "var(--accent)" }}
                />
                <span style={{ flex: 1, fontSize: 14 }}>
                  {item.matched_name ?? item.receipt_name}
                  {item.matched_name && item.matched_name !== item.receipt_name && (
                    <span style={{ fontSize: 11, color: "var(--tx4)", marginLeft: 6 }}>
                      ({item.receipt_name})
                    </span>
                  )}
                </span>
                <span style={{ fontSize: 13, color: "var(--tx3)", whiteSpace: "nowrap" }}>
                  +{item.quantity}{item.unit_dim === "mass" ? "g" : item.unit_dim === "volume" ? "ml" : "×"}
                </span>
                {!item.ingredient_id && (
                  <span style={{ fontSize: 10, color: "var(--accent)", fontWeight: 600 }}>NEU</span>
                )}
              </label>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => { setScanResults(null); setScanChecked(new Set()); }}
              style={{ flex: 1 }}
            >
              Abbrechen
            </button>
            <button
              type="button"
              className="btn-accent"
              onClick={applyScanResults}
              disabled={applying || scanChecked.size === 0}
              style={{ flex: 1, opacity: applying ? 0.5 : 1 }}
            >
              {applying ? "Wird gespeichert…" : "Vorrat aktualisieren"}
            </button>
          </div>
        </div>
      )}

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
