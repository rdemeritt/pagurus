import { describe, it, expect } from "@jest/globals";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerShellTools } from "../src/tools/shell.js";

const TEST_KEY = "pag_live_testkey12345678901234567890123";

function registeredToolNames(server: McpServer): string[] {
  return Object.keys((server as unknown as { _registeredTools: Record<string, unknown> })._registeredTools);
}

const disabledConfig = {
  bindHost: "127.0.0.1",
  bindPort: 8080,
  externalUrl: "",
  apiKeys: [TEST_KEY],
  fsRoot: "/tmp",
  fsWrite: false,
  shellEnabled: false,
  shellAllowlist: ["ls", "echo"],
  httpAllowlist: [],
};

const enabledConfig = {
  ...disabledConfig,
  shellEnabled: true,
  shellAllowlist: ["ls", "echo"],
};

describe("shell.exec tool pack", () => {
  it("shell.exec NOT registered when shellEnabled=false", () => {
    const server = new McpServer({ name: "test", version: "0" });
    registerShellTools(server, disabledConfig);
    expect(registeredToolNames(server)).not.toContain("shell.exec");
  });

  it("shell.exec registered when shellEnabled=true", () => {
    const server = new McpServer({ name: "test", version: "0" });
    registerShellTools(server, enabledConfig);
    expect(registeredToolNames(server)).toContain("shell.exec");
  });
});
