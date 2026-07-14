import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, useRecipe } from "../api";
import { INFORMAL_UNITS } from "../../shared/types";
import type { Ingredient, Scaling, StepKind, UnitDim } from "../../shared/types";
import type { RecipeSaveInput } from "../../worker/recipes";

const UNITS = ["g", "ml", "Stück", "Prise", "TL", "EL", "Spritzer"];

// The canonical (weighable/countable) unit for each dimension. Informal units (Prise, TL, …) are
// presence-only downstream regardless of dimension, so they're always offered alongside whichever
// canonical unit matches the ingredient's dimension — this is what keeps the unit dropdown from
// ever offering a canonical unit that mismatches the ingredient (enforced server-side too, see
// worker/recipes.ts validateUnitDimensions).
const CANONICAL_UNIT: Record<UnitDim, string> = { mass: "g", volume: "ml", count: "Stück" };
function unitOptionsFor(dim: UnitDim): string[] {
  return [CANONICAL_UNIT[dim], ...INFORMAL_UNITS];
}

const SCALINGS: { value: Scaling; label: string }[] = [
  { value: "linear", label: "Linear" },
  { value: "damped", label: "Gedämpft" },
  { value: "fixed", label: "Fix" },
];

const CATEGORIES = [
  "Gemüse & Obst", "Fleisch & Fisch", "Milchprodukte", "Grundnahrungsmittel",
  "Gewürze", "Tiefkühl", "Getränke", "Sonstiges",
];

const UNIT_DIMS: { value: UnitDim; label: string }[] = [
  { value: "mass", label: "Masse (g)" },
  { value: "volume", label: "Volumen (ml)" },
  { value: "count", label: "Stück" },
];

const SPEEDS = (() => {
  const out: string[] = [];
  for (let i = 1; i <= 20; i++) out.push(String(i / 2));
  out.push("Turbo", "Teigstufe");
  return out;
})();

const TEMPS = [
  "37", "45", "50", "55", "60", "65", "70", "75", "80", "85", "90", "95", "98",
  "100", "105", "110", "115", "120", "130", "140", "150", "160", "Varoma",
];

const ZUBEHOER = ["Varoma", "Gareinsatz", "Rühraufsatz", "Gemüse-Styler"];

const MODI = [
  "Slow Cooking", "Sous-vide", "Fermentieren", "Reiskocher", "Wasserkocher",
  "Eierkocher", "Eindicken", "Aufwärmen", "Anbraten/Karamellisieren", "Vorreinigen",
];

interface IngredientRow {
  key: string;
  name: string;
  quantity: string;
  unit: string;
  scaling: Scaling;
  note: string;
  category: string;
  unit_dim: UnitDim;
  grams_per_piece: string;
}

function newIngredientRow(): IngredientRow {
  return {
    key: crypto.randomUUID(), name: "", quantity: "", unit: UNITS[0], scaling: "linear",
    note: "", category: "", unit_dim: "mass", grams_per_piece: "",
  };
}

interface StepRow {
  key: string;
  kind: StepKind;
  text: string;
  minutes: string;
  seconds: string;
  temp: string;
  speed: string;
  reverse: boolean;
  mode: string;
  accessory: string;
  device: string;
}

function newStepRow(kind: StepKind = "tm6"): StepRow {
  return {
    key: crypto.randomUUID(), kind, text: "", minutes: "", seconds: "", temp: "", speed: "",
    reverse: false, mode: "", accessory: "", device: "",
  };
}

type CatalogIngredient = Ingredient & { aliases: string | null };

