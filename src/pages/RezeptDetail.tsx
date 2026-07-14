import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { api, useRecipe } from "../api";
import RecipeBody from "../components/RecipeBody";

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

export default function RezeptDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: recipe, isLoading, error } = useRecipe(id);
  const [portionsOverride, setPortionsOverride] = useState<number | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const portions = portionsOverride ?? recipe?.servings_base ?? 1;

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
    queryClient.removeQueries({ queryKey: ["recipe", id] });
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
          background: "linear-gradient(135deg,var(--hero-grad-a) 0%,var(--hero-grad-b) 100%)",
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
              background: "var(--overlay-bg)",
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
                background: "var(--overlay-bg)",
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
                background: "var(--overlay-bg)",
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
              onClick={() => setPortionsOverride(Math.max(1, portions - 1))}
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
              onClick={() => setPortionsOverride(Math.min(24, portions + 1))}
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

        <RecipeBody
          ingredients={recipe.ingredients}
          steps={recipe.steps}
          servingsBase={recipe.servings_base}
          portions={portions}
        />

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
