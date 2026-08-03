# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.4.0-beta.10] - 2026-08-03

### Added

- `meddle update` shows a download progress bar (percent + transferred/total) while streaming the binary, and prints a "连接中断，正在重试" notice before each retry attempt.
- Binary download timeout raised from 120s to 5min for slow networks.

## [0.4.0-beta.9] - 2026-08-03

### Changed

- Explicit `--beta` / `--stable` now *switches channels*, including downgrades: `meddle update --stable` from a beta install moves to the latest stable release (instead of reporting the beta as up-to-date). Auto-inferred runs keep the only-upgrade behavior.

## [0.4.0-beta.8] - 2026-08-03

### Fixed

- `meddle update` binary downloads now retry on connection drops (`error reading a body from connection`): 3 attempts with linear backoff before giving up, so flaky networks no longer fail the whole upgrade.

## [0.4.0-beta.7] - 2026-08-03

### Fixed

- `meddle update --check --stable` (or `--beta`) on a prerelease install no longer echoes the current version as "已是最新版本". It now reports the channel's actual latest version, e.g. `当前 0.4.0-beta.6 已超过稳定频道最新版本 0.3.1`.

## [0.4.0-beta.6] - 2026-08-03

### Added

- `meddle update` now auto-infers the update channel from the current version: prerelease installs (e.g. `0.4.0-beta.4`) default to the beta channel, releases default to stable. Explicit `--beta` / `--stable` flags override the inference.

### Fixed

- Beta channel no longer queries the GitHub releases API (unauthenticated callers hit 403 rate limits). It now resolves through the npm registry `beta` dist-tag (`MEDDLE_NPM_BETA_REGISTRY_URL` mirrors it), which is published in lockstep with GitHub releases.

## [0.4.0-beta.4] - 2026-08-03

### Added

- `meddle update --beta` — check/upgrade through the beta channel: npm installs query the `beta` dist-tag, binary installs list GitHub releases and pick the highest prerelease (`--check --beta`, `status` also support the channel)

## [0.4.0-beta.3] - 2026-08-03

### Fixed

- MITM HTTPS server port conflict (`EADDRINUSE`) no longer crashes the whole proxy: `listenWithRetry` retries with a fresh port instead of letting the async listen error escape to `uncaughtException` and `process.exit(1)`

## [0.4.0-beta.2] - 2026-08-02

### Added

- Offline e2e test for `meddle update` (local HTTP fixtures, `pnpm run test:e2e:update`)
- `MEDDLE_UPDATE_BASE_URL` / `MEDDLE_NPM_REGISTRY_URL` / `MEDDLE_GITHUB_LATEST_URL` env vars for mirror/offline testing

## [0.4.0-beta.1] - 2026-08-02

### Added

- Auto-update: `meddle update` command (check / upgrade / `--version <x.y.z>` / `--auto on|off` / `status`)
- Non-blocking async version check on proxy startup (24h cache, never blocks boot)
- Binary installs: SHA256-verified download + `.bak` backup + atomic replace; auto-update downloads on startup when enabled (default off)
- npm installs: `meddle update` runs `npm install -g`

### Fixed

- Windows: `spawnSync('npm')` now uses shell (npm.cmd); replace failure restores backup with a clear error
- Binary download timeout raised to 120s for large payloads
- Auto-update skips download when the running executable path differs from the install dir (session / custom PATH)

## [0.3.1] - 2026-08-02

### Fixed

- Web lint errors: setState in effect (monaco-editor, use-mocks, use-scroll-shadows), non-component exports (rule-config, badge), missing useCallback deps (mock-config), prefer-const and no-useless-escape (code-fixer), no-explicit-any (api-client)
- Install script: use GitHub release redirect instead of API to avoid 403 rate limiting; clean output with progress bar

## [0.3.0] - 2026-08-01

### Added

- Binary distribution via `deno compile`: single-file executables for 6 platforms (linux-x64/arm64, darwin-x64/arm64, windows-x64/arm64), no Node.js required
- Single-entry dispatch (`bin/main.js`) routing proxy/mcp/cli via `MEDDLE_ENTRY` env var
- CI workflow (`.github/workflows/build-binary.yml`): v* tag triggers 6-target cross-compilation with smoke test and SHA256 release upload
- Install scripts: `scripts/install-binary.sh` (macOS/Linux) and `scripts/install-binary.ps1` (Windows) with checksum verification
- Automated binary smoke test (`scripts/binary-smoke.cjs`) using local origin server

### Changed

- Self-spawn (mcp-server, supervise, session create) now uses env-based dispatch instead of script paths
- Binary size optimized from 477MB to 133MB by excluding devDependencies, puppeteer-core, and web/node_modules

### Removed

- Dead code `core/plugin-compiler.ts` (unused esbuild dependency)

## [0.2.2] - 2026-07-31

### Fixed

- Event loop starvation (watchdog `eventLoopDelay` critical) caused by synchronous zlib decompression of large compressed upstream responses on the proxy hot path; bodies are now decompressed asynchronously off the event loop and oversized compressed inputs are refused instead of decompressed

## [0.2.1] - 2026-07-31

### Added

- `meddle --version` / `meddle -v` CLI flag as a shortcut alias for `meddle version`

## [0.2.0] - 2026-07-31

### Added

- Configurable `detailBodySizeKB` setting (default `256KB`) to cap request/response body size stored in log details, with structured `requestBodyTruncated` / `responseBodyTruncated` / `requestBodyOriginalBytes` / `responseBodyOriginalBytes` markers for truncated bodies
- Per-session inheritance for `detailBodySizeKB`: session settings → default session settings → `MEDDLE_MAX_DETAIL_BODY_KB` env → default 256KB

### Fixed

- Memory leak via unbounded detail body storage (proxy records stored up to 5MB bodies x 200 details, causing RSS to exceed the watchdog threshold)
- Memory leak via unbounded HTTP/2 session pool; sessions are now capped (default 32, configurable via `MEDDLE_MAX_H2_SESSIONS`) with LRU eviction

## [0.1.2] - 2026-07-30

### Added

- Output proxy server URL (`http://127.0.0.1:<port>`) on startup for easy access

## [0.1.1] - 2026-07-28

### Added

- `meddle version` command to display package, Node.js, and platform info

## [0.1.0] - 2026-07-28

### Fixed

- Proxy responses now stream in real-time instead of buffering the entire body

## [0.0.3] - 2026-07-27

### Added

- Automated tests for certificate trust detection (`checkCATrusted`)
- Exported `checkCATrusted` for testability

### Fixed

- Certificate trust detection bypasses unreliable `node-easy-cert` curl check;
  uses `security find-certificate` (macOS) and `openssl verify` (Linux) instead
- Linux auto-trust install for Debian (`update-ca-certificates`) and RHEL (`update-ca-trust`)

## [0.0.2] - 2026-07-27

### Fixed

- Renamed `bin/index` to `bin/index.js` so Node.js resolves the CLI entry correctly

## [0.0.1] - 2026-07-27

### Added

- Initial public release of `@jonathanleelx/meddle`
- Proxy server with routing rules, mock responses, and HTTPS interception
- Plugin system (builtin: logger, mock, router)
- MCP server integration
- CLI commands: start, supervise, status, doctor, url, mock, route, session
- Web dashboard (React + Vite)
- Multi-session isolation (preview)
