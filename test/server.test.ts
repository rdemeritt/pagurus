import { describe, it, expect } from "@jest/globals";
import { createApp } from "../src/server.js";
import type { Config } from "../src/config.js";

const testConfig: Config = {
  bindHost: "127.0.0.1",
  bindPort: 8080,
  externalUrl: "",
  apiKeys: ["test-key"],
  fsRoot: "/tmp",
  fsWrite: false,
  shellEnabled: false,
  shellAllowlist: [],
  httpAllowlist: [],
};

describe("health endpoints", () => {
  it("GET /healthz returns 200 with version", async () => {
    const { app } = createApp(testConfig);
    const res = await app.request("/healthz");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; version: string };
    expect(body.status).toBe("ok");
    expect(body.version).toBe("0.1.0");
  });

  it("GET /readyz returns 200", async () => {
    const { app } = createApp(testConfig);
    const res = await app.request("/readyz");
    expect(res.status).toBe(200);
  });
});
