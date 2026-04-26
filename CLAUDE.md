# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Easy Proxy is a development proxy server with a plugin-based architecture. It supports custom routing rules, mock responses, HTTPS interception, and an extensible plugin system.

## Development Commands

```bash
pnpm install           # Install dependencies
pnpm run build         # Build TypeScript (outputs to dist/)
pnpm run build:watch   # Build with watch mode
pnpm run test          # Run all tests (vitest)
pnpm run test:watch    # Run tests with watch mode
pnpm run test:refactor # Build + syntax check + test
pnpm run start         # Build and start proxy server
pnpm run start:open    # Start with browser launch
pnpm run doctor        # Run configuration diagnostics
pnpm run mcp           # Start MCP server
```

**Run a single test file:**
```bash
pnpm exec vitest run tests/helpers.spec.ts
```

## Architecture

### Core Modules (`core/`)

| Module | Purpose |
|--------|---------|
| `types.ts` | All TypeScript interfaces (Plugin, HookContext, Pipeline, etc.) |
| `pipeline.ts` | Request pipeline engine - orchestrates hooks in order |
| `plugin-runtime.ts` | PluginManager (registration/state) + HookDispatcher (execution with timeout) |
| `plugin-bootstrap.ts` | Plugin initialization and context setup |
| `plugin-context-factory.ts` | Creates PluginContext (log, config, store, eventBus APIs) |
| `route-decision.ts` | Decides routing path based on pipeline mode and gate logic |
| `shadow-compare.ts` | Tracks differences between traditional vs plugin routing (shadow mode) |
| `on-mode-gate.ts` | Host whitelist gate for "on" mode |
| `mock-gate.ts` | Determines if mock should intercept request |
| `helpers.ts` | Route pattern matching (`testRulePattern`, `resolveTargetUrl`) and EPRC parsing |

### Server API (`server/`)

Express routes for Web UI and CLI:
- `pipeline.ts` - Pipeline mode API (`/api/pipeline/mode`, `/api/pipeline/shadow-stats`)
- `plugins.ts` - Plugin management (`/api/plugins`, `/api/plugins/test`, `/api/plugins/generate`)
- `rule-files.ts` - Route rule file management (`/api/rule-files`)
- `mocks.ts` - Mock rule API
- `index.ts` - App creation and ServerContext interface

### Plugin System

**Three modes:**
- `off` - Traditional routing only (no plugins)
- `shadow` - Plugins run but don't affect routing (comparison tracking)
- `on` - Plugins fully control routing

**Hook execution order (by priority):**
```
onRequestStart → onBeforeProxy → onAfterRequest → upstream → onBeforeResponse → onAfterResponse → onError
```

**Hook timeout:** 10ms default per hook (`runWithTimeout` in plugin-runtime.ts)

**PluginContext APIs:**
- `log` - Logger with plugin ID prefix
- `config` - Persistent config (`~/.ep/plugins-data/{id}.json`)
- `store` - Private storage (`~/.ep/plugins-data/{id}.store.json`)
- `eventBus` - Plugin event pub/sub

### Route Matching (`helpers.ts`)

Pattern types:
1. **Wildcard** - `*.example.com` → matches subdomains
2. **Simple** - `example.com` → literal match (dots escaped)
3. **Regex** - `^https://api\.com/.*` → explicit regex

Matching is against **full URL**, not just host.

**Exclusions:** `pattern !/api !/internal target` - exclusion patterns skip the rule

**Target resolution:**
- Host-only target → inherits protocol, path, query from original
- Target with custom path → **discards original path** (documented behavior)
- `[marker]` syntax → extracts path after marker for rewrite

## Key Files to Read

- `core/types.ts` - All type definitions (start here for understanding interfaces)
- `helpers.ts` - Routing logic (`resolveTargetUrl`, `testRulePattern`, `parseEprcWithExclusions`)
- `core/pipeline.ts` - Request processing flow
- `core/plugin-runtime.ts` - Plugin execution mechanics
- `server/index.ts` - ServerContext structure
- `CONFIG_STRUCTURE.md` - Route rule format documentation

## Testing Notes

- Tests run with vitest
- Run tests after changes to routing logic (`helpers.ts`) or business rules
- Plugin tests in `tests/plugin-runtime.spec.ts`, `tests/pipeline.spec.ts`
- Route tests in `tests/helpers.spec.ts`, `tests/route-preview.spec.ts`

## Environment Variables

| Variable | Effect |
|----------|--------|
| `EP_PLUGIN_MODE` | Plugin mode: off/shadow/on |
| `EP_PLUGIN_ON_HOSTS` | On-mode host whitelist (comma-separated) |
| `PORT` | Web UI port (default 8989) |

## Package Manager

Use `pnpm` for this project. Use `npm link --ignore-scripts` when linking local packages.