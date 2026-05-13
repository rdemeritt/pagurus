# Pagurus

Self-hosted MCP server for tight developer-model collaboration. Exposes your shell, filesystem, and HTTP client to Claude Desktop and Claude Code via the Model Context Protocol. Runs on Docker. Auditable. Secure by default.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![CI](https://github.com/rdemeritt/pagurus/actions/workflows/ci.yml/badge.svg)](https://github.com/rdemeritt/pagurus)

## Quickstart

1. Clone the repo:
   ```bash
   git clone https://github.com/rdemeritt/pagurus
   cd pagurus
   ```

2. Copy and configure environment:
   ```bash
   cp .env.example .env
   chmod 600 .env
   # Edit .env with your settings (see Configuration below)
   ```

3. Generate an API key:
   ```bash
   pnpm install
   pnpm pagurus keygen
   ```
   Copy the printed key into `PAGURUS_API_KEYS` in `.env`.

4. Start the server:
   ```bash
   docker compose up -d
   ```

5. Verify it's running:
   ```bash
   curl http://127.0.0.1:8080/healthz
   # → {"status":"ok","version":"0.1.0"}
   ```

## Configuring Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "pagurus": {
      "url": "http://127.0.0.1:8080/mcp",
      "headers": {
        "Authorization": "Bearer pag_live_YOUR_KEY_HERE"
      }
    }
  }
}
```

Restart Claude Desktop. You'll now see Pagurus tools in the compose panel.

## Configuring Claude Code

```bash
claude mcp add --transport http pagurus http://127.0.0.1:8080/mcp \
  --header "Authorization: Bearer pag_live_YOUR_KEY_HERE"
```

## Tools Reference

| Tool | Description | Default | Env Var |
|------|-------------|---------|---------|
| `fs.read` | Read file contents (sandboxed) | Enabled | `PAGURUS_FS_ROOT`, `PAGURUS_FS_DENYLIST` |
| `fs.write` | Write/overwrite files | Enabled | `PAGURUS_FS_WRITE` |
| `fs.list` | List directory contents | Enabled | `PAGURUS_FS_ROOT` |
| `http.fetch` | Fetch URLs with SSRF protection | Enabled | `PAGURUS_HTTP_ALLOWLIST` |
| `shell.exec` | Execute shell commands | **Disabled** | `PAGURUS_SHELL_ENABLED`, `PAGURUS_SHELL_ALLOWLIST` |

See [ADR-003](clients/self/projects/pagurus/specs/adr-003-pagurus-tool-surface-2026-05-13.md) for tool design rationale.

## Architecture

Pagurus is a Model Context Protocol (MCP) server that sits between Claude (Desktop or Code) and your local filesystem, HTTP APIs, and shell commands. It acts as a security boundary, enforcing authentication, authorization, and sandboxing at every layer.

### Request Flow

```mermaid
sequenceDiagram
    participant Claude as Claude Desktop/<br/>Code
    participant Traefik as Traefik<br/>(HermitHost)
    participant Pagurus as Pagurus Container
    participant Auth as Auth Middleware
    participant Tools as Tool Packs
    
    Claude->>Traefik: POST /mcp<br/>+ Authorization header
    Traefik->>Pagurus: HTTPS (TLS)
    Pagurus->>Auth: Extract & validate<br/>Bearer token
    Auth->>Auth: SHA-256 fingerprint<br/>+ timingSafeEqual
    alt Token invalid
        Auth-->>Claude: 401 Unauthorized
    else Token valid
        Auth->>Tools: Route to tool<br/>e.g., fs.read
        Tools->>Tools: Jail path / validate<br/>SSRF check / check allowlist
        Tools-->>Pagurus: Tool result
        Pagurus-->>Claude: MCP response
    end
