import { Hono } from "hono";
import Anthropic from "@anthropic-ai/sdk";
import type { Env } from "./index";
import { qAll } from "./db";
import { normalizeName, matchIngredient } from "./ingredients";

/**
 * Spreading a whole photo's bytes into String.fromCharCode blows V8's argument limit
 * (~65k), so encode in chunks.
 */
export function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export interface ScannedItem {
  receipt_name: string;
  matched_name: string | null;
  ingredient_id: number | null;
  quantity: number;
  unit_dim: string;
  category: string;
}

const SCAN_SCHEMA = {
  type: "object" as const,
  additionalProperties: false,
  required: ["items"],
  properties: {
    items: {
      type: "array" as const,
      items: {
        type: "object" as const,
        additionalProperties: false,
        required: ["receipt_name", "quantity", "unit_dim", "category"],
        properties: {
          receipt_name: { type: "string" as const },
          quantity: { type: "number" as const },
          unit_dim: { type: "string" as const, enum: ["mass", "volume", "count"] },
          category: {
            type: "string" as const,
            enum: [
              "Gemüse & Obst", "Fleisch & Fisch", "Milchprodukte", "Grundnahrungsmittel",
              "Gewürze", "Tiefkühl", "Getränke", "Sonstiges",
            ],
          },
        },
      },
    },
  },
};

export const scanRoutes = new Hono<{ Bindings: Env }>().post("/", async (c) => {
  const contentType = c.req.header("content-type") ?? "";
  if (!contentType.startsWith("image/")) {
    return c.json({ error: "Content-Type muss ein Bild sein" }, 400);
  }
  const mediaType = contentType.split(";")[0].trim() as "image/jpeg" | "image/png" | "image/webp";
  if (!["image/jpeg", "image/png", "image/webp"].includes(mediaType)) {
    return c.json({ error: "Nur JPEG, PNG oder WebP erlaubt" }, 400);
  }

  const body = await c.req.arrayBuffer();
  if (body.byteLength > 5 * 1024 * 1024) {
    return c.json({ error: "Bild zu groß (max 5 MB)" }, 400);
  }

  const base64 = toBase64(body);

  const db = c.env.DB;
  const ingredients = await qAll<{ id: number; name: string; unit_dim: string; category: string; grams_per_piece: number | null }>(
    db.prepare("SELECT id, name, unit_dim, category, grams_per_piece FROM ingredients ORDER BY name"));
  const aliases = await qAll<{ alias: string; ingredient_id: number }>(
    db.prepare("SELECT alias, ingredient_id FROM ingredient_aliases"));

  const catalogList = ingredients.map((i) => i.name).join(", ");

  const settings = Object.fromEntries(
    (await qAll<{ key: string; value: string }>(db.prepare("SELECT key, value FROM settings")))
      .map((s) => [s.key, s.value]));

  const client = new Anthropic({ apiKey: c.env.ANTHROPIC_API_KEY });

  try {
    const resp = await client.messages.create({
      model: settings.generation_model ?? "claude-sonnet-5",
      max_tokens: 4096,
      messages: [{
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: mediaType, data: base64 },
          },
          {
            type: "text",
            text: `Du siehst einen Kassenbon / Einkaufszettel. Extrahiere alle Lebensmittel-Artikel mit Mengen.

Regeln:
- Ignoriere Non-Food-Artikel (Putzmittel, Hygiene, etc.)
- Übersetze Marken-/Kurzbezeichnungen in generische Zutatennamen (z.B. "Bio H-Milch 1L" → "Milch", quantity: 1000, unit_dim: "volume")
- Für Gewichtsangaben: quantity in Gramm, unit_dim: "mass"
- Für Volumen: quantity in Milliliter, unit_dim: "volume"
- Für Stückware: quantity als Anzahl, unit_dim: "count"
- Wenn keine Menge erkennbar: schätze basierend auf der üblichen Packungsgröße
- category: eine von "Gemüse & Obst", "Fleisch & Fisch", "Milchprodukte", "Grundnahrungsmittel", "Gewürze", "Tiefkühl", "Getränke", "Sonstiges"

Bekannte Zutaten im System (nutze diese Namen wenn möglich):
${catalogList}`,
          },
        ],
      }],
      output_config: {
        format: { type: "json_schema", schema: SCAN_SCHEMA },
      },
    });

    const textBlock = resp.content.find((b): b is Anthropic.TextBlock => b.type === "text");
    if (!textBlock) throw new Error("no text block");
    const parsed = JSON.parse(textBlock.text) as { items: Array<{ receipt_name: string; quantity: number; unit_dim: string; category: string }> };

    const byName = new Map(ingredients.map((i) => [normalizeName(i.name), i.id]));
    const byAlias = new Map(aliases.map((a) => [normalizeName(a.alias), a.ingredient_id]));
    const ingredientMap = new Map(ingredients.map((i) => [i.id, i]));

    const items: ScannedItem[] = parsed.items
      .filter((raw) => raw.quantity > 0)
      .map((raw) => {
        const id = matchIngredient(raw.receipt_name, byName, byAlias);
        const matched = id ? ingredientMap.get(id) : null;
        // The pantry stores quantities in the catalog ingredient's dimension, so a scanned
        // amount in a different dimension must be converted (via grams_per_piece when known)
        // or it would be stored as-is under the wrong unit (e.g. 200 g becoming 200 Stück).
        let quantity = raw.quantity;
        if (matched && matched.unit_dim !== raw.unit_dim && matched.grams_per_piece) {
          if (raw.unit_dim === "mass" && matched.unit_dim === "count") {
            quantity = Math.max(1, Math.round(raw.quantity / matched.grams_per_piece));
          } else if (raw.unit_dim === "count" && matched.unit_dim === "mass") {
            quantity = raw.quantity * matched.grams_per_piece;
          }
        }
        return {
          receipt_name: raw.receipt_name,
          matched_name: matched?.name ?? null,
          ingredient_id: id,
          quantity,
          unit_dim: matched?.unit_dim ?? raw.unit_dim,
          category: matched?.category ?? raw.category,
        };
      });

    return c.json({ items });
  } catch (err) {
    console.error("scan: Anthropic API error", err instanceof Error ? err.message : err);
    return c.json({ error: "Kassenbon konnte nicht gelesen werden." }, 502);
  }
});
