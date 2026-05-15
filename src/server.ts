import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { HttpBindings } from "@hono/node-server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Config } from "./config.js";
import { authMiddleware, AuthVariables } from "./auth/middleware.js";
import { registerFsTools } from "./tools/fs.js";
import { registerHttpTools } from "./tools/http.js";
import { registerShellTools } from "./tools/shell.js";

const VERSION = "0.1.0";

type Bindings = HttpBindings;

export function createApp(config: Config) {
  const app = new Hono<{ Bindings: Bindings; Variables: AuthVariables }>();

  // Health endpoints — auth-exempt
  app.get("/healthz", (c) => c.json({ status: "ok", version: VERSION }));
  app.get("/readyz", (c) => c.json({ status: "ok" }));

  // Auth middleware — applied after health routes, before /mcp
  app.use(authMiddleware(config));

  app.onError((err, c) => {
    console.error(
      JSON.stringify({ level: "error", msg: "unhandled handler error", err: String(err), stack: err instanceof Error ? err.stack : undefined })
    );
    return c.text("internal server error", 500);
  });

  app.post("/mcp", async (c) => {
    // DNS-rebinding defense
    const origin = c.req.header("origin");
    const host = c.req.header("host") ?? "";

    if (config.externalUrl) {
      const allowedOrigin = new URL(config.externalUrl).origin;
      const allowedHost = new URL(config.externalUrl).host;
      const loopback = host === "localhost" || host === "127.0.0.1" || /^(127\.0\.0\.1|localhost):\d+$/.test(host);
      const hostOk = host === allowedHost || loopback;
      if (!hostOk) {
        return c.json({ error: "forbidden" }, 403);
      }
      if (origin !== undefined && origin !== "" && origin !== allowedOrigin) {
        return c.json({ error: "forbidden" }, 403);
      }
    }

    const body = await c.req.json();
    const { incoming, outgoing } = c.env;

    // Stateless mode: fresh McpServer + transport per request.
    // The SDK does not support reusing a transport across requests in stateless
    // mode — after handleRequest completes the transport is spent.
    const mcpServer = new McpServer({ name: "pagurus", version: VERSION });
    registerFsTools(mcpServer, config);
    registerHttpTools(mcpServer, config);
    registerShellTools(mcpServer, config);

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless — no Mcp-Session-Id header
    });

    await mcpServer.connect(transport);
    await transport.handleRequest(incoming, outgoing, body);

    // @hono/node-server v2 responseViaCache does not guard writeHead/end against
    // double-write. The transport already wrote to outgoing; stomp the methods so
    // Hono's response path silently no-ops instead of throwing ERR_HTTP_HEADERS_SENT.
    if (outgoing.headersSent) {
      (outgoing as any).writeHead = () => outgoing;
      (outgoing as any).write = () => true;
      (outgoing as any).end = () => outgoing;
    }

    return new Response(null, { status: 200 });
  });

  return { app };
}

export function startServer(config: Config) {
  const { app } = createApp(config);

  const server = serve({
    fetch: app.fetch,
    hostname: config.bindHost,
    port: config.bindPort,
  });

  console.log(
    JSON.stringify({
      level: "info",
      msg: "pagurus started",
      host: config.bindHost,
      port: config.bindPort,
      version: VERSION,
    })
  );

  process.on("SIGTERM", () => {
    console.log(JSON.stringify({ level: "info", msg: "SIGTERM received, draining" }));
    server.close(() => {
      console.log(JSON.stringify({ level: "info", msg: "server closed" }));
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 15_000);
  });
}
