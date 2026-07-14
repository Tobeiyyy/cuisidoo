import { Hono } from "hono";
import Anthropic from "@anthropic-ai/sdk";
import type { Env } from "./index";
import { buildSystemPrompt, SAVE_RECIPE_TOOL } from "./prompt";
import { qAll } from "./db";

export const generateRoutes = new Hono<{ Bindings: Env }>().post("/", async (c) => {
  const { wunsch, portionen, extraGeraeteErlaubt } = await c.req.json<{
    wunsch: string; portionen: number; extraGeraeteErlaubt?: boolean;
  }>();

  const db = c.env.DB;
  const equipmentOwned = (await qAll<{ name: string }>(
    db.prepare("SELECT name FROM equipment WHERE owned=1"))).map((e) => e.name);
  const settings = Object.fromEntries((await qAll<{ key: string; value: string }>(
    db.prepare("SELECT key, value FROM settings"))).map((s) => [s.key, s.value]));
  const canonicalNames = (await qAll<{ name: string }>(
    db.prepare("SELECT name FROM ingredients ORDER BY name"))).map((i) => i.name);

  const client = new Anthropic({ apiKey: c.env.ANTHROPIC_API_KEY });
  const system = buildSystemPrompt({
    equipmentOwned, dietBias: settings.diet_bias ?? "", canonicalNames,
    extraGeraeteErlaubt: !!extraGeraeteErlaubt,
  });
  const tools: any[] = [
    { type: "web_search_20260209", name: "web_search", max_uses: 5 },
    SAVE_RECIPE_TOOL,
  ];
  let messages: Anthropic.MessageParam[] = [{
    role: "user",
    content: `Rezeptwunsch: ${wunsch}\nPortionen: ${portionen}`,
  }];

  for (let attempt = 0; attempt < 6; attempt++) {
    const resp = await client.messages.create({
      model: settings.generation_model ?? "claude-sonnet-5",
      max_tokens: 16000,
      system, tools, messages,
    });
    const toolUse = resp.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === "save_recipe");
    if (toolUse) return c.json(toolUse.input);   // RecipeSaveInput draft

    messages = [...messages, { role: "assistant", content: resp.content }];
    if (resp.stop_reason === "pause_turn") continue;               // server tool resumes
    if (resp.stop_reason === "refusal") return c.json({ error: "Anfrage abgelehnt" }, 422);
    // end_turn without save_recipe → nudge once more
    messages = [...messages, {
      role: "user",
      content: "Bitte gib das Rezept jetzt genau einmal über das Tool save_recipe aus.",
    }];
  }
  return c.json({ error: "Generierung fehlgeschlagen (kein save_recipe)" }, 502);
});
