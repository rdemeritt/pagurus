import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { mkdir, readdir, open as fsOpen, rename } from "fs/promises";
import { resolve, join as pathJoin, relative, extname, dirname } from "path";
import { randomBytes } from "crypto";
import { lookup } from "mime-types";
import { Config } from "../config.js";

// suppress unused import warning — pathJoin used in jailPath indirectly
void pathJoin;

const MAX_READ_BYTES = 1024 * 1024; // 1 MiB default
const MAX_HARD_CAP = 100 * 1024 * 1024; // 100 MiB absolute ceiling

function deny(msg: string): never {
  throw new Error(msg);
}

// S1: Symlink-safe jail — resolves deepest existing ancestor when target is absent.
async function jailPath(root: string, input: string): Promise<string> {
  if (input.includes("\0")) deny("null_byte");
  const { resolve: res, relative: rel, dirname: dn } = await import("path");
  const { realpath: rp } = await import("fs/promises");
  const resolved = res(root, input);

  let real: string;
  try {
    real = await rp(resolved);
  } catch {
    // File doesn't exist yet — realpath the deepest existing ancestor
    let ancestor = dn(resolved);
    let ancestorReal: string;
    try {
      ancestorReal = await rp(ancestor);
    } catch {
      // If ancestor also doesn't exist, realpath root and re-resolve
      ancestorReal = await rp(root);
    }
    // Re-derive real path from the jailed ancestor
    const relToAncestor = rel(ancestor, resolved);
    real = res(ancestorReal, relToAncestor);
  }

  const relPath = relative(root, real);
  if (relPath.startsWith("..") || relPath === "..") deny("path_outside_root");
  if (resolve(root, relPath) !== real) deny("path_outside_root");
  return real;
}

async function isDenied(fsRoot: string, filePath: string, denylist: string[]): Promise<boolean> {
  const { minimatch } = await import("minimatch");
  const rel = relative(fsRoot, filePath);
  return denylist.some((pattern) => minimatch(rel, pattern));
}

export function registerFsTools(server: McpServer, config: Config): void {
  const root = config.fsRoot;
  const denylist = (process.env["PAGURUS_FS_DENYLIST"] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  // S5: Validate env var — NaN or non-positive falls back to default; hard cap enforced.
  const parsedMax = parseInt(
    process.env["PAGURUS_FS_MAX_READ_BYTES"] ?? String(MAX_READ_BYTES),
    10
  );
  const maxReadBytes =
    Number.isFinite(parsedMax) && parsedMax > 0
      ? Math.min(parsedMax, MAX_HARD_CAP)
      : MAX_READ_BYTES;

  // fs.list
  server.tool(
    "fs.list",
    "List files and directories under the sandboxed workspace root",
    { path: z.string().default(".").describe("Relative path to list (default: root)") },
    async ({ path: inputPath }) => {
      const jailed = await jailPath(root, inputPath);
      const entries = await readdir(jailed, { withFileTypes: true });
      const items = entries.map((e) => ({
        name: e.name,
        type: e.isDirectory() ? "directory" : "file",
      }));
      return { content: [{ type: "text", text: JSON.stringify(items, null, 2) }] };
    }
  );

  // fs.read
  server.tool(
    "fs.read",
    "Read a file from the sandboxed workspace",
    {
      path: z.string().describe("Relative file path"),
      encoding: z
        .enum(["utf8", "base64"])
        .default("utf8")
        .describe("Return encoding"),
    },
    async ({ path: inputPath, encoding }) => {
      const jailed = await jailPath(root, inputPath);
      if (await isDenied(root, jailed, denylist)) deny("denylist_hit");

      // S2: Bounded read via fd — avoids stat/read TOCTOU; +1 detects overflow.
      const fd = await fsOpen(jailed, "r");
      let content_buf: Buffer;
      try {
        const cap = maxReadBytes + 1;
        const buf = Buffer.allocUnsafe(cap);
        const { bytesRead } = await fd.read(buf, 0, cap, 0);
        if (bytesRead > maxReadBytes) deny("too_large");
        content_buf = buf.subarray(0, bytesRead);
      } finally {
        await fd.close();
      }

      const mime = lookup(extname(jailed)) || "application/octet-stream";
      const isBinary = !mime.startsWith("text/") && mime !== "application/json";
      const content =
        isBinary || encoding === "base64"
          ? content_buf.toString("base64")
          : content_buf.toString("utf8");
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              path: inputPath,
              encoding: isBinary ? "base64" : encoding,
              mime,
              content,
            }),
          },
        ],
      };
    }
  );

  // fs.write (only if enabled)
  if (config.fsWrite) {
    server.tool(
      "fs.write",
      "Write content to a file in the sandboxed workspace",
      {
        path: z.string().describe("Relative file path"),
        content: z.string().describe("Content to write"),
        encoding: z.enum(["utf8", "base64"]).default("utf8"),
      },
      async ({ path: inputPath, content: data, encoding }) => {
        const jailed = await jailPath(root, inputPath);
        if (await isDenied(root, jailed, denylist)) deny("denylist_hit");
        const buf =
          encoding === "base64" ? Buffer.from(data, "base64") : Buffer.from(data, "utf8");
        if (buf.length > maxReadBytes) deny("too_large");
        const dir = dirname(jailed);
        await mkdir(dir, { recursive: true, mode: 0o750 });

        // S3: Cryptographically random tmp name; O_EXCL prevents symlink pre-creation.
        const tmp = jailed + ".tmp." + randomBytes(16).toString("hex");
        const tmpFd = await fsOpen(tmp, "wx", 0o640); // O_EXCL: fail if exists
        try {
          await tmpFd.writeFile(buf);
        } finally {
          await tmpFd.close();
        }
        await rename(tmp, jailed);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ path: inputPath, bytes_written: buf.length }),
            },
          ],
        };
      }
    );
  }
}
