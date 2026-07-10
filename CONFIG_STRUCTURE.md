# Easy Proxy 配置文件结构说明

## 目录结构

Easy Proxy 的运行配置统一存储在 `~/.ep/`：

```text
~/.ep/
├── route-rules/              # 路由规则文本文件
│   ├── 默认规则.txt
│   └── beta-rules.txt
├── mocks.json                # Mock 规则
├── settings.json             # 系统设置和启用状态
├── ca/                       # HTTPS 证书
│   ├── rootCA.crt
│   ├── rootCA.key
│   └── *.crt / *.key
├── plugins/                  # 用户自定义插件
├── plugins-data/             # 插件配置和持久化数据
├── mcp-proxy-url.json        # MCP 启动时记录的代理地址
└── supervisor.log            # daemon supervisor 日志
```

其中 `route-rules/`、`ca/` 等目录会在需要时自动创建。路由规则不再从项目目录或单个用户配置文件加载。

## 路由规则

### 文件位置与启用状态

每组路由规则对应一个文本文件：

```text
~/.ep/route-rules/<规则文件名称>.txt
```

可以同时启用多个规则文件。启用文件名称及顺序存储在 `settings.json` 的 `activeRuleFiles` 数组中，代理会按数组顺序合并各文件，再按文件内顺序匹配规则。

推荐通过以下方式管理：

- Web 界面的“路由规则”页面
- `ep route list/show/create/add/update/delete`
- `ep route active` 和 `ep route active set <file>`

### 文本格式

每行格式固定为：

```text
pattern [pattern2 ...] [!exclusion ...] target
```

- `target` 必须位于最后。
- 同一行可以包含多个 pattern，它们共享 target 和 exclusion。
- 空行以及以 `#` 或 `//` 开头的行会被忽略。

示例：

```text
# 单条规则
solution.wps.cn http://localhost:8000

# 多个 pattern 共用 target
solution.wps.cn/console solution.wps.cn/dev-server https://localhost:8000

# 排除部分路径
open.wps.cn !/api !/oauth !/internal http://localhost:5173

# 通配符
*.wps.cn 127.0.0.1:3000

# marker 路径重写
^https://365.kdocs.cn[/3rd/work] https://localhost:13001
```

### 匹配规则

1. 请求按照合并后的规则顺序逐条匹配，第一条可用规则生效。
2. pattern 面向完整请求 URL，而不是只匹配 host。
3. pattern 支持显式正则和 `*` 通配符。
4. exclusion 使用 `!` 前缀；任一 exclusion 命中时跳过当前规则，继续检查下一条。
5. target 为 host 或 `host:port` 时，会继承原请求的协议、路径和查询参数。
6. target 带自定义路径时，默认使用 target 自身的路径。
7. pattern 中的 `[marker]` 会保留 marker 后面的原始尾路径，并拼接到 target 后。
8. target 可以是 `file://` URL 或本地绝对路径，用于映射本地文件。
9. WebSocket 请求会根据 target 协议自动转换为 `ws` 或 `wss`。

marker 示例：

```text
^https://365.kdocs.cn[/3rd/work] https://localhost:13001
```

请求：

```text
https://365.kdocs.cn/3rd/work/micro/app?a=1
```

最终地址：

```text
https://localhost:13001/micro/app?a=1
```

## Mock 规则

默认文件：

```text
~/.ep/mocks.json
```

也可以通过 `settings.json` 的 `mocksFilePath` 指定其他 JSON 文件。

示例：

```json
{
  "nextId": 2,
  "rules": [
    {
      "id": 1,
      "name": "模拟 API 响应",
      "urlPattern": "/api/user",
      "method": "GET",
      "statusCode": 200,
      "headers": {
        "Content-Type": "application/json"
      },
      "bodyType": "inline",
      "body": "{\"name\":\"test\"}",
      "delay": 0,
      "enabled": true
    }
  ]
}
```

主要字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | number | 规则 ID |
| `name` | string | 规则名称 |
| `urlPattern` | string | URL 匹配模式 |
| `method` | string | HTTP 方法，`*` 表示全部 |
| `statusCode` | number | HTTP 状态码 |
| `headers` | object | 自定义响应头 |
| `bodyType` | string | `inline` 或 `file` |
| `body` | string | 响应内容或文件路径 |
| `delay` | number | 响应延迟，单位毫秒 |
| `enabled` | boolean | 是否启用 |

