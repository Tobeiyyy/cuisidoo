import { Hono } from "hono";
import { authMiddleware, setAuthCookie } from "./auth";
import { ingredientRoutes } from "./ingredients";
import { recipeRoutes } from "./recipes";
import { generateRoutes } from "./generate";
import { qAll } from "./db";

export type Env = {
  DB: D1Database;
  BUCKET: R2Bucket;
  ASSETS: Fetcher;
  ANTHROPIC_API_KEY: string;
  AUTH_PASSPHRASE: string;
  AUTH_SECRET: string;
};

export type App = Hono<{ Bindings: Env }>;

const app: App = new Hono();

app.use("/api/*", authMiddleware);

app.get("/api/health", (c) => c.json({ ok: true }));

app.post("/api/auth/login", async (c) => {
  const { passphrase } = await c.req.json<{ passphrase: string }>();
  if (passphrase !== c.env.AUTH_PASSPHRASE) return c.json({ error: "falsche Passphrase" }, 401);
  await setAuthCookie(c, c.env.AUTH_SECRET);
  return c.json({ ok: true });
});

app.get("/api/auth/check", (c) => c.json({ ok: true }));

app.get("/api/equipment", async (c) =>
  c.json(await qAll(c.env.DB.prepare("SELECT id, name, owned FROM equipment ORDER BY name"))));

app.route("/api/ingredients", ingredientRoutes);
app.route("/api/recipes", recipeRoutes);
app.route("/api/generate", generateRoutes);

export default app;
