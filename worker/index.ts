import { Hono } from "hono";
import { authMiddleware, setAuthCookie, hmac } from "./auth";
import { ingredientRoutes } from "./ingredients";
import { recipeRoutes } from "./recipes";
import { generateRoutes } from "./generate";
import { pantryRoutes, settingsRoutes, equipmentRoutes } from "./settings";
import { planRoutes } from "./plan";
import { shoppingRoutes } from "./shopping";

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

// Shared malformed-JSON / unexpected-error guard for every route below. Never logs request
// bodies or keys — only the error message — so accidental logging can't leak recipe/auth data.
app.onError((err, c) => {
  if (err instanceof SyntaxError) {
    return c.json({ error: "Ungültige Anfrage." }, 400);
  }
  console.error(err instanceof Error ? err.message : String(err));
  return c.json({ error: "Interner Fehler." }, 500);
});

app.use("/api/*", authMiddleware);

app.get("/api/health", (c) => c.json({ ok: true }));

app.post("/api/auth/login", async (c) => {
  const { passphrase } = await c.req.json<{ passphrase: string }>();
  // Compare HMAC digests of both sides rather than the raw passphrase directly, so a failed
  // login can't be used to time-probe the correct passphrase character by character.
  const [supplied, expected] = await Promise.all([
    hmac(c.env.AUTH_SECRET, typeof passphrase === "string" ? passphrase : ""),
    hmac(c.env.AUTH_SECRET, c.env.AUTH_PASSPHRASE),
  ]);
  if (supplied !== expected) return c.json({ error: "falsche Passphrase" }, 401);
  await setAuthCookie(c, c.env.AUTH_SECRET);
  return c.json({ ok: true });
});

app.get("/api/auth/check", (c) => c.json({ ok: true }));

app.get("/api/images/*", async (c) => {
  const key = new URL(c.req.url).pathname.replace(/^\/api\/images\//, "");
  const object = await c.env.BUCKET.get(key);
  if (!object) return c.json({ error: "not found" }, 404);
  return new Response(object.body, {
    headers: {
      "content-type": object.httpMetadata?.contentType ?? "application/octet-stream",
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
});

app.route("/api/ingredients", ingredientRoutes);
app.route("/api/recipes", recipeRoutes);
app.route("/api/generate", generateRoutes);
app.route("/api/pantry", pantryRoutes);
app.route("/api/settings", settingsRoutes);
app.route("/api/equipment", equipmentRoutes);
app.route("/api/plan", planRoutes);
app.route("/api/shopping", shoppingRoutes);

export default app;
