# Easy-Proxy 多实例隔离技术方案

> 状态: Proposal | 分支: `proposal/multi-instance-ep-home` | 日期: 2026-07-10

## 1. 背景与问题

当前 easy-proxy 为单进程单例模式，所有运行时数据硬编码为 `~/.ep/`。当多个 agent 同时运行时：
- 共享同一份配置（路由规则、插件、mock、证书、设置）
- 一个 agent 的变更立即污染另一个
- 无法为不同项目/场景维护独立的代理环境

## 2. 设计目标

Agent 通过 MCP 或 CLI **按需创建一个代理实例**，获取实例 ID，之后所有操作通过这个 ID 进行。Agent 无需关心底层文件路径或端口。

```
理想流程:
  Agent: "创建代理实例"     →  返回 { id: "xyz", proxyUrl: "http://127.0.0.1:8989" }
  Agent: "给 xyz 添加路由"  →  CLI 自动找到对应实例
  Agent: "删除 xyz"        →  实例清理，资源回收
```

## 3. 架构设计

### 3.1 进程模型

```
┌─────────────────────────────────────────────┐
│              Instance Manager                │
│  管理所有代理实例的创建、启动、停止、删除       │
│  API: POST /instances, GET/DELETE /instances/:id │
│  注册表: ~/.ep/instances.json               │
│  端口: 固定（如 8900），或通过 Unix socket     │
├─────────────────────────────────────────────┤
│                                             │
│  ┌──────────────┐  ┌──────────────┐         │
│  │ instance-a   │  │ instance-b   │         │
│  │ port: 8989   │  │ port: 8990   │         │
│  │ EP_HOME:     │  │ EP_HOME:     │         │
│  │  ~/.ep/i/a   │  │  ~/.ep/i/b   │         │
│  └──────────────┘  └──────────────┘         │
│         ↑ child           ↑ child           │
│                                             │
│  ┌──────────────┐                            │
│  │ default      │  (不指定 instance 时使用)   │
│  │ port: 8989?  │                            │
│  │ EP_HOME:     │                            │
│  │  ~/.ep/      │                            │
│  └──────────────┘                            │
└─────────────────────────────────────────────┘
```

- **Manager**: 一个轻量进程，负责实例生命周期管理
- **每个 Instance**: 独立的 Node.js 子进程，有独立的 `EP_HOME`、端口、插件、路由规则
- **default**: 不指定 `--instance` 时回退到 `~/.ep/`，兼容现有行为

### 3.2 实例注册表

`~/.ep/instances.json` 记录所有活跃实例：

```json
{
  "agent-a-1718283600": {
    "port": 8989,
    "pid": 12345,
    "epHome": "/Users/xxx/.ep/instances/agent-a-1718283600",
    "createdAt": "2026-07-10T10:00:00Z",
    "label": "agent-a"
  },
  "agent-b-1718283700": {
    "port": 8990,
    "pid": 12346,
    "epHome": "/Users/xxx/.ep/instances/agent-b-1718283700",
    "createdAt": "2026-07-10T10:01:00Z",
    "label": "agent-b"
  }
}
```

实例 ID 生成规则：`{label}-{timestamp}`，用户可指定 label，不指定则自动生成。

### 3.3 实例完整目录布局

```
~/.ep/
├── instances.json              # 实例注册表
├── instances/                  # 非 default 实例数据
│   ├── agent-a-1718283600/
│   │   ├── ca/                 # 独立 CA 证书
│   │   ├── route-rules/        # 独立路由规则
│   │   ├── mocks.json          # 独立 Mock
│   │   ├── settings.json       # 独立设置
│   │   ├── plugins/            # 独立插件
│   │   ├── plugins-data/       # 独立插件数据
│   │   ├── mcp-proxy-url.json  # MCP 发现文件
│   │   └── supervisor.log
│   └── agent-b-1718283700/
│       └── ...
├── ca/                         # default 实例 CA
├── route-rules/                # default 实例路由
├── mocks.json                  # default 实例 Mock
├── settings.json               # default 实例设置
├── plugins/                    # default 实例插件
└── plugins-data/               # default 实例插件数据
```

## 4. 交互流程

### 4.1 Agent 通过 MCP 使用

```
1. MCP tool: ep_create_instance({ name: "my-debug-session" })
   → Manager spawns child process
   → Returns: { id: "my-debug-session-1718283600", port: 8989, proxyUrl: "..." }

2. MCP tool: ep_route_add({ instance: "my-debug-session-1718283600", pattern: "...", target: "..." })
   → CLI 读取 instances.json 找到该实例的 port + epHome
   → 通过 HTTP API 操作该实例的代理服务

3. MCP tool: ep_mock_add({ instance: "my-debug-session-1718283600", ... })
   → 同上

4. MCP tool: ep_delete_instance({ id: "my-debug-session-1718283600" })
   → Manager 发送 SIGTERM 给子进程
   → 从 instances.json 移除
```

### 4.2 Agent 通过 CLI 使用

```
$ ep instance create --name my-session
Created instance: my-session-1718283600
  Proxy URL: http://127.0.0.1:8989

$ ep --instance my-session-1718283600 route list
... (该实例的路由规则)

$ ep --instance my-session-1718283600 mock add --name "API" --pattern "api.test.com"
... 

$ ep instance delete my-session-1718283600
Instance deleted.
```

### 4.3 现有用户不受影响

```
$ ep                          # 启动 default 实例（等同于当前行为）
$ ep route list               # 操作 default 实例（read from ~/.ep/）
$ ep mock add --name ...      # 同上
```

