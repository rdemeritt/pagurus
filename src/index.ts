import { statSync } from "fs";
import { isAbsolute } from "path";
import { loadConfig } from "./config.js";
import { startServer } from "./server.js";

const config = loadConfig();

if (config.apiKeys.length === 0) {
  console.error(
    JSON.stringify({ level: "fatal", msg: "PAGURUS_API_KEYS is empty — refusing to start" })
  );
  process.exit(1);
}

// S5 — fsRoot validation at boot
if (!isAbsolute(config.fsRoot)) {
  console.error(JSON.stringify({ level: "fatal", msg: "PAGURUS_FS_ROOT must be an absolute path", value: config.fsRoot }));
  process.exit(1);
}
try {
  const st = statSync(config.fsRoot);
  if (!st.isDirectory()) throw new Error("not a directory");
} catch {
  console.error(JSON.stringify({ level: "fatal", msg: "PAGURUS_FS_ROOT must exist and be a directory", value: config.fsRoot }));
  process.exit(1);
}

startServer(config);
