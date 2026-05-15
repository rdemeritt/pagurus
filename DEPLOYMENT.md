# Deploying Pagurus

Pagurus is a Docker-native application and runs on any Docker host: a local machine, VPS, Fly.io, Render, HermitHost, Coolify, Caprover, or bare Docker.

## Prerequisites

- Docker + Docker Compose v2
- (For HTTPS) a reverse proxy: Traefik, Caddy, Nginx, or similar

## Basic Deployment (Any Host)

1. **Clone and configure:**
   ```bash
   git clone https://github.com/rdemeritt/pagurus
   cd pagurus
   cp .env.example .env
   chmod 600 .env
   ```

2. **Generate an API key:**
   ```bash
   pnpm install && pnpm pagurus keygen
   ```
   Copy the printed key into `PAGURUS_API_KEYS` in `.env`.

3. **Set required environment variables** in `.env`:
   - `PAGURUS_EXTERNAL_URL` — public URL of your instance (e.g., `https://pagurus.example.com` or `http://localhost:8080` for local development)
   - `PAGURUS_FS_ROOT` — absolute path on the host to expose as workspace (e.g., `/home/user/workspace`)
   - `PAGURUS_BIND_HOST` — defaults to `127.0.0.1` (localhost only); change to `0.0.0.0` only if behind a private network reverse proxy
   - `PAGURUS_BIND_PORT` — defaults to `8080`

4. **Start the server:**
   ```bash
   docker compose up -d
   ```

5. **Verify it's running:**
   ```bash
   curl http://127.0.0.1:8080/healthz
   # → {"status":"ok","version":"0.1.0"}
   ```

At this point, Pagurus is running locally. To access it from outside your machine or use HTTPS, you need a reverse proxy (see below).

---

## Exposing Over HTTPS

The base `docker-compose.yml` binds to `127.0.0.1:8080` for security. To expose Pagurus over HTTPS on a public domain or remote machine, use a reverse proxy.

### Option 1: Traefik (HermitHost, Coolify, Caprover, or Standalone)

Traefik is a popular reverse proxy with built-in Let's Encrypt support.

**Setup:**

Use the `docker-compose.hermithost.yml` overlay:

```bash
docker compose -f docker-compose.yml -f docker-compose.hermithost.yml up -d
```

This overlay assumes:
- A `traefik` Docker network exists (created by Traefik or your platform)
- `PAGURUS_DOMAIN` environment variable is set (e.g., `pagurus.example.com`)

**Add to your `.env`:**
```bash
PAGURUS_EXTERNAL_URL=https://pagurus.example.com
PAGURUS_DOMAIN=pagurus.example.com
PAGURUS_FS_ROOT=/path/to/workspace
```

