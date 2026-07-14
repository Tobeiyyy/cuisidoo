import { Hono } from "hono";

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

app.get("/api/health", (c) => c.json({ ok: true }));

export default app;
