import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { Config } from "../config.js";
import { Agent, fetch as undiciFetch } from "undici";
import type { Dispatcher } from "undici";
import { lookup as dnsLookup } from "dns";

// ---------------------------------------------------------------------------
// IP normalization & SSRF guards
// ---------------------------------------------------------------------------

function normalizeIp(ip: string): string {
  // Strip IPv6-mapped IPv4: ::ffff:10.0.0.1 -> 10.0.0.1
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped?.[1]) return mapped[1];
  return ip;
}

const PRIVATE_IP_RANGES = [
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^127\./,
  /^169\.254\./,
  /^0\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, // 100.64/10 CGNAT
  /^::1$/,
  /^::$/,
  /^f[cd][0-9a-f]{2}:/i,  // ULA fc00::/7 (covers fd00::/8)
  /^fe[89ab][0-9a-f]:/i,  // link-local fe80::/10
  /^::ffff:/i,             // IPv4-mapped — also caught via normalizeIp
];

function isPrivateIp(ip: string): boolean {
  const normalized = normalizeIp(ip);
  return PRIVATE_IP_RANGES.some(r => r.test(normalized));
}

function deny(msg: string): never {
  throw new Error(msg);
}

// ---------------------------------------------------------------------------
// Allow-list — fail-closed: empty list denies all
// ---------------------------------------------------------------------------

function hostnameAllowed(hostname: string, allowlist: string[]): boolean {
  if (allowlist.length === 0) return false; // fail-closed
  const lower = hostname.toLowerCase();
  return allowlist.some(pattern => {
    const p = pattern.toLowerCase();
    if (p === "*") return true; // explicit wildcard opt-in
    if (p.startsWith("*.")) {
      const suffix = p.slice(2);
      return lower === suffix || lower.endsWith("." + suffix);
    }
    return lower === p;
  });
}

// ---------------------------------------------------------------------------
// Validating undici Agent — DNS check happens at connection time (Fix 1)
// ---------------------------------------------------------------------------

