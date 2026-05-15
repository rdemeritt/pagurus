import { describe, it, expect } from "@jest/globals";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerHttpTools } from "../src/tools/http.js";

const TEST_KEY = "pag_live_testkey12345678901234567890123";

function registeredToolNames(server: McpServer): string[] {
  return Object.keys((server as unknown as { _registeredTools: Record<string, unknown> })._registeredTools);
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
    const server = new McpServer({ name: "test", version: "0" });
    registerHttpTools(server, testConfig);
    expect(registeredToolNames(server)).toContain("http.fetch");
  });

  it("registers http.fetch with empty allowlist (all hosts allowed)", () => {
    const server = new McpServer({ name: "test", version: "0" });
    registerHttpTools(server, { ...testConfig, httpAllowlist: [] });
    expect(registeredToolNames(server)).toContain("http.fetch");
  });
});
