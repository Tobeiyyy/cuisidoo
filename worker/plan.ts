import { Hono } from "hono";
import type { Env } from "./index";
import { qAll } from "./db";

const SLOTS = ["mittag", "abend", "sonstiges"] as const;
type Slot = (typeof SLOTS)[number];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface PlanEntry {
  id: number;
  date: string;
  slot: Slot;
  recipe_id: number;
  servings: number;
  title: string;
  image_key: string | null;
}

export const planRoutes = new Hono<{ Bindings: Env }>()
  .get("/", async (c) => {
    const { from, to } = c.req.query();
    if (!from || !to || !DATE_RE.test(from) || !DATE_RE.test(to)) {
      return c.json({ error: "from and to must be YYYY-MM-DD" }, 400);
    }
    const rows = await qAll<PlanEntry>(c.env.DB.prepare(
      "SELECT pe.id, pe.date, pe.slot, pe.recipe_id, pe.servings, r.title, r.image_key " +
      "FROM plan_entries pe JOIN recipes r ON r.id = pe.recipe_id " +
      "WHERE pe.date >= ? AND pe.date <= ? ORDER BY pe.date, pe.slot",
    ).bind(from, to));
    return c.json(rows);
  })
  .post("/", async (c) => {
    const { date, slot, recipe_id, servings } = await c.req.json<{
      date: string; slot: string; recipe_id: number; servings: number;
    }>();
    if (!date || !DATE_RE.test(date)) return c.json({ error: "date must be YYYY-MM-DD" }, 400);
    if (!SLOTS.includes(slot as Slot)) return c.json({ error: "invalid slot" }, 400);
    if (!Number.isInteger(servings) || servings < 1) return c.json({ error: "servings must be >= 1" }, 400);
    const res = await c.env.DB.prepare(
      "INSERT INTO plan_entries (date, slot, recipe_id, servings) VALUES (?,?,?,?) RETURNING id",
    ).bind(date, slot, recipe_id, servings).first<{ id: number }>();
    return c.json({ id: res!.id }, 201);
  })
  .patch("/:id", async (c) => {
    const { servings } = await c.req.json<{ servings: number }>();
    if (!Number.isInteger(servings) || servings < 1) return c.json({ error: "servings must be >= 1" }, 400);
    await c.env.DB.prepare("UPDATE plan_entries SET servings=? WHERE id=?")
      .bind(servings, Number(c.req.param("id"))).run();
    return c.json({ ok: true });
  })
  .delete("/:id", async (c) => {
    await c.env.DB.prepare("DELETE FROM plan_entries WHERE id=?").bind(Number(c.req.param("id"))).run();
    return c.json({ ok: true });
  });
