# EP_HOME 多实例隔离技术方案

> 状态: Proposal | 分支: `proposal/multi-instance-ep-home` | 日期: 2026-07-10

## 1. 背景与问题

当前 easy-proxy 所有运行时数据目录硬编码为 `~/.ep/`，整个系统为单进程单例模式。存在问题：

- 两个 agent 同时运行时，共享同一份配置（路由规则、插件、mock、证书、设置）
- 一个 agent 的规则或插件变更会立即影响另一个
- 无法为不同项目/场景维护独立的代理环境
- `PluginManager`、`HookDispatcher`、`EventBus` 均为全局单例

### 受影响的硬编码位置

| 层 | 文件 | 行 | 硬编码路径 |
|-----|------|-----|-----------|
| 核心 | `core/proxy-context.ts` | 13 | `~/.ep/` |
| 核心 | `core/plugin-context-factory.ts` | 14 | `~/.ep/plugins-data/` |
| 核心 | `cert.ts` | 9 | `~/.ep/ca/` |
| 核心 | `helpers.ts` | 184 | `~/.ep/route-rules/` |
| CLI | `bin/lib/proxy-detect.js` | 10 | `~/.ep/` (找 mcp-proxy-url.json) |
| CLI | `bin/lib/file-access.js` | 7 | `~/.ep/` (离线模式直读文件) |
| CLI | `bin/doctor.js` | 12 | `~/.ep/` (健康检查) |
| CLI | `bin/commands/supervise.js` | 71 | `~/.ep/` (daemon 日志) |

## 2. 方案概述

引入环境变量 **`EP_HOME`**，指定代理数据根目录。通过共享的 `resolveEpHome()` 函数作为唯一真相源，替换所有硬编码。

```
EP_HOME=/path/to/agent-a-ep ep    →  数据目录 = /path/to/agent-a-ep/
EP_HOME=./my-ep-data ep           →  数据目录 = $PWD/my-ep-data/
ep                                →  数据目录 = ~/.ep/（向后兼容）
```

## 3. 核心原则

| 原则 | 说明 |
|------|------|
| **零破坏** | 不设置 `EP_HOME` 时，所有路径、行为、测试与当前完全一致 |
| **单点解析** | 所有路径收敛到 `resolveEpHome()`，杜绝分散硬编码 |
| **惰性创建** | 按需 `mkdir`，不在启动时强制创建（与现有行为一致） |
| **CLI 透传** | `ep start` / `ep supervise` 子进程自动继承 `EP_HOME`（已通过 `...process.env` 展开） |
| **CLI/MCP 一致性** | CLI 命令和 MCP client 必须与代理服务端使用相同的 `EP_HOME` 来互发现与通信 |

## 4. CLI/MCP 兼容性分析（关键）

### 4.1 CLI 命令交互模型

CLI 命令（`ep route`、`ep mock`、`ep status`、`ep url` 等）是**独立进程**，与代理服务端通过两条路径交互：

```
                    ┌──────────────────────────┐
  ep route list     │  在线模式: HTTP API 调用    │
  EP_HOME=/ep-a ───►│  1. read /ep-a/mcp-proxy-url.json 得到端口 │
                    │  2. GET http://127.0.0.1:{port}/api/...  │
                    │                            │
                    │  离线模式: 直接文件读写       │
                    │  1. read /ep-a/route-rules/*.txt        │
                    │  2. read /ep-a/mocks.json               │
                    │  3. read /ep-a/settings.json            │
                    └──────────────────────────┘
```

**关键路径**: `proxy-detect.js:10` → `file-access.js:7` → 所有 CLI 文件操作

### 4.2 MCP 交互模型

```
  Agent 设置:
    EP_HOME=/ep-a EP_MCP=1 ep
    │
    ├── index.js 写入 /ep-a/mcp-proxy-url.json = {"proxyUrl":"http://127.0.0.1:8989"}
    │
    └── MCP client 需要读取 mcp-proxy-url.json 以发现代理端口
        │
        ├── 如果 MCP client 也设置 EP_HOME=/ep-a → 正确读取 /ep-a/mcp-proxy-url.json
        └── 如果 MCP client 未设置 EP_HOME → 错误读取 ~/.ep/mcp-proxy-url.json
```

**结论**: Agent 侧 MCP tool 配置必须同时声明 `EP_HOME`，使 CLI 命令和代理服务端使用同一个数据目录进行互发现。

### 4.3 CLI 库文件的 JS/TS 依赖问题

CLI 命令是纯 JS 文件（`bin/lib/*.js`），不依赖 TypeScript 编译产物。如果 `resolveEpHome()` 只存在于 `core/ep-home.ts`（需编译为 `dist/core/ep-home.js`），则 CLI 命令在未执行 `npm run build` 时会失败。

**解决方案**: 将 `resolveEpHome` 放置在 `bin/lib/ep-home.js`（纯 JS），`core/ep-home.ts` 通过 `require` 引用它。这样 CLI 零依赖，核心 TS 模块保持一致。

