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

## Web UI design system (for AI agents)

Stack: `web/` is React 19 + Vite + Tailwind 4 + shadcn **new-york/neutral**. Prefer consistency over redesign; do not introduce a parallel design language.

### Source of truth

| Concern | Location |
| --- | --- |
| Tokens | `web/src/index.css` (`:root`, `.dark`, `@theme`, `data-accent`) |
| Layout classes | `.app-workspace-content`, `.app-page-stack`, `.app-panel-content`, `.app-section`, `.app-field-group` |
| UI kit | `web/src/components/ui/*` |
| Tests | `web/src/components/ui-layout-standard.test.ts`, `web/src/components/ui/button.test.tsx` — update when changing token/Button contracts |

### Tokens

- Spacing: `--ui-page-padding` (1.5rem / 1rem mobile), `--ui-panel-padding` (1.75rem / 1rem), `--ui-content-gap` (2rem / 1.5rem), `--ui-section-gap` 1rem, `--ui-field-gap` 0.75rem, `--ui-copy-leading` 1.5rem; `--font-size-base` 14px + `--app-scale`; shell `max-w-[1600px]`. Prefer `.app-*` layout classes over one-off `p-6` / `gap-8`.
- Radius: `--radius` 0.625rem with `sm` / `md` / `lg` / `xl` / `2xl` / `3xl` / `4xl` scale.
- Colors: semantic CSS variables only. Meddle system: `--system-success`, `--system-warning`. Support Light/Dark + accent modes. Do not invent hex/oklch in feature code.

### Button (Meddle-specific)

- `default` variant = `bg-foreground` (not classic primary).
- Selected / active = primary fill.
- Sizes: `default` / `xs` / `sm` / `lg` / `icon*`. Do not add one-off `h-7` overrides when a size token fits.
- Status pills / tip chips → `Badge`. Prefer `Tabs` / `Input` / `Switch` / `Label` / `Card` from `ui/`.

### Patterns vs screens

Extend shared tokens, layout classes, and `ui/*` primitives. Screens compose patterns; they should not redefine spacing, radius, or color contracts.

### Agent must-follow rules

1. Consistency first — reuse existing tokens and components.
2. No parallel design system or alternate visual language.
3. Touch files minimally; avoid drive-by refactors.
4. Empty / Error / Loading states are Phase 2 — do not invent ad-hoc ones ahead of that work unless fixing a regression.
5. Prefer glass / panel surfaces for in-app chrome; dialogs for focused confirmations/modals.
6. Figma naming alignment comes later — do not rename tokens for Figma parity yet.
7. After UI contract changes: `cd web && npx tsc --noEmit` and `cd web && pnpm run test:run`.

### Roadmap

- **Phase 1** — tokens + primitives (done / in progress on this track).
- **Phase 2** — Empty / Error / Loading.
- **Phase 3+** — polish + Figma alignment.