export default function RezeptForm() {
  const { id } = useParams();
  const isEdit = !!id;
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const recipeQuery = useRecipe(id);
  const ingredientsQuery = useQuery({
    queryKey: ["ingredients"],
    queryFn: () => api<CatalogIngredient[]>("/api/ingredients"),
  });
  const equipmentQuery = useQuery({
    queryKey: ["equipment"],
    queryFn: () => api<{ id: number; name: string; owned: number }[]>("/api/equipment"),
  });
  const catalog = ingredientsQuery.data ?? [];
  const equipmentList = equipmentQuery.data ?? [];

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [servings, setServings] = useState("4");
  const [totalTime, setTotalTime] = useState("");
  const [activeTime, setActiveTime] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [ingredientRows, setIngredientRows] = useState<IngredientRow[]>([newIngredientRow()]);
  const [stepRows, setStepRows] = useState<StepRow[]>([newStepRow()]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [prefilled, setPrefilled] = useState(false);

  const catalogByName = useMemo(() => {
    const map = new Map<string, CatalogIngredient>();
    for (const item of catalog) {
      map.set(item.name.trim().toLowerCase(), item);
      if (item.aliases) for (const a of item.aliases.split("|")) map.set(a.trim().toLowerCase(), item);
    }
    return map;
  }, [catalog]);

  function findMatch(name: string): CatalogIngredient | undefined {
    return catalogByName.get(name.trim().toLowerCase());
  }

  // Prefill form once both the recipe and the ingredient catalog have loaded (edit mode only).
  useEffect(() => {
    if (!isEdit || prefilled) return;
    if (recipeQuery.isLoading || ingredientsQuery.isLoading) return;
    const recipe = recipeQuery.data;
    if (!recipe) return;

    setTitle(recipe.title);
    setDescription(recipe.description ?? "");
    setServings(String(recipe.servings_base));
    setTotalTime(recipe.total_time_min != null ? String(recipe.total_time_min) : "");
    setActiveTime(recipe.active_time_min != null ? String(recipe.active_time_min) : "");
    setTagsInput(recipe.tags.join(", "));

    setIngredientRows(
      recipe.ingredients.length
        ? recipe.ingredients.map((ing) => {
            const match = findMatch(ing.name);
            return {
              key: crypto.randomUUID(),
              name: ing.name,
              quantity: String(ing.quantity),
              unit: ing.unit,
              scaling: ing.scaling,
              note: ing.note ?? "",
              category: match?.category ?? "",
              unit_dim: match?.unit_dim ?? "mass",
              grams_per_piece: match?.grams_per_piece != null ? String(match.grams_per_piece) : "",
            };
          })
        : [newIngredientRow()],
    );

    setStepRows(
      recipe.steps.length
        ? recipe.steps.map((s) => ({
            key: crypto.randomUUID(),
            kind: s.kind,
            text: s.text,
            minutes: s.seconds != null ? String(Math.floor(s.seconds / 60)) : "",
            seconds: s.seconds != null ? String(s.seconds % 60) : "",
            temp: s.temp ?? "",
            speed: s.speed ?? "",
            reverse: s.reverse,
            mode: s.mode ?? "",
            accessory: s.accessory ?? "",
            device: s.device ?? "",
          }))
        : [newStepRow()],
    );
    setPrefilled(true);
    // findMatch depends on catalogByName which is derived from ingredientsQuery.data; not listed to avoid re-running on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEdit, prefilled, recipeQuery.isLoading, recipeQuery.data, ingredientsQuery.isLoading]);

  const derivedEquipment = useMemo(() => {
    const set = new Set<string>();
    for (const s of stepRows) if (s.kind === "off_device" && s.device.trim()) set.add(s.device.trim());
    return [...set];
  }, [stepRows]);

  function updateIngredient(key: string, patch: Partial<IngredientRow>) {
    setIngredientRows((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }
  function removeIngredient(key: string) {
    setIngredientRows((rows) => (rows.length > 1 ? rows.filter((r) => r.key !== key) : rows));
  }
  function addIngredient() {
    setIngredientRows((rows) => [...rows, newIngredientRow()]);
  }

  function updateStep(key: string, patch: Partial<StepRow>) {
    setStepRows((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }
  function removeStep(key: string) {
    setStepRows((rows) => (rows.length > 1 ? rows.filter((r) => r.key !== key) : rows));
  }
  function addStep() {
    setStepRows((rows) => [...rows, newStepRow()]);
  }

  function buildInput(): RecipeSaveInput | null {
    if (!title.trim()) {
      setError("Titel fehlt.");
      return null;
    }
    const servingsNum = Number(servings);
    if (!servingsNum || servingsNum < 1) {
      setError("Portionen müssen mindestens 1 sein.");
      return null;
    }

    const ingredients: RecipeSaveInput["ingredients"] = [];
    for (const row of ingredientRows) {
      const name = row.name.trim();
      if (!name) continue;
      const quantity = Number(row.quantity);
      if (!row.quantity || Number.isNaN(quantity) || quantity <= 0) {
        setError(`Menge für "${name}" ist ungültig.`);
        return null;
      }
      if (!row.unit) {
        setError(`Einheit für "${name}" fehlt.`);
        return null;
      }
      const match = findMatch(name);
      const category = match?.category ?? row.category;
      const unit_dim = match?.unit_dim ?? row.unit_dim;
      let grams_per_piece: number | null = match?.grams_per_piece ?? null;
      if (!match) {
        if (!row.category) {
          setError(`Kategorie für neue Zutat "${name}" fehlt.`);
          return null;
        }
        if (row.unit_dim === "count" && row.grams_per_piece) {
          grams_per_piece = Number(row.grams_per_piece) || null;
        }
      }
      ingredients.push({
        name, category, unit_dim, grams_per_piece,
        quantity, unit: row.unit, scaling: row.scaling, note: row.note.trim() || null, section: null,
      });
    }
    if (ingredients.length === 0) {
      setError("Mindestens eine Zutat wird benötigt.");
      return null;
    }

    const steps: RecipeSaveInput["steps"] = [];
    for (const row of stepRows) {
      if (!row.text.trim()) continue;
      if (row.kind === "tm6") {
        const minutes = Number(row.minutes) || 0;
        const secs = Number(row.seconds) || 0;
        const totalSeconds = minutes * 60 + secs;
        steps.push({
          kind: "tm6", text: row.text.trim(),
          seconds: totalSeconds > 0 ? totalSeconds : null,
          temp: row.temp || null, speed: row.speed || null,
          reverse: row.reverse, mode: row.mode || null, accessory: row.accessory || null, device: null,
        });
      } else {
        steps.push({
          kind: "off_device", text: row.text.trim(),
          seconds: null, temp: null, speed: null, reverse: false, mode: null, accessory: null,
          device: row.device || null,
        });
      }
    }
    if (steps.length === 0) {
      setError("Mindestens ein Schritt wird benötigt.");
      return null;
    }

    return {
      title: title.trim(),
      description: description.trim() || null,
      servings_base: servingsNum,
      total_time_min: totalTime ? Number(totalTime) : null,
      active_time_min: activeTime ? Number(activeTime) : null,
      tags: tagsInput.split(",").map((t) => t.trim()).filter(Boolean),
      equipment: derivedEquipment,
      ingredients,
      steps,
    };
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const input = buildInput();
    if (!input) return;
    setSubmitting(true);
    setError(null);
    try {
      if (isEdit) {
        await api(`/api/recipes/${id}`, { method: "PUT", body: JSON.stringify(input) });
        queryClient.invalidateQueries({ queryKey: ["recipe", id] });
        queryClient.invalidateQueries({ queryKey: ["recipes"] });
        queryClient.invalidateQueries({ queryKey: ["ingredients"] });
        navigate(`/rezept/${id}`);
      } else {
        const res = await api<{ id: number }>("/api/recipes", { method: "POST", body: JSON.stringify(input) });
        queryClient.invalidateQueries({ queryKey: ["recipes"] });
        queryClient.invalidateQueries({ queryKey: ["ingredients"] });
        navigate(`/rezept/${res.id}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Speichern fehlgeschlagen.");
    } finally {
      setSubmitting(false);
    }
  }

  if (isEdit && recipeQuery.isLoading) {
    return (
      <div className="page">
        <p style={{ color: "var(--tx3)" }}>Lädt…</p>
      </div>
    );
  }
  if (isEdit && (recipeQuery.error || !recipeQuery.data)) {
    return (
      <div className="page">
        <p style={{ color: "var(--tx3)" }}>Rezept konnte nicht geladen werden.</p>
        <Link to="/" className="btn-ghost" style={{ marginTop: 12 }}>
          Zurück zur Übersicht
        </Link>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>{isEdit ? "Rezept bearbeiten" : "Neues Rezept"}</h1>
        <button type="button" className="icon-btn" onClick={() => navigate(-1)} aria-label="Abbrechen">
          ✕
        </button>
      </div>

      <datalist id="ingredient-catalog">
        {catalog.map((c) => (
          <option key={c.id} value={c.name} />
        ))}
      </datalist>

      <form onSubmit={handleSubmit}>
        {/* Basis */}
        <h2 style={{ fontSize: 18, margin: "0 0 12px" }}>Basis</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 28 }}>
          <input
            className="input"
            placeholder="Titel"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
          />
          <textarea
            className="input"
            placeholder="Beschreibung (optional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            style={{ resize: "vertical" }}
          />
          <div style={{ display: "flex", gap: 10 }}>
            <label style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 11, color: "var(--tx4)" }}>Portionen</span>
              <input
                className="input"
                type="number"
                min="1"
                value={servings}
                onChange={(e) => setServings(e.target.value)}
              />
            </label>
            <label style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 11, color: "var(--tx4)" }}>Gesamtzeit (Min)</span>
              <input
                className="input"
                type="number"
                min="0"
                value={totalTime}
                onChange={(e) => setTotalTime(e.target.value)}
              />
            </label>
            <label style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 11, color: "var(--tx4)" }}>Aktivzeit (Min)</span>
              <input
                className="input"
                type="number"
                min="0"
                value={activeTime}
                onChange={(e) => setActiveTime(e.target.value)}
              />
            </label>
          </div>
          <input
            className="input"
            placeholder="Tags, kommagetrennt (z.B. schnell, vegan)"
            value={tagsInput}
            onChange={(e) => setTagsInput(e.target.value)}
          />
        </div>

        {/* Zutaten */}
        <h2 style={{ fontSize: 18, margin: "0 0 12px" }}>Zutaten</h2>
        {ingredientRows.map((row) => {
          const match = findMatch(row.name);
          const isNew = row.name.trim() !== "" && !match;
          // Once the name matches a catalog ingredient its dimension is fixed; for a brand-new
          // ingredient it's whatever unit_dim the "Neue Zutat" section currently has selected.
          const unitOptions = unitOptionsFor(match?.unit_dim ?? row.unit_dim);
          return (
            <div key={row.key} className="card" style={{ padding: 12, marginBottom: 10 }}>
              <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                <input
                  className="input"
                  list="ingredient-catalog"
                  placeholder="Zutat"
                  value={row.name}
                  onChange={(e) => {
                    const name = e.target.value;
                    const matched = findMatch(name);
                    // Force the unit to the matched ingredient's canonical unit so the row can't
                    // keep a leftover unit from before the name matched (or from a previous,
                    // differently-dimensioned ingredient).
                    updateIngredient(row.key, matched ? { name, unit: CANONICAL_UNIT[matched.unit_dim] } : { name });
                  }}
                  style={{ flex: 2 }}
                />
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => removeIngredient(row.key)}
                  aria-label="Zutat entfernen"
                >
                  ✕
                </button>
              </div>
              <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                <input
                  className="input"
                  type="number"
                  step="any"
                  min="0"
                  placeholder="Menge"
                  value={row.quantity}
                  onChange={(e) => updateIngredient(row.key, { quantity: e.target.value })}
                  style={{ flex: 1, minWidth: 90 }}
                />
                <select
                  className="input"
                  value={row.unit}
                  onChange={(e) => updateIngredient(row.key, { unit: e.target.value })}
                  style={{ flex: 1, minWidth: 90 }}
                >
                  {unitOptions.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
                <select
                  className="input"
                  value={row.scaling}
                  onChange={(e) => updateIngredient(row.key, { scaling: e.target.value as Scaling })}
                  style={{ flex: 1, minWidth: 100 }}
                >
                  {SCALINGS.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
              <input
                className="input"
                placeholder="Notiz (optional)"
                value={row.note}
                onChange={(e) => updateIngredient(row.key, { note: e.target.value })}
              />
              {isNew && (
                <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <span style={{ fontSize: 11, color: "var(--tx4)", width: "100%" }}>
                    Neue Zutat — bitte einordnen:
                  </span>
                  <select
                    className="input"
                    value={row.category}
                    onChange={(e) => updateIngredient(row.key, { category: e.target.value })}
                    style={{ flex: 1, minWidth: 150 }}
                  >
                    <option value="">Kategorie wählen</option>
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                  <select
                    className="input"
                    value={row.unit_dim}
                    onChange={(e) => {
                      const unit_dim = e.target.value as UnitDim;
                      // Keep the quantity's unit in step with the newly-chosen dimension, same as
                      // when a name match forces it — otherwise switching to e.g. "count" here
                      // could leave "g" selected, which the server would then reject.
                      updateIngredient(row.key, { unit_dim, unit: CANONICAL_UNIT[unit_dim] });
                    }}
                    style={{ flex: 1, minWidth: 130 }}
                  >
                    {UNIT_DIMS.map((d) => (
                      <option key={d.value} value={d.value}>
                        {d.label}
                      </option>
                    ))}
                  </select>
                  {row.unit_dim === "count" && (
                    <input
                      className="input"
                      type="number"
                      step="any"
                      min="0"
                      placeholder="g pro Stück (optional)"
                      value={row.grams_per_piece}
                      onChange={(e) => updateIngredient(row.key, { grams_per_piece: e.target.value })}
                      style={{ flex: 1, minWidth: 150 }}
                    />
                  )}
                </div>
              )}
            </div>
          );
        })}
        <button
          type="button"
          className="btn-ghost"
          onClick={addIngredient}
          style={{ marginBottom: 28 }}
        >
          + Zutat hinzufügen
        </button>

        {/* Schritte */}
        <h2 style={{ fontSize: 18, margin: "0 0 12px" }}>Zubereitung</h2>
        {stepRows.map((row, i) => (
          <div key={row.key} className="card" style={{ padding: 12, marginBottom: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <span style={{ fontSize: 13, color: "var(--tx4)", fontWeight: 600 }}>Schritt {i + 1}</span>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <div style={{ display: "flex", border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
                  <button
                    type="button"
                    onClick={() => updateStep(row.key, { kind: "tm6" })}
                    style={{
                      padding: "4px 10px", fontSize: 12, border: "none", cursor: "pointer",
                      background: row.kind === "tm6" ? "var(--accent)" : "transparent",
                      color: row.kind === "tm6" ? "#fff" : "var(--tx3)",
                    }}
                  >
                    TM6
                  </button>
                  <button
                    type="button"
                    onClick={() => updateStep(row.key, { kind: "off_device" })}
                    style={{
                      padding: "4px 10px", fontSize: 12, border: "none", cursor: "pointer",
                      background: row.kind === "off_device" ? "var(--accent)" : "transparent",
                      color: row.kind === "off_device" ? "#fff" : "var(--tx3)",
                    }}
                  >
                    Extern
                  </button>
                </div>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => removeStep(row.key)}
                  aria-label="Schritt entfernen"
                  style={{ width: 32, height: 32 }}
                >
                  ✕
                </button>
              </div>
            </div>
            <textarea
              className="input"
              placeholder="Beschreibung"
              value={row.text}
              onChange={(e) => updateStep(row.key, { text: e.target.value })}
              rows={2}
              style={{ marginBottom: 8, resize: "vertical" }}
            />
            {row.kind === "tm6" ? (
              <>
                <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                  <input
                    className="input"
                    type="number"
                    min="0"
                    placeholder="Min"
                    value={row.minutes}
                    onChange={(e) => updateStep(row.key, { minutes: e.target.value })}
                    style={{ flex: 1, minWidth: 70 }}
                  />
                  <input
                    className="input"
                    type="number"
                    min="0"
                    max="59"
                    placeholder="Sek"
                    value={row.seconds}
                    onChange={(e) => updateStep(row.key, { seconds: e.target.value })}
                    style={{ flex: 1, minWidth: 70 }}
                  />
                  <select
                    className="input"
                    value={row.speed}
                    onChange={(e) => updateStep(row.key, { speed: e.target.value })}
                    style={{ flex: 1, minWidth: 100 }}
                  >
                    <option value="">Stufe —</option>
                    {SPEEDS.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
                <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                  <select
                    className="input"
                    value={row.temp}
                    onChange={(e) => updateStep(row.key, { temp: e.target.value })}
                    style={{ flex: 1, minWidth: 100 }}
                  >
                    <option value="">Temp —</option>
                    {TEMPS.map((t) => (
                      <option key={t} value={t}>
                        {t === "Varoma" ? t : `${t}°`}
                      </option>
                    ))}
                  </select>
                  <select
                    className="input"
                    value={row.accessory}
                    onChange={(e) => updateStep(row.key, { accessory: e.target.value })}
                    style={{ flex: 1, minWidth: 120 }}
                  >
                    <option value="">Zubehör —</option>
                    {ZUBEHOER.map((a) => (
                      <option key={a} value={a}>
                        {a}
                      </option>
                    ))}
                  </select>
                  <select
                    className="input"
                    value={row.mode}
                    onChange={(e) => updateStep(row.key, { mode: e.target.value })}
                    style={{ flex: 1, minWidth: 120 }}
                  >
                    <option value="">Modus —</option>
                    {MODI.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--tx3)" }}>
                  <input
                    type="checkbox"
                    checked={row.reverse}
                    onChange={(e) => updateStep(row.key, { reverse: e.target.checked })}
                  />
                  Linkslauf
                </label>
              </>
            ) : (
              <select
                className="input"
                value={row.device}
                onChange={(e) => updateStep(row.key, { device: e.target.value })}
              >
                <option value="">Gerät wählen</option>
                {equipmentList.map((eq) => (
                  <option key={eq.id} value={eq.name}>
                    {eq.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        ))}
        <button type="button" className="btn-ghost" onClick={addStep} style={{ marginBottom: 28 }}>
          + Schritt hinzufügen
        </button>

        {/* Geräte (auto-derived, display only) */}
        <h2 style={{ fontSize: 18, margin: "0 0 12px" }}>Geräte</h2>
        <div style={{ marginBottom: 28 }}>
          {derivedEquipment.length === 0 ? (
            <p style={{ color: "var(--tx4)", fontSize: 14, margin: 0 }}>Nur Thermomix TM6 benötigt.</p>
          ) : (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {derivedEquipment.map((d) => (
                <span key={d} className="chip">
                  {d}
                </span>
              ))}
            </div>
          )}
        </div>

        {error && <p style={{ color: "var(--accent)", fontSize: 14, marginBottom: 16 }}>{error}</p>}

        <button type="submit" className="btn-accent" disabled={submitting} style={{ marginBottom: 10 }}>
          {submitting ? "Speichern…" : isEdit ? "Änderungen speichern" : "Rezept speichern"}
        </button>
        <button type="button" className="btn-ghost" onClick={() => navigate(-1)}>
          Abbrechen
        </button>
      </form>
    </div>
  );
}