**Works with:**
- [HermitHost](https://github.com/rdemeritt/hermithost) — self-hosted Netlify alternative
- [Coolify](https://coolify.io/) — open-source hosting platform
- [Caprover](https://caprover.com/) — self-hosted PaaS
- Standalone Traefik v2/v3 deployment

---

### Option 2: Caddy

Caddy is simpler than Traefik and has automatic HTTPS via Let's Encrypt.

**Setup:**

1. Ensure Caddy is running with a shared Docker network:
   ```bash
   docker network create caddy 2>/dev/null || true
   docker run -d --name caddy-server \
     --network caddy \
     -p 80:80 -p 443:443 \
     -v /path/to/Caddyfile:/etc/caddy/Caddyfile \
     -v caddy-data:/data \
     caddy:latest
   ```

2. Use the `docker-compose.caddy.yml` overlay:
   ```bash
   docker compose -f docker-compose.yml -f docker-compose.caddy.yml up -d
   ```

3. Add to your `Caddyfile`:
   ```caddy
   pagurus.yourdomain.com {
     reverse_proxy pagurus:8080
   }
   ```

4. Add to `.env`:
   ```bash
   PAGURUS_EXTERNAL_URL=https://pagurus.yourdomain.com
   PAGURUS_FS_ROOT=/path/to/workspace
   ```

---

### Option 3: Nginx

Nginx requires manual certificate management (or use [Certbot](https://certbot.eff.org/)).

**Setup:**

1. Create an Nginx config at `/etc/nginx/sites-available/pagurus`:
   ```nginx
   server {
     listen 443 ssl http2;
     server_name pagurus.yourdomain.com;

     ssl_certificate /etc/letsencrypt/live/pagurus.yourdomain.com/fullchain.pem;
     ssl_certificate_key /etc/letsencrypt/live/pagurus.yourdomain.com/privkey.pem;

     location / {
       proxy_pass http://localhost:8080;
       proxy_set_header Host $host;
       proxy_set_header X-Real-IP $remote_addr;
       proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
       proxy_set_header X-Forwarded-Proto $scheme;
     }
   }

   server {
     listen 80;
     server_name pagurus.yourdomain.com;
     return 301 https://$server_name$request_uri;
   }
   ```

2. Enable the site:
   ```bash
   sudo ln -s /etc/nginx/sites-available/pagurus /etc/nginx/sites-enabled/
   sudo nginx -t && sudo systemctl reload nginx
   ```

3. Obtain a certificate (Certbot):
   ```bash
   sudo certbot certonly --standalone -d pagurus.yourdomain.com
   ```

4. Run Pagurus locally:
   ```bash
   docker compose up -d
   ```

5. Add to `.env`:
   ```bash
   PAGURUS_EXTERNAL_URL=https://pagurus.yourdomain.com
   PAGURUS_FS_ROOT=/path/to/workspace
   ```

---

## Configuring Claude Desktop

Once Pagurus is running and accessible at your public URL, add it to Claude Desktop.

1. Copy your API key (from the `PAGURUS_API_KEYS` environment variable)
2. Open `~/Library/Application Support/Claude/claude_desktop_config.json`
3. Add or update the `mcpServers` section:

```json
{
  "mcpServers": {
    "pagurus": {
      "url": "https://pagurus.yourdomain.com/mcp",
      "headers": {
        "Authorization": "Bearer pag_live_YOUR_KEY_HERE"
      }
    }
  }
}
```

4. Restart Claude Desktop

You'll now see Pagurus tools in the compose panel.

**For local development:**
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

---

## Configuring Claude Code

```bash
claude mcp add --transport http pagurus https://pagurus.yourdomain.com/mcp \
  --header "Authorization: Bearer pag_live_YOUR_KEY_HERE"
```

For local development, use `http://127.0.0.1:8080/mcp` instead.

---

## Environment Variables Reference

| Variable | Required? | Default | Notes |
|----------|-----------|---------|-------|
| `PAGURUS_API_KEYS` | Yes | — | Comma-separated API keys. Generate with `pnpm pagurus keygen`. |
| `PAGURUS_FS_ROOT` | Yes | — | Absolute path on host to expose as workspace. |
| `PAGURUS_EXTERNAL_URL` | Yes | — | Public URL (e.g., `https://pagurus.example.com`). Used for DNS rebinding defense. |
| `PAGURUS_BIND_HOST` | No | `127.0.0.1` | Localhost by default; `0.0.0.0` only on private networks. |
| `PAGURUS_BIND_PORT` | No | `8080` | Port to listen on. |
| `PAGURUS_FS_WRITE` | No | `true` | Allow `fs.write` tool. Set `false` for read-only. |
| `PAGURUS_FS_DENYLIST` | No | `.env,.env.*,**/*.key,**/*.pem,**/*.p12` | Glob patterns to deny (relative to FS_ROOT). |
| `PAGURUS_FS_MAX_READ_BYTES` | No | `1048576` (1 MiB) | Max file size for reads. Max: 100 MiB. |
| `PAGURUS_HTTP_ALLOWLIST` | No | — | Comma-separated hostname allow-list (e.g., `api.github.com`). Empty = deny all. |
| `PAGURUS_HTTP_ALLOW_PRIVATE` | No | `false` | Allow private IP ranges. Never set `true` in production. |
| `PAGURUS_SHELL_ENABLED` | No | `false` | Enable `shell.exec` tool (high-risk). |
| `PAGURUS_SHELL_ALLOWLIST` | No | — | Comma-separated allowed command basenames (e.g., `git,ls,cat`). Shells always blocked. |

See `.env.example` for full documentation.

---

## Troubleshooting

### Healthz endpoint returns 503
- Check logs: `docker compose logs pagurus`
- Verify `PAGURUS_FS_ROOT` exists and is readable
- Verify `PAGURUS_API_KEYS` is set (even if healthz doesn't require auth, keys must be valid)

### DNS rebinding error (403)
- Verify `PAGURUS_EXTERNAL_URL` matches your actual public URL
- If using `localhost:8080` for development, it bypasses DNS rebinding checks
- Check `Origin` and `Host` headers match the configured external URL

### Reverse proxy returns 502
- Verify Pagurus container is running: `docker compose ps`
- Check Pagurus logs: `docker compose logs pagurus`
- Ensure reverse proxy can reach Pagurus on the Docker network (check `docker network inspect`)

### Claude Desktop can't reach Pagurus
- Verify the URL in `claude_desktop_config.json` is correct
- Check API key is correct (generate a new one if unsure: `pnpm pagurus keygen`)
- Test with `curl`: `curl -H "Authorization: Bearer YOUR_KEY" https://pagurus.example.com/healthz`

---

## Next Steps

- Read [README.md](README.md) for configuration and tool usage
- Check [SECURITY.md](SECURITY.md) for security best practices
- See [ADR-002](clients/self/projects/pagurus/specs/adr-002-pagurus-auth-model-2026-05-13.md) for authentication design
- See [ADR-003](clients/self/projects/pagurus/specs/adr-003-pagurus-tool-surface-2026-05-13.md) for tool threat model
