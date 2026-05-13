import { describe, it, expect } from "@jest/globals";
import { createApp } from "../src/server.js";

const TEST_KEY = "pag_live_testkey12345678901234567890123";

// McpServer stores registered tools on _registeredTools keyed by tool name
function registeredToolNames(mcpServer: { _registeredTools: Record<string, unknown> }): string[] {
  return Object.keys(mcpServer._registeredTools);
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
    const { mcpServer } = createApp(disabledConfig);
    const names = registeredToolNames(
      mcpServer as unknown as { _registeredTools: Record<string, unknown> }
    );
    expect(names).not.toContain("shell.exec");
  });

  it("shell.exec registered when shellEnabled=true", () => {
    const { mcpServer } = createApp(enabledConfig);
    const names = registeredToolNames(
      mcpServer as unknown as { _registeredTools: Record<string, unknown> }
    );
    expect(names).toContain("shell.exec");
  });
});
