# CLI Reference

Easy Proxy provides a comprehensive CLI for managing proxy rules, mock rules, and viewing status.

## Installation

```bash
npm install easy-dev-proxy -g
```

This creates the `ep` command.

---

## Commands Overview

| Command | Description |
|---------|-------------|
| `ep` | Start proxy server (default) |
| `ep start [options]` | Start proxy server |
| `ep doctor` | Check configuration health |
| `ep url` | Get proxy URL |
| `ep status [--json]` | View proxy status |
| `ep mock *` | Manage mock rules |
| `ep route *` | Manage route rules |

---

## Proxy Commands

### ep

Start proxy server with default settings.

```bash
ep                # 启动代理服务器
ep --open         # 启动并自动打开浏览器
```

**Options:**
- `--open` - Launch browser with proxy configured

### ep start

Start proxy server.

```bash
ep start          # 启动代理服务器
ep start --open   # 启动并打开浏览器
ep start --remote # 允许局域网设备连接
```

**Options:**
- `--open` - Launch browser with proxy
- `--remote` - Allow private LAN devices to use the proxy
- `--remote-token <token>` - Require Basic proxy authentication
- `--intercept-https` - Decrypt all HTTPS traffic
- `--no-intercept-https` - Disable HTTPS decryption in remote mode

---

## Diagnostic Commands

### ep doctor

Check configuration file health.

```bash
ep doctor
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

✓ 配置目录 ~/.ep 存在
✓ 系统设置文件 ~/.ep/settings.json 格式正确
✓ 路由规则目录 ~/.ep/route-rules 包含 2 个有效文件
✓ Mock 规则文件 ~/.ep/mocks.json 有效
✓ SSL 证书文件存在
✓ 文件权限正常

Status: healthy
```

### ep status

View proxy and rules status.

```bash
ep status         # 查看状态（文本格式）
ep status --json  # JSON 格式输出
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

### ep url

Get proxy URL for MCP/IDE integration.

```bash
ep url
```

---

## Mock Commands

### ep mock list

List all mock rules.

```bash
ep mock list           # 文本格式
ep mock list --json    # JSON 格式
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

### ep mock add

Add a mock rule.

```bash
ep mock add --name "API Mock" --pattern "/api/user" --method GET --status 200 --body '{"name":"test"}' --delay 100 --json
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
ep mock add \
  --name "Login API" \
  --pattern "/api/login" \
  --method POST \
  --status 200 \
  --body '{"token":"abc123"}' \
  --headers '{"Content-Type":"application/json"}' \
  --delay 50
```

### ep mock update

Update a mock rule.

```bash
ep mock update 1 --status 404 --delay 200
```

**Options:**
- All options from `ep mock add`

### ep mock delete

Delete a mock rule.

```bash
ep mock delete 1
```

### ep mock enable / disable

Enable or disable a mock rule.

```bash
ep mock enable 1
ep mock disable 2
```

---

## Route Commands

### ep route list

List all route files.

```bash
ep route list           # 文本格式
ep route list --json    # JSON 格式
```

**Output:**
```
Route Files (2 total)

✓ default (5 rules, 2 exclusions)
○ beta-rules (3 rules)
```

### ep route show

Show route file content.

```bash
ep route show default           # 文本格式
ep route show default --json    # JSON 格式
```

**Output:**
```
Route File: default

example.com localhost:3000
api.test.com !/internal localhost:8080
*.wps.cn 127.0.0.1:5000
```

### ep route active

View or set active route files.

```bash
ep route active           # 查看当前激活的文件
ep route active set beta  # 设置激活的文件
```

### ep route create

Create a new route file.

```bash
ep route create beta-rules
```

### ep route add

Add a rule to a route file.

```bash
ep route add <file> <pattern> <target>
```

**Example:**
```bash
ep route add default "api.example.com" "localhost:3000"
ep route add beta "solution.wps.cn !/api" "http://localhost:8000"
ep route add dev "^https://365.kdocs.cn[/3rd/work]" "https://localhost:13001"
```

**Note:**
- Supports exclusion patterns: `pattern !exclusion target`
- Supports marker syntax: `pattern[marker] target`

### ep route update

Update a rule in a route file.

```bash
ep route update <file> <pattern> <new-target>
```

**Example:**
```bash
ep route update default "api.example.com" "localhost:4000"
```

### ep route delete

Delete a rule from a route file.

```bash
ep route delete <file> <pattern>
```

**Example:**
```bash
ep route delete default "api.example.com"
```

---

## Global Options

| Option | Description |
|--------|-------------|
| `--help, -h` | Show help |
| `--json` | JSON format output (for list/show/status) |
| `--open` | Launch browser (for start) |
| `--remote` | Allow private LAN devices to use the proxy |
| `--remote-token <token>` | Require Basic proxy authentication; username is `easy-proxy` |
| `--intercept-https` | Decrypt and capture all HTTPS traffic |
| `--no-intercept-https` | Disable HTTPS decryption in remote mode |

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `EP_PLUGIN_MODE` | Plugin mode (off/shadow/on) |
| `EP_PLUGIN_ON_HOSTS` | On mode host whitelist |
| `EP_OPEN` | Open browser flag (`1` to enable) |
| `EP_REMOTE` | Enable private LAN proxy access (`1` to enable) |
| `EP_REMOTE_TOKEN` | Remote proxy password; username is `easy-proxy` |
| `EP_INTERCEPT_HTTPS` | Decrypt all HTTPS traffic (`1` or `0`) |
| `EP_BIND_HOST` | Proxy listen address |
| `DEBUG` | Debug logging |
| `PORT` | Web interface port (default: 8989) |

---

## Examples

### Quick Start

```bash
# 安装并启动
npm install easy-dev-proxy -g
ep

# 检查状态
ep status

# 添加路由规则
ep route add default "api.test.com" "localhost:3000"

# 添加 Mock 规则
ep mock add --name "Test API" --pattern "/api/test" --status 200 --body '{"ok":true}'
```

### Mobile Device Capture

```bash
# Bind to the LAN and decrypt HTTPS
ep --remote

# Enable proxy authentication when the mobile OS supports it
ep --remote --remote-token "change-me"
```

The startup output contains a setup URL such as `http://192.168.1.10:8989/`. Open it on the phone, configure that host and port as the Wi-Fi HTTP proxy, then install and trust the linked CA certificate.

Remote clients can access only the setup page, CA certificate, and proxy service. The Web UI and `/api` routes remain loopback-only. Certificate-pinned apps and Android apps that reject user-installed CAs cannot be decrypted.

### Multiple Route Configurations

```bash
# 创建并启用一组 beta 路由规则
ep route create beta-rules --content '
beta.api.com localhost:4000
'
ep route active set beta-rules
```

### JSON Output for Scripting

```bash
# 获取状态并解析
ep status --json | jq '.mocks.active'

# 获取 mock 规则列表
ep mock list --json | jq '.[] | select(.enabled)'
```

---

## See Also

- [API Reference](./API_REFERENCE.md) - HTTP API documentation
- [Configuration Structure](../CONFIG_STRUCTURE.md) - Configuration file format
- [README](../README.md) - General usage guide
