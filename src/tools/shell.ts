import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { spawn } from "child_process";
import { Config } from "../config.js";

const MAX_OUTPUT_BYTES = 256 * 1024; // 256 KiB

// S17 — Concurrency cap
let activeCalls = 0;
const MAX_CONCURRENT = 4;

function deny(msg: string): never {
  throw new Error(msg);
}

// S3 — Hard deny-list for dangerous commands regardless of operator allowlist
const DANGEROUS_COMMANDS = new Set([
  "sh", "bash", "zsh", "fish", "ksh", "csh", "tcsh", "dash",
  "node", "nodejs", "deno", "bun",
  "python", "python3", "python2", "ruby", "perl", "lua",
  "awk", "gawk", "mawk", "sed",
  "find",
  "xargs",
  "env",
  "nohup",
  "tee",
  "dd",
  "nc", "ncat", "netcat",
  "curl", "wget",
  "sudo", "su", "doas",
  "chmod", "chown",
  "install",
  "at", "cron", "crontab",
  "pkill", "kill", "killall",
  "reboot", "shutdown", "halt", "poweroff",
  "mount", "umount",
  "rm", "rmdir", "unlink",
]);

function isAllowed(command: string, allowlist: string[]): boolean {
  if (command.includes("/") || command.includes("\\")) return false;
  if (DANGEROUS_COMMANDS.has(command.toLowerCase())) return false; // hard deny
  return allowlist.includes(command);
}

async function jailCwd(fsRoot: string, inputCwd: string | undefined): Promise<string> {
  const { resolve, relative } = await import("path");
  const { realpath } = await import("fs/promises");
  const target = inputCwd ? resolve(fsRoot, inputCwd) : fsRoot;
  let real: string;
  try {
    real = await realpath(target);
  } catch {
    deny("cwd_not_found");
  }
  const rel = relative(fsRoot, real!);
  if (rel.startsWith("..")) deny("cwd_outside_root");
  return real!;
}

// S9 — Kill entire process group (grandchildren too)
function killGroup(child: ReturnType<typeof spawn>): void {
  try {
    if (child.pid !== undefined) {
      process.kill(-child.pid, "SIGKILL");
    }
  } catch {
    // already dead
  }
}

export function registerShellTools(server: McpServer, config: Config): void {
  if (!config.shellEnabled) return; // not visible in tools/list

  server.tool(
    "shell.exec",
    "Execute an allow-listed command in the sandboxed workspace (operator must enable PAGURUS_SHELL_ENABLED=true and configure PAGURUS_SHELL_ALLOWLIST)",
    {
      command: z.string().describe("Command name (basename only, no path separators)"),
      args: z.array(z.string()).default([]).describe("Arguments array — never shell-interpolated"),
      cwd: z.string().optional().describe("Working directory relative to PAGURUS_FS_ROOT"),
      // S16 — min timeout 100ms
      timeout_ms: z.number().min(100).max(30000).default(5000),
    },
    async ({ command, args, cwd: inputCwd, timeout_ms }, extra) => {
      // S13 — Require keyFingerprint
      const fingerprint = (extra as Record<string, unknown>)?.["keyFingerprint"] as string | undefined;
      if (!fingerprint) deny("missing_key_fingerprint");

      // Allow-list check (includes S3 hard deny)
      if (!isAllowed(command, config.shellAllowlist)) deny("command_not_allowed");

      // Jail cwd
      const safeCwd = await jailCwd(config.fsRoot, inputCwd);

      // S17 — Concurrency cap
      if (activeCalls >= MAX_CONCURRENT) deny("concurrency_limit");
      activeCalls++;

      const startTime = Date.now();

      try {
        return await new Promise((resolve, reject) => {
          // S9 — detached: true makes child a process group leader
          const child = spawn(command, args, {
            shell: false, // never shell=true
            // S14 — expanded PATH for Alpine tools (git, rg, jq via apk)
            env: { PATH: "/usr/local/bin:/usr/bin:/bin", LANG: "C.UTF-8" },
            cwd: safeCwd,
            detached: true,
            stdio: ["ignore", "pipe", "pipe"],
          });
          child.unref(); // don't keep event loop alive

          let stdout = Buffer.alloc(0);
          let stderr = Buffer.alloc(0);
          let stdoutTruncated = false;
          let stderrTruncated = false;

          (child.stdout as NodeJS.ReadableStream).on("data", (chunk: Buffer) => {
            if (!stdoutTruncated) {
              stdout = Buffer.concat([stdout, chunk]);
              if (stdout.length >= MAX_OUTPUT_BYTES) {
                stdout = stdout.subarray(0, MAX_OUTPUT_BYTES);
                stdoutTruncated = true;
                // S7 — Kill child immediately on truncation
                killGroup(child);
              }
            }
          });

          (child.stderr as NodeJS.ReadableStream).on("data", (chunk: Buffer) => {
            if (!stderrTruncated) {
              stderr = Buffer.concat([stderr, chunk]);
              if (stderr.length >= MAX_OUTPUT_BYTES) {
                stderr = stderr.subarray(0, MAX_OUTPUT_BYTES);
                stderrTruncated = true;
                // S7 — Kill child immediately on truncation
                killGroup(child);
              }
            }
          });

          // S9 — Kill entire process group on timeout
          const killTimer = setTimeout(() => {
            killGroup(child);
          }, timeout_ms);

          child.on("close", (exitCode) => {
            clearTimeout(killTimer);
            const duration = Date.now() - startTime;

            // Audit log
            console.log(
              JSON.stringify({
                level: "info",
                event: "shell.exec",
                command,
                args,
                exit_code: exitCode,
                duration_ms: duration,
                stdout_truncated: stdoutTruncated,
                stderr_truncated: stderrTruncated,
                key_fingerprint: fingerprint,
              })
            );

            resolve({
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    exit_code: exitCode,
                    stdout: stdout.toString("utf8"),
                    stderr: stderr.toString("utf8"),
                    stdout_truncated: stdoutTruncated,
                    stderr_truncated: stderrTruncated,
                    duration_ms: duration,
                  }),
                },
              ],
            });
          });

          child.on("error", (err) => {
            clearTimeout(killTimer);
            reject(err);
          });
        });
      } finally {
        // S17 — Release concurrency slot
        activeCalls--;
      }
    }
  );
}
