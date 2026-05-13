import { describe, it, expect } from "@jest/globals";
import { createApp } from "../src/server.js";

const TEST_KEY = "pag_live_testkey12345678901234567890123";

// McpServer stores registered tools on _registeredTools keyed by tool name
function registeredToolNames(mcpServer: { _registeredTools: Record<string, unknown> }): string[] {
  return Object.keys(mcpServer._registeredTools);
}

const testConfig = {
  bindHost: "127.0.0.1",
  bindPort: 8080,
  externalUrl: "",
  apiKeys: [TEST_KEY],
  fsRoot: "/tmp",
  fsWrite: false,
  shellEnabled: false,
  shellAllowlist: [],
  httpAllowlist: ["example.com", "*.example.com"],
};

describe("http tool pack", () => {
  it("registers http.fetch tool", () => {
    const { mcpServer } = createApp(testConfig);
    const names = registeredToolNames(mcpServer as unknown as { _registeredTools: Record<string, unknown> });
    expect(names).toContain("http.fetch");
  });

  it("registers http.fetch with empty allowlist (all hosts allowed)", () => {
    const config = { ...testConfig, httpAllowlist: [] };
    const { mcpServer } = createApp(config);
    const names = registeredToolNames(mcpServer as unknown as { _registeredTools: Record<string, unknown> });
    expect(names).toContain("http.fetch");
  });
});
