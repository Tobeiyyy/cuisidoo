import { Hono } from "hono";
import Anthropic from "@anthropic-ai/sdk";
import type { Env } from "./index";
import { buildSystemPrompt, type PantryPromptItem } from "./prompt";
import { qAll } from "./db";
import type { UnitDim } from "../shared/types";

export interface Suggestion {
  title: string;
  description: string;
}

export const suggestRoutes = new Hono<{ Bindings: Env }>().post("/", async (c) => {
  const { portionen, extraGeraeteErlaubt } = await c.req.json<{
    portionen: number; extraGeraeteErlaubt?: boolean;
  }>();
  if (!Number.isFinite(portionen) || portionen < 1) {
    return c.json({ error: "portionen muss ≥ 1 sein" }, 400);
  }

  const db = c.env.DB;
  const equipmentOwned = (await qAll<{ name: string }>(
    db.prepare("SELECT name FROM equipment WHERE owned=1"))).map((e) => e.name);
  const settings = Object.fromEntries((await qAll<{ key: string; value: string }>(
    db.prepare("SELECT key, value FROM settings"))).map((s) => [s.key, s.value]));
  const canonicalNames = (await qAll<{ name: string }>(
    db.prepare("SELECT name FROM ingredients ORDER BY name"))).map((i) => i.name);
  const pantryRows = await qAll<{ name: string; quantity: number; unit_dim: string; amountless: number }>(
    db.prepare(
      "SELECT i.name, p.quantity, i.unit_dim, p.amountless FROM pantry p " +
      "JOIN ingredients i ON i.id = p.ingredient_id ORDER BY i.name",
    ),
  );
  const pantry: PantryPromptItem[] = pantryRows.map((r) => ({
    name: r.name, quantity: r.quantity,
    unit_dim: r.unit_dim as UnitDim, amountless: !!r.amountless,
  }));

  const system = buildSystemPrompt({
    equipmentOwned, dietBias: settings.diet_bias ?? "", canonicalNames,
    extraGeraeteErlaubt: !!extraGeraeteErlaubt, pantry,
  });

  const client = new Anthropic({ apiKey: c.env.ANTHROPIC_API_KEY });
  try {
    const resp = await client.messages.create({
      model: settings.generation_model ?? "claude-sonnet-5",
      max_tokens: 1024,
      system,
      messages: [{
        role: "user",
        content: `Schlage genau 3 verschiedene TM6-Rezeptideen vor, die zu meinem Vorrat und meinen Präferenzen passen. Für ${portionen} Portionen. Gib nur Titel und eine kurze Beschreibung (1 Satz) pro Vorschlag.`,
      }],
      output_config: {
        format: {
          type: "json_schema",
          schema: {
            type: "object", additionalProperties: false,
            required: ["suggestions"],
            properties: {
              suggestions: {
                type: "array",
                items: {
                  type: "object", additionalProperties: false,
                  required: ["title", "description"],
                  properties: {
                    title: { type: "string" },
                    description: { type: "string" },
                  },
                },
              },
            },
          },
        },
      },
    });
    const textBlock = resp.content.find((b): b is Anthropic.TextBlock => b.type === "text");
    if (!textBlock) throw new Error("no text block");
    return c.json(JSON.parse(textBlock.text));
  } catch (err) {
    console.error("suggest: Anthropic API error", err instanceof Error ? err.message : err);
    return c.json({ error: "Vorschläge konnten nicht generiert werden." }, 502);
  }
});
