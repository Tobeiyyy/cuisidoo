import { Hono } from "hono";
import type { Env } from "./index";
import { qAll } from "./db";

export const pantryRoutes = new Hono<{ Bindings: Env }>()
  .get("/", async (c) => {
    const rows = await qAll(c.env.DB.prepare(
      "SELECT p.ingredient_id, i.name, i.category, i.unit_dim, p.quantity, p.updated_at " +
      "FROM pantry p JOIN ingredients i ON i.id = p.ingredient_id " +
      "ORDER BY i.category, i.name"));
    return c.json(rows);
  })
  .put("/", async (c) => {
    const { ingredient_id, quantity } = await c.req.json<{ ingredient_id: number; quantity: number }>();
    if (quantity <= 0) {
      await c.env.DB.prepare("DELETE FROM pantry WHERE ingredient_id=?").bind(ingredient_id).run();
    } else {
      await c.env.DB.prepare(
        "INSERT INTO pantry (ingredient_id, quantity, updated_at) VALUES (?,?,datetime('now')) " +
        "ON CONFLICT(ingredient_id) DO UPDATE SET quantity=excluded.quantity, updated_at=excluded.updated_at",
      ).bind(ingredient_id, quantity).run();
    }
    return c.json({ ok: true });
  });

export const settingsRoutes = new Hono<{ Bindings: Env }>()
  .get("/", async (c) => {
    const rows = await qAll<{ key: string; value: string }>(c.env.DB.prepare("SELECT key, value FROM settings"));
    const map: Record<string, string> = {};
    for (const r of rows) map[r.key] = r.value;
    return c.json(map);
  })
  .put("/", async (c) => {
    const body = await c.req.json<Record<string, string>>();
    const stmts = Object.entries(body).map(([key, value]) =>
      c.env.DB.prepare(
        "INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      ).bind(key, String(value)));
    if (stmts.length) await c.env.DB.batch(stmts);
    return c.json({ ok: true });
  });

export const equipmentRoutes = new Hono<{ Bindings: Env }>()
  .get("/", async (c) =>
    c.json(await qAll(c.env.DB.prepare("SELECT id, name, owned FROM equipment ORDER BY name"))))
  .put("/:id", async (c) => {
    const id = Number(c.req.param("id"));
    const { owned } = await c.req.json<{ owned: boolean }>();
    await c.env.DB.prepare("UPDATE equipment SET owned=? WHERE id=?").bind(owned ? 1 : 0, id).run();
    return c.json({ ok: true });
  });