## 5. 关键设计决策

### 5.1 Manager 的启动方式

**方案 A: Manager 内嵌于 default 实例**

```
ep                    → 启动 default 实例，同时启动 manager
ep instance create    → 与 manager 通信，创建新实例
```

优点: 用户体验一致，`ep` 一个命令搞定
缺点: default 实例和 manager 耦合

**方案 B: Manager 作为独立守护进程**

```
ep manager start      → 启动 manager 守护进程（单次）
ep instance create    → 与 manager 通信
```

优点: 生命周期独立
缺点: 用户需要额外步骤启动 manager

**推荐方案 A**，因为：
- 用户无需感知 manager 的存在
- 如果 default 实例被 kill，manager 也随之退出，不会留下孤儿进程
- `ep instance create` 时如果 default 实例未运行，自动启动

### 5.2 Manager 与实例、CLI 之间的通信

```
CLI (--instance <id>)
  │
  ├─ 读 ~/.ep/instances.json → 获取实例 port
  └─ HTTP API → http://127.0.0.1:{port}/api/...
```

无需引入额外的 RPC 通道。CLI 始终通过 HTTP API 与代理实例通信。

### 5.3 `--instance` 全局标志

为所有现有 CLI 命令新增 `--instance <id>` 参数：

```
ep --instance <id> route list|show|add|...
ep --instance <id> mock list|add|delete|...
ep --instance <id> status
ep --instance <id> doctor
```

### 5.4 资源管理与清理

- 实例在 `instances.json` 注册表中跟踪
- `ep instance delete <id>` 终止进程 + 清理注册表
- 可选的清理策略：`ep instance delete <id> --clean` 同时删除 `~/.ep/instances/<id>/` 目录
- Manager 退出时向所有子进程发送 SIGTERM
- `ep instance list` 显示所有实例（含进程存活检测：pid 死掉的标记为 `orphaned`）

## 6. 实现路线图

### Phase 1: 基础设施（底层支撑）

1. **`EP_HOME` 支持** — 引入 `resolveEpHome()`，替换所有硬编码（详见附录 A）
2. **CLI `--instance` 标志** — 所有命令读取 `instances.json` 定位目标实例
3. **实例注册表** — `~/.ep/instances.json` 读写逻辑

### Phase 2: 实例管理（核心功能）

4. **`ep instance create`** — spawn 子进程，写入注册表，返回实例信息
5. **`ep instance list`** — 列出所有实例及状态
6. **`ep instance delete`** — 终止进程，清理注册表
7. **Manager HTTP API** — `POST /__manager/instances` 等（供 MCP 调用）

### Phase 3: MCP 集成

8. **MCP tools 适配** — 所有 MCP tool 支持 `instance` 参数

## 7. 变更总结

| 统计 | Phase 1 | Phase 2 | Phase 3 | 合计 |
|------|---------|---------|---------|------|
| 新建文件 | 2 | 3 | 1 | 6 |
| 修改文件 | 8-10 | 2 | 3 | ~14 |
| 不改动文件 | ~11 | - | - | - |

## 8. 兼容性

| 场景 | 行为 |
|------|------|
| `ep` (不设任何参数) | 与当前完全一致，使用 `~/.ep/` |
| `ep route list` (无 --instance) | 操作 default 实例，行为不变 |
| `ep instance create --name x` | 新建实例，返回 ID + port |
| `ep --instance xyz route add ...` | 操作指定实例 |
| `ep instance delete xyz` | 终止进程，清理注册 |
| 现有 292 tests | 零破坏（不设 --instance 时路径不变） |

---

## 附录 A: Phase 1 — EP_HOME 底层改动

### A.1 新增 `bin/lib/ep-home.js`（纯 JS，CLI 零编译依赖）

```javascript
const os = require('os')
const path = require('path')

function resolveEpHome() {
    const fromEnv = (process.env.EP_HOME || '').trim()
    if (fromEnv) return path.resolve(fromEnv)
    return path.resolve(os.homedir(), '.ep')
}

module.exports = { resolveEpHome }
```

### A.2 新增 `core/ep-home.ts`（TS 桥接层）

```typescript
import { resolveEpHome } from '../bin/lib/ep-home'
export { resolveEpHome }
```

### A.3 硬编码替换清单

| # | 文件 | 行 | 改动 |
|---|------|-----|------|
| 1 | `core/proxy-context.ts` | 13 | `resolveEpHome()` 替换 `os.homedir() + '.ep'` |
| 2 | `core/plugin-context-factory.ts` | 14 | 同上 |
| 3 | `cert.ts` | 9 | 同上 |
| 4 | `helpers.ts` | 184 | 同上 |
| 5 | `bin/lib/proxy-detect.js` | 10 | 同上 |
| 6 | `bin/lib/file-access.js` | 7 | 同上 |
| 7 | `bin/doctor.js` | 12 | 同上 |
| 8 | `bin/commands/supervise.js` | 71 | 同上 |

### A.4 依赖传播

```
bin/lib/ep-home.js  ← 唯一真相源（纯 JS）
 ├── core/ep-home.ts              ← TS 桥接
 │    ├── core/proxy-context.ts   → ctx.epDir → 其余模块
 │    ├── core/plugin-context-factory.ts
 │    ├── cert.ts
 │    └── helpers.ts
 ├── bin/lib/proxy-detect.js      ← CLI 代理发现
 ├── bin/lib/file-access.js       ← CLI 文件操作
 ├── bin/doctor.js                ← CLI 健康检查
 └── bin/commands/supervise.js    ← CLI 守护进程
```
