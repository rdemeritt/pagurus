# Contributing to Pagurus

Thank you for your interest in contributing! This document provides guidelines for development, testing, and submitting changes.

## Developer Setup

### Prerequisites
- Node.js 22+ (pin via `.nvmrc`)
- pnpm (npm alternative, faster for monorepos)
- Docker + Docker Compose (for integration testing)

### Initial Setup
```bash
git clone https://github.com/rdemeritt/pagurus
cd pagurus
pnpm install
```

### Development Workflow
```bash
pnpm dev        # Start dev server (watch mode, auto-reload)
pnpm test       # Run unit tests
pnpm lint       # Run ESLint
pnpm typecheck  # TypeScript type checking
pnpm build      # Build for production
```

All commands must pass before opening a PR.

## Branch & Commit Conventions

### Branch Names
- Features: `feat/kebab-case-description` (e.g., `feat/multi-tenant-auth`)
- Bugfixes: `fix/kebab-case-description` (e.g., `fix/ssrf-bypass`)
- Docs: `docs/kebab-case-description` (e.g., `docs/deployment-guide`)
- Chores: `chore/kebab-case-description` (e.g., `chore/upgrade-deps`)

### Commit Messages
Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(auth): add OAuth 2.0 support
fix(http): prevent SSRF to 127.0.0.1
docs(readme): clarify shell.exec security
chore(deps): upgrade TypeScript to 5.9
```

Format: `type(scope): subject`

Types: `feat`, `fix`, `docs`, `chore`, `test`, `refactor`
Scope: subsystem affected (auth, http, fs, shell, server, cli)
Subject: lowercase, no period, imperative mood (e.g., "add", not "adds" or "added")

All commits require DCO sign-off (see below).

## Testing

### Running Tests
```bash
pnpm test
```

Tests use Jest. Test files live in `test/` with `.test.ts` extension.

### Test Requirements
- New features must include corresponding tests.
- Bug fixes must include a regression test that would fail without the fix.
- Aim for >80% coverage of new code paths.

### Integration Tests
For features involving Docker or filesystem I/O:
```bash
docker compose -f docker-compose.test.yml up -d
pnpm test:integration
docker compose -f docker-compose.test.yml down
```

## Code Style

- **Formatter:** Prettier (enforced in CI)
- **Linter:** ESLint + TypeScript strict mode
- **Naming:** camelCase for variables/functions, PascalCase for types/classes

ESLint and Prettier configs are committed. Run before opening a PR:
```bash
pnpm lint --fix
pnpm typecheck
```

## Pull Request Process

1. **Create a feature branch** from `main`:
   ```bash
   git checkout -b feat/my-feature
   ```

2. **Make your changes** and commit with DCO sign-off:
   ```bash
   git commit -s -m "feat(scope): description"
   ```

3. **Ensure all checks pass**:
   ```bash
   pnpm lint
   pnpm typecheck
   pnpm test
   pnpm build
   ```

4. **Push and open a PR**:
   ```bash
   git push origin feat/my-feature
   ```

5. **PR description** should include:
   - Clear summary of what changed and why
   - Link to related GitHub issue (if applicable)
   - Screenshots for UI changes
   - Test plan (what did you test?)
   - Checklist:
     - [ ] Tests pass locally
     - [ ] No console warnings
     - [ ] Follows code style
     - [ ] DCO signed-off
     - [ ] No secrets in commit history

### PR Title Format
```
[feature|fix|docs|chore]: Brief description

Example:
feat(auth): add OAuth 2.0 multi-tenant support
```

## DCO Sign-Off

All commits require Developer Certificate of Origin (DCO) sign-off:

```bash
git commit -s -m "feat(scope): description"
```

The `-s` flag adds a "Signed-off-by:" line to your commit. By signing off, you certify:

> I developed this code and have the legal right to submit it under the open-source license used by this project.

This is a standard practice in open-source projects. See [Developer Certificate of Origin](https://developercertificate.org/) for details.

## Proposing New Tool Packs

Tool packs are core to Pagurus. Large additions should be proposed as an ADR (Architecture Decision Record) first.

1. Copy `clients/self/projects/pagurus/specs/adr-template.md`
2. Write up the motivation, constraints, and options
3. Open a Discussion or issue for community feedback
4. Once consensus reached, implement as a feature branch
5. Link the merged ADR in your PR

See existing ADRs for examples:
- [ADR-001](clients/self/projects/pagurus/specs/adr-001-pagurus-platform-architecture-2026-05-13.md) — Platform architecture
- [ADR-003](clients/self/projects/pagurus/specs/adr-003-pagurus-tool-surface-2026-05-13.md) — Tool surface design

## Security Issues

**Do not open public issues for security vulnerabilities.** See [SECURITY.md](SECURITY.md) for responsible disclosure.

## Documentation

- Update `.env.example` for new environment variables
- Update README if user-facing behavior changes
- Update CHANGELOG.md in the `[Unreleased]` section
- Add JSDoc comments for public functions

## Questions?

- Open a Discussion for questions or ideas
- Open an Issue for bugs
- Email maintainer for security issues

Thank you for helping make Pagurus better!
