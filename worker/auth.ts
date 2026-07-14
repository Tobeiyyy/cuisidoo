import type { MiddlewareHandler } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import type { Env } from "./index";

const enc = new TextEncoder();

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export async function signToken(secret: string, expiresAtMs: number): Promise<string> {
  const payload = String(expiresAtMs);
  return `${payload}.${await hmac(secret, payload)}`;
}

export async function verifyToken(secret: string, token: string): Promise<boolean> {
  const dot = token.lastIndexOf(".");
  if (dot < 1) return false;
  const payload = token.slice(0, dot);
  const expected = await hmac(secret, payload);
  if (token.slice(dot + 1) !== expected) return false;
  const exp = Number(payload);
  return Number.isFinite(exp) && exp > Date.now();
}

const MAX_AGE_S = 180 * 24 * 3600;

export async function setAuthCookie(c: any, secret: string) {
  const token = await signToken(secret, Date.now() + MAX_AGE_S * 1000);
  setCookie(c, "cuisidoo_auth", token, {
    httpOnly: true, secure: true, sameSite: "Lax", path: "/", maxAge: MAX_AGE_S,
  });
}

export const authMiddleware: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  const path = new URL(c.req.url).pathname;
  if (path === "/api/auth/login" || path === "/api/health" || path.startsWith("/api/images/")) return next();
  const token = getCookie(c, "cuisidoo_auth");
  if (!token || !(await verifyToken(c.env.AUTH_SECRET, token))) {
    return c.json({ error: "unauthorized" }, 401);
  }
  return next();
};
