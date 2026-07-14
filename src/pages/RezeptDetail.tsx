import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { api, useRecipe } from "../api";
import { scaleQuantity } from "../../shared/scaling";
import { formatSeconds, formatTemp } from "../format";
import type { RecipeStep } from "../../shared/types";

function BackIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--tx)" strokeWidth="2.5" strokeLinecap="round">
      <path d="M15 18l-6-6 6-6" />
    </svg>
  );
}

function BookmarkIcon({ filled }: { filled: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill={filled ? "var(--accent)" : "none"} stroke={filled ? "var(--accent)" : "var(--tx)"} strokeWidth="2">
      <path d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--tx)" strokeWidth="2">
      <circle cx="12" cy="6" r="1.5" />
      <circle cx="12" cy="12" r="1.5" />
      <circle cx="12" cy="18" r="1.5" />
    </svg>
  );
}

function StepView({ step, index }: { step: RecipeStep; index: number }) {
  const isTm6 = step.kind === "tm6";
  return (
    <div
      style={
        isTm6
          ? { marginBottom: 20 }
          : { marginBottom: 20, padding: 16, background: "var(--elev)", border: "1px solid var(--line)", borderRadius: "var(--r-lg)" }
      }
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: isTm6 ? 10 : 8 }}>
        <span style={{ fontSize: 36, fontWeight: 700, color: isTm6 ? "var(--accent)" : "var(--border2)", lineHeight: 1 }}>
          {index + 1}
        </span>
        {isTm6 ? (
          <span style={{ fontSize: 15, color: "var(--tx2)", lineHeight: 1.4 }}>{step.text}</span>
        ) : (
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
        )}
      </div>
      {isTm6 ? (
        <>
          <div className="tm6-grid">
            <div>
              <div className="tm6-value">{step.seconds != null ? formatSeconds(step.seconds) : "—"}</div>
              <div className="tm6-label">Zeit</div>
            </div>
            <div>
              <div className="tm6-value">{formatTemp(step.temp)}</div>
              <div className="tm6-label">Temperatur</div>
            </div>
            <div>
              <div className="tm6-value">{step.speed ?? "—"}</div>
              <div className="tm6-label">Stufe</div>
            </div>
          </div>
          {(step.reverse || step.accessory || step.mode) && (
            <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
              {step.reverse && <span className="chip">↺ Linkslauf</span>}
              {step.accessory && <span className="chip">{step.accessory}</span>}
              {step.mode && <span className="chip">{step.mode}</span>}
            </div>
          )}
        </>
      ) : (
        <p style={{ fontSize: 15, color: "var(--tx3)", margin: 0, lineHeight: 1.5 }}>{step.text}</p>
      )}
    </div>
  );
}

