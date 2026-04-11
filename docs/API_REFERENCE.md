# API Reference

Easy Proxy provides HTTP API for managing proxy rules, mock rules, plugins, and pipeline mode.

## Base URL

```
http://localhost:8989
```

## Overview

| Category | Endpoints |
|----------|-----------|
| Pipeline Mode | `/api/pipeline/*` |
| Plugins | `/api/plugins/*` |
| Mock Rules | `/api/mocks/*` |
| Route Rules | `/api/rules/*`, `/api/rule-files/*` |
| Logs | `/api/logs/*` |
| Config | `/api/config/*` |
| Refactor | `/api/refactor/*` |

---

## Pipeline API

### GET /api/pipeline/mode

Get current pipeline mode.

**Response:**
```json
{
  "mode": "off" | "shadow" | "on"
}
```

### PUT /api/pipeline/mode

Set pipeline mode.

**Request Body:**
```json
{
  "mode": "shadow"
}
```

**Response:**
```json
{
  "status": "success",
  "oldMode": "off",
  "mode": "shadow"
}
```

### GET /api/pipeline/shadow-stats

Get shadow comparison statistics.

**Response:**
```json
{
  "total": 500,
  "diff": 12,
  "same": 488,
  "diffRate": "0.024",
  "uniqueDiffPairs": 3,
  "topDiffs": [...],
  "samples": [...],
  "onModeGate": {
    "mode": "on",
    "allowed": 100,
    "denied": 50,
    "total": 150
  }
}
```

### POST /api/pipeline/shadow-stats/reset

Reset shadow comparison statistics.

**Response:**
```json
{
  "status": "success",
  "stats": {...}
}
```

### GET /api/pipeline/readiness

Get readiness evaluation for switching to on mode.

**Response:**
```json
{
  "mode": "shadow",
  "readiness": {
    "ready": true,
    "reason": "差异率 1.2% < 5%，可以切换",
    "total": 500,
    "minSamples": 200,
    "diffRate": 0.012,
    "maxDiffRate": 0.05
  },
  "advice": "...",
  "shadowStats": {...},
  "onModeGate": {...}
}
```

### GET /api/pipeline/config

Get pipeline configuration.

**Response:**
```json
{
  "mode": "shadow",
  "allowlist": [],
  "plugins": {
    "router": true,
    "logger": true,
    "mock": true
  },
  "thresholds": {
    "shadowWarnMinSamples": 200,
    "shadowWarnDiffRate": 0.05
  },
  "onModeGate": {...}
}
```

---

## Plugins API

### GET /api/plugins

Get all plugins list.

**Response:**
```json
{
  "mode": "shadow",
  "total": 3,
  "plugins": [
    {
      "id": "builtin.router",
      "name": "Router",
      "version": "1.0.0",
      "hooks": ["onBeforeProxy"],
      "permissions": ["proxy:read", "proxy:write"],
      "priority": 50,
      "state": "running",
      "stats": {...}
    }
  ]
}
```

### PUT /api/plugins/:id/toggle

Enable or disable a plugin.

**Request Body:**
```json
{
  "enabled": false
}
```

**Response:**
```json
{
  "status": "success",
  "pluginId": "custom.my-plugin",
  "state": "disabled"
}
```

### GET /api/plugins/health

Get plugins health status.

**Response:**
```json
{
  "mode": "shadow",
  "healthy": true,
  "issues": [],
  "plugins": [...]
}
```

### GET /api/plugins/logger

Get logger plugin info.

**Response:**
```json
{
  "pluginId": "builtin.logger",
  "mode": "shadow",
  "stats": {...},
  "summary": {...},
  "recent": [...]
}
```

### GET /api/plugins/mock

Get mock plugin info.

**Response:**
```json
{
  "pluginId": "builtin.mock",
  "enabled": true,
  "mode": "on",
  "stats": {...}
}
```

### POST /api/plugins/test

Test a plugin with a simulated request.

**Request Body:**
```json
{
  "pluginId": "custom.my-plugin",
  "url": "https://api.example.com/users",
  "method": "GET",
  "headers": {...},
  "body": "",
  "integrated": true
}
```

**Response:**
```json
{
  "status": "success",
  "results": {
    "pluginId": "custom.my-plugin",
    "hooks": ["onBeforeProxy"],
    "hookResults": {...},
    "realRequest": {...},
    "shortCircuited": false
  }
}
```

### Plugin Generation API

#### POST /api/plugins/generate-stream

Generate plugin code via AI (streaming).

**Request Body:**
```json
{
  "requirement": "添加 CORS headers 到所有响应",
  "aiConfig": {
    "provider": "openai",
    "apiKey": "sk-...",
    "baseUrl": "...",
    "model": "gpt-4"
  }
}
```

**Response (SSE):**
```
event: start
data: {"status":"generating"}

event: chunk
data: {"chunk":"...", "accumulated":"..."}

event: complete
data: {"status":"success", "plugin": {...}}
```

#### POST /api/plugins/generate

Generate plugin code (non-streaming, backward compatible).

**Request Body:** Same as generate-stream

**Response:**
```json
{
  "status": "success",
  "plugin": {...}
}
```

#### POST /api/plugins/save

Save plugin to config directory.

