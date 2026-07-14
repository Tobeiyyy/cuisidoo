import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { mondayOf, addDays, formatISODate, formatDayLabel, weekdayName, weekRangeLabel } from "../format";

type Slot = "mittag" | "abend" | "sonstiges";

interface PlanEntry {
  id: number;
  date: string;
  slot: Slot;
  recipe_id: number;
  servings: number;
  title: string;
  image_key: string | null;
}

interface RecipeListItem {
  id: number;
  title: string;
  image_key: string | null;
}

const SLOT_LABELS: Record<Slot, string> = { mittag: "Mittag", abend: "Abend", sonstiges: "Sonstiges" };

// Decorative placeholder-card gradients, values lifted directly from mockup 2a/2b (not part of the design token system).
const GRADIENTS = [
  "linear-gradient(135deg,#2A1E18,#1E1412)",
  "linear-gradient(135deg,#1A1E18,#121614)",
  "linear-gradient(135deg,#1E1A18,#161210)",
  "linear-gradient(135deg,#181A1E,#101216)",
  "linear-gradient(135deg,#1E181A,#141012)",
  "linear-gradient(135deg,#18181E,#101016)",
];
function gradientFor(id: number) {
  return GRADIENTS[id % GRADIENTS.length];
}

function ChevronLeftIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--tx3)" strokeWidth="2.5" strokeLinecap="round">
      <path d="M15 18l-6-6 6-6" />
    </svg>
  );
}
function ChevronRightIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--tx3)" strokeWidth="2.5" strokeLinecap="round">
      <path d="M9 18l6-6-6-6" />
    </svg>
  );
}
function PlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
function MoreIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--tx3)" strokeWidth="2">
      <circle cx="12" cy="6" r="1.5" />
      <circle cx="12" cy="12" r="1.5" />
      <circle cx="12" cy="18" r="1.5" />
    </svg>
  );
}
function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--tx4)" strokeWidth="2">
      <circle cx="11" cy="11" r="8" />
      <path d="M21 21l-4.35-4.35" />
    </svg>
  );
}

interface EntryMenuState { id: number; servings: number; mode: "menu" | "servings" }