```javascript
// bin/lib/ep-home.js (纯 JS，无编译依赖)
const os = require('os')
const path = require('path')

function resolveEpHome() {
    const fromEnv = (process.env.EP_HOME || '').trim()
    if (fromEnv) return path.resolve(fromEnv)
    return path.resolve(os.homedir(), '.ep')
}

module.exports = { resolveEpHome }
```

```typescript
// core/ep-home.ts (TS 层，引用 JS 实现)
import { resolveEpHome } from '../bin/lib/ep-home'
export { resolveEpHome }
```

## 5. 文件改动明细

### 5.1 新增 `bin/lib/ep-home.js`（约 10 行）

```javascript
const os = require('os')
const path = require('path')

/**
 * Resolve the easy-proxy data directory.
 * EP_HOME env var takes priority; falls back to ~/.ep/
 */
function resolveEpHome() {
    const fromEnv = (process.env.EP_HOME || '').trim()
    if (fromEnv) return path.resolve(fromEnv)
    return path.resolve(os.homedir(), '.ep')
}

module.exports = { resolveEpHome }
```

### 5.2 新增 `core/ep-home.ts`（约 3 行，桥接层）

```typescript
import { resolveEpHome } from '../bin/lib/ep-home'
export { resolveEpHome }
```

### 5.3 修改 `core/proxy-context.ts:13`

```
- const epDir = path.resolve(os.homedir(), '.ep')
+ import { resolveEpHome } from './ep-home'
+ const epDir = resolveEpHome()
```

### 5.4 修改 `core/plugin-context-factory.ts:14`

```
- const epDir = path.resolve(os.homedir(), '.ep');
+ import { resolveEpHome } from './ep-home'
+ const epDir = resolveEpHome();
```

### 5.5 修改 `cert.ts:9`

```
- const rootDirPath = path.resolve(os.homedir(), '.ep', 'ca');
+ import { resolveEpHome } from './core/ep-home'
+ const rootDirPath = path.resolve(resolveEpHome(), 'ca');
```

### 5.6 修改 `helpers.ts:184`

```
- export const ROUTE_RULES_DIR = path.resolve(os.homedir(), '.ep', 'route-rules');
+ import { resolveEpHome } from './core/ep-home'
+ export const ROUTE_RULES_DIR = path.resolve(resolveEpHome(), 'route-rules');
```

### 5.7 修改 `bin/lib/proxy-detect.js:10`

```
- const epDir = path.resolve(os.homedir(), '.ep')
+ const { resolveEpHome } = require('./ep-home')
+ const epDir = resolveEpHome()
```

### 5.8 修改 `bin/lib/file-access.js:7`

```
- const { epDir } = require('./proxy-detect')
+ const { resolveEpHome } = require('./ep-home')
+ const epDir = resolveEpHome()
```

> 注意: 此前 `file-access.js` 从 `proxy-detect.js` 引入 `epDir`，改为直接从 `ep-home.js` 引入。理由: 明确依赖关系（文件访问不应依赖代理检测模块）。

### 5.9 修改 `bin/doctor.js:12`

```
- const epDir = path.resolve(os.homedir(), '.ep')
+ const { resolveEpHome } = require('./lib/ep-home')
+ const epDir = resolveEpHome()
```

### 5.10 修改 `bin/commands/supervise.js:71`

```
- const epDir = path.resolve(os.homedir(), '.ep')
+ const { resolveEpHome } = require('../lib/ep-home')
+ const epDir = resolveEpHome()
```

### 5.11 无需修改的文件

| 文件 | 原因 |
|------|------|
| `bin/commands/start.js` | `{ ...process.env }` 已包含 `EP_HOME`，自动透传 |
| `bin/commands/supervise.js` L25 | 同上 |
| `server/plugins.ts` | 通过 `ctx.epDir` 间接引用 |
| `server/rule-files.ts` | 通过 `ctx.epDir` 间接引用 |
| `core/mock-handler.ts` | 通过 `ctx.epDir` 间接引用 |
| `core/route-loader.ts` | 通过 `ctx.epDir` 间接引用 |
| `core/browser.ts` | 参数 `epDir: string`，由调用方传入 |
| `core/config-diagnostics.ts` | 通过参数 `ctx.epDir` 间接引用 |
| `index.js` | 通过 `ctx.epDir` 访问 |

## 6. 依赖传播

```
bin/lib/ep-home.js  ← 新增（唯一真相源，纯 JS，零依赖）
 ├── core/ep-home.ts              ← 桥接层（TS 引用 JS）
 │    ├── core/proxy-context.ts   → ctx.epDir → 其余所有模块
 │    ├── core/plugin-context-factory.ts
 │    ├── cert.ts
 │    └── helpers.ts
 ├── bin/lib/proxy-detect.js      ← CLI 代理发现
 ├── bin/lib/file-access.js       ← CLI 文件操作
 ├── bin/doctor.js                ← CLI 健康检查
 └── bin/commands/supervise.js    ← CLI 守护进程
```

