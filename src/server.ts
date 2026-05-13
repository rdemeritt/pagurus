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
  app.get("/readyz", (c) => c.json({ status: "ok" })); // expanded in E3+ when packs initialize

  // Auth middleware — applied after health routes, before /mcp
  app.use(authMiddleware(config));

  // MCP Streamable HTTP transport — one shared instance (stateless mode)
  const mcpServer = new McpServer({
    name: "pagurus",
    version: VERSION,
  });

  registerFsTools(mcpServer, config);
  registerHttpTools(mcpServer, config);
  registerShellTools(mcpServer, config);

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless mode
  });

  // Wire MCP server to transport (fire-and-forget; connect() is async but
  // transport is ready synchronously for the first request)
  mcpServer.connect(transport).catch((err: unknown) => {
    console.error(
      JSON.stringify({ level: "error", msg: "mcpServer.connect failed", err: String(err) })
    );
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

    // Access the raw Node.js IncomingMessage / ServerResponse via c.env
    // (provided by @hono/node-server's HttpBindings)
    const { incoming, outgoing } = c.env;

    await transport.handleRequest(incoming, outgoing, body);

    // handleRequest writes directly to the Node.js ServerResponse; return an
    // empty Hono response so Hono doesn't try to write headers again.
    return new Response(null, { status: 200 });
  });

  return { app, mcpServer };
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
