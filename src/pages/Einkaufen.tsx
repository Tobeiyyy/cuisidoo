import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, toggleItem, UnauthorizedError, type ShoppingItem } from "../api";
import { getMirroredShoppingList, mirrorShoppingList } from "../offline";
import { isInformalUnit } from "../../shared/types";
import { formatQuantity } from "../format";

/** Task 17: the list query returns the items plus whether they came from the offline mirror. */
interface ShoppingData {
  items: ShoppingItem[];
  offline: boolean;
}

const CATEGORIES = [
  "Gemüse & Obst", "Fleisch & Fisch", "Milchprodukte", "Grundnahrungsmittel",
  "Gewürze", "Tiefkühl", "Getränke", "Sonstiges",
];

const UNITS = ["g", "ml", "Stück", "Prise", "TL", "EL", "Spritzer"];

function PlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round">
      <path d="M5 13l4 4L19 7" />
    </svg>
  );
}
function TrashIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--tx4)" strokeWidth="2" strokeLinecap="round">
      <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0-1 14a2 2 0 01-2 2H7a2 2 0 01-2-2L4 6" />
    </svg>
  );
}

function RoundCheckbox({ checked }: { checked: boolean }) {
  if (checked) {
    return (
      <div
        style={{
          width: 22, height: 22, borderRadius: "50%", background: "var(--accent)",
          display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
        }}
      >
        <CheckIcon />
      </div>
    );
  }
  return <div style={{ width: 22, height: 22, borderRadius: "50%", border: "2px solid var(--border2)", flexShrink: 0 }} />;
}

