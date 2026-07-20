# CLI Reference

Meddle provides a comprehensive CLI for managing proxy rules, mock rules, and viewing status.

## Installation

```bash
npm install @jonathanleelx/meddle -g
```

This creates the `meddle` command.

---

## Commands Overview

| Command | Description |
|---------|-------------|
| `meddle` | Start proxy server (default) |
| `meddle start [options]` | Start proxy server |
| `meddle doctor` | Check configuration health |
| `meddle url` | Get proxy URL |
| `meddle status [--json]` | View proxy status |
| `meddle mock *` | Manage mock rules |
| `meddle route *` | Manage route rules |

---

## Proxy Commands

### meddle

Start proxy server with default settings.

```bash
meddle                # 启动代理服务器
meddle --open         # 启动并自动打开浏览器
```

**Options:**
- `--open` - Launch browser with proxy configured

### meddle start

Start proxy server.

```bash
meddle start          # 启动代理服务器
meddle start --open   # 启动并打开浏览器
meddle start --remote # 允许局域网设备连接
```

**Options:**
- `--open` - Launch browser with proxy
- `--remote` - Allow private LAN devices to use the proxy
- `--remote-token <token>` - Require Basic proxy authentication
- `--intercept-https` - Decrypt all HTTPS traffic
- `--no-intercept-https` - Disable HTTPS decryption in remote mode

---

## Diagnostic Commands

### meddle doctor

Check configuration file health.

```bash
meddle doctor
```

Checks:
- Configuration directory exists
- System settings file format
- Route rules file valid
- Mock rules file valid
- SSL certificate files exist
- File permissions

**Output:**
```
Configuration Health Check

✓ 配置目录 ~/.meddle 存在
✓ 系统设置文件 ~/.meddle/settings.json 格式正确
✓ 路由规则目录 ~/.meddle/route-rules 包含 2 个有效文件
✓ Mock 规则文件 ~/.meddle/mocks.json 有效
✓ SSL 证书文件存在
✓ 文件权限正常

Status: healthy
```

### meddle status

View proxy and rules status.

```bash
meddle status         # 查看状态（文本格式）
meddle status --json  # JSON 格式输出
```

**Output:**
```
Proxy Status
Proxy URL: http://localhost:8899
Status: Running

Mock Rules
Total: 5
Active: 3

Route Rules
Files: 2
Active Files: 1
Total Rules: 10
Total Exclusions: 3

  ✓ default (5 rules, 2 exclusions)
  ○ beta-rules (3 rules)
```

**JSON Output:**
```json
{
  "proxyUrl": "http://localhost:8899",
  "running": true,
  "mocks": {"total": 5, "active": 3},
  "routes": {
    "files": 2,
    "activeFiles": 1,
    "totalRules": 10,
    "totalExclusions": 3
  }
}
```

### meddle url

Get proxy URL for MCP/IDE integration.

```bash
meddle url
```

---

## Mock Commands

### meddle mock list

List all mock rules.

```bash
meddle mock list           # 文本格式
meddle mock list --json    # JSON 格式
```

**Output:**
```
Mock Rules (5 total)

#1 Mock API ✓
  Pattern: /api/user
  Method: GET
  Status: 200
  Delay: 0ms

#2 Mock Error ○
  Pattern: /api/error
  Method: *
  Status: 500
  Delay: 100ms
```

### meddle mock add

Add a mock rule.

```bash
meddle mock add --name "API Mock" --pattern "/api/user" --method GET --status 200 --body '{"name":"test"}' --delay 100 --json
```

