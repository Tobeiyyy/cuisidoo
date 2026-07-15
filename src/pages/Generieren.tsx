import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, fetchSuggestions, importRecipe } from "../api";
import RecipeBody from "../components/RecipeBody";
import type { RecipeSaveInput } from "../../worker/recipes";
import type { Suggestion } from "../../worker/suggest";

const STATUS_MESSAGES = ["Suche Rezeptideen…", "Prüfe TM6-Schritte…", "Passe an den TM6 an…"];

type Mode = "generate" | "surprise" | "import";
type Phase = "form" | "loading" | "error" | "preview" | "suggesting" | "picking";

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

/** Shared portionen stepper + extra-geräte checkbox, reused across all three modes' forms. */
function SharedControls({
  portionen,
  onChangePortionen,
  extraGeraeteErlaubt,
  onChangeExtraGeraete,
}: {
  portionen: number;
  onChangePortionen: (next: number) => void;
  extraGeraeteErlaubt: boolean;
  onChangeExtraGeraete: (next: boolean) => void;
}) {
  return (
    <>
      <div
        className="card"
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", marginBottom: 16 }}
      >
        <span style={{ fontSize: 15, color: "var(--tx)", fontWeight: 500 }}>Portionen</span>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <button
            type="button"
            onClick={() => onChangePortionen(Math.max(1, portionen - 1))}
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
            onClick={() => onChangePortionen(Math.min(24, portionen + 1))}
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
          onChange={(e) => onChangeExtraGeraete(e.target.checked)}
          style={{ width: 20, height: 20, accentColor: "var(--accent)", cursor: "pointer" }}
        />
      </label>
    </>
  );
}