> 内置 Mock 插件只处理 `inline` 类型；其他类型由传统 Mock 处理器处理。

## 系统设置

固定位置：

```text
~/.ep/settings.json
```

示例：

```json
{
  "theme": "system",
  "accentColor": "auto",
  "fontSize": "100",
  "activeRuleFiles": [
    "默认规则",
    "beta-rules"
  ],
  "mocksFilePath": "",
  "pluginMode": "off",
  "clientAliases": {
    "10.0.0.8": "测试手机"
  },
  "aiConfig": {
    "enabled": false,
    "provider": "openai",
    "apiKey": "",
    "baseUrl": "",
    "model": "",
    "models": []
  }
}
```

主要字段：

| 字段 | 说明 |
|------|------|
| `theme` | `light`、`dark` 或 `system` |
| `accentColor` | 界面强调色 |
| `fontSize` | 界面缩放百分比字符串，例如 `100` |
| `activeRuleFiles` | 当前启用的路由规则文件名称，顺序即合并顺序 |
| `mocksFilePath` | 自定义 Mock JSON 路径；空值使用默认位置 |
| `pluginMode` | 插件 Pipeline 模式：`off`、`shadow` 或 `on` |
| `clientAliases` | 客户端 IP 到设备名称的映射 |
| `aiConfig` | AI 服务和模型配置 |

设置文件可能包含 API Key，不应提交到代码仓库或发送给他人。

## SSL 证书

证书目录：

```text
~/.ep/ca/
```

- `rootCA.crt`：根证书。
- `rootCA.key`：根证书私钥，必须妥善保管。
- 域名证书和私钥会在 HTTPS 代理过程中按需生成。

首次进行 HTTPS 解密前，需要在系统或测试设备上安装并信任根证书。

## 配置加载规则

### 路由规则

1. 读取 `~/.ep/settings.json` 中的 `activeRuleFiles`。
2. 按数组顺序读取 `~/.ep/route-rules/<名称>.txt`。
3. 合并规则并按顺序匹配。
4. 如果目录为空，首次启动会创建一个默认规则文件并将其设为启用状态。
5. 规则文件修改后会自动重新加载。

### Mock 规则

1. `mocksFilePath` 有值且文件存在时，读取自定义文件。
2. 否则读取 `~/.ep/mocks.json`。
3. 可通过设置页的“重新加载配置”立即重新读取。

### 系统设置

- 始终读取 `~/.ep/settings.json`。
- 文件不存在时使用应用默认值。
- Web 设置页保存时会写入该文件。

## 常用操作

### 查看配置

```bash
ls -la ~/.ep/
ls -la ~/.ep/route-rules/
cat ~/.ep/route-rules/默认规则.txt
cat ~/.ep/mocks.json | jq .
cat ~/.ep/settings.json | jq .
```

### 管理路由文件

```bash
ep route list
ep route create local --content "api.example.com localhost:3000"
ep route show local
ep route active set local
ep route preview "https://api.example.com/users"
```

### 配置健康检查

```bash
ep doctor
```

诊断内容包括：

- `~/.ep/` 是否存在。
- `settings.json` 是否为有效 JSON。
- `route-rules/` 中的规则文件数量和启用状态。
- Mock 文件格式和启用规则数量。
- 根证书及私钥是否存在。

Web 设置页的“配置文件”标签也提供相同的诊断入口。

### 备份与恢复

完整备份：

```bash
tar -czf easy-proxy-backup.tar.gz ~/.ep/
```

仅备份主要配置：

```bash
tar -czf easy-proxy-config-backup.tar.gz \
  ~/.ep/route-rules \
  ~/.ep/mocks.json \
  ~/.ep/settings.json
```

恢复完整备份：

```bash
tar -xzf easy-proxy-backup.tar.gz -C ~/
```

## 安全提示

1. 不要公开 `settings.json` 中的 API Key。
2. 不要分享 `ca/rootCA.key`。
3. 备份文件包含敏感数据时应加密保存。
4. 修改配置前建议先备份 `~/.ep/`。

## 相关文档

- [README](./README.md)
- [CLI Reference](./docs/CLI_REFERENCE.md)
- [API Reference](./docs/API_REFERENCE.md)
- [Mock 优化指南](./MOCK_OPTIMIZATION_SUMMARY.md)
