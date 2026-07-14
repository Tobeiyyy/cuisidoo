import { isInformalUnit, type Scaling } from "./types";

export function roundQuantity(q: number, unit: string): number {
  if (unit === "Stück") return Math.round(q * 2) / 2;   // halves of a piece
  if (unit === "g" || unit === "ml") {
    return q >= 100 ? Math.round(q / 5) * 5 : Math.round(q);
  }
  return Math.round(q * 100) / 100;
}

export function scaleQuantity(quantity: number, scaling: Scaling, factor: number, unit: string): number {
  if (isInformalUnit(unit) || scaling === "fixed" || factor === 1) return quantity;
  const raw = scaling === "damped" ? quantity * Math.pow(factor, 0.6) : quantity * factor;
  if (unit === "Stück") return Math.max(1, Math.round(raw)); // whole pieces when scaling
  return roundQuantity(raw, unit);
}
