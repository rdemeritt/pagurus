import { createMiddleware } from "hono/factory";
import { createHash, timingSafeEqual } from "crypto";
import { Config } from "../config.js";

const EXEMPT_PATHS = new Set(["/healthz", "/readyz"]);

function fingerprint(token: string): string {
  return createHash("sha256").update(token).digest("hex").slice(0, 8);
}

function safeCompare(a: string, b: string): boolean {
  if (a.length > 256 || b.length > 256) return false;  // reject oversized
  const bufA = Buffer.from(a.padEnd(256));
  const bufB = Buffer.from(b.padEnd(256));
  const lenA = Buffer.allocUnsafe(4);
  const lenB = Buffer.allocUnsafe(4);
  lenA.writeUInt32BE(a.length, 0);
  lenB.writeUInt32BE(b.length, 0);
  return timingSafeEqual(lenA, lenB) && timingSafeEqual(bufA, bufB);
}

export type AuthVariables = {
  keyFingerprint: string;
};

export function authMiddleware(config: Config) {
  return createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
    if (EXEMPT_PATHS.has(c.req.path)) {
      return next();
    }

    const authHeader = c.req.header("authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return c.json({ error: "unauthorized" }, 401);
    }

    const presented = authHeader.slice(7);
    let matched = false;

    for (const key of config.apiKeys) {
      if (safeCompare(presented, key)) {
        matched = true;
        c.set("keyFingerprint", fingerprint(presented));
        break;
      }
    }

    if (!matched) {
      return c.json({ error: "unauthorized" }, 401);
    }

    return next();
  });
}
