import { useEffect, useMemo, useRef, useState } from "react";
import type { TouchEvent } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { api, useRecipe } from "../api";
import { scaleQuantity } from "../../shared/scaling";
import { formatSeconds, formatTemp } from "../format";
import type { RecipeIngredient, RecipeStep } from "../../shared/types";

const RING_R = 82;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_R;
const SWIPE_THRESHOLD = 60;

/** Heuristic: does an ingredient's name (or its trailing-"n"-stripped form) appear in the step text? Case-insensitive. */
function nameAppearsIn(name: string, text: string): boolean {
  const n = name.toLowerCase();
  const t = text.toLowerCase();
  if (t.includes(n)) return true;
  if (n.length > 1 && n.endsWith("n") && t.includes(n.slice(0, -1))) return true;
  return false;
}

function stepIngredients(step: RecipeStep, ingredients: RecipeIngredient[]): RecipeIngredient[] {
  return ingredients.filter((ing) => nameAppearsIn(ing.name, step.text));
}

/** "M:SS" clock display for the countdown ring. */
function formatClock(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function ExitIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--tx3)" strokeWidth="2.5" strokeLinecap="round">
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  );
}

export default function Kochmodus() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: recipe, isLoading, error } = useRecipe(id);
  const [searchParams] = useSearchParams();

  const [stepIndex, setStepIndex] = useState(0);
  const [finished, setFinished] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [running, setRunning] = useState(false);
  const [flash, setFlash] = useState(false);
  const [ingredientsOpen, setIngredientsOpen] = useState(false);
  const [cookedState, setCookedState] = useState<"idle" | "saving" | "error">("idle");

  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);

  const steps = recipe?.steps ?? [];
  const step: RecipeStep | undefined = steps[stepIndex];

  const portionsParam = Number(searchParams.get("portionen"));
  const portions =
    Number.isFinite(portionsParam) && portionsParam > 0 ? portionsParam : recipe?.servings_base ?? 1;

  // Wake lock: keep the screen on while cooking. Guarded — unsupported/insecure contexts (Safari, http)
  // simply reject and we swallow the error; the app still works, it just won't hold the screen awake.
  useEffect(() => {
    let cancelled = false;
    async function acquire() {
      try {
        const sentinel = await navigator.wakeLock?.request("screen");
        if (cancelled) {
          sentinel?.release().catch(() => {});
          return;
        }
        wakeLockRef.current = sentinel ?? null;
      } catch {
        // ignore — not supported or rejected
      }
    }
    acquire();
    function onVisibilityChange() {
      if (document.visibilityState === "visible") acquire();
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      wakeLockRef.current?.release().catch(() => {});
      wakeLockRef.current = null;
    };
  }, []);

  // Reset the timer whenever the current step changes.
  useEffect(() => {
    setRemaining(step?.seconds ?? null);
    setRunning(false);
    setFlash(false);
    setIngredientsOpen(false);
  }, [stepIndex, step?.seconds]);

  // Countdown tick.
  useEffect(() => {
    if (!running || remaining == null || remaining <= 0) return;
    const t = setTimeout(() => setRemaining((r) => (r == null ? r : r - 1)), 1000);
    return () => clearTimeout(t);
  }, [running, remaining]);

  // Timer reached zero: vibrate + brief flash, then stop (timer is a helper, not a gate).
  useEffect(() => {
    if (!running || remaining !== 0) return;
    setRunning(false);
    setFlash(true);
    navigator.vibrate?.(400);
    const t = setTimeout(() => setFlash(false), 600);
    return () => clearTimeout(t);
  }, [running, remaining]);

  const matched = useMemo(
    () => (step ? stepIngredients(step, recipe?.ingredients ?? []) : []),
    [step, recipe?.ingredients],
  );

  if (isLoading) {
    return (
      <div className="page no-nav" style={{ background: "var(--cook-bg)" }}>
        <p style={{ color: "var(--tx3)" }}>Lädt…</p>
      </div>
    );
  }

  if (error || !recipe || steps.length === 0) {
    return (
      <div className="page no-nav" style={{ background: "var(--cook-bg)" }}>
        <p style={{ color: "var(--tx3)" }}>Rezept konnte nicht geladen werden.</p>
        <button className="btn-ghost" onClick={() => navigate(`/rezept/${id}`)} style={{ marginTop: 12 }}>
          Zurück
        </button>
      </div>
    );
  }

  function handleExit() {
    if (stepIndex > 0 && !window.confirm("Kochmodus beenden?")) return;
    navigate(`/rezept/${id}`);
  }

  function goNext() {
    if (stepIndex < steps.length - 1) setStepIndex((i) => i + 1);
    else setFinished(true);
  }
  function goPrev() {
    if (stepIndex > 0) setStepIndex((i) => i - 1);
  }

  function handleTouchStart(e: TouchEvent<HTMLDivElement>) {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  }
  function handleTouchEnd(e: TouchEvent<HTMLDivElement>) {
    if (touchStartX.current == null || touchStartY.current == null) return;
    const deltaX = e.changedTouches[0].clientX - touchStartX.current;
    const deltaY = e.changedTouches[0].clientY - touchStartY.current;
    touchStartX.current = null;
    touchStartY.current = null;
    if (Math.abs(deltaX) > SWIPE_THRESHOLD && Math.abs(deltaX) > Math.abs(deltaY) * 1.5) {
      if (deltaX < 0) goNext();
      else goPrev();
    }
  }

  function toggleRing() {
    if (!step || step.seconds == null || remaining == null) return;
    if (running || remaining === 0) {
      // Running (mid-countdown) or finished — a tap resets it. Skippable: the timer is a helper, not a gate.
      setRunning(false);
      setRemaining(step.seconds);
    } else {
      setRunning(true);
    }
  }

  async function handleAbbuchen() {
    setCookedState("saving");
    try {
      await api(`/api/recipes/${id}/cooked`, {
        method: "POST",
        body: JSON.stringify({ servings: Math.round(portions) }),
      });
      queryClient.invalidateQueries({ queryKey: ["pantry"] });
      queryClient.invalidateQueries({ queryKey: ["recipe", id] });
      navigate(`/rezept/${id}`);
    } catch {
      setCookedState("error");
    }
  }

  if (finished) {
    return (
      <div
        style={{
          background: "var(--cook-bg)",
          minHeight: "100vh",
          padding: "32px 20px 40px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
        }}
      >
        <h1 style={{ fontSize: 26, margin: "0 0 8px" }}>Guten Appetit!</h1>
        <p style={{ color: "var(--tx3)", fontSize: 15, margin: 0 }}>{recipe.title}</p>
        {cookedState === "error" && (
          <p style={{ color: "var(--accent)", fontSize: 13, marginTop: 16 }} role="alert">
            Vorrat konnte nicht aktualisiert werden. Bitte später erneut versuchen.
          </p>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 12, width: "100%", marginTop: 32 }}>
          <button className="btn-accent" onClick={handleAbbuchen} disabled={cookedState === "saving"}>
            {cookedState === "saving" ? "Speichert…" : "Zutaten aus Vorrat abbuchen"}
          </button>
          <button className="btn-ghost" onClick={() => navigate(`/rezept/${id}`)}>
            Schließen
          </button>
        </div>
      </div>
    );
  }

  const isTm6 = step.kind === "tm6";
  const hasTimer = step.seconds != null && remaining != null;

  return (
    <div
      style={{ background: "var(--cook-bg)", minHeight: "100vh", padding: "32px 20px 40px", display: "flex", flexDirection: "column" }}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* Header: step counter + segment progress + exit */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--tx)" }}>
            Schritt {stepIndex + 1} / {steps.length}
          </span>
          {recipe.offline && <span className="chip">Offline</span>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ display: "flex", gap: 5 }}>
            {steps.map((_, i) => (
              <div
                key={i}
                style={{
                  width: 20,
                  height: 3,
                  borderRadius: 2,
                  background: i <= stepIndex ? "var(--accent)" : "var(--line)",
                  opacity: i === stepIndex ? 0.4 : 1,
                }}
              />
            ))}
          </div>
          <button
            onClick={handleExit}
            aria-label="Kochmodus beenden"
            style={{ width: 28, height: 28, background: "none", border: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", padding: 0 }}
          >
            <ExitIcon />
          </button>
        </div>
      </div>

      {isTm6 ? (
        <>
          <div
            style={{
              background: "var(--raise)",
              border: "1px solid var(--line)",
              borderRadius: "var(--r-xl)",
              padding: "28px 16px",
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr",
              gap: 4,
              textAlign: "center",
              marginBottom: 16,
            }}
          >
            <div>
              <div style={{ fontSize: 34, fontWeight: 700, color: "var(--accent)" }}>
                {step.seconds != null ? formatSeconds(step.seconds) : "—"}
              </div>
              <div style={{ fontSize: 10, color: "var(--tx4)", marginTop: 6, textTransform: "uppercase", letterSpacing: 1.5 }}>Zeit</div>
            </div>
            <div>
              <div style={{ fontSize: 34, fontWeight: 700, color: "var(--accent)" }}>{formatTemp(step.temp)}</div>
              <div style={{ fontSize: 10, color: "var(--tx4)", marginTop: 6, textTransform: "uppercase", letterSpacing: 1.5 }}>
                Temperatur
              </div>
            </div>
            <div>
              <div style={{ fontSize: 34, fontWeight: 700, color: "var(--accent)" }}>{step.speed ?? "—"}</div>
              <div style={{ fontSize: 10, color: "var(--tx4)", marginTop: 6, textTransform: "uppercase", letterSpacing: 1.5 }}>Stufe</div>
            </div>
          </div>
          {(step.reverse || step.accessory || step.mode) && (
            <div style={{ display: "flex", gap: 8, justifyContent: "center", marginBottom: 16, flexWrap: "wrap" }}>
              {step.reverse && (
                <span className="chip" style={{ fontSize: 12 }}>
                  ↺ Linkslauf
                </span>
              )}
              {step.accessory && (
                <span className="chip" style={{ fontSize: 12 }}>
                  {step.accessory}
                </span>
              )}
              {step.mode && (
                <span className="chip" style={{ fontSize: 12 }}>
                  {step.mode}
                </span>
              )}
            </div>
          )}
          <p style={{ fontSize: 15, color: "var(--tx3)", margin: "0 0 20px", lineHeight: 1.5, textAlign: "center" }}>{step.text}</p>
        </>
      ) : (
        <>
          <div style={{ textAlign: "center", marginBottom: 16 }}>
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: 1,
                color: "var(--tx3)",
                background: "var(--line)",
                padding: "3px 8px",
                borderRadius: 6,
              }}
            >
              ✋ {step.device ?? "Manuell"}
            </span>
          </div>
          <p style={{ fontSize: 15, color: "var(--tx3)", margin: "0 0 20px", lineHeight: 1.5, textAlign: "center" }}>{step.text}</p>
        </>
      )}

      {matched.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <button
            type="button"
            onClick={() => setIngredientsOpen((o) => !o)}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              width: "100%",
              background: "none",
              border: "none",
              color: "var(--tx3)",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              padding: "8px 0",
            }}
          >
            Zutaten für diesen Schritt {ingredientsOpen ? "▲" : "▼"}
          </button>
          {ingredientsOpen && (
            <div style={{ background: "var(--raise)", border: "1px solid var(--line)", borderRadius: "var(--r-md)", padding: "4px 14px" }}>
              {matched.map((ing) => {
                const factor = portions / recipe.servings_base;
                const scaled = scaleQuantity(ing.quantity, ing.scaling, factor, ing.unit);
                return (
                  <div
                    key={ing.ingredient_id}
                    style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", fontSize: 14, borderBottom: "1px solid var(--line)" }}
                  >
                    <span style={{ color: "var(--tx2)" }}>{ing.name}</span>
                    <span style={{ color: "var(--accent)", fontWeight: 500 }}>
                      {scaled} {ing.unit}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {hasTimer && (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div
            onClick={toggleRing}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") toggleRing();
            }}
            aria-label={running ? "Timer zurücksetzen" : "Timer starten"}
            style={{ position: "relative", width: 180, height: 180, cursor: "pointer" }}
          >
            <svg width="180" height="180" viewBox="0 0 180 180">
              <circle cx="90" cy="90" r={RING_R} fill="none" stroke="var(--surface)" strokeWidth="4" />
              <circle
                cx="90"
                cy="90"
                r={RING_R}
                fill="none"
                stroke="var(--accent)"
                strokeWidth="4"
                strokeDasharray={RING_CIRCUMFERENCE}
                strokeDashoffset={RING_CIRCUMFERENCE * (1 - (remaining as number) / (step.seconds as number))}
                strokeLinecap="round"
                transform="rotate(-90 90 90)"
                className={flash ? "cook-ring-flash" : undefined}
              />
            </svg>
            <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
              <div style={{ fontSize: 44, fontWeight: 700, color: "var(--accent)", fontVariantNumeric: "tabular-nums" }}>
                {formatClock(remaining as number)}
              </div>
              <div style={{ fontSize: 10, color: "var(--tx4)", textTransform: "uppercase", letterSpacing: 1.5, marginTop: 2 }}>
                verbleibend
              </div>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 12, marginTop: "auto", paddingTop: 16 }}>
        <button
          onClick={goPrev}
          disabled={stepIndex === 0}
          style={{
            flex: 1,
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: "var(--r-md)",
            padding: 16,
            textAlign: "center",
            color: "var(--tx3)",
            fontSize: 16,
            fontWeight: 600,
            cursor: stepIndex === 0 ? "default" : "pointer",
            opacity: stepIndex === 0 ? 0.4 : 1,
          }}
        >
          Zurück
        </button>
        <button className="btn-accent" onClick={goNext} style={{ flex: 1 }}>
          Weiter →
        </button>
      </div>
    </div>
  );
}