export default function RezeptDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: recipe, isLoading, error } = useRecipe(id);
  const [portions, setPortions] = useState(1);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (recipe) setPortions(recipe.servings_base);
  }, [recipe?.id, recipe?.servings_base]);

  if (isLoading) {
    return (
      <div className="page">
        <p style={{ color: "var(--tx3)" }}>Lädt…</p>
      </div>
    );
  }

  if (error || !recipe) {
    return (
      <div className="page">
        <p style={{ color: "var(--tx3)" }}>Rezept konnte nicht geladen werden.</p>
        <Link to="/" className="btn-ghost" style={{ marginTop: 12 }}>
          Zurück zur Übersicht
        </Link>
      </div>
    );
  }

  const factor = portions / recipe.servings_base;

  async function toggleFavorite() {
    if (!recipe) return;
    await api(`/api/recipes/${recipe.id}/favorite`, {
      method: "PATCH",
      body: JSON.stringify({ favorite: !recipe.favorite }),
    });
    queryClient.invalidateQueries({ queryKey: ["recipe", id] });
    queryClient.invalidateQueries({ queryKey: ["recipes"] });
  }

  async function handleDelete() {
    if (!recipe) return;
    if (!confirm(`"${recipe.title}" wirklich löschen?`)) return;
    await api(`/api/recipes/${recipe.id}`, { method: "DELETE" });
    queryClient.invalidateQueries({ queryKey: ["recipes"] });
    navigate("/");
  }

  return (
    <div className="page" style={{ padding: 0, paddingBottom: "calc(96px + env(safe-area-inset-bottom, 0px))" }}>
      {/* Hero */}
      <div
        style={{
          position: "relative",
          height: 240,
          background: "linear-gradient(135deg,#1E1E20 0%,#141416 100%)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <span style={{ fontSize: 13, color: "var(--tx4)" }}>{recipe.image_key ? "" : "Foto folgt"}</span>
        <div style={{ position: "absolute", top: 20, left: 16, right: 16, display: "flex", justifyContent: "space-between" }}>
          <button
            onClick={() => navigate(-1)}
            aria-label="Zurück"
            style={{
              width: 44,
              height: 44,
              background: "rgba(28,28,30,.85)",
              border: "1px solid var(--border)",
              borderRadius: 22,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
            }}
          >
            <BackIcon />
          </button>
          <div style={{ display: "flex", gap: 8, position: "relative" }}>
            <button
              onClick={toggleFavorite}
              aria-label={recipe.favorite ? "Favorit entfernen" : "Als Favorit markieren"}
              style={{
                width: 44,
                height: 44,
                background: "rgba(28,28,30,.85)",
                border: "1px solid var(--border)",
                borderRadius: 22,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
              }}
            >
              <BookmarkIcon filled={recipe.favorite} />
            </button>
            <button
              onClick={() => setMenuOpen((o) => !o)}
              aria-label="Mehr Optionen"
              style={{
                width: 44,
                height: 44,
                background: "rgba(28,28,30,.85)",
                border: "1px solid var(--border)",
                borderRadius: 22,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
              }}
            >
              <MoreIcon />
            </button>
            {menuOpen && (
              <div className="card" style={{ position: "absolute", top: 50, right: 0, minWidth: 160, padding: 6, zIndex: 10 }}>
                <Link
                  to={`/rezept/${recipe.id}/bearbeiten`}
                  style={{ display: "block", padding: "10px 12px", color: "var(--tx)", fontSize: 14, textDecoration: "none" }}
                >
                  Bearbeiten
                </Link>
                <button
                  onClick={handleDelete}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    padding: "10px 12px",
                    background: "none",
                    border: "none",
                    color: "var(--accent)",
                    fontSize: 14,
                    cursor: "pointer",
                  }}
                >
                  Löschen
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      <div style={{ padding: "24px 20px 40px" }}>
        <h1 style={{ fontSize: 24, margin: "0 0 10px", lineHeight: 1.25 }}>{recipe.title}</h1>
        <div style={{ display: "flex", gap: 16, alignItems: "center", color: "var(--tx3)", fontSize: 14, marginBottom: 20 }}>
          {recipe.total_time_min != null && <span>{recipe.total_time_min} Min</span>}
          <span>·</span>
          <span>{portions} Portionen</span>
        </div>

        {/* Portion stepper */}
        <div
          className="card"
          style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", marginBottom: 28 }}
        >
          <span style={{ fontSize: 15, color: "var(--tx)", fontWeight: 500 }}>Portionen</span>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <button
              onClick={() => setPortions((p) => Math.max(1, p - 1))}
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
              {portions}
            </span>
            <button
              onClick={() => setPortions((p) => Math.min(24, p + 1))}
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

        {/* Zutaten */}
        <h2 style={{ fontSize: 18, margin: "0 0 12px" }}>Zutaten</h2>
        {recipe.ingredients.map((ing) => {
          const scaled = scaleQuantity(ing.quantity, ing.scaling, factor, ing.unit);
          const showHint = ing.scaling === "damped" && factor !== 1;
          return (
            <div
              key={ing.position}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
                padding: "12px 0",
                borderBottom: "1px solid var(--line)",
              }}
            >
              <div style={{ fontSize: 15, color: "var(--tx2)" }}>
                {ing.name}
                {showHint && <span style={{ display: "block", fontSize: 11, color: "var(--tx4)" }}>nach Geschmack</span>}
              </div>
              <div style={{ fontSize: 15, color: "var(--accent)", whiteSpace: "nowrap", marginLeft: 16, fontWeight: 500 }}>
                {scaled} {ing.unit}
              </div>
            </div>
          );
        })}

        {/* Zubereitung */}
        <h2 style={{ fontSize: 18, margin: "32px 0 16px" }}>Zubereitung</h2>
        {recipe.steps.map((step, i) => (
          <StepView key={step.position} step={step} index={i} />
        ))}

        {/* Nutrition placeholder */}
        <div className="card" style={{ padding: 16, marginBottom: 28, color: "var(--tx3)", fontSize: 14 }}>
          Nährwerte folgen in Kürze.
        </div>

        <Link to={`/rezept/${recipe.id}/kochen`} className="btn-accent" style={{ textDecoration: "none" }}>
          Kochen starten
        </Link>
      </div>
    </div>
  );
}
