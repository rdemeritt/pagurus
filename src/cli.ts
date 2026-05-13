import { randomBytes, createHash } from "crypto";

const [, , cmd] = process.argv;

if (cmd === "keygen") {
  const raw = "pag_live_" + randomBytes(32).toString("base64url");
  const fp = createHash("sha256").update(raw).digest("hex").slice(0, 8);
  console.log("\nGenerated API key:");
  console.log(raw);
  console.log(`\nFingerprint: ${fp}`);
  console.log("\nAdd this key to PAGURUS_API_KEYS (comma-separated).");
  console.log("It will not be shown again.\n");
} else {
  console.log("Usage: pnpm pagurus keygen");
  process.exit(1);
}
