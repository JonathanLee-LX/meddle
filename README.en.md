# Easy Proxy

Easy Proxy is a local development proxy server with custom routing rules, mock support, HTTPS interception, a Web UI, and MCP integration.

[简体中文 README](./README.md)

## Features

- Custom routing rules with `.eprc`, JSON, and JS config support
- Mock rule management for local debugging
- HTTPS interception with local certificate generation
- Web UI for rules, logs, plugins, and settings
- MCP server for IDE and agent workflows
- Plugin runtime for built-in and custom extensions

## Installation

```bash
npm install -g easy-dev-proxy
```

This installs the `ep` command.

Requirements:

- Node.js `>= 18`

## Quick Start

```bash
# Start the proxy server
ep

# Start and open a browser configured with the proxy
ep --open

# Print the current proxy URL
ep url

# Show proxy, route, and mock status
ep status

# Validate local configuration files
ep doctor
```

The proxy starts searching for an available port from `8989`. Use `ep url` or the startup log to confirm the actual listening address.

For the full command set, see [CLI Reference](./docs/CLI_REFERENCE.md).

## Configuration Directory

The default configuration directory is `~/.ep/`:

```text
~/.ep/
├── .eprc              # Default route rules
├── mocks.json         # Mock rules
├── settings.json      # System settings
├── route-rules/       # Additional route rule files
└── ca/                # SSL certificate directory
```

Supported routing config sources:

- Project-local: `.eprc`, `ep.config.json`, `ep.config.js`
- User-level: `~/.ep/.eprc`

See [CONFIG_STRUCTURE.md](./CONFIG_STRUCTURE.md) for rule matching, wildcards, exclusions, and marker-based rewrites.

## Web UI

The Web UI and HTTP API are served from the same address as the proxy service. By default, the server starts from `http://127.0.0.1:8989` and uses the next free port if needed.

Common API groups:

- `/api/mocks`
- `/api/rules`
- `/api/rule-files`
- `/api/plugins`
- `/api/pipeline`

See [API Reference](./docs/API_REFERENCE.md) for endpoint details.

## MCP Server

The repository ships with `mcp-server.js`, which exposes these MCP tools:

- `start_proxy`
- `get_proxy_url`
- `mock_rule_list`
- `mock_rule_add`
- `mock_rule_update`
- `mock_rule_delete`
- `route_rule_list`
- `route_rule_active_get`
- `route_rule_active_set`
- `route_rule_create_file`
- `route_rule_add`
- `route_rule_update`
- `route_rule_delete`
- `route_preview`

### Cursor / MCP Configuration Example

```json
{
  "mcpServers": {
    "easy-proxy": {
      "command": "node",
      "args": ["/path/to/easy-proxy/mcp-server.js"]
    }
  }
}
```

Or use the npm script from the repository directory:

```json
{
  "mcpServers": {
    "easy-proxy": {
      "command": "npm",
      "args": ["run", "mcp", "--prefix", "/path/to/easy-proxy"]
    }
  }
}
```

## Plugin System

Easy Proxy includes a plugin runtime and built-in plugins for routing, logging, and mock behavior.

Related docs:

- [Plugin System Guide](./docs/plugin/PLUGIN_SYSTEM_GUIDE.md)
- [Pipeline Mode Guide](./docs/plugin/PIPELINE_MODE_GUIDE.md)
- [RFC: Plugin Architecture](./docs/plugin/RFC_PLUGIN_ARCHITECTURE.md)

## AI Plugin Generation

The Web UI can generate custom plugins with AI and automatically compile TypeScript plugin code.

Related docs:

- [AI Plugin Feature Summary](./AI_PLUGIN_FEATURE_SUMMARY.md)
- [Plugin Generator Feature](./PLUGIN_GENERATOR_FEATURE.md)
- [Streaming Feature](./STREAMING_FEATURE.md)
- [Plugin Compilation](./PLUGIN_COMPILATION.md)

## Environment Variables

| Variable | Description | Default |
| --- | --- | --- |
| `PORT` | Base port for the proxy and Web UI | `8989` |
| `EP_OPEN` | Open a browser on startup (`1` to enable) | unset |
| `EP_ENV` | Reserved environment name flag; runtime config loading is not wired yet | unset |
| `EP_PLUGIN_MODE` | Plugin mode (`off` / `shadow` / `on`) | `off` |
| `EP_PLUGIN_ON_HOSTS` | Comma-separated allowlist for `on` mode | empty |
| `EP_ENABLE_BUILTIN_ROUTER` | Enable built-in router plugin | `true` |
| `EP_ENABLE_BUILTIN_LOGGER` | Enable built-in logger plugin | `true` |
| `EP_ENABLE_BUILTIN_MOCK` | Enable built-in mock plugin | `false` |

## Development

```bash
pnpm install

# Build and start the backend
pnpm start

# Build, start, and open a browser
pnpm run start:open

# Backend tests
pnpm test

# Type checking
pnpm run typecheck

# Frontend development
pnpm run dev:web
```

Relevant CI and publish workflows:

- `.github/workflows/ci.yml`
- `.github/workflows/publish.yml`

## Documentation

- [Documentation Index (English)](./docs/DOCS_INDEX.en.md)
- [文档索引（中文）](./docs/DOCS_INDEX.md)
- [CLI Reference](./docs/CLI_REFERENCE.md)
- [API Reference](./docs/API_REFERENCE.md)
- [Configuration Structure](./CONFIG_STRUCTURE.md)
