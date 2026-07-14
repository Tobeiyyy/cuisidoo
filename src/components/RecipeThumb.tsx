import { useState } from "react";

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

/**
 * Square/rounded recipe thumbnail used by the library list and the weekly-plan entry cards. Shows
 * the uploaded photo (Task 18) when `image_key` is set; falls back to the initial-letter gradient
 * placeholder both when there's no photo and when the photo fails to load (e.g. offline — images
 * aren't cached by the PWA's offline mirror, so a stale/missing R2 object degrades gracefully).
 */
export default function RecipeThumb({
  recipe, size, fontSize, radius,
}: {
  recipe: { id: number; title: string; image_key: string | null };
  size: number;
  fontSize: number;
  radius?: number | string;
}) {
  const [broken, setBroken] = useState(false);
  const showImage = !!recipe.image_key && !broken;
  return (
    <div
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: radius,
        overflow: "hidden",
        background: showImage ? "var(--surface)" : gradientFor(recipe.id),
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {showImage ? (
        <img
          src={`/api/images/${recipe.image_key}`}
          alt=""
          onError={() => setBroken(true)}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      ) : (
        <span style={{ fontSize, fontWeight: 700, color: "var(--tx4)" }}>{recipe.title.charAt(0)}</span>
      )}
    </div>
  );
}