function EntryCard({
  entry, entryMenu, onNavigate, onOpenMenu, onCloseMenu, onSetEntryMenu, onRemove, onSaveServings,
}: {
  entry: PlanEntry;
  entryMenu: EntryMenuState | null;
  onNavigate: (recipeId: number) => void;
  onOpenMenu: (entry: PlanEntry) => void;
  onCloseMenu: () => void;
  onSetEntryMenu: (next: EntryMenuState) => void;
  onRemove: (id: number) => void;
  onSaveServings: () => void;
}) {
  return (
    <div
      className="card"
      style={{ display: "flex", alignItems: "center", gap: 12, padding: 10, cursor: "pointer", position: "relative" }}
      onClick={() => onNavigate(entry.recipe_id)}
    >
      <div
        style={{
          width: 52, height: 52, flexShrink: 0, borderRadius: "var(--r-sm)",
          background: gradientFor(entry.recipe_id), display: "flex", alignItems: "center", justifyContent: "center",
        }}
      >
        <span style={{ fontSize: 18, fontWeight: 700, color: "var(--tx4)" }}>{entry.title.charAt(0)}</span>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: "var(--tx)", marginBottom: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {entry.title}
        </div>
        <span className="chip">×{entry.servings}</span>
      </div>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onOpenMenu(entry); }}
        aria-label="Optionen"
        style={{ background: "none", border: "none", cursor: "pointer", padding: 6, flexShrink: 0 }}
      >
        <MoreIcon />
      </button>

      {entryMenu?.id === entry.id && (
        <>
          <div
            style={{ position: "fixed", inset: 0, zIndex: 40 }}
            onClick={(e) => { e.stopPropagation(); onCloseMenu(); }}
          />
          <div
            className="card"
            style={{ position: "absolute", top: 44, right: 8, minWidth: 180, padding: 8, zIndex: 41 }}
            onClick={(e) => e.stopPropagation()}
          >
            {entryMenu.mode === "menu" ? (
              <>
                <button
                  type="button"
                  onClick={() => onSetEntryMenu({ ...entryMenu, mode: "servings" })}
                  style={{ display: "block", width: "100%", textAlign: "left", padding: "10px 12px", background: "none", border: "none", color: "var(--tx)", fontSize: 14, cursor: "pointer" }}
                >
                  Portionen ändern
                </button>
                <button
                  type="button"
                  onClick={() => onRemove(entry.id)}
                  style={{ display: "block", width: "100%", textAlign: "left", padding: "10px 12px", background: "none", border: "none", color: "var(--accent)", fontSize: 14, cursor: "pointer" }}
                >
                  Entfernen
                </button>
              </>
            ) : (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "4px 8px", gap: 12 }}>
                <button
                  type="button"
                  onClick={() => onSetEntryMenu({ ...entryMenu, servings: Math.max(1, entryMenu.servings - 1) })}
                  aria-label="Weniger Portionen"
                  style={{ width: 30, height: 30, border: "1.5px solid var(--border2)", background: "none", borderRadius: "var(--r-sm)", color: "var(--tx3)", fontSize: 16, cursor: "pointer" }}
                >
                  −
                </button>
                <span style={{ fontSize: 15, fontWeight: 700, color: "var(--tx)", minWidth: 20, textAlign: "center" }}>{entryMenu.servings}</span>
                <button
                  type="button"
                  onClick={() => onSetEntryMenu({ ...entryMenu, servings: entryMenu.servings + 1 })}
                  aria-label="Mehr Portionen"
                  style={{ width: 30, height: 30, background: "var(--accent)", border: "none", borderRadius: "var(--r-sm)", color: "#fff", fontSize: 16, cursor: "pointer" }}
                >
                  +
                </button>
                <button type="button" onClick={onSaveServings} className="btn-accent" style={{ width: "auto", padding: "8px 14px", fontSize: 13 }}>
                  Fertig
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function SlotRow({
  date, slot, entries, allowAdd, entryMenu, onNavigate, onOpenMenu, onCloseMenu, onSetEntryMenu, onRemove, onSaveServings, onOpenPicker,
}: {
  date: string;
  slot: Slot;
  entries: PlanEntry[];
  allowAdd: boolean;
  entryMenu: EntryMenuState | null;
  onNavigate: (recipeId: number) => void;
  onOpenMenu: (entry: PlanEntry) => void;
  onCloseMenu: () => void;
  onSetEntryMenu: (next: EntryMenuState) => void;
  onRemove: (id: number) => void;
  onSaveServings: () => void;
  onOpenPicker: (date: string, slot: Slot) => void;
}) {
  if (entries.length === 0 && !allowAdd) return null;
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1, color: "var(--tx4)", marginBottom: 6 }}>
        {SLOT_LABELS[slot]}
      </div>
      {entries.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {entries.map((entry) => (
            <EntryCard
              key={entry.id}
              entry={entry}
              entryMenu={entryMenu}
              onNavigate={onNavigate}
              onOpenMenu={onOpenMenu}
              onCloseMenu={onCloseMenu}
              onSetEntryMenu={onSetEntryMenu}
              onRemove={onRemove}
              onSaveServings={onSaveServings}
            />
          ))}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => onOpenPicker(date, slot)}
          style={{
            width: "100%", border: "1px dashed var(--border)", borderRadius: "var(--r-lg)",
            padding: 18, background: "none", color: "var(--tx4)", fontSize: 13, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
          }}
        >
          <PlusIcon /> Rezept
        </button>
      )}
    </div>
  );
}

