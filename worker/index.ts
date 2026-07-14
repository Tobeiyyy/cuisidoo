import { Hono } from "hono";
import { authMiddleware, setAuthCookie } from "./auth";
import { ingredientRoutes } from "./ingredients";
import { recipeRoutes } from "./recipes";
import { generateRoutes } from "./generate";
import { pantryRoutes, settingsRoutes, equipmentRoutes } from "./settings";

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

app.route("/api/ingredients", ingredientRoutes);
app.route("/api/recipes", recipeRoutes);
app.route("/api/generate", generateRoutes);
app.route("/api/pantry", pantryRoutes);
app.route("/api/settings", settingsRoutes);
app.route("/api/equipment", equipmentRoutes);

export default app;
