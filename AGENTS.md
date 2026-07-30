# AGENTS.md

## Project

`@jonathanleelx/meddle` — dev proxy with routing, mock, HTTPS interception, plugin system, and MCP server.

Two packages: root (Node.js proxy server) and `web/` (React dashboard). Each has its own `pnpm-lock.yaml`.

## Commands

```bash
# Install (root + web separately)
pnpm install
cd web && pnpm install

# TypeCheck (no lint script at root; web lint is non-blocking in CI)
npx tsc --noEmit
cd web && npx tsc --noEmit

# Build (order matters: web first for prepack/publish)
pnpm run build          # tsc → dist/
pnpm run build:web      # cd web && tsc -b && vite build

# Test
pnpm test               # vitest run (root)
cd web && pnpm run test:run

# Single test file
npx vitest run tests/cert.spec.ts
```

Verification order: `tsc --noEmit` → `build` → `test`.

## Architecture

- `bin/` — CLI entry (`bin/index.js`) and subcommands. Plain JS, not compiled by tsc.
- `index.js`, `mcp-server.js` — hand-written JS entry points at root. Not in tsconfig.
- `core/`, `server/`, `plugins/`, `helpers.ts`, `cert.ts` — TypeScript, compiled to `dist/`.
- `web/` — React 19 + Vite 8 + Tailwind 4 + shadcn. Separate pnpm workspace.
- `tests/` — vitest specs (`tests/**/*.spec.ts`). Excluded from tsconfig; vitest transpiles.

## Versioning

Follow [semver](https://semver.org/) (npm convention):

- `patch` (0.1.x) — bug fixes, no API change
- `minor` (0.x.0) — new features, backward-compatible
- `major` (x.0.0) — breaking changes

Bump workflow:

1. Update `"version"` in `package.json`
2. Add entry in `CHANGELOG.md` (date, added/fixed/changed sections)
3. Commit both: `git commit -m "<new-version>"`
4. Tag: `git tag v<new-version>`
5. Push both: `git push origin main && git push origin v<new-version>`

The `v*` tag triggers CI publish to npm. Never publish without a tag.

## Quirks

- `tests/browser.spec.ts` requires puppeteer and is excluded in CI (`process.env.CI`).
- CI installs with `--ignore-scripts` to avoid postinstall build conflicts.
- Publish is triggered by `v*` tags via `.github/workflows/publish.yml` (needs `NPM_TOKEN` secret).
- `cert.ts` uses `node-easy-cert` but bypasses its unreliable `ifRootCATrusted` with a custom `checkCATrusted()` (macOS: `security find-certificate`, Linux: `openssl verify`).
- Config dir: `~/.meddle/`. Env vars: `MEDDLE_*`. CLI command: `meddle`.
- Network to GitHub from this environment is intermittently unreachable; pushes may need retries.
- `.githooks/pre-commit` validates that version bumps include a CHANGELOG.md update. Run `git config core.hooksPath .githooks` after clone to enable it.
