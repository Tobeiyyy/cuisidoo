import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import RecipeBody from "../components/RecipeBody";
import type { RecipeSaveInput } from "../../worker/recipes";

const STATUS_MESSAGES = ["Suche Rezeptideen…", "Prüfe TM6-Schritte…", "Passe an den TM6 an…"];

type Phase = "form" | "loading" | "error" | "preview";

function SkeletonBlock({ height, width = "100%" }: { height: number; width?: number | string }) {
  return (
    <div
      style={{
        height,
        width,
        background: "var(--elev)",
        borderRadius: "var(--r-sm)",
        marginBottom: 10,
      }}
    />
  );
}

export default function Generieren() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [wunsch, setWunsch] = useState("");
  // TODO Task 13: default_servings from settings; hardcoded to 2 until settings exist.
  const [portionen, setPortionen] = useState(2);
  const [extraGeraeteErlaubt, setExtraGeraeteErlaubt] = useState(false);

  const [phase, setPhase] = useState<Phase>("form");
  const [statusIndex, setStatusIndex] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [draft, setDraft] = useState<RecipeSaveInput | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (phase !== "loading") return;
    setStatusIndex(0);
    const interval = setInterval(() => {
      setStatusIndex((i) => (i + 1) % STATUS_MESSAGES.length);
    }, 4000);
    return () => clearInterval(interval);
  }, [phase]);

  async function runGenerate() {
    setPhase("loading");
    setErrorMsg(null);
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ wunsch: wunsch.trim(), portionen, extraGeraeteErlaubt }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setErrorMsg(body?.error ?? "Generierung fehlgeschlagen. Bitte erneut versuchen.");
        setPhase("error");
        return;
      }
      const data = (await res.json()) as RecipeSaveInput;
      setDraft(data);
      setPhase("preview");
    } catch {
      setErrorMsg("Verbindung fehlgeschlagen. Bitte erneut versuchen.");
      setPhase("error");
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!wunsch.trim() || phase === "loading") return;
    runGenerate();
  }

  function handleDiscard() {
    setDraft(null);
    setSaveError(null);
    setPhase("form");
    // wunsch (and portionen/toggle) intentionally kept so the user can tweak and retry.
  }

  async function handleSave() {
    if (!draft) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/recipes?source=generated", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(draft),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setSaveError(body?.error ?? "Speichern fehlgeschlagen. Bitte erneut versuchen.");
        setSaving(false);
        return;
      }
      const { id } = (await res.json()) as { id: number };
      queryClient.invalidateQueries({ queryKey: ["recipes"] });
      queryClient.invalidateQueries({ queryKey: ["ingredients"] });
      navigate(`/rezept/${id}`);
    } catch {
      setSaveError("Speichern fehlgeschlagen. Bitte erneut versuchen.");
      setSaving(false);
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>Generieren</h1>
      </div>

      {phase === "form" && (
        <form onSubmit={handleSubmit}>
          <textarea
            className="input"
            placeholder="Worauf hast du Lust? / Was ist im Kühlschrank?"
            value={wunsch}
            onChange={(e) => setWunsch(e.target.value)}
            rows={4}
            autoFocus
            style={{ resize: "vertical", marginBottom: 16 }}
          />

          <div
            className="card"
            style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", marginBottom: 16 }}
          >
            <span style={{ fontSize: 15, color: "var(--tx)", fontWeight: 500 }}>Portionen</span>
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <button
                type="button"
                onClick={() => setPortionen((p) => Math.max(1, p - 1))}
                aria-label="Weniger Portionen"
                style={{
                  width: 38,
                  height: 38,
                  border: "1.5px solid var(--border2)",
                  background: "none",
                  borderRadius: "var(--r-sm)",
                  color: "var(--tx3)",
                  fontSize: 20,
                  cursor: "pointer",
                }}
              >
                −
              </button>
              <span style={{ fontSize: 22, fontWeight: 700, color: "var(--tx)", minWidth: 28, textAlign: "center" }}>
                {portionen}
              </span>
              <button
                type="button"
                onClick={() => setPortionen((p) => Math.min(24, p + 1))}
                aria-label="Mehr Portionen"
                style={{
                  width: 38,
                  height: 38,
                  background: "var(--accent)",
                  border: "none",
                  borderRadius: "var(--r-sm)",
                  color: "#fff",
                  fontSize: 20,
                  cursor: "pointer",
                }}
              >
                +
              </button>
            </div>
          </div>

          <label
            className="card"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "12px 16px",
              marginBottom: 24,
              cursor: "pointer",
            }}
          >
            <span style={{ fontSize: 15, color: "var(--tx)", fontWeight: 500 }}>Weitere Küchengeräte erlauben</span>
            <input
              type="checkbox"
              checked={extraGeraeteErlaubt}
              onChange={(e) => setExtraGeraeteErlaubt(e.target.checked)}
              style={{ width: 20, height: 20, accentColor: "var(--accent)", cursor: "pointer" }}
            />
          </label>

          <button type="submit" className="btn-accent" disabled={!wunsch.trim()}>
            Rezept generieren
          </button>
        </form>
      )}

      {phase === "loading" && (
        <div>
          <div className="card" style={{ padding: 20, marginBottom: 20 }}>
            <SkeletonBlock height={22} width="70%" />
            <SkeletonBlock height={14} width="90%" />
            <SkeletonBlock height={14} width="40%" />
            <div style={{ marginTop: 16 }}>
              <SkeletonBlock height={54} />
              <SkeletonBlock height={54} />
              <SkeletonBlock height={54} />
            </div>
          </div>
          <p style={{ textAlign: "center", color: "var(--tx3)", fontSize: 14 }}>
            {STATUS_MESSAGES[statusIndex]}
          </p>
          <p style={{ textAlign: "center", color: "var(--tx4)", fontSize: 12 }}>
            Das kann 30–90 Sekunden dauern…
          </p>
        </div>
      )}

      {phase === "error" && (
        <div className="card" style={{ padding: 20, textAlign: "center" }}>
          <p style={{ color: "var(--accent)", fontSize: 14, marginBottom: 16 }} role="alert">
            {errorMsg}
          </p>
          <button type="button" className="btn-accent" onClick={runGenerate} style={{ marginBottom: 10 }}>
            Erneut versuchen
          </button>
          <button type="button" className="btn-ghost" onClick={handleDiscard}>
            Zurück zum Formular
          </button>
        </div>
      )}

      {phase === "preview" && draft && (
        <div>
          <h1 style={{ fontSize: 24, margin: "0 0 10px", lineHeight: 1.25 }}>{draft.title}</h1>
          {draft.description && (
            <p style={{ fontSize: 14, color: "var(--tx3)", margin: "0 0 12px", lineHeight: 1.5 }}>{draft.description}</p>
          )}
          <div style={{ display: "flex", gap: 16, alignItems: "center", color: "var(--tx3)", fontSize: 14, marginBottom: 16 }}>
            {draft.total_time_min != null && <span>{draft.total_time_min} Min</span>}
            {draft.total_time_min != null && <span>·</span>}
            <span>{draft.servings_base} Portionen</span>
          </div>
          {(draft.tags.length > 0 || draft.equipment.length > 0) && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20 }}>
              {draft.tags.map((t) => (
                <span key={t} className="chip">
                  {t}
                </span>
              ))}
              {draft.equipment.map((e) => (
                <span key={e} className="chip">
                  {e}
                </span>
              ))}
            </div>
          )}

          <RecipeBody
            ingredients={draft.ingredients}
            steps={draft.steps}
            servingsBase={draft.servings_base}
            portions={draft.servings_base}
          />

          {saveError && (
            <p style={{ color: "var(--accent)", fontSize: 14, margin: "16px 0" }} role="alert">
              {saveError}
            </p>
          )}

          <button
            type="button"
            className="btn-accent"
            onClick={handleSave}
            disabled={saving}
            style={{ marginTop: 24, marginBottom: 10 }}
          >
            {saving ? "Speichern…" : "Speichern"}
          </button>
          <button type="button" className="btn-ghost" onClick={handleDiscard} disabled={saving}>
            Verwerfen
          </button>
        </div>
      )}
    </div>
  );
}
