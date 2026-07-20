# 一个非常简单的开发代理服务器

- 自定义代理规则
- 支持https✅

## 使用

全局安装 `npm install @jonathanleelx/meddle -g`，会创建一个 `meddle` 命令。

### 命令

```bash
# 启动代理服务器
meddle

# 启动并自动打开浏览器
meddle --open

# 检查配置文件健康状况
meddle doctor

# 查看代理状态
meddle status

# 显示帮助信息
meddle --help
```

完整 CLI 命令文档见 [CLI Reference](./docs/CLI_REFERENCE.md)

### 配置文件

配置文件扁平化存储在 `~/.meddle/` 目录：

```
~/.meddle/
├── route-rules/       # 路由规则文本文件
├── mocks.json         # Mock 规则配置
├── settings.json      # 系统设置（主题、字体、AI配置）
└── ca/                # SSL 证书目录
```

**路由规则配置**:
- 每个规则文件存储为 `~/.meddle/route-rules/<名称>.txt`
- 可同时启用多个规则文件，启用顺序记录在 `settings.json` 的 `activeRuleFiles`
- 支持顺序匹配、通配符、正则、排除规则和 marker 路径重写
- 可通过 Web 界面或 `meddle route *` 命令管理

**Web 界面管理**:
- 启动后访问 http://localhost:8989
- 通过界面管理路由规则、Mock 规则和系统设置

详见 [配置文件结构说明](./CONFIG_STRUCTURE.md)

### 自动打开浏览器并设置代理

使用以下任一方式启动：
- `meddle --open`（全局安装后）
- `npm run start:open`（开发时）
- `MEDDLE_OPEN=1 npm run start`

启动后将使用 Chrome/Edge/Chromium 的 `--proxy-server` 参数启动浏览器，仅该浏览器实例使用代理，不修改系统代理设置。

### 手机远程代理与抓包

电脑和手机连接同一局域网后，使用远程模式启动：

```bash
meddle --remote

# 推荐：在支持代理认证的设备上设置口令
meddle --remote --remote-token "change-me"
```

启动日志会输出手机配置入口和代理地址，例如：

```text
手机配置入口: http://192.168.1.10:8989/
代理服务器: 192.168.1.10:8989
```

也可以在电脑上打开 `http://127.0.0.1:8989/_meddle/setup` 查看手机配置页。

1. 用手机浏览器打开“手机配置入口”。
2. 在当前 Wi-Fi 的 HTTP 代理设置中选择手动，填写电脑 IP 和端口。
3. 下载并安装 `meddle-ca.crt`。
4. 在系统设置中完全信任该根证书，然后在电脑 Web 界面查看 HTTP/HTTPS 请求与响应。

iOS 安装证书后，还需前往“设置 → 通用 → 关于本机 → 证书信任设置”开启完全信任。Android 应用是否信任用户证书取决于应用配置；使用证书锁定的 App 无法解密 HTTPS 流量。

远程模式只允许局域网私有地址接入，且远程设备不能访问管理 API。默认会解密 HTTPS；如只需普通隧道代理，可使用：

```bash
meddle --remote --no-intercept-https
```

### 请求来源应用识别

日志面板会识别请求来源应用：

- macOS 本机请求通过 socket 反查真实进程，可信度高。
- 远程设备请求根据 User-Agent 推断 Chrome、Safari、Firefox、Edge 和常见 WebView。
- 推断结果会显示“推断”标记，不会生成虚假的 PID 或 Bundle ID。
- 可使用 `app:Chrome`、`app:Safari` 等条件过滤日志。

远程 HTTPS 只有在开启解密并成功读取 HTTP 请求头时才能进行 User-Agent 推断。完整策略、字段和限制见 [请求来源应用识别](./docs/APPLICATION_IDENTITY.md)。

### MCP Server

提供 MCP 工具：启动代理服务器、管理路由规则与 Mock 规则、创建和管理多 Session。

**Cursor 配置**：在 Cursor 设置中添加 MCP 服务器：

```json
{
  "mcpServers": {
    "meddle": {
      "command": "node",
      "args": ["/path/to/meddle/mcp-server.js"]
    }
  }
}
```

或使用 npm 脚本（在项目目录下）：

```json
{
  "mcpServers": {
    "meddle": {
      "command": "npm",
      "args": ["run", "mcp", "--prefix", "/path/to/meddle"]
    }
  }
}
```

**MCP 工具列表：**

| 工具 | 说明 |
|------|------|
| `start_proxy` | 启动默认代理服务器 |
| `get_proxy_url` | 获取代理地址 |
| `create_session` | 创建隔离代理 session |
| `delete_session` | 删除指定 session |
| `list_sessions` | 列出所有 session |
| `mock_rule_*` | Mock 规则管理（支持 session 参数） |
| `route_rule_*` | 路由规则管理（支持 session 参数） |
| `route_preview` | 预览路由匹配结果（支持 session 参数） |

所有 `mock_rule_*`、`route_rule_*`、`route_preview` 工具均支持可选 `session` 参数，指定后可操作对应 session 的规则，不传则操作默认 session。

### 多 Session 隔离（预览功能）

多 Session 允许同时运行多个独立的 `meddle` 代理进程，每个进程拥有独立的配置目录（MEDDLE_HOME）、端口、路由规则和 Mock 规则，适用于多个 Agent 或项目需要隔离代理环境的场景。

**核心概念**：
- **Session**：一个独立的 `meddle` 代理进程，拥有自己的 MEDDLE_HOME 和端口
- **默认 Session**：不指定 `--session` 时的回退，使用 `~/.meddle/`，行为与之前完全一致
- **CA 共享**：所有 session 共用 `~/.meddle/ca/` 证书，无需重复安装

**目录结构**：

```
~/.meddle/
├── sessions.json                 # session 注册表
├── sessions/                     # 非默认 session 的数据目录
│   ├── my-project-1718283600/
│   │   ├── route-rules/
│   │   ├── mocks.json
│   │   ├── settings.json
│   │   ├── plugins/
│   │   └── plugins-data/
│   └── ...
├── ca/                           # 共享 CA 证书
├── route-rules/                  # 默认 session 路由
├── mocks.json                    # 默认 session Mock
└── settings.json                 # 默认 session 设置
```

**CLI 命令**：

```bash
# 创建一个新 session，返回 session id
meddle session create --name my-project

# 指定端口创建
meddle session create --name debug --port 9100

# 列出所有 session（含存活状态）
meddle session list

# 操作指定 session 的路由/Mock 等
meddle --session <session-id> route list
meddle --session <session-id> mock add --name API --pattern "api.test.com"

# 删除 session（--clean 同时删除数据目录）
meddle session delete <session-id>
meddle session delete <session-id> --clean

# 清理所有孤儿 session（进程已退出的注册表记录）
meddle session prune
```

**MCP 工具**：

```
# 通过 MCP 创建 session
create_session({ name: "my-project" })
# → { id: "my-project-1718283600", port: 9000, proxyUrl: "http://127.0.0.1:9000" }

# 操作指定 session 的路由（传入 session 参数）
route_rule_list({ session: "my-project-1718283600" })
route_rule_add({ session: "my-project-1718283600", ruleFile: "dev", pattern: "...", target: "..." })

# 不传 session 参数时操作默认 session（向后兼容）
route_rule_list({})
```

**兼容性**：不设置 `--session` 或 `MEDDLE_HOME` 环境变量时，行为与之前完全一致，所有配置仍在 `~/.meddle/` 下。详见 [多 Session 隔离设计文档](./docs/proposals/multi-session-isolation.md)。

## 文档

- [配置文件结构说明](./CONFIG_STRUCTURE.md) - 配置文件详细说明 ⭐
- [CLI Reference](./docs/CLI_REFERENCE.md) - CLI 命令完整文档 ⭐
- [API Reference](./docs/API_REFERENCE.md) - HTTP API 完整文档
- [请求来源应用识别](./docs/APPLICATION_IDENTITY.md) - 本机进程识别、远程 UA 推断与限制
- [文档索引](./docs/DOCS_INDEX.md) - 了解所有可用文档
- [Mock 优化指南](./MOCK_OPTIMIZATION_SUMMARY.md) - Mock 功能优化说明

## 插件开发

Meddle 提供了强大的插件系统，允许开发者扩展代理功能。

### AI 辅助插件开发 ✨ 新功能

**通过AI自动生成自定义插件**，无需手写代码！

1. **配置AI服务**：在Web界面设置中配置OpenAI或Anthropic API
2. **描述需求**：用自然语言描述插件功能
3. **AI生成代码**：实时查看AI生成的TypeScript插件代码
4. **自动编译**：保存时自动编译为JavaScript
5. **即刻使用**：重启服务器后插件自动加载

**特性**：
- 🤖 支持 OpenAI 和 Anthropic
- ⚡ 流式输出，实时查看生成进度
- 🔧 自动编译 TypeScript → JavaScript  
- 📊 编译状态可视化（已编译/未编译/需要重新编译）
- 💾 自动保存到 `~/.meddle/plugins/` 目录

**使用步骤**：
1. 启动代理服务器并访问 Web 界面
2. 进入"扩展插件"标签页
3. 点击"AI 生成插件"按钮
4. 填写插件需求并生成
5. 查看代码，确认后保存

详见：
- [AI插件功能完整总结](./AI_PLUGIN_FEATURE_SUMMARY.md) ⭐ - 功能概述、使用指南、演示视频
- [插件生成器功能说明](./PLUGIN_GENERATOR_FEATURE.md) - 技术实现细节
- [流式输出功能说明](./STREAMING_FEATURE.md) - 流式生成原理和优势
- [插件编译功能说明](./PLUGIN_COMPILATION.md) - TypeScript编译机制

### 手动插件开发

如果您希望手动编写插件，详细的插件开发指南请参考：

- [插件系统完整开发指南](./docs/plugin/PLUGIN_SYSTEM_GUIDE.md) ⭐ - 包含插件接口、Hook 协议、示例代码和最佳实践
- [插件架构设计文档](./docs/plugin/RFC_PLUGIN_ARCHITECTURE.md) - 插件系统的架构设计和实施方案
- [插件 API 决策文档](./docs/plugin/ADR-001-plugin-api.md) - 插件 API 与 Hook 协议定版
- [插件 Pipeline 模式指南](./docs/plugin/PIPELINE_MODE_GUIDE.md) - 三种运行模式、Shadow 比对追踪、切换策略

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `MEDDLE_PLUGIN_MODE` | 插件运行模式（off/shadow/on） | `off` |
| `MEDDLE_PLUGIN_ON_HOSTS` | On 模式 host 白名单（逗号分隔） | 空 |
| `MEDDLE_ENABLE_BUILTIN_ROUTER` | 启用内置路由插件 | `true` |
| `MEDDLE_ENABLE_BUILTIN_LOGGER` | 启用内置日志插件 | `true` |
| `MEDDLE_ENABLE_BUILTIN_MOCK` | 启用内置 Mock 插件 | `false` |
| `PORT` | Web 界面端口 | `8989` |
| `MEDDLE_REMOTE` | 允许局域网设备连接代理 | `false` |
| `MEDDLE_REMOTE_TOKEN` | 远程代理认证口令，用户名固定为 `meddle` | 空 |
| `MEDDLE_INTERCEPT_HTTPS` | 解密并记录全部 HTTPS 流量；远程模式默认开启 | `false` |
| `MEDDLE_BIND_HOST` | 监听地址；远程模式默认 `0.0.0.0` | `127.0.0.1` |

详见 [插件 Pipeline 模式指南](./docs/plugin/PIPELINE_MODE_GUIDE.md)

## 开发

克隆项目到本地
### 安装依赖
`pnpm install`

### 启动
`
