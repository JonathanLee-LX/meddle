# Easy Proxy

一个用于本地开发调试的代理服务器，支持自定义路由规则、Mock、HTTPS 拦截、Web UI 和 MCP 集成。

[English README](./README.en.md)

## 功能概览

- 自定义路由规则，支持 `.eprc`、JSON、JS 配置
- Mock 规则管理与在线调试
- HTTPS 拦截与本地证书生成
- Web UI 管理规则、日志、插件和系统设置
- MCP Server 集成，方便在 IDE / Agent 场景下调用
- 插件系统，支持内置插件和自定义插件

## 安装

```bash
npm install -g easy-dev-proxy
```

安装后会创建 `ep` 命令。

要求：

- Node.js `>= 18`

## 快速开始

```bash
# 启动代理服务器
ep

# 启动后自动打开浏览器
ep --open

# 查看当前代理地址
ep url

# 查看配置与规则状态
ep status

# 检查本地配置健康状况
ep doctor
```

代理服务默认从 `8989` 开始寻找可用端口，实际监听地址可通过 `ep url` 或启动日志查看。

完整命令见 [CLI Reference](./docs/CLI_REFERENCE.md)。

## 配置目录

默认配置目录为 `~/.ep/`：

```text
~/.ep/
├── .eprc              # 默认路由规则
├── mocks.json         # Mock 规则
├── settings.json      # 系统设置
├── route-rules/       # 多路由文件目录
└── ca/                # SSL 证书目录
```

支持的路由配置来源：

- 项目目录：`.eprc`、`ep.config.json`、`ep.config.js`
- 用户目录：`~/.ep/.eprc`

路由匹配、通配符、排除规则与 marker 重写语法见 [CONFIG_STRUCTURE.md](./CONFIG_STRUCTURE.md)。

## Web UI

启动后，Web UI 和 HTTP API 挂载在代理服务同一地址上。默认情况下会从 `http://127.0.0.1:8989` 开始监听可用端口。

常用接口包括：

- `/api/mocks`
- `/api/rules`
- `/api/rule-files`
- `/api/plugins`
- `/api/pipeline`

完整接口定义见 [API Reference](./docs/API_REFERENCE.md)。

## MCP Server

项目提供 `mcp-server.js`，可暴露以下 MCP 工具：

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

### Cursor / MCP 配置示例

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

或在仓库目录中使用 npm script：

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

## 插件系统

Easy Proxy 提供插件运行时与内置插件体系，可用于扩展路由、日志、Mock 等行为。

相关文档：

- [插件系统完整开发指南](./docs/plugin/PLUGIN_SYSTEM_GUIDE.md)
- [Pipeline 模式指南](./docs/plugin/PIPELINE_MODE_GUIDE.md)
- [RFC: 插件化架构重构方案](./docs/plugin/RFC_PLUGIN_ARCHITECTURE.md)

## AI 插件生成

Web UI 支持通过 AI 生成自定义插件代码，并自动编译 TypeScript 插件。

相关说明：

- [AI 插件功能总结](./AI_PLUGIN_FEATURE_SUMMARY.md)
- [插件生成器功能说明](./PLUGIN_GENERATOR_FEATURE.md)
- [流式输出功能说明](./STREAMING_FEATURE.md)
- [插件编译功能说明](./PLUGIN_COMPILATION.md)

## 环境变量

| 变量 | 说明 | 默认值 |
| --- | --- | --- |
| `PORT` | 代理 / Web UI 起始端口 | `8989` |
| `EP_OPEN` | 启动时自动打开浏览器（`1` 启用） | 未设置 |
| `EP_ENV` | 环境名，占位能力，运行时尚未实现按环境加载 | 未设置 |
| `EP_PLUGIN_MODE` | 插件运行模式（`off` / `shadow` / `on`） | `off` |
| `EP_PLUGIN_ON_HOSTS` | `on` 模式 host 白名单（逗号分隔） | 空 |
| `EP_ENABLE_BUILTIN_ROUTER` | 启用内置路由插件 | `true` |
| `EP_ENABLE_BUILTIN_LOGGER` | 启用内置日志插件 | `true` |
| `EP_ENABLE_BUILTIN_MOCK` | 启用内置 Mock 插件 | `false` |

## 开发

```bash
pnpm install

# 构建后启动
pnpm start

# 构建后启动并自动打开浏览器
pnpm run start:open

# 后端测试
pnpm test

# 类型检查
pnpm run typecheck

# 前端开发
pnpm run dev:web
```

CI / 发布相关工作流位于：

- `.github/workflows/ci.yml`
- `.github/workflows/publish.yml`

## 文档导航

- [文档索引（中文）](./docs/DOCS_INDEX.md)
- [Documentation Index (English)](./docs/DOCS_INDEX.en.md)
- [CLI Reference](./docs/CLI_REFERENCE.md)
- [API Reference](./docs/API_REFERENCE.md)
- [配置文件结构说明](./CONFIG_STRUCTURE.md)