## 7. 兼容性

### 7.1 默认行为（EP_HOME 未设置）

| 检查项 | 结果 |
|--------|------|
| `resolveEpHome()` 返回值 | `~/.ep/`（与硬编码完全一致） |
| `ctx.epDir` | 值相同，类型 `string` 不变 |
| `ProxyContext` 类型 | 无字段增删 |
| `PluginContext` 工厂 | 接口签名不变 |
| `ensureRootCA()` | 签名与语义不变 |
| `getRootCAPath()` | 返回值不变 |
| `ROUTE_RULES_DIR` | 值相同 |
| CLI `ep route/mock/status/doctor` | 行为不变，操作 `~/.ep/` |
| MCP `mcp-proxy-url.json` | 读写 `~/.ep/` |
| 现有 292 tests / 35 suites | 零破坏 |

### 7.2 设置 EP_HOME 后

| 检查项 | 结果 |
|--------|------|
| 目录不存在 | 各模块按需 `mkdir`，与现有 `~/.ep/` 行为一致 |
| 首次启动 | 自动生成 CA 证书、创建子目录 |
| 相对路径 `EP_HOME=./ep-data` | `path.resolve()` 转为绝对路径 |
| 尾部空格 | `.trim()` 处理 |
| CLI 命令带 `EP_HOME` | 正确操作对应数据目录、找到对应端口 |
| MCP client 带 `EP_HOME` | 正确读取 `$EP_HOME/mcp-proxy-url.json` |
| 两个实例同 `EP_HOME` | 会冲突（用户误用，非 bug） |

### 7.3 Agent/MCP 集成约定

```
# Agent 配置必须同时声明 EP_HOME:
{
  "mcpServers": {
    "easy-proxy": {
      "command": "ep",
      "env": {
        "EP_HOME": "/path/to/agent-ep-data",
        "EP_MCP": "1"
      }
    }
  }
}
```

Agent 侧的 CLI tool（通过 MCP server 暴露）由于继承了 `EP_HOME` 环境变量，能正确发现对应实例的端口并与之通信。

### 7.4 不兼容场景（明确排除）

| 场景 | 说明 |
|------|------|
| 多个实例设置相同 `EP_HOME` | 等同于两个进程写同一套文件，预期冲突 |
| 旧数据迁移 | 需用户手动 `cp -r ~/.ep $EP_HOME` |
| MCP client 不设置 `EP_HOME` | 会回退到 `~/.ep/`，与实例数据不一致，属于配置错误 |

## 8. 变更总结

| 统计 | 数值 |
|------|------|
| 新建文件 | 2 (`bin/lib/ep-home.js`, `core/ep-home.ts`) |
| 修改文件 | 8 |
| 总变更行 | ~30 |
| 不改动但已兼容文件 | 11 |

## 9. 测试计划

### 新增单元测试

`tests/ep-home.spec.ts` 覆盖 `resolveEpHome()` 的四种场景：默认路径、自定义路径、空白 trim、相对路径转绝对。

### 回归测试

```bash
pnpm run test                    # 全部 292 tests，不设 EP_HOME
EP_HOME=/tmp/ep-test pnpm test   # 设 EP_HOME 验证隔离
```

### 集成验证

```bash
# 场景1: 双实例并行
EP_HOME=/tmp/ep-a ep & EP_HOME=/tmp/ep-b ep &

# 场景2: CLI 命令定位正确实例
EP_HOME=/tmp/ep-a ep route list --json
EP_HOME=/tmp/ep-a ep mock list --json
EP_HOME=/tmp/ep-a ep status --json
EP_HOME=/tmp/ep-a ep doctor

# 场景3: MCP 文件写入正确目录
EP_HOME=/tmp/ep-a EP_MCP=1 ep
cat /tmp/ep-a/mcp-proxy-url.json    # 应存在且包含正确端口
```

## 10. 使用方式

```bash
# 默认模式（完全兼容现有行为）
ep

# 自定义数据目录
EP_HOME=/path/to/my-project-ep ep

# 相对路径
EP_HOME=./ep-data ep --open

# Agent 场景：两个 agent 各自独立
export EP_HOME=~/.ep/instances/agent-a
ep --mcp &

export EP_HOME=~/.ep/instances/agent-b
ep --mcp &

# CLI 操作指定实例
EP_HOME=~/.ep/instances/agent-a ep route list
EP_HOME=~/.ep/instances/agent-a ep mock add --name "test" --pattern "api.test.com"

# MCP 配置
{
  "mcpServers": {
    "easy-proxy": {
      "command": "ep",
      "env": { "EP_HOME": "~/.ep/instances/agent-a", "EP_MCP": "1" }
    }
  }
}
```