export default function Planen() {
  const navigate = useNavigate();
  const onNavigate = (recipeId: number) => navigate(`/rezept/${recipeId}`);
  const queryClient = useQueryClient();
  const [weekOffset, setWeekOffset] = useState(0);
  const [entryMenu, setEntryMenu] = useState<EntryMenuState | null>(null);
  const [pickerTarget, setPickerTarget] = useState<{ date: string; slot: Slot } | null>(null);
  const [pickerQuery, setPickerQuery] = useState("");
  const [pickerSelected, setPickerSelected] = useState<RecipeListItem | null>(null);
  const [pickerServings, setPickerServings] = useState(2);

  const today = new Date();
  const todayIso = formatISODate(today);
  const tomorrowIso = formatISODate(addDays(today, 1));

  const monday = useMemo(() => addDays(mondayOf(today), weekOffset * 7), [weekOffset]); // eslint-disable-line react-hooks/exhaustive-deps
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(monday, i)), [monday]);
  const from = formatISODate(days[0]);
  const to = formatISODate(days[6]);

  const planQuery = useQuery({
    queryKey: ["plan", from, to],
    queryFn: () => api<PlanEntry[]>(`/api/plan?from=${from}&to=${to}`),
  });
  const recipesQuery = useQuery({
    queryKey: ["recipes", "all"],
    queryFn: () => api<RecipeListItem[]>("/api/recipes"),
  });
  const settingsQuery = useQuery({
    queryKey: ["settings"],
    queryFn: () => api<Record<string, string>>("/api/settings"),
  });
  const defaultServings = Number(settingsQuery.data?.default_servings) || 2;

  const entriesByDate = useMemo(() => {
    const map = new Map<string, PlanEntry[]>();
    for (const e of planQuery.data ?? []) {
      if (!map.has(e.date)) map.set(e.date, []);
      map.get(e.date)!.push(e);
    }
    return map;
  }, [planQuery.data]);

  function dayHeaderLabel(iso: string, date: Date) {
    if (iso === todayIso) return "Heute";
    if (iso === tomorrowIso) return "Morgen";
    return weekdayName(date);
  }

  async function refreshPlan() {
    await queryClient.invalidateQueries({ queryKey: ["plan"] });
  }

  function openPicker(date: string, slot: Slot) {
    setPickerTarget({ date, slot });
    setPickerQuery("");
    setPickerSelected(null);
    setPickerServings(defaultServings);
  }
  function closePicker() {
    setPickerTarget(null);
    setPickerQuery("");
    setPickerSelected(null);
  }
  async function confirmAdd() {
    if (!pickerTarget || !pickerSelected) return;
    await api("/api/plan", {
      method: "POST",
      body: JSON.stringify({
        date: pickerTarget.date, slot: pickerTarget.slot,
        recipe_id: pickerSelected.id, servings: pickerServings,
      }),
    });
    closePicker();
    await refreshPlan();
  }

  function openEntryMenu(entry: PlanEntry) {
    setEntryMenu({ id: entry.id, servings: entry.servings, mode: "menu" });
  }
  function closeEntryMenu() {
    setEntryMenu(null);
  }
  async function removeEntry(id: number) {
    closeEntryMenu();
    await api(`/api/plan/${id}`, { method: "DELETE" });
    await refreshPlan();
  }
  async function saveServings() {
    if (!entryMenu) return;
    await api(`/api/plan/${entryMenu.id}`, {
      method: "PATCH",
      body: JSON.stringify({ servings: entryMenu.servings }),
    });
    closeEntryMenu();
    await refreshPlan();
  }

  const filteredRecipes = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase();
    return (recipesQuery.data ?? []).filter((r) => !q || r.title.toLowerCase().includes(q)).slice(0, 30);
  }, [recipesQuery.data, pickerQuery]);

  return (
    <div className="page">
      <div className="page-header">
        <h1>Wochenplan</h1>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 13, color: "var(--tx3)", whiteSpace: "nowrap" }}>{weekRangeLabel(monday)}</span>
          <div style={{ display: "flex", gap: 4 }}>
            <button type="button" className="icon-btn" style={{ width: 32, height: 32 }} aria-label="Vorherige Woche" onClick={() => setWeekOffset((w) => w - 1)}>
              <ChevronLeftIcon />
            </button>
            <button type="button" className="icon-btn" style={{ width: 32, height: 32 }} aria-label="Nächste Woche" onClick={() => setWeekOffset((w) => w + 1)}>
              <ChevronRightIcon />
            </button>
          </div>
        </div>
      </div>

      {days.map((date) => {
        const iso = formatISODate(date);
        const entries = entriesByDate.get(iso) ?? [];
        const mittag = entries.filter((e) => e.slot === "mittag");
        const abend = entries.filter((e) => e.slot === "abend");
        const sonstiges = entries.filter((e) => e.slot === "sonstiges");
        return (
          <div key={iso} style={{ marginBottom: 22 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 10 }}>
              <span style={{ fontSize: 15, fontWeight: 700, color: "var(--tx)" }}>{dayHeaderLabel(iso, date)}</span>
              <span style={{ fontSize: 12, color: "var(--tx4)" }}>{formatDayLabel(date)}</span>
            </div>
            <SlotRow
              date={iso} slot="mittag" entries={mittag} allowAdd
              entryMenu={entryMenu} onNavigate={onNavigate} onOpenMenu={openEntryMenu} onCloseMenu={closeEntryMenu}
              onSetEntryMenu={setEntryMenu} onRemove={removeEntry} onSaveServings={saveServings} onOpenPicker={openPicker}
            />
            <SlotRow
              date={iso} slot="abend" entries={abend} allowAdd
              entryMenu={entryMenu} onNavigate={onNavigate} onOpenMenu={openEntryMenu} onCloseMenu={closeEntryMenu}
              onSetEntryMenu={setEntryMenu} onRemove={removeEntry} onSaveServings={saveServings} onOpenPicker={openPicker}
            />
            <SlotRow
              date={iso} slot="sonstiges" entries={sonstiges} allowAdd={false}
              entryMenu={entryMenu} onNavigate={onNavigate} onOpenMenu={openEntryMenu} onCloseMenu={closeEntryMenu}
              onSetEntryMenu={setEntryMenu} onRemove={removeEntry} onSaveServings={saveServings} onOpenPicker={openPicker}
            />
          </div>
        );
      })}

      {/* TODO Task 15: wire this up to POST /api/shopping/generate (or similar) once the shopping-list
          endpoint exists, then navigate to /einkaufen. */}
      <button type="button" className="btn-accent" disabled style={{ marginTop: 8 }}>
        Einkaufsliste für diese Woche erzeugen
      </button>
      <p style={{ textAlign: "center", fontSize: 12, color: "var(--tx4)", marginTop: 8 }}>folgt</p>

      {pickerTarget && (
        <div
          style={{ position: "fixed", inset: 0, background: "var(--overlay-bg)", zIndex: 100, display: "flex", alignItems: "flex-end" }}
          onClick={closePicker}
        >
          <div
            className="card"
            style={{ width: "100%", borderRadius: "20px 20px 0 0", padding: 20, maxHeight: "80vh", overflowY: "auto", border: "none" }}
            onClick={(e) => e.stopPropagation()}
          >
            {!pickerSelected ? (
              <>
                <h2 style={{ fontSize: 16, margin: "0 0 14px" }}>
                  Rezept für {SLOT_LABELS[pickerTarget.slot]} wählen
                </h2>
                <div className="input" style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                  <SearchIcon />
                  <input
                    value={pickerQuery}
                    onChange={(e) => setPickerQuery(e.target.value)}
                    placeholder="Rezept suchen…"
                    aria-label="Rezept suchen"
                    autoFocus
                    style={{ border: "none", background: "none", outline: "none", color: "var(--tx)", font: "inherit", flex: 1 }}
                  />
                </div>
                {filteredRecipes.length === 0 ? (
                  <p style={{ color: "var(--tx4)", fontSize: 13 }}>Keine Treffer.</p>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {filteredRecipes.map((r) => (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => setPickerSelected(r)}
                        className="list-row"
                        style={{ background: "none", border: "none", width: "100%", textAlign: "left", cursor: "pointer", color: "var(--tx)", font: "inherit" }}
                      >
                        <div
                          style={{ width: 40, height: 40, borderRadius: "var(--r-sm)", background: gradientFor(r.id), flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}
                        >
                          <span style={{ fontSize: 14, fontWeight: 700, color: "var(--tx4)" }}>{r.title.charAt(0)}</span>
                        </div>
                        <span style={{ flex: 1 }}>{r.title}</span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <>
                <h2 style={{ fontSize: 16, margin: "0 0 14px" }}>{pickerSelected.title}</h2>
                <div className="card" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", marginBottom: 20 }}>
                  <span style={{ fontSize: 15, color: "var(--tx)", fontWeight: 500 }}>Portionen</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                    <button
                      type="button"
                      onClick={() => setPickerServings((v) => Math.max(1, v - 1))}
                      aria-label="Weniger Portionen"
                      style={{ width: 34, height: 34, border: "1.5px solid var(--border2)", background: "none", borderRadius: "var(--r-sm)", color: "var(--tx3)", fontSize: 18, cursor: "pointer" }}
                    >
                      −
                    </button>
                    <span style={{ fontSize: 18, fontWeight: 700, color: "var(--tx)", minWidth: 24, textAlign: "center" }}>{pickerServings}</span>
                    <button
                      type="button"
                      onClick={() => setPickerServings((v) => v + 1)}
                      aria-label="Mehr Portionen"
                      style={{ width: 34, height: 34, background: "var(--accent)", border: "none", borderRadius: "var(--r-sm)", color: "#fff", fontSize: 18, cursor: "pointer" }}
                    >
                      +
                    </button>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 10 }}>
                  <button type="button" className="btn-ghost" onClick={() => setPickerSelected(null)}>
                    Zurück
                  </button>
                  <button type="button" className="btn-accent" onClick={confirmAdd}>
                    Hinzufügen
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