function makeValidatingAgent(allowPrivate: boolean): Dispatcher {
  return new Agent({
    connect: {
      lookup: (hostname, options, callback) => {
        dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
          if (err) {
            callback(err as NodeJS.ErrnoException, "", 4);
            return;
          }
          const addrs = Array.isArray(addresses) ? addresses : [addresses];
          if (!allowPrivate) {
            for (const { address } of addrs) {
              if (isPrivateIp(address)) {
                callback(
                  new Error(`private_ip_blocked:${address}`) as NodeJS.ErrnoException,
                  "",
                  4,
                );
                return;
              }
            }
          }
          const first = addrs[0];
          if (!first) {
            callback(new Error("dns_no_result") as NodeJS.ErrnoException, "", 4);
            return;
          }
          callback(null, first.address, first.family as 4 | 6);
        });
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Header constants
// ---------------------------------------------------------------------------

const STRIPPED_REQUEST_HEADERS = new Set([
  "authorization",
  "cookie",
  "proxy-authorization",
  "proxy-connection",
  "host",
]);

const STRIPPED_RESPONSE_HEADERS = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "proxy-authorization",
  "proxy-authenticate",
  "proxy-connection",
]);

// HTTP token regex — RFC 7230 §3.2.6
const HTTP_TOKEN_RE = /^[!#$%&'*+\-.0-9A-Z^_`a-z|~]+$/;

const MAX_BODY_BYTES = 1024 * 1024; // 1 MB

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerHttpTools(server: McpServer, config: Config): void {
  const allowPrivate = process.env["PAGURUS_HTTP_ALLOW_PRIVATE"] === "true";

  // Normalize allow-list to lowercase at startup
  const allowlist = config.httpAllowlist.map(h => h.toLowerCase());

  server.tool(
    "http.fetch",
    "Fetch a URL from an operator-approved allow-list",
    {
      url: z.string().url().describe("URL to fetch"),
      method: z
        .enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"])
        .default("GET"),
      headers: z
        .record(z.string(), z.string())
        .optional()
        .describe("Request headers (Authorization stripped)"),
      body: z.string().optional().describe("Request body for POST/PUT/PATCH"),
      timeout_ms: z.number().min(0).max(30000).default(10000),
    },
    async ({ url: rawUrl, method, headers: reqHeaders, body, timeout_ms }) => {
      // Parse URL
      let parsed: URL;
      try {
        parsed = new URL(rawUrl);
      } catch {
        deny("invalid_url");
      }

      // Only http/https
      if (parsed!.protocol !== "http:" && parsed!.protocol !== "https:") {
        deny("unsupported_protocol");
      }

      // CRLF injection guard on URL
      if (/[\r\n]/.test(rawUrl)) deny("crlf_in_url");

      // Allow-list check — fail-closed (Fix 5)
      if (!hostnameAllowed(parsed!.hostname, allowlist)) {
        deny("host_not_allowed");
      }

      // Build safe request headers with CRLF + token validation (Fix 3)
      const safeHeaders: Record<string, string> = {};
      for (const [k, v] of Object.entries(reqHeaders ?? {})) {
        if (!HTTP_TOKEN_RE.test(k)) deny("invalid_header_name");
        if (/[\r\n]/.test(v)) deny("crlf_in_header");
        const lower = k.toLowerCase();
        if (STRIPPED_REQUEST_HEADERS.has(lower)) continue;
        safeHeaders[k] = v;
      }

      // Validating agent enforces SSRF check at connect time (Fix 1)
      const agent = makeValidatingAgent(allowPrivate);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout_ms);

      let resp: Awaited<ReturnType<typeof undiciFetch>>;
      let redirectCount = 0;

      try {
        resp = await undiciFetch(rawUrl, {
          method,
          headers: safeHeaders,
          body: body ?? undefined,
          signal: controller.signal,
          redirect: "manual",
          dispatcher: agent,
        });

        // Follow up to 3 redirects manually; drop auth headers on cross-origin
        while (resp.status >= 300 && resp.status < 400 && redirectCount < 3) {
          const location = resp.headers.get("location");
          if (!location) break;
          let redirectUrl: URL;
          try {
            redirectUrl = new URL(location, rawUrl);
          } catch {
            break;
          }

          if (!hostnameAllowed(redirectUrl.hostname, allowlist)) {
            deny("redirect_host_not_allowed");
          }

          // Drop all request headers on cross-origin redirect (no auth leakage)
          const isCrossOrigin =
            redirectUrl.hostname !== parsed!.hostname ||
            redirectUrl.protocol !== parsed!.protocol;
          const redirectHeaders = isCrossOrigin ? {} : safeHeaders;

          resp = await undiciFetch(redirectUrl.toString(), {
            method: "GET",
            headers: redirectHeaders,
            signal: controller.signal,
            redirect: "manual",
            dispatcher: agent,
          });
          redirectCount++;
        }

        // Read body with 1 MB cap — AbortController stays active (Fix 4)
        const chunks: Uint8Array[] = [];
        let totalBytes = 0;
        let truncated = false;

        if (resp.body) {
          const reader = resp.body.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (!value) continue;
            totalBytes += value.length;
            if (totalBytes > MAX_BODY_BYTES) {
              truncated = true;
              chunks.push(value.slice(0, value.length - (totalBytes - MAX_BODY_BYTES)));
              break;
            }
            chunks.push(value);
          }
        }

        const responseBody = Buffer.concat(
          chunks.map(c => Buffer.from(c)),
        ).toString("utf8");

        // Strip sensitive response headers
        const responseHeaders: Record<string, string> = {};
        resp.headers.forEach((v, k) => {
          if (
            !STRIPPED_RESPONSE_HEADERS.has(k.toLowerCase()) &&
            !k.toLowerCase().startsWith("proxy-")
          ) {
            responseHeaders[k] = v;
          }
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                status: resp.status,
                headers: responseHeaders,
                body: responseBody,
                truncated,
              }),
            },
          ],
        };
      } finally {
        // clearTimeout only after body read completes (or on error) — Fix 4
        clearTimeout(timer);
      }
    },
  );
}
