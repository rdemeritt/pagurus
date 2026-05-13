# Deploying Pagurus on HermitHost

## Prerequisites
- HermitHost with Traefik running (`traefik` Docker network exists)
- Docker + Docker Compose v2

## Steps

1. Clone and configure:
   ```bash
   git clone https://github.com/rdemeritt/pagurus
   cd pagurus
   cp .env.example .env
   chmod 600 .env
   ```

2. Generate an API key:
   ```bash
   pnpm install && pnpm pagurus keygen
   ```
   Copy the printed key into `PAGURUS_API_KEYS` in `.env`.

3. Set required vars in `.env`:
   - `PAGURUS_EXTERNAL_URL` — your public URL (e.g. `https://pagurus.example.com`)
   - `PAGURUS_FS_ROOT` — absolute host path to expose (e.g. `/home/user/workspace`)
   - `PAGURUS_DOMAIN` — same hostname without `https://`
   - `HOST_WORKSPACE` — same as `PAGURUS_FS_ROOT`

4. Deploy:
   ```bash
   docker compose -f docker-compose.yml -f docker-compose.hermithost.yml up -d
   ```

5. Verify:
   ```bash
   curl https://pagurus.yourdomain.com/healthz
   # → {"status":"ok","version":"0.1.0"}
   ```

## Configuring Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

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

## Configuring Claude Code

```bash
claude mcp add --transport http pagurus https://pagurus.yourdomain.com/mcp \
  --header "Authorization: Bearer pag_live_YOUR_KEY_HERE"
```
