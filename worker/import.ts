import { Hono } from "hono";
import Anthropic from "@anthropic-ai/sdk";
import type { Env } from "./index";
import { buildImportPrompt, SAVE_RECIPE_TOOL, type PantryPromptItem } from "./prompt";
import { qAll } from "./db";
import type { UnitDim } from "../shared/types";

export const importRoutes = new Hono<{ Bindings: Env }>().post("/", async (c) => {
  const { input, portionen, extraGeraeteErlaubt, selectedTitle } = await c.req.json<{
    input: string; portionen: number; extraGeraeteErlaubt?: boolean; selectedTitle?: string;
  }>();
  if (!input?.trim()) return c.json({ error: "Eingabe ist erforderlich" }, 400);
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

  const isUrl = /^https?:\/\//i.test(input.trim());
  const system = buildImportPrompt({
    equipmentOwned, canonicalNames,
    extraGeraeteErlaubt: !!extraGeraeteErlaubt, pantry,
  });

  const client = new Anthropic({ apiKey: c.env.ANTHROPIC_API_KEY });

  // Multi-recipe detection pass (no selectedTitle yet)
  if (!selectedTitle) {
    const multiCheckResp = await client.messages.create({
      model: settings.generation_model ?? "claude-sonnet-5",
      max_tokens: 1024,
      system: "Analysiere den folgenden Text. Enthält er mehrere verschiedene Rezepte? Wenn ja, liste Titel und eine kurze Beschreibung für jedes. Wenn nur ein Rezept enthalten ist, setze multi auf false.",
      messages: [{ role: "user", content: input.trim() }],
      output_config: {
        format: {
          type: "json_schema",
          schema: {
            type: "object", additionalProperties: false,
            required: ["multi", "suggestions"],
            properties: {
              multi: { type: "boolean" },
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
    const textBlock = multiCheckResp.content.find((b): b is Anthropic.TextBlock => b.type === "text");
    if (textBlock) {
      const parsed = JSON.parse(textBlock.text);
      if (parsed.multi && parsed.suggestions.length > 1) {
        return c.json(parsed);
      }
    }
  }

  // Single recipe import (or selected from multi)
  const userContent = selectedTitle
    ? `Wandle folgendes Rezept für den TM6 um (nur das Rezept "${selectedTitle}"):\n\n${input.trim()}\n\nPortionen: ${portionen}`
    : `Wandle folgendes Rezept für den TM6 um:\n\n${input.trim()}\n\nPortionen: ${portionen}`;

  const tools: any[] = isUrl
    ? [{ type: "web_search_20260209", name: "web_search", max_uses: 3 }, SAVE_RECIPE_TOOL]
    : [SAVE_RECIPE_TOOL];

  let messages: Anthropic.MessageParam[] = [{ role: "user", content: userContent }];

  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const resp = await client.messages.create({
        model: settings.generation_model ?? "claude-sonnet-5",
        max_tokens: 16000,
        system, tools, messages,
      });
      const toolUse = resp.content.find(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === "save_recipe");
      if (toolUse) {
        const recipe = toolUse.input as any;
        if (!recipe.tags) recipe.tags = [];
        if (!recipe.tags.includes("Importiert")) recipe.tags.push("Importiert");
        return c.json(recipe);
      }
      messages = [...messages, { role: "assistant", content: resp.content }];
      if (resp.stop_reason === "pause_turn") continue;
      if (resp.stop_reason === "refusal") return c.json({ error: "Anfrage abgelehnt" }, 422);
      messages = [...messages, {
        role: "user",
        content: "Bitte gib das umgewandelte Rezept jetzt genau einmal über das Tool save_recipe aus.",
      }];
    } catch (err) {
      console.error("import: Anthropic API error", err instanceof Error ? err.message : err);
      return c.json({ error: "Import fehlgeschlagen. Bitte erneut versuchen." }, 502);
    }
  }
  return c.json({ error: "Import fehlgeschlagen (kein save_recipe)" }, 502);
});
