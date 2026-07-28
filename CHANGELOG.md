# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

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