**Options:**
- `--name <name>` - Rule name (required)
- `--pattern <pattern>` - URL pattern (required)
- `--method <method>` - HTTP method (GET/POST/PUT/DELETE/*) (default: `*`)
- `--status <code>` - Status code (default: `200`)
- `--body <body>` - Response body
- `--delay <ms>` - Response delay (default: `0`)
- `--headers <json>` - Response headers (JSON string)
- `--json` - JSON format output

**Example:**
```bash
meddle mock add \
  --name "Login API" \
  --pattern "/api/login" \
  --method POST \
  --status 200 \
  --body '{"token":"abc123"}' \
  --headers '{"Content-Type":"application/json"}' \
  --delay 50
```

### meddle mock update

Update a mock rule.

```bash
meddle mock update 1 --status 404 --delay 200
```

**Options:**
- All options from `meddle mock add`

### meddle mock delete

Delete a mock rule.

```bash
meddle mock delete 1
```

### meddle mock enable / disable

Enable or disable a mock rule.

```bash
meddle mock enable 1
meddle mock disable 2
```

---

## Route Commands

### meddle route list

List all route files.

```bash
meddle route list           # 文本格式
meddle route list --json    # JSON 格式
```

**Output:**
```
Route Files (2 total)

✓ default (5 rules, 2 exclusions)
○ beta-rules (3 rules)
```

### meddle route show

Show route file content.

```bash
meddle route show default           # 文本格式
meddle route show default --json    # JSON 格式
```

**Output:**
```
Route File: default

example.com localhost:3000
api.test.com !/internal localhost:8080
*.example.com 127.0.0.1:5000
```

### meddle route active

View or set active route files.

```bash
meddle route active           # 查看当前激活的文件
meddle route active set beta  # 设置激活的文件
```

### meddle route create

Create a new route file.

```bash
meddle route create beta-rules
```

### meddle route add

Add a rule to a route file.

```bash
meddle route add <file> <pattern> <target>
```

**Example:**
```bash
meddle route add default "api.example.com" "localhost:3000"
meddle route add beta "app.example.com !/api" "http://localhost:8000"
meddle route add dev "^https://app.example.com[/api/v2]" "https://localhost:13001"
```

**Note:**
- Supports exclusion patterns: `pattern !exclusion target`
- Supports marker syntax: `pattern[marker] target`

### meddle route update

Update a rule in a route file.

```bash
meddle route update <file> <pattern> <new-target>
```

**Example:**
```bash
meddle route update default "api.example.com" "localhost:4000"
```

### meddle route delete

Delete a rule from a route file.

```bash
meddle route delete <file> <pattern>
```

**Example:**
```bash
meddle route delete default "api.example.com"
```

---

## Global Options

| Option | Description |
|--------|-------------|
| `--help, -h` | Show help |
| `--json` | JSON format output (for list/show/status) |
| `--open` | Launch browser (for start) |
| `--remote` | Allow private LAN devices to use the proxy |
| `--remote-token <token>` | Require Basic proxy authentication; username is `meddle` |
| `--intercept-https` | Decrypt and capture all HTTPS traffic |
| `--no-intercept-https` | Disable HTTPS decryption in remote mode |

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `MEDDLE_PLUGIN_MODE` | Plugin mode (off/shadow/on) |
| `MEDDLE_PLUGIN_ON_HOSTS` | On mode host whitelist |
| `MEDDLE_OPEN` | Open browser flag (`1` to enable) |
| `MEDDLE_REMOTE` | Enable private LAN proxy access (`1` to enable) |
| `MEDDLE_REMOTE_TOKEN` | Remote proxy password; username is `meddle` |
| `MEDDLE_INTERCEPT_HTTPS` | Decrypt all HTTPS traffic (`1` or `0`) |
| `MEDDLE_BIND_HOST` | Proxy listen address |
| `DEBUG` | Debug logging |
| `PORT` | Web interface port (default: 8989) |

---

## Examples

### Quick Start

```bash
# 安装并启动
npm install @jonathanleelx/meddle -g
meddle

# 检查状态
meddle status

# 添加路由规则
meddle route add default "api.test.com" "localhost:3000"

# 添加 Mock 规则
meddle mock add --name "Test API" --pattern "/api/test" --status 200 --body '{"ok":true}'
```

### Mobile Device Capture

```bash
# Bind to the LAN and decrypt HTTPS
meddle --remote

# Enable proxy authentication when the mobile OS supports it
meddle --remote --remote-token "change-me"
```

The startup output contains a setup URL such as `http://192.168.1.10:8989/`. Open it on the phone, configure that host and port as the Wi-Fi HTTP proxy, then install and trust the linked CA certificate.

Remote clients can access only the setup page, CA certificate, and proxy service. The Web UI and `/api` routes remain loopback-only. Certificate-pinned apps and Android apps that reject user-installed CAs cannot be decrypted.

### Multiple Route Configurations

```bash
# 创建并启用一组 beta 路由规则
meddle route create beta-rules --content '
beta.api.com localhost:4000
'
meddle route active set beta-rules
```

### JSON Output for Scripting

```bash
# 获取状态并解析
meddle status --json | jq '.mocks.active'

# 获取 mock 规则列表
meddle mock list --json | jq '.[] | select(.enabled)'
```

---

## See Also

- [API Reference](./API_REFERENCE.md) - HTTP API documentation
- [Configuration Structure](../CONFIG_STRUCTURE.md) - Configuration file format
- [README](../README.md) - General usage guide