export default function Einkaufen() {
  const queryClient = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [addLabel, setAddLabel] = useState("");
  const [addCategory, setAddCategory] = useState("");
  const [addQuantity, setAddQuantity] = useState("");
  const [addUnit, setAddUnit] = useState("");
  const [error, setError] = useState<string | null>(null);

  const shoppingQuery = useQuery({
    queryKey: ["shopping"],
    queryFn: async (): Promise<ShoppingData> => {
      try {
        const items = await api<ShoppingItem[]>("/api/shopping");
        void mirrorShoppingList(items).catch(() => {});
        return { items, offline: false };
      } catch (err) {
        if (err instanceof UnauthorizedError) throw err;
        const mirrored = await getMirroredShoppingList();
        if (mirrored.length > 0) return { items: mirrored, offline: true };
        throw err;
      }
    },
  });
  const items = shoppingQuery.data?.items ?? [];
  const isOffline = shoppingQuery.data?.offline ?? false;

  const grouped = useMemo(() => {
    const map = new Map<string, ShoppingItem[]>();
    for (const item of items) {
      if (!map.has(item.category)) map.set(item.category, []);
      map.get(item.category)!.push(item);
    }
    return [...map.entries()];
  }, [items]);

  const totalCount = items.length;
  const checkedCount = items.filter((i) => i.checked).length;
  const isEmpty = shoppingQuery.isSuccess && totalCount === 0;

  async function handleToggle(item: ShoppingItem) {
    const next = !item.checked;
    queryClient.setQueryData<ShoppingData>(["shopping"], (old) =>
      old && { ...old, items: old.items.map((i) => (i.id === item.id ? { ...i, checked: next } : i)) });
    try {
      await toggleItem(item.id, next);
    } catch {
      queryClient.invalidateQueries({ queryKey: ["shopping"] });
    }
  }

  async function handleDelete(id: number) {
    queryClient.setQueryData<ShoppingData>(["shopping"], (old) =>
      old && { ...old, items: old.items.filter((i) => i.id !== id) });
    try {
      await api(`/api/shopping/${id}`, { method: "DELETE" });
    } finally {
      queryClient.invalidateQueries({ queryKey: ["shopping"] });
    }
  }

  async function handleComplete() {
    if (!confirm("Gekaufte Artikel in den Vorrat übernehmen?")) return;
    try {
      await api("/api/shopping/complete", { method: "POST" });
      queryClient.invalidateQueries({ queryKey: ["shopping"] });
      queryClient.invalidateQueries({ queryKey: ["pantry"] });
      setError(null);
    } catch {
      setError("Aktion fehlgeschlagen.");
    }
  }

  async function handleAddItem(e: React.FormEvent) {
    e.preventDefault();
    if (!addLabel.trim() || !addCategory) return;
    try {
      await api("/api/shopping", {
        method: "POST",
        body: JSON.stringify({
          label: addLabel.trim(),
          category: addCategory,
          quantity: addQuantity.trim() ? Number(addQuantity) : undefined,
          unit: addUnit || undefined,
        }),
      });
      setAddLabel("");
      setAddCategory("");
      setAddQuantity("");
      setAddUnit("");
      setShowAdd(false);
      queryClient.invalidateQueries({ queryKey: ["shopping"] });
      setError(null);
    } catch {
      setError("Aktion fehlgeschlagen.");
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>Einkaufsliste</h1>
        {isOffline && <span className="chip">Offline</span>}
      </div>

      {totalCount > 0 && (
        <p style={{ fontSize: 13, color: "var(--tx3)", marginBottom: 20 }}>
          {checkedCount} von {totalCount} erledigt
        </p>
      )}

      {isEmpty && !showAdd && (
        <p style={{ textAlign: "center", color: "var(--tx3)", padding: "24px 0" }}>
          Noch keine Artikel. Erzeuge eine Liste im Wochenplan oder füge unten manuell etwas hinzu.
        </p>
      )}

      {grouped.map(([category, catItems]) => (
        <div key={category} style={{ marginBottom: 24 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1.5, color: "var(--accent)" }}>
              {category}
            </span>
            <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
          </div>
          <div className="card" style={{ padding: "0 16px" }}>
            {catItems.map((item) => {
              const showQty = item.quantity != null && item.unit != null && !isInformalUnit(item.unit);
              return (
                <div
                  key={item.id}
                  className="list-row"
                  style={{ cursor: "pointer" }}
                  onClick={() => handleToggle(item)}
                >
                  <RoundCheckbox checked={item.checked} />
                  <span
                    style={{
                      flex: 1, fontSize: 15,
                      color: item.checked ? "var(--tx4)" : "var(--tx)",
                      textDecoration: item.checked ? "line-through" : "none",
                    }}
                  >
                    {item.label}
                  </span>
                  {showQty && (
                    <span style={{ fontSize: 14, color: "var(--accent)", fontWeight: 500, fontVariantNumeric: "tabular-nums" }}>
                      {formatQuantity(item.quantity!, item.unit!)} {item.unit}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); handleDelete(item.id); }}
                    aria-label={`${item.label} entfernen`}
                    style={{ background: "none", border: "none", cursor: "pointer", padding: 4, flexShrink: 0 }}
                  >
                    <TrashIcon />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {error && (
        <p style={{ color: "var(--accent)", fontSize: 13, marginBottom: 10 }} role="alert">
          {error}
        </p>
      )}

      <button type="button" className="btn-accent" onClick={handleComplete} style={{ marginTop: 8 }}>
        Einkauf abschließen
      </button>

      <button
        type="button"
        className="btn-ghost"
        onClick={() => setShowAdd((v) => !v)}
        style={{ marginTop: 10, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}
      >
        <PlusIcon />
        Artikel hinzufügen
      </button>

      {showAdd && (
        <form onSubmit={handleAddItem} className="card" style={{ padding: 12, marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
          <input
            className="input"
            placeholder="Artikel (z. B. Toilettenpapier)"
            value={addLabel}
            onChange={(e) => setAddLabel(e.target.value)}
            autoFocus
          />
          <select className="input" value={addCategory} onChange={(e) => setAddCategory(e.target.value)}>
            <option value="">Kategorie wählen</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <div style={{ display: "flex", gap: 10 }}>
            <input
              className="input"
              type="number"
              placeholder="Menge (optional)"
              value={addQuantity}
              onChange={(e) => setAddQuantity(e.target.value)}
              style={{ flex: 1 }}
            />
            <select className="input" value={addUnit} onChange={(e) => setAddUnit(e.target.value)} style={{ flex: 1 }}>
              <option value="">Einheit</option>
              {UNITS.map((u) => (
                <option key={u} value={u}>{u}</option>
              ))}
            </select>
          </div>
          <button type="submit" className="btn-accent" disabled={!addLabel.trim() || !addCategory}>
            Hinzufügen
          </button>
        </form>
      )}
    </div>
  );
}
