import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";

interface RecipeListItem {
  id: number;
  title: string;
  total_time_min: number | null;
  favorite: boolean;
  image_key: string | null;
  tags: string[];
  cookable: boolean;
}

type Filter = { kind: "all" } | { kind: "favorite" } | { kind: "cookable" } | { kind: "tag"; tag: string };

// Decorative placeholder-card gradients, values lifted directly from mockup 2a (not part of the design token system).
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

function PlusIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function SettingsGearIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
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

function StarIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill={filled ? "var(--accent)" : "none"}
      stroke={filled ? "var(--accent)" : "var(--tx3)"}
      strokeWidth="2"
    >
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  );
}

export default function Rezepte() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchInput, setSearchInput] = useState("");
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>({ kind: "all" });

  useEffect(() => {
    const t = setTimeout(() => setQ(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const allRecipes = useQuery({
    queryKey: ["recipes", "all"],
    queryFn: () => api<RecipeListItem[]>("/api/recipes"),
  });

  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (filter.kind === "favorite") params.set("favorite", "1");
  if (filter.kind === "cookable") params.set("cookable", "1");
  if (filter.kind === "tag") params.set("tag", filter.tag);

  const filtered = useQuery({
    queryKey: ["recipes", params.toString()],
    queryFn: () => api<RecipeListItem[]>(`/api/recipes?${params.toString()}`),
  });

  const availableTags = useMemo(() => {
    const set = new Set<string>();
    for (const r of allRecipes.data ?? []) for (const t of r.tags) set.add(t);
    return [...set].sort();
  }, [allRecipes.data]);

  async function toggleFavorite(e: React.MouseEvent, recipe: RecipeListItem) {
    e.preventDefault();
    e.stopPropagation();
    await api(`/api/recipes/${recipe.id}/favorite`, {
      method: "PATCH",
      body: JSON.stringify({ favorite: !recipe.favorite }),
    });
    queryClient.invalidateQueries({ queryKey: ["recipes"] });
  }

  const libraryIsEmpty = allRecipes.isSuccess && allRecipes.data.length === 0;
  const recipes = filtered.data ?? [];

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="eyebrow">Guten Abend</div>
          <h1>Meine Rezepte</h1>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Link to="/neu" className="icon-btn" aria-label="Neues Rezept">
            <PlusIcon />
          </Link>
          <Link to="/einstellungen" className="icon-btn" aria-label="Einstellungen">
            <SettingsGearIcon />
          </Link>
        </div>
      </div>

      <div className="input" style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <SearchIcon />
        <input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Rezept suchen…"
          aria-label="Rezept suchen"
          style={{ border: "none", background: "none", outline: "none", color: "var(--tx)", font: "inherit", flex: 1 }}
        />
      </div>

      <div style={{ display: "flex", gap: 8, overflowX: "auto", marginBottom: 24, paddingBottom: 2 }}>
        <button
          className={`tag-pill${filter.kind === "all" ? " active" : ""}`}
          style={{ cursor: "pointer" }}
          onClick={() => setFilter({ kind: "all" })}
        >
          Alle
        </button>
        {availableTags.map((tag) => (
          <button
            key={tag}
            className={`tag-pill${filter.kind === "tag" && filter.tag === tag ? " active" : ""}`}
            style={{ cursor: "pointer" }}
            onClick={() => setFilter({ kind: "tag", tag })}
          >
            {tag}
          </button>
        ))}
        <button
          className={`tag-pill${filter.kind === "favorite" ? " active" : ""}`}
          style={{ cursor: "pointer" }}
          onClick={() => setFilter({ kind: "favorite" })}
        >
          Favoriten
        </button>
        <button
          className={`tag-pill${filter.kind === "cookable" ? " active" : ""}`}
          style={{ cursor: "pointer" }}
          onClick={() => setFilter({ kind: "cookable" })}
        >
          Kochbar
        </button>
      </div>

      {libraryIsEmpty && (
        <div style={{ textAlign: "center", padding: "40px 12px", color: "var(--tx3)" }}>
          <p style={{ marginBottom: 16 }}>Noch keine Rezepte — generiere dein erstes!</p>
          <Link to="/generieren" className="btn-accent" style={{ display: "inline-block", width: "auto", padding: "12px 24px" }}>
            Rezept generieren
          </Link>
        </div>
      )}

      {!libraryIsEmpty && filtered.isSuccess && recipes.length === 0 && (
        <p style={{ textAlign: "center", color: "var(--tx3)", padding: "24px 0" }}>Keine Treffer für diese Auswahl.</p>
      )}

      {!libraryIsEmpty && recipes.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {recipes.map((r) => (
            <div
              key={r.id}
              className="card"
              style={{ overflow: "hidden", cursor: "pointer", display: "flex", gap: 12, padding: 0 }}
              onClick={() => navigate(`/rezept/${r.id}`)}
            >
              <div
                style={{
                  width: 88,
                  height: 88,
                  flexShrink: 0,
                  background: gradientFor(r.id),
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <span style={{ fontSize: 22, fontWeight: 700, color: "var(--tx4)" }}>{r.title.charAt(0)}</span>
              </div>
              <div style={{ flex: 1, minWidth: 0, padding: "12px 12px 12px 0", display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "var(--tx)", lineHeight: 1.3 }}>{r.title}</div>
                  <button
                    onClick={(e) => toggleFavorite(e, r)}
                    aria-label={r.favorite ? "Favorit entfernen" : "Als Favorit markieren"}
                    style={{ background: "none", border: "none", cursor: "pointer", padding: 2, flexShrink: 0 }}
                  >
                    <StarIcon filled={r.favorite} />
                  </button>
                </div>
                {r.total_time_min != null && (
                  <div style={{ fontSize: 11, color: "var(--tx4)" }}>{r.total_time_min} Min</div>
                )}
                {r.tags.length > 0 && (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {r.tags.map((t) => (
                      <span key={t} style={{ fontSize: 10, color: "var(--tx3)", border: "1px solid var(--border)", borderRadius: 6, padding: "2px 6px" }}>
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