```

### Internal Architecture

```mermaid
graph TD
    A["Pagurus Server<br/>(Hono + MCP SDK)"]
    A1["GET /healthz<br/>GET /readyz<br/>POST /mcp"]
    A --> A1
    
    B["Auth Middleware"]
    C["DNS-Rebinding Defense"]
    D["MCP Streamable HTTP Transport"]
    
    A1 --> B
    B --> C
    C --> D
    
    E["Tool Packs"]
    F["fs Pack"]
    G["http Pack"]
    H["shell Pack"]
    
    D --> E
    E --> F
    E --> G
    E --> H
    
    F1["Path Jailing<br/>Denylist<br/>Max Size"]
    F --> F1
    
    G1["DNS-Rebinding<br/>SSRF Validation<br/>Allow-list<br/>Private IP Block"]
    G --> G1
    
    H1["Command Allow-list<br/>Hard Deny-list<br/>Concurrency Cap<br/>Process Group Kill"]
    H --> H1
    
    I["Config<br/>env vars"]
    I -.-> A
    I -.-> B
    I -.-> E
```

## How a Request Flows

When Claude calls a tool through Pagurus, here's what happens:

1. **Claude sends a request** — POST to `/mcp` with JSON-RPC `tools/call` and `Authorization: Bearer <KEY>` header.

2. **Traefik receives it** — If deployed on HermitHost, Traefik terminates TLS and forwards to Pagurus over HTTP (internal network).

3. **Hono server accepts POST /mcp** — Routes through:
   - **Health endpoint exemption** — `/healthz` and `/readyz` skip all auth
   - **Auth middleware** — Extracts Bearer token, compares using `timingSafeEqual` against API keys to prevent timing attacks; sets `keyFingerprint` on context; returns 401 if no match

4. **DNS-rebinding defense** — Validates `Origin` and `Host` headers against `PAGURUS_EXTERNAL_URL`; blocks mismatches with 403.

5. **MCP transport deserializes** — Converts JSON-RPC to MCP handler call.

6. **Tool handler executes** — Depending on the tool:
   - **fs.read** — Jails path (resolves realpath, checks for `..` escape), checks denylist, reads with size cap
   - **http.fetch** — Validates hostname against allow-list, checks for private IPs via DNS lookup, enforces SSRF rules, strips sensitive headers
   - **shell.exec** — Checks command allowlist AND hard deny-list, jails cwd, spawns with `shell: false`, kills process group on timeout

7. **Response returned** — Tool returns result as MCP `tools/call` response; Pagurus serializes and sends back to Claude.

8. **Audit log** — Shell execution logs command, args, exit code, duration, truncation status, and key fingerprint for compliance.

## How to Use Each Tool

### fs.list

**Purpose:** List files and directories in the workspace.

**Example:**
```json
{
  "method": "tools/call",
  "params": {
    "name": "fs.list",
    "arguments": {
      "path": "."
    }
  }
}
```

**Configuration:**
- `PAGURUS_FS_ROOT` — Absolute path to expose (required)

**Security:** Paths are jailed; `..` sequences cannot escape the root. No symlink attacks possible (realpath validation).

---

### fs.read

**Purpose:** Read a file from the workspace as text or base64.

**Example:**
```json
{
  "method": "tools/call",
  "params": {
    "name": "fs.read",
    "arguments": {
      "path": "src/config.ts",
      "encoding": "utf8"
    }
  }
}
```

**Configuration:**
- `PAGURUS_FS_ROOT` — Workspace root (required)
- `PAGURUS_FS_DENYLIST` — Glob patterns to deny (default: `.env,.env.*,**/*.key,**/*.pem,**/*.p12`)
- `PAGURUS_FS_MAX_READ_BYTES` — Max bytes (default: 1 MiB, max: 100 MiB)

**Security:** Files matching denylist are blocked. Reads are bounded (TOCTOU-safe via fd operations). Binary files auto-detect and return as base64.

---

### fs.write

**Purpose:** Write or overwrite a file in the workspace.

**Example:**
```json
{
  "method": "tools/call",
  "params": {
    "name": "fs.write",
    "arguments": {
      "path": "output.txt",
      "content": "hello world",
      "encoding": "utf8"
    }
  }
}
```

**Configuration:**
- `PAGURUS_FS_WRITE` — Enable writes (default: `true`)
- `PAGURUS_FS_ROOT` — Workspace root (required)
- `PAGURUS_FS_DENYLIST` — Same as `fs.read`
- `PAGURUS_FS_MAX_READ_BYTES` — Size cap applies

**Security:** Writes use atomic rename (temp file + rename); denylist is enforced. Disabled by default; set `PAGURUS_FS_WRITE=false` for read-only mode.

---

### http.fetch

**Purpose:** Fetch a URL from an operator-approved allow-list.

**Example:**
```json
{
  "method": "tools/call",
  "params": {
    "name": "http.fetch",
    "arguments": {
      "url": "https://api.github.com/repos/rdemeritt/pagurus",
      "method": "GET",
      "headers": {
        "Accept": "application/json"
      },
      "timeout_ms": 10000
    }
  }
}
```

**Configuration:**
- `PAGURUS_HTTP_ALLOWLIST` — Comma-separated hostnames (e.g., `api.github.com,*.api.example.com`). Empty = deny all (fail-closed).
- `PAGURUS_HTTP_ALLOW_PRIVATE` — Allow private IPs (default: `false`). Never set `true` in production.

**Security:** 
- DNS is resolved at connection time (prevents rebinding attacks).
- Private IP ranges (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 127.0.0.0/8, fe80::/10, fc00::/7, etc.) are blocked unless explicitly allowed.
- Auth headers are stripped on redirect to different origins.
- Response body capped at 1 MB; truncated responses flagged.

---

### shell.exec

**Purpose:** Execute an allow-listed command in the workspace.

**Example:**
```json
{
  "method": "tools/call",
  "params": {
    "name": "shell.exec",
    "arguments": {
      "command": "git",
      "args": ["status"],
      "cwd": "myrepo",
      "timeout_ms": 5000
    }
  }
}
```

**Configuration:**
- `PAGURUS_SHELL_ENABLED` — Enable this tool (default: `false`). **High-risk feature.**
- `PAGURUS_SHELL_ALLOWLIST` — Comma-separated command basenames (e.g., `git,ls,cat,grep`). Empty = no commands allowed.

**Security:**
- Shells (`sh`, `bash`, `zsh`, etc.) and interpreters (`node`, `python`, `ruby`, etc.) are **hard-blocked** regardless of allowlist.
- Dangerous commands (`rm`, `chmod`, `sudo`, `kill`, etc.) are always blocked.
- Process spawned with `shell: false` (no shell injection possible).
- Entire process group is killed on timeout (no orphans).
- Concurrency capped at 4 concurrent calls.
- All executions are audit-logged with command, args, exit code, duration, and key fingerprint.

---

## Security Model

Pagurus implements defense-in-depth across multiple layers:

```mermaid
flowchart TD
    A["Request<br/>from Claude"]
    B["Layer 1: TLS<br/>Traefik terminates"]
    C["Layer 2: Auth<br/>Bearer token +<br/>timingSafeEqual"]
    D["Layer 3: DNS-Rebinding<br/>Origin/Host validation"]
    E["Layer 4: Tool-Level<br/>Sandboxing"]
    
    A --> B
    B --> C
    C --> D
    D --> E
    
    F["fs: Path jailing<br/>+ denylist<br/>+ size bounds"]
    G["http: SSRF defense<br/>+ allow-list<br/>+ private IP block"]
    H["shell: Hard deny<br/>+ allow-list<br/>+ process kill"]
    
    E --> F
    E --> G
    E --> H
    
    F --> I["Sandboxed<br/>Response"]
    G --> I
    H --> I
```

**Layer 1: TLS Transport**
- All traffic to Pagurus is encrypted. When deployed on HermitHost, Traefik terminates TLS; internal communication is on a private network.

**Layer 2: Bearer Token Authentication**
- API keys are cryptographically compared using `timingSafeEqual` to prevent timing attacks.
- Keys are plaintext in `.env` — keep the file private (`chmod 600`).
- No session tokens or OAuth yet (v0.2 planned).

**Layer 3: DNS-Rebinding Defense**
- `PAGURUS_EXTERNAL_URL` is required; both `Origin` and `Host` headers are validated against it.
- Requests to `localhost` or `127.0.0.1` bypass this check (development convenience).
- Prevents DNS rebinding attacks that would trick the server into accepting attacker-controlled hosts.

**Layer 4: Tool-Level Sandboxing**
- **fs:** Paths are jail-validated using realpath + relative path checks; symlinks cannot escape root. Denylist (glob patterns) blocks sensitive files (`.env`, `*.key`, `*.pem`). Reads are size-bounded and TOCTOU-safe.
- **http:** Hostname allow-list is fail-closed (empty = deny all). Private IP ranges are blocked by default. SSRF is validated at connection time via DNS; undici's agent hook enforces checks. Headers are scrubbed; cookies and auth headers are stripped.
- **shell:** Hard deny-list blocks shells and interpreters regardless of allow-list. Spawned with `shell: false` (no injection). Process group killed on timeout. All executions audit-logged.

For details on authentication design, see [ADR-002](clients/self/projects/pagurus/specs/adr-002-pagurus-auth-model-2026-05-13.md). For tool threat model, see [ADR-003](clients/self/projects/pagurus/specs/adr-003-pagurus-tool-surface-2026-05-13.md).

For known limitations and how to report security vulnerabilities, see [SECURITY.md](SECURITY.md).


## Configuration

All configuration via environment variables in `.env`:

| Variable | Default | Description |
|----------|---------|-------------|
| `PAGURUS_BIND_HOST` | `127.0.0.1` | Hostname to bind to. `0.0.0.0` only on private networks. |
| `PAGURUS_BIND_PORT` | `8080` | Port to listen on. |
| `PAGURUS_EXTERNAL_URL` | — | **REQUIRED** Public URL of this instance (e.g., `https://pagurus.yourdomain.com`). Used for DNS rebinding defense. |
| `PAGURUS_API_KEYS` | — | **REQUIRED** Comma-separated API keys. Generate with `pnpm pagurus keygen`. |
| `PAGURUS_FS_ROOT` | — | **REQUIRED** Absolute path on host to expose as workspace root. |
| `PAGURUS_FS_WRITE` | `true` | Allow `fs.write` tool. Set `false` for read-only. |
| `PAGURUS_FS_DENYLIST` | `.env,.env.*,**/*.key,**/*.pem,**/*.p12` | Glob patterns to deny access (relative to FS_ROOT). |
| `PAGURUS_FS_MAX_READ_BYTES` | `1048576` (1 MiB) | Max file size for reads. Max: 100 MiB. |
| `PAGURUS_HTTP_ALLOWLIST` | — | Comma-separated hostname allow-list (e.g., `api.github.com,*.api.example.com`). Empty = deny all. |
| `PAGURUS_HTTP_ALLOW_PRIVATE` | `false` | Allow private IP ranges in HTTP requests. Never set `true` in production. |
| `PAGURUS_SHELL_ENABLED` | `false` | Enable `shell.exec` tool. **Warning:** highest-risk feature. |
| `PAGURUS_SHELL_ALLOWLIST` | — | Comma-separated allowed command basenames (e.g., `git,ls,cat,grep`). Shells always blocked. |

See `.env.example` for all options with detailed descriptions.

## Deploying on HermitHost

Pagurus is built to run on [HermitHost](https://github.com/rdemeritt/hermithost) — self-hosted Netlify alternative with DNS + SSL.

See [DEPLOYMENT.md](DEPLOYMENT.md) for step-by-step HermitHost deployment guide.

## Roadmap

### v0.2 (Planned)
- OAuth 2.0 authentication (multi-user)
- Multi-tenant isolation
- Notes pack (create/update/search local markdown notes)
- Admin dashboard for key + tool management
- Rate limiting per API key
- Request logging + audit trail

### Future
- Custom tool packs (user-defined code execution sandboxes)
- WebSocket transport for streaming responses
- Secrets rotation

## Contributing

We welcome contributions. Please read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a PR.

Development setup:
```bash
pnpm install
pnpm test       # Run tests
pnpm lint       # Lint code
pnpm typecheck  # Type checking
pnpm dev        # Local dev server (watch mode)
```

## Code of Conduct

This project adopts the [Contributor Covenant](CODE_OF_CONDUCT.md). All participants are expected to uphold this code.

## Security Policy

Found a security vulnerability? Please read [SECURITY.md](SECURITY.md) for responsible disclosure guidelines.

## License

MIT License — see [LICENSE](LICENSE) for details. Copyright 2026 Pagurus Contributors.

## Acknowledgements

- [Model Context Protocol](https://modelcontextprotocol.io) — open standard for AI tool integration
- [HermitHost](https://github.com/rdemeritt/hermithost) — self-hosted platform that inspired this
- MCP SDK team for excellent documentation and tooling
