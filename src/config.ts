export interface Config {
  bindHost: string;
  bindPort: number;
  externalUrl: string;
  apiKeys: string[]; // raw keys from env — hashed at auth time
  fsRoot: string;
  fsWrite: boolean;
  shellEnabled: boolean;
  shellAllowlist: string[];
  httpAllowlist: string[];
}

export function loadConfig(): Config {
  const apiKeysEnv = process.env["PAGURUS_API_KEYS"] ?? "";
  // Server won't start if PAGURUS_API_KEYS missing — enforced in src/index.ts
  return {
    bindHost: process.env["PAGURUS_BIND_HOST"] ?? "127.0.0.1",
    bindPort: parseInt(process.env["PAGURUS_BIND_PORT"] ?? "8080", 10),
    externalUrl: process.env["PAGURUS_EXTERNAL_URL"] ?? "",
    apiKeys: apiKeysEnv
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean),
    fsRoot: process.env["PAGURUS_FS_ROOT"] ?? "/workspace",
    fsWrite: process.env["PAGURUS_FS_WRITE"] !== "false",
    shellEnabled: process.env["PAGURUS_SHELL_ENABLED"] === "true",
    shellAllowlist: (process.env["PAGURUS_SHELL_ALLOWLIST"] ?? "")
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean),
    httpAllowlist: (process.env["PAGURUS_HTTP_ALLOWLIST"] ?? "")
      .split(",")
      .map((h) => h.trim())
      .filter(Boolean),
  };
}