export default function Generieren() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [mode, setMode] = useState<Mode>("generate");

  const [wunsch, setWunsch] = useState("");
  const [portionen, setPortionen] = useState(2);
  const [portionenTouched, setPortionenTouched] = useState(false);
  const [extraGeraeteErlaubt, setExtraGeraeteErlaubt] = useState(false);

  const settingsQuery = useQuery({
    queryKey: ["settings"],
    queryFn: () => api<Record<string, string>>("/api/settings"),
  });

  useEffect(() => {
    if (portionenTouched || !settingsQuery.data) return;
    const fallback = Number(settingsQuery.data.default_servings);
    if (fallback > 0) setPortionen(fallback);
  }, [portionenTouched, settingsQuery.data]);

  const [phase, setPhase] = useState<Phase>("form");
  const [statusIndex, setStatusIndex] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [draft, setDraft] = useState<RecipeSaveInput | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Surprise-me ("Überrasch mich!") state.
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [selectedSuggestions, setSelectedSuggestions] = useState<Set<number>>(new Set());
  const [suggestQueue, setSuggestQueue] = useState<string[]>([]);

  // Import state.
  const [importInput, setImportInput] = useState("");
  const [importSuggestions, setImportSuggestions] = useState<Suggestion[]>([]);
  const [selectedImports, setSelectedImports] = useState<Set<number>>(new Set());
  const [importQueue, setImportQueue] = useState<{ input: string; title: string }[]>([]);

  // Holds "retry this exact attempt" so the error screen's retry button repeats whichever
  // operation actually failed (initial generate, suggest fetch, import, or a queued item) with
  // its original arguments — rather than guessing from `mode`, which can't disambiguate a queued
  // generate/import call from the mode's initial action.
  const retryRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (phase !== "loading") return;
    setStatusIndex(0);
    const interval = setInterval(() => {
      setStatusIndex((i) => (i + 1) % STATUS_MESSAGES.length);
    }, 4000);
    return () => clearInterval(interval);
  }, [phase]);

  function handlePortionenChange(next: number) {
    setPortionenTouched(true);
    setPortionen(next);
  }

  function switchMode(next: Mode) {
    setMode(next);
    setPhase("form");
    setSuggestions([]);
    setSelectedSuggestions(new Set());
    setSuggestQueue([]);
    setImportSuggestions([]);
    setSelectedImports(new Set());
    setImportQueue([]);
    setDraft(null);
    setSaveError(null);
    setErrorMsg(null);
  }

  async function runGenerate(wunschOverride?: string) {
    // `wunschOverride` lets queue-driven callers (surprise-me picking, queue advance) pass the
    // next title directly — `setWunsch` alone wouldn't be visible here yet since state updates
    // aren't synchronous, so reading the `wunsch` closure variable would send the previous value.
    const effectiveWunsch = (wunschOverride ?? wunsch).trim();
    retryRef.current = () => runGenerate(wunschOverride);
    setPhase("loading");
    setErrorMsg(null);
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ wunsch: effectiveWunsch, portionen, extraGeraeteErlaubt }),
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

  async function runSuggest() {
    retryRef.current = () => runSuggest();
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

  async function runImport(selectedTitle?: string) {
    retryRef.current = () => runImport(selectedTitle);
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
      setDraft(res as unknown as RecipeSaveInput);
      setPhase("preview");
    } catch {
      setErrorMsg("Import fehlgeschlagen. Bitte erneut versuchen.");
      setPhase("error");
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!wunsch.trim() || phase === "loading") return;
    runGenerate();
  }

  function advanceSuggestQueue() {
    const remaining = suggestQueue.slice(1);
    setSuggestQueue(remaining);
    if (remaining.length > 0) {
      setWunsch(remaining[0]);
      setDraft(null);
      setSaveError(null);
      runGenerate(remaining[0]);
    } else {
      setPhase("form");
      setWunsch("");
    }
  }

  function advanceImportQueue() {
    const remaining = importQueue.slice(1);
    setImportQueue(remaining);
    if (remaining.length > 0) {
      setDraft(null);
      setSaveError(null);
      runImport(remaining[0].title);
    } else {
      setPhase("form");
      setImportInput("");
    }
  }

  function confirmSuggestionPicking() {
    if (mode === "import") {
      const queue = [...selectedImports].map((i) => ({ input: importInput.trim(), title: importSuggestions[i].title }));
      setImportQueue(queue);
      runImport(queue[0].title);
    } else {
      const queue = [...selectedSuggestions].map((i) => suggestions[i].title);
      setSuggestQueue(queue);
      setWunsch(queue[0]);
      runGenerate(queue[0]);
    }
  }

  function handleDiscard() {
    setDraft(null);
    setSaveError(null);
    if (suggestQueue.length > 1) {
      advanceSuggestQueue();
      return;
    }
    if (importQueue.length > 1) {
      advanceImportQueue();
      return;
    }
    setSuggestQueue([]);
    setImportQueue([]);
    setPhase("form");
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
      if (suggestQueue.length > 1) {
        setSaving(false);
        advanceSuggestQueue();
        return;
      }
      if (importQueue.length > 1) {
        setSaving(false);
        advanceImportQueue();
        return;
      }
      navigate(`/rezept/${id}`);
    } catch {
      setSaveError("Speichern fehlgeschlagen. Bitte erneut versuchen.");
      setSaving(false);
    }
  }

  // The picking phase is shared by "surprise" and "import" modes — pick the right backing state.
  const pickingItems = mode === "import" ? importSuggestions : suggestions;
  const pickingSelected = mode === "import" ? selectedImports : selectedSuggestions;
  const setPickingSelected = mode === "import" ? setSelectedImports : setSelectedSuggestions;

  return (
    <div className="page">
      <div className="page-header">
        <h1>Generieren</h1>
      </div>

      <div
        style={{
          display: "flex",
          gap: 0,
          marginBottom: 20,
          background: "var(--elev)",
          borderRadius: "var(--r-md)",
          overflow: "hidden",
          border: "1px solid var(--line)",
        }}
      >
        {([
          ["generate", "Generieren"],
          ["surprise", "Überrasch mich!"],
          ["import", "Importieren"],
        ] as const).map(([m, label]) => (
          <button
            key={m}
            type="button"
            onClick={() => {
              if (phase === "form" || phase === "error") switchMode(m);
            }}
            style={{
              flex: 1,
              padding: "10px 0",
              fontSize: 13,
              fontWeight: 600,
              border: "none",
              cursor: "pointer",
              background: mode === m ? "var(--accent)" : "transparent",
              color: mode === m ? "#fff" : "var(--tx3)",
              opacity: phase !== "form" && phase !== "error" && mode !== m ? 0.4 : 1,
              pointerEvents: phase !== "form" && phase !== "error" && mode !== m ? "none" : "auto",
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {mode === "generate" && phase === "form" && (
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

          <SharedControls
            portionen={portionen}
            onChangePortionen={handlePortionenChange}
            extraGeraeteErlaubt={extraGeraeteErlaubt}
            onChangeExtraGeraete={setExtraGeraeteErlaubt}
          />

          <button type="submit" className="btn-accent" disabled={!wunsch.trim()}>
            Rezept generieren
          </button>
        </form>
      )}

      {mode === "surprise" && phase === "form" && (
        <div>
          <SharedControls
            portionen={portionen}
            onChangePortionen={handlePortionenChange}
            extraGeraeteErlaubt={extraGeraeteErlaubt}
            onChangeExtraGeraete={setExtraGeraeteErlaubt}
          />
          <button type="button" className="btn-accent" onClick={runSuggest} style={{ marginTop: 16 }}>
            Rezeptvorschläge laden
          </button>
        </div>
      )}

      {mode === "import" && phase === "form" && (
        <div>
          <textarea
            className="input"
            placeholder="URL oder Rezepttext einfügen…"
            value={importInput}
            onChange={(e) => setImportInput(e.target.value)}
            rows={6}
            autoFocus
            style={{ resize: "vertical", marginBottom: 16 }}
          />

          <SharedControls
            portionen={portionen}
            onChangePortionen={handlePortionenChange}
            extraGeraeteErlaubt={extraGeraeteErlaubt}
            onChangeExtraGeraete={setExtraGeraeteErlaubt}
          />

          <button
            type="button"
            className="btn-accent"
            disabled={!importInput.trim()}
            onClick={() => runImport()}
            style={{ marginTop: 16 }}
          >
            Rezept importieren
          </button>
        </div>
      )}

      {phase === "suggesting" && (
        <div className="card" style={{ padding: 20, textAlign: "center" }}>
          <p style={{ color: "var(--tx3)", fontSize: 14 }}>Suche Rezeptvorschläge aus deinem Vorrat…</p>
        </div>
      )}

      {phase === "picking" && (
        <div>
          <h2 style={{ fontSize: 16, marginBottom: 16 }}>Rezeptvorschläge</h2>
          {pickingItems.map((s, i) => (
            <button
              key={i}
              type="button"
              onClick={() =>
                setPickingSelected((prev) => {
                  const next = new Set(prev);
                  next.has(i) ? next.delete(i) : next.add(i);
                  return next;
                })
              }
              className="card"
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: 16,
                marginBottom: 10,
                border: pickingSelected.has(i) ? "2px solid var(--accent)" : "1px solid var(--line)",
                background: "var(--raise)",
                cursor: "pointer",
              }}
            >
              <div style={{ fontSize: 15, fontWeight: 600, color: "var(--tx)", marginBottom: 4 }}>{s.title}</div>
              <div style={{ fontSize: 13, color: "var(--tx3)" }}>{s.description}</div>
            </button>
          ))}
          <button
            type="button"
            className="btn-accent"
            disabled={pickingSelected.size === 0}
            onClick={confirmSuggestionPicking}
            style={{ marginTop: 8 }}
          >
            {pickingSelected.size === 1 ? "Rezept generieren" : `${pickingSelected.size} Rezepte generieren`}
          </button>
          <button type="button" className="btn-ghost" onClick={() => setPhase("form")} style={{ marginTop: 8 }}>
            Zurück
          </button>
        </div>
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
          <button
            type="button"
            className="btn-accent"
            onClick={() => retryRef.current()}
            style={{ marginBottom: 10 }}
          >
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

          {(suggestQueue.length > 1 || importQueue.length > 1) && (
            <p style={{ color: "var(--tx3)", fontSize: 13, margin: "16px 0 0" }}>
              {(() => {
                const remaining = (suggestQueue.length > 1 ? suggestQueue.length : importQueue.length) - 1;
                return remaining === 1 ? "Noch 1 weiteres Rezept" : `Noch ${remaining} weitere Rezepte`;
              })()}{" "}
              in der Warteschlange
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
