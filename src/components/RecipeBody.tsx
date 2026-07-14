import { scaleQuantity } from "../../shared/scaling";
import { formatSeconds, formatTemp } from "../format";
import type { RecipeStep, Scaling } from "../../shared/types";

/** Minimal ingredient shape needed for rendering — satisfied by both a saved
 * Recipe's RecipeIngredient[] and a generation draft's ingredient rows (no ingredient_id/position yet). */
export interface RecipeBodyIngredient {
  name: string;
  quantity: number;
  unit: string;
  scaling: Scaling;
}

/** A step without its position — satisfied by both saved RecipeStep[] and a generation draft's steps. */
export type RecipeBodyStep = Omit<RecipeStep, "position">;

interface RecipeBodyProps {
  ingredients: RecipeBodyIngredient[];
  steps: RecipeBodyStep[];
  /** Base servings the quantities/steps were written for. */
  servingsBase: number;
  /** Servings to scale ingredient quantities to. */
  portions: number;
}

function StepView({ step, index }: { step: RecipeBodyStep; index: number }) {
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

/** Renders the Zutaten (scaled) and Zubereitung sections shared by RezeptDetail (saved Recipe)
 * and the Generieren preview (RecipeSaveInput draft, no ids yet). */
export default function RecipeBody({ ingredients, steps, servingsBase, portions }: RecipeBodyProps) {
  const factor = portions / servingsBase;

  return (
    <>
      <h2 style={{ fontSize: 18, margin: "0 0 12px" }}>Zutaten</h2>
      {ingredients.map((ing, i) => {
        const scaled = scaleQuantity(ing.quantity, ing.scaling, factor, ing.unit);
        const showHint = ing.scaling === "damped" && factor !== 1;
        return (
          <div
            key={i}
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

      <h2 style={{ fontSize: 18, margin: "32px 0 16px" }}>Zubereitung</h2>
      {steps.map((step, i) => (
        <StepView key={i} step={step} index={i} />
      ))}
    </>
  );
}
