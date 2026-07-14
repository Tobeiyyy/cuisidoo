import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";

interface EquipmentItem {
  id: number;
  name: string;
  owned: number;
}

const MODELS = [
  { value: "claude-sonnet-5", label: "Sonnet – günstig" },
  { value: "claude-opus-4-8", label: "Opus – beste Qualität" },
];

export default function Einstellungen() {
  const queryClient = useQueryClient();

  const equipmentQuery = useQuery({
    queryKey: ["equipment"],
    queryFn: () => api<EquipmentItem[]>("/api/equipment"),
  });
  const settingsQuery = useQuery({
    queryKey: ["settings"],
    queryFn: () => api<Record<string, string>>("/api/settings"),
  });

  const equipment = equipmentQuery.data ?? [];

  const [dietBias, setDietBias] = useState("");
  const [defaultServings, setDefaultServings] = useState("2");
  const [model, setModel] = useState(MODELS[0].value);
  const [loadedFromServer, setLoadedFromServer] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (loadedFromServer || !settingsQuery.data) return;
    const s = settingsQuery.data;
    setDietBias(s.diet_bias ?? "");
    setDefaultServings(s.default_servings ?? "2");
    setModel(s.generation_model ?? MODELS[0].value);
    setLoadedFromServer(true);
  }, [loadedFromServer, settingsQuery.data]);

  async function toggleEquipment(item: EquipmentItem) {
    const newOwned = item.owned ? 0 : 1;
    queryClient.setQueryData<EquipmentItem[]>(["equipment"], (old) =>
      old ? old.map((e) => (e.id === item.id ? { ...e, owned: newOwned } : e)) : old);
    try {
      await api(`/api/equipment/${item.id}`, {
        method: "PUT",
        body: JSON.stringify({ owned: !!newOwned }),
      });
    } finally {
      queryClient.invalidateQueries({ queryKey: ["equipment"] });
    }
  }

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      await api("/api/settings", {
        method: "PUT",
        body: JSON.stringify({
          diet_bias: dietBias,
          default_servings: defaultServings,
          generation_model: model,
        }),
      });
      queryClient.invalidateQueries({ queryKey: ["settings"] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Speichern fehlgeschlagen.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>Einstellungen</h1>
      </div>

      <h2 style={{ fontSize: 16, margin: "0 0 10px" }}>Geräteprofil</h2>
      <div className="card" style={{ padding: "0 16px", marginBottom: 28 }}>
        {equipment.length === 0 && (
          <p style={{ color: "var(--tx4)", fontSize: 13, padding: "12px 0" }}>Lädt…</p>
        )}
        {equipment.map((item) => (
          <label key={item.id} className="list-row" style={{ cursor: "pointer" }}>
            <span style={{ flex: 1, fontSize: 15, color: "var(--tx)" }}>{item.name}</span>
            <input
              type="checkbox"
              checked={!!item.owned}
              onChange={() => toggleEquipment(item)}
              style={{ width: 20, height: 20, accentColor: "var(--accent)", cursor: "pointer" }}
            />
          </label>
        ))}
      </div>

      <h2 style={{ fontSize: 16, margin: "0 0 10px" }}>Ernährungsziel</h2>
      <textarea
        className="input"
        value={dietBias}
        onChange={(e) => setDietBias(e.target.value)}
        rows={4}
        placeholder="z.B. Muskelaufbau, proteinreich, wenig Zucker…"
        style={{ resize: "vertical", marginBottom: 28 }}
      />

      <h2 style={{ fontSize: 16, margin: "0 0 10px" }}>Standard-Portionen</h2>
      <input
        className="input"
        type="number"
        min="1"
        max="24"
        value={defaultServings}
        onChange={(e) => setDefaultServings(e.target.value)}
        style={{ marginBottom: 28 }}
      />

      <h2 style={{ fontSize: 16, margin: "0 0 10px" }}>Modell</h2>
      <select
        className="input"
        value={model}
        onChange={(e) => setModel(e.target.value)}
        style={{ marginBottom: 28 }}
      >
        {MODELS.map((m) => (
          <option key={m.value} value={m.value}>
            {m.label}
          </option>
        ))}
      </select>

      {saveError && (
        <p style={{ color: "var(--accent)", fontSize: 14, marginBottom: 16 }} role="alert">
          {saveError}
        </p>
      )}
      {saved && (
        <p style={{ color: "var(--tx3)", fontSize: 14, marginBottom: 16 }}>Gespeichert.</p>
      )}

      <button type="button" className="btn-accent" onClick={handleSave} disabled={saving}>
        {saving ? "Speichern…" : "Speichern"}
      </button>
    </div>
  );
}