**Request Body:**
```json
{
  "filename": "my-plugin.js",
  "code": "// plugin code"
}
```

**Response:**
```json
{
  "status": "success",
  "message": "插件已保存",
  "path": "~/.ep/plugins/my-plugin.js"
}
```

### Custom Plugin Management

#### GET /api/plugins/custom

List custom plugins.

**Response:**
```json
{
  "plugins": [
    {
      "filename": "my-plugin.js",
      "path": "~/.ep/plugins/my-plugin.js",
      "modified": "2026-04-11T10:00:00Z"
    }
  ]
}
```

#### GET /api/plugins/custom/:filename/code

Get plugin source code.

**Response:**
```json
{
  "filename": "my-plugin.js",
  "code": "// plugin code"
}
```

#### PUT /api/plugins/custom/:filename/code

Update plugin source code.

**Request Body:**
```json
{
  "code": "// updated code"
}
```

#### DELETE /api/plugins/custom/:filename

Delete custom plugin.

**Response:**
```json
{
  "status": "success",
  "message": "插件已删除"
}
```

#### POST /api/plugins/reload

Reload custom plugins.

**Response:**
```json
{
  "status": "success",
  "message": "已重新加载 2 个自定义插件",
  "count": 2,
  "plugins": [...]
}
```

### Plugin Fix API

#### POST /api/plugins/fix

Auto-fix plugin with AI (non-streaming).

**Request Body:**
```json
{
  "originalCode": "...",
  "testError": "TypeError: ...",
  "requirement": "...",
  "aiConfig": {...}
}
```

**Response:**
```json
{
  "status": "success",
  "fixedCode": "..."
}
```

#### POST /api/plugins/fix-stream

Auto-fix plugin with AI (streaming).

#### POST /api/plugins/revise-stream

Revise plugin with AI instruction (streaming).

---

## Mock Rules API

### GET /api/mocks

List all mock rules.

**Response:**
```json
[
  {
    "id": 1,
    "name": "Mock API",
    "urlPattern": "/api/user",
    "method": "GET",
    "statusCode": 200,
    "headers": {...},
    "bodyType": "inline",
    "body": "{\"name\":\"test\"}",
    "delay": 0,
    "enabled": true
  }
]
```

### POST /api/mocks

Create mock rule.

**Request Body:**
```json
{
  "name": "Mock API",
  "urlPattern": "/api/user",
  "method": "GET",
  "statusCode": 200,
  "headers": {"Content-Type": "application/json"},
  "bodyType": "inline",
  "body": "{\"name\":\"test\"}",
  "delay": 100,
  "enabled": true
}
```

### PUT /api/mocks/:id

Update mock rule.

### DELETE /api/mocks/:id

Delete mock rule.

---

## Route Rules API

### GET /api/rules

Get current route rules (EPRC format).

**Response (text/plain):**
```
example.com 127.0.0.1:3000
/api/.* http://localhost:8080
```

### POST /api/rules/preview

Preview route target for a URL.

**Request Body:**
```json
{
  "url": "https://api.example.com/users",
  "rulesText": "api.example.com localhost:3000"
}
```

**Response:**
```json
{
  "status": "success",
  "target": "http://localhost:3000/users",
  "matchedPattern": "api.example.com"
}
```

---

## Rule Files API

### GET /api/rule-files

List all rule files.

**Response:**
```json
[
  {
    "name": "default",
    "enabled": true,
    "ruleCount": 5,
    "excludeCount": 2
  }
]
```

### POST /api/rule-files

Create rule file.

**Request Body:**
```json
{
  "name": "beta-rules",
  "content": "",
  "enabled": true
}
```

### GET /api/rule-files/:name/content

Get rule file content.

**Response (text/plain):** EPRC format text

### PUT /api/rule-files/:name/content

Update rule file content.

**Request Body:**
```json
{
  "content": "example.com localhost:3000"
}
```

### PUT /api/rule-files/:name

Update rule file attributes (enable/disable, rename).

**Request Body:**
```json
{
  "enabled": false,
  "newName": "new-rules"
}
```

### DELETE /api/rule-files/:name

Delete rule file.

---

## Logs API

### GET /api/logs

Get proxy logs.

### GET /api/logs/:id

Get log detail.

---

## Config API

### GET /api/config

Get system settings.

### PUT /api/config

Update system settings.

### POST /api/config/diagnose

Run configuration diagnostics.

**Response:**
```json
{
  "status": "healthy",
  "checks": [
    {"name": "配置目录", "status": "ok", "path": "~/.ep"},
    {"name": "路由规则文件", "status": "ok"},
    ...
  ],
  "errors": [],
  "warnings": []
}
```

---

## Refactor API

### GET /api/refactor/status

Get comprehensive runtime status.

**Response:**
```json
{
  "runtime": {
    "pid": 12345,
    "uptimeSec": 3600
  },
  "mode": "shadow",
  "readiness": {...},
  "plugins": [...],
  "loggerSummary": {...}
}
```

---

## Error Responses

All endpoints return errors in this format:

```json
{
  "error": "错误信息描述"
}
```

HTTP Status Codes:
- `400` - Bad Request (invalid parameters)
- `404` - Not Found (plugin/rule not found)
- `409` - Conflict (duplicate name)
- `500` - Internal Server Error