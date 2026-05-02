# 一个非常简单的开发代理服务器

- 自定义代理规则
- 支持https✅

## 使用

全局安装easy-dev-proxy `npm install easy-dev-proxy -g`,会创建一个`ep`命令。

### 命令

```bash
# 启动代理服务器
ep

# 启动并自动打开浏览器
ep --open

# 指定环境启动 [planned]
ep start --env beta

# 检查配置文件健康状况
ep doctor

# 查看代理状态
ep status

# 显示帮助信息
ep --help
```

完整 CLI 命令文档见 [CLI Reference](./docs/CLI_REFERENCE.md)

### 配置文件

配置文件扁平化存储在 `~/.ep/` 目录：

```
~/.ep/
├── .eprc              # 路由规则配置
├── mocks.json         # Mock 规则配置
├── settings.json      # 系统设置（主题、字体、AI配置）
└── ca/                # SSL 证书目录
```

**路由规则配置**:
- 项目目录配置（优先）：`.eprc`、`ep.config.json`、`ep.config.js`
- 用户默认配置：`~/.ep/.eprc`
- 支持 EPRC、JSON、JS 三种格式
- EPRC 路由匹配规则、通配符、排除和 marker 重写说明见 [配置文件结构说明](./CONFIG_STRUCTURE.md)

**Web 界面管理**:
- 启动后访问 http://localhost:8899
- 通过界面管理路由规则、Mock 规则和系统设置

详见 [配置文件结构说明](./CONFIG_STRUCTURE.md)

### 自动打开浏览器并设置代理

使用以下任一方式启动：
- `ep --open`（全局安装后）
- `npm run start:open`（开发时）
- `EP_OPEN=1 npm run start`

启动后将使用 Chrome/Edge/Chromium 的 `--proxy-server` 参数启动浏览器，仅该浏览器实例使用代理，不修改系统代理设置。

### MCP Server

提供 MCP 工具 `start_proxy`：启动代理服务器并返回代理地址。

- `env`：环境名（如 `beta`、`eprc.beta`）[planned] — 对应 `.epconfig/.{env}` 配置，runtime 装载逻辑尚未实现
- `openBrowser: true`：启动浏览器并设置代理

**Cursor 配置**：在 Cursor 设置中添加 MCP 服务器：

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

或使用 npm 脚本（在项目目录下）：

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

## 文档

- [配置文件结构说明](./CONFIG_STRUCTURE.md) - 配置文件详细说明 ⭐
- [CLI Reference](./docs/CLI_REFERENCE.md) - CLI 命令完整文档 ⭐
- [API Reference](./docs/API_REFERENCE.md) - HTTP API 完整文档
- [文档索引](./docs/DOCS_INDEX.md) - 了解所有可用文档
- [Mock 优化指南](./MOCK_OPTIMIZATION_SUMMARY.md) - Mock 功能优化说明

## 插件开发

Easy Proxy 提供了强大的插件系统，允许开发者扩展代理功能。

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
- 💾 自动保存到 `~/.ep/plugins/` 目录

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
| `EP_PLUGIN_MODE` | 插件运行模式（off/shadow/on） | `off` |
| `EP_PLUGIN_ON_HOSTS` | On 模式 host 白名单（逗号分隔） | 空 |
| `EP_ENABLE_BUILTIN_ROUTER` | 启用内置路由插件 | `true` |
| `EP_ENABLE_BUILTIN_LOGGER` | 启用内置日志插件 | `true` |
| `EP_ENABLE_BUILTIN_MOCK` | 启用内置 Mock 插件 | `false` |
| `PORT` | Web 界面端口 | `8989` |

详见 [插件 Pipeline 模式指南](./docs/plugin/PIPELINE_MODE_GUIDE.md)

## 开发

克隆项目到本地
### 安装依赖
`pnpm install`

### 启动
`
