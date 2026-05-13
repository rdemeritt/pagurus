# Security Policy

## Supported Versions

Currently, only the latest release is supported with security patches.

| Version | Status | Support Until |
|---------|--------|----------------|
| 0.1.x | Actively supported | v0.2 release |
| < 0.1.0 | Unsupported | — |

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Please report security issues privately to: **rdemeritt@gmail.com**

Include:
- Description of the vulnerability
- Affected versions
- Steps to reproduce (if possible)
- Potential impact
- Suggested fix (optional)

### Response Timeline
- **Acknowledge:** Within 48 hours
- **Patch:** Critical/High within 14 days; Medium within 30 days
- **Disclosure:** Coordinated 90-day disclosure after patch is released

## Security Considerations

### Known Limitations

1. **API Key Storage (v0.1)**
   - Keys stored in plaintext in `.env` file
   - Requires file-level access control (`chmod 600 .env`)
   - Anyone with host shell access can read keys
   - Mitigation: Use strong, unique keys; rotate regularly

2. **Single-Tenant Architecture (v0.1)**
   - No multi-user isolation
   - All authenticated requests have same permissions
   - Mitigation: Deploy per-user instances or wait for v0.2 OAuth

3. **HTTP Fetch SSRF Defense**
   - Custom allow-list implementation (not battle-tested)
   - Potential for bypass via DNS rebinding, IPv6, or encoding tricks
   - Mitigation: Always enable `PAGURUS_HTTP_ALLOWLIST`; avoid `PAGURUS_HTTP_ALLOW_PRIVATE=true` in production

4. **Shell Execution (shell.exec)**
   - Allowlist is prefix-based and depends on `$PATH` ordering
   - If operator installs malicious binary in `/usr/local/bin`, it may bypass intent
   - Mitigation: Keep `PAGURUS_SHELL_ENABLED=false` unless required; audit `$PATH`; use minimal Docker images

5. **No Rate Limiting (v0.1)**
   - No per-key rate limits
   - No automatic DOS protection
   - Mitigation: Deploy behind a rate-limiting reverse proxy; v0.2 will add native support

### Out of Scope

- Operator misconfiguration (e.g., `PAGURUS_HTTP_ALLOW_PRIVATE=true` on public network)
- Host-level compromises (e.g., container escape)
- Dependency vulnerabilities (handled by Dependabot)

## Security Checklist for Operators

- [ ] File permissions: `chmod 600 .env`
- [ ] Keep `.env.example` (no secrets) for version control
- [ ] Rotate `PAGURUS_API_KEYS` every 90 days
- [ ] Review `PAGURUS_SHELL_ALLOWLIST` before enabling shell execution
- [ ] Never set `PAGURUS_HTTP_ALLOW_PRIVATE=true` on internet-facing deployments
- [ ] Review `PAGURUS_FS_DENYLIST` — ensure sensitive paths are blocked
- [ ] Use HTTPS (`PAGURUS_EXTERNAL_URL` must be `https://...`)
- [ ] Run latest patched version
- [ ] Monitor Docker image scans (Trivy) for CVEs

## Responsible Disclosure

We appreciate security researchers who follow responsible disclosure practices. Please:

1. **Report privately** — use the email above, not public issues
2. **Give us time** — at least 72 hours to acknowledge before public disclosure
3. **Don't exploit** — report the vulnerability itself, not proof-of-concept exploits
4. **Coordinate timing** — we'll work with you on a mutually agreeable disclosure date

Researchers who report valid vulnerabilities will be credited in release notes and this document (if desired).

## Security Updates

- Follow [@pagurus_io](https://twitter.com) on Twitter for security announcements (future)
- Watch this repository for release notifications
- Subscribe to the GitHub Security Advisory in your Pagurus repo

## Additional Resources

- [Model Context Protocol Security](https://modelcontextprotocol.io/docs/security)
- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [Node.js Security Best Practices](https://nodejs.org/en/docs/guides/nodejs-security/)

## Contact

Security lead: Ron DeMeritt (rdemeritt@gmail.com)
