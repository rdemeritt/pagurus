import { describe, it, expect } from "@jest/globals";
import { createApp } from "../src/server.js";

const TEST_KEY = "pag_live_testkey12345678901234567890123";

const testConfig = {
  bindHost: "127.0.0.1",
  bindPort: 8080,
  externalUrl: "",
  apiKeys: [TEST_KEY],
  fsRoot: "/tmp",
  fsWrite: false,
  shellEnabled: false,
  shellAllowlist: [],
  httpAllowlist: [],
};

describe("auth middleware", () => {
  it("allows /healthz without auth", async () => {
    const { app } = createApp(testConfig);
    const res = await app.request("/healthz");
    expect(res.status).toBe(200);
  });

  it("allows /readyz without auth", async () => {
    const { app } = createApp(testConfig);
    const res = await app.request("/readyz");
    expect(res.status).toBe(200);
  });

  it("rejects /mcp without auth header", async () => {
    const { app } = createApp(testConfig);
    const res = await app.request("/mcp", { method: "POST", body: "{}" });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("unauthorized");
  });

  it("rejects /mcp with wrong token", async () => {
    const { app } = createApp(testConfig);
    const res = await app.request("/mcp", {
      method: "POST",
      headers: { authorization: "Bearer wrong-token" },
      body: "{}",
    });
    expect(res.status).toBe(401);
  });

  it("allows /mcp with correct token", async () => {
    const { app } = createApp(testConfig);
    const res = await app.request("/mcp", {
      method: "POST",
      headers: {
        authorization: `Bearer ${TEST_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "test", version: "0" },
        },
        id: 1,
      }),
    });
    // 200 or 4xx from MCP internals is fine — just not 401
    expect(res.status).not.toBe(401);
  });
});
