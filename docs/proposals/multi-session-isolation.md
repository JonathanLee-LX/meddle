# Easy-Proxy 多 Session 隔离技术方案

> 状态: Proposal | 分支: `proposal/multi-instance-ep-home` | 日期: 2026-07-10 | 修订: 2026-07-11

## 1. 背景与问题

当前 easy-proxy 为单进程单例模式，所有运行时数据硬编码为 `~/.ep/`。当多个 agent 同时运行时：
- 共享同一份配置（路由规则、插件、mock、证书、设置）
- 一个 agent 的变更立即污染另一个
- 无法为不同项目/场景维护独立的代理环境

## 2. 设计目标

Agent 通过 MCP 或 CLI **按需创建一个代理 session**，获取 session ID，之后所有操作通过这个 ID 进行。Agent 无需关心底层文件路径或端口。

**设计原则（贯穿本方案）：**
- **改动最小** — 不引入新的守护进程或进程管理层，复用现有 HTTP API
- **兼容最大** — 不设 `--session` 时行为与当前完全一致，292 测试零破坏
- **default 不特殊** — default session 只是"没有 `--session` 时的回退"，不承担管理职责

```
理想流程:
  Agent: "创建代理 session"     →  返回 { id: "xyz", proxyUrl: "http://127.0.0.1:8989" }
  Agent: "给 xyz 添加路由"     →  CLI 自动找到对应 session
  Agent: "删除 xyz"           →  session 清理，资源回收
```

## 3. 架构设计

### 3.1 进程模型

**关键决策：不引入独立的 Session Manager 进程。** 每个 session 是一个独立的 `ep` 子进程，由调用方（CLI/MCP）直接 `spawn`，生命周期通过注册表文件协调。理由见 §5.1。

```
┌──────────────────────────────────────────────────────┐
│  调用方 (CLI / MCP server)                            │
│  • 读取 ~/.ep/sessions.json 定位 session              │
│  • spawn 子进程 = ep 进程 + EP_HOME=<session dir>     │
│  • 通过 HTTP API 操作: http://127.0.0.1:{port}/api/.. │
├──────────────────────────────────────────────────────┤
│                                                      │
│  ┌──────────────┐  ┌──────────────┐                  │
│  │ session-a    │  │ session-b    │  (各自独立进程)   │
│  │ port: 8989   │  │ port: 8990   │                  │
│  │ EP_HOME:     │  │ EP_HOME:     │                  │
│  │  ~/.ep/s/a   │  │  ~/.ep/s/b   │                  │
│  └──────────────┘  └──────────────┘                  │
│                                                      │
│  ┌──────────────┐                                     │
│  │ default      │  (不指定 --session 时使用)          │
│  │ port: 8989   │  (EP_HOME=~/.ep，行为同当前)        │
│  │ EP_HOME:     │                                     │
│  │  ~/.ep/      │                                     │
│  └──────────────┘                                     │
└──────────────────────────────────────────────────────┘
```

- **每个 session**：独立的 `ep` 进程，独立的 `EP_HOME`、端口、插件、路由规则
- **default**：不指定 `--session` 时回退到 `~/.ep/`，行为完全等同当前
- **无 Manager 进程**：spawn 由 CLI/MCP 执行，注册表是协调的唯一媒介

### 3.2 Session 注册表

`~/.ep/sessions.json` 记录所有已创建 session：

```json
{
  "my-debug-1718283600": {
    "port": 8989,
    "pid": 12345,
    "epHome": "/Users/xxx/.ep/sessions/my-debug-1718283600",
    "createdAt": "2026-07-10T10:00:00Z",
    "label": "my-debug"
  }
}
```

Session ID 生成规则：`{label}-{timestamp}`，用户可指定 label，不指定则用 `session-{timestamp}`。

**并发安全（关键）：**

- 读写 `sessions.json` 必须使用 **原子写**：先写 `sessions.json.tmp` 再 `rename` 覆盖
- create 操作采用 **乐观锁 + 重试**：读取 → 分配端口 → 写入前重新读取确认端口未被占用 → 写入；冲突则重新分配端口
- 不引入文件锁（避免跨平台复杂性，重试机制足以覆盖 agent 并发创建的低频场景）

### 3.3 端口分配策略

| session 类型 | 端口 |
|------|------|
| default | **8989**（固定，兼容当前行为） |
| 非 default | **9000–9999 区间**，portfinder 顺序探测 |

- 非 default session 从 9000 开始探测可用端口，避免与 default 的 8989 冲突
- 端口分配在 spawn 前完成，写入注册表后启动子进程
- spawn 传递 `PORT=<port>` 环境变量，子进程复用现有端口读取逻辑
- 端口被占用时 portfinder 自动顺延；若全段被占则报错退出

### 3.4 Session 完整目录布局

```
~/.ep/
├── sessions.json               # session 注册表
├── sessions/                   # 非 default session 数据
│   ├── my-debug-1718283600/
│   │   ├── ca/                 # 证书（见 §5.5 策略）
│   │   ├── route-rules/
│   │   ├── mocks.json
│   │   ├── settings.json
│   │   ├── plugins/
│   │   ├── plugins-data/
│   │   ├── mcp-proxy-url.json
│   │   └── supervisor.log
│   └── ...
├── ca/                         # default session CA（共享，见 §5.5）
├── route-rules/                # default session 路由
├── mocks.json
├── settings.json
├── plugins/
└── plugins-data/
```

### 3.5 证书策略：共享 CA

**所有 session 共享 `~/.ep/ca/` 这一份 CA 证书。** 理由：

- 用户首次安装 CA 后，所有 session 的 HTTPS 拦截立即可用，无需重复安装
- 隔离 CA 带来的 UX 成本（每个 session 装一次证书）远高于安全收益
- session 间隔离的是**配置**（路由/mock/插件），而非**信任根**

实现方式：`cert.ts` 中 CA 路径始终指向 `~/.ep/ca/`，**不**跟随 `EP_HOME`。这是改动最小的做法——`cert.ts` 保持现状即可，Phase 1 无需改动此文件。路由/mock/插件等配置路径跟随 `EP_HOME`。

> 修订记录：原方案"独立 CA"已改为"共享 CA"。若未来有强隔离需求，可再引入 `EP_CA_DIR` 环境变量覆盖。

## 4. 交互流程

### 4.1 Agent 通过 MCP 使用

```
1. MCP tool: ep_create_session({ name: "my-debug" })
   → MCP server 调用 spawn('node', ['index.js'], { env: { EP_HOME, PORT } })
   → 等待子进程 /api/mocks 可达（轮询，复用 proxy-detect.js 的 waitForProxyUrl）
   → 原子写入 sessions.json
   → Returns: { id: "my-debug-1718283600", port: 8989, proxyUrl: "..." }

2. MCP tool: ep_route_add({ session: "my-debug-1718283600", ... })
   → 读 sessions.json 找 port → POST http://127.0.0.1:{port}/api/rule-files/...
   → 复用现有 MCP tool 实现，仅传入不同 baseUrl

3. MCP tool: ep_delete_session({ id: "my-debug-1718283600" })
   → process.kill(pid, 'SIGTERM')
   → 原子写 sessions.json 移除记录
   → 可选 --clean 删除 EP_HOME 目录
```

### 4.2 Agent 通过 CLI 使用

```
$ ep session create --name my-session
Created session: my-session-1718283600
  Proxy URL: http://127.0.0.1:8989
  EP_HOME:   ~/.ep/sessions/my-session-1718283600

$ ep --session my-session-1718283600 route list
... (该 session 的路由规则)

$ ep --session my-session-1718283600 mock add --name "API" --pattern "api.test.com"

$ ep session delete my-session-1718283600
Session deleted.
```

### 4.3 现有用户不受影响

```
$ ep                          # 启动 default session（等同当前行为，EP_HOME=~/.ep）
$ ep route list               # 操作 default session
$ ep mock add --name ...      # 同上
```

## 5. 关键设计决策

### 5.1 不引入 Session Manager 进程（原方案 A/B 均否决）

**原方案 A（内嵌于 default）的问题：**
- 循环依赖：manager 在 default 内，但 `ep session create` 时若 default 未运行需"自动启动 default"——谁来自启动？CLI 还是 manager？
- API 端口归属矛盾：manager API 挂在 default 的 8989 上，default crash 则无法管理其他 session
- default 被赋予了不对称的管理职责，违反"session 间独立"原则

**原方案 B（独立守护进程）的问题：**
- 用户需额外执行 `ep manager start`，体验割裂
- 引入全新的进程层，改动量大

**本方案：无 Manager 进程。** spawn 由 CLI/MCP 直接执行，注册表文件是唯一协调媒介。

| 对比项 | 原方案 A | 原方案 B | 本方案 |
|--------|---------|---------|--------|
| 新进程层 | 1（内嵌） | 1（独立） | **0** |
| 用户额外步骤 | 无 | 需 `ep manager start` | 无 |
| default 崩溃影响 | 无法管理其他 session | 无影响 | 无影响 |
| 修改文件数 | 多 | 多 | 少 |
| 孤儿进程风险 | 低 | 中 | 中（靠 §5.4 回收） |

### 5.2 CLI 与 session 的通信

```
CLI (--session <id>)
  │
  ├─ 读 ~/.ep/sessions.json → 获取 port
  └─ HTTP API → http://127.0.0.1:{port}/api/...
```

无需引入额外的 RPC 通道。CLI 始终通过 HTTP API 与代理 session 通信。

### 5.3 `--session` 全局标志与 `EP_HOME` 优先级

为所有现有 CLI 命令新增 `--session <id>` 参数：

```
ep --session <id> route list|show|add|...
ep --session <id> mock list|add|delete|...
ep --session <id> status
ep --session <id> doctor
```

**`EP_HOME` 与 `--session` 优先级（冲突解析规则）：**

| 情况 | 行为 |
|------|------|
| 仅 `--session <id>` | 从 `sessions.json` 查找，使用该 session 的 `epHome` 和 `port` |
| 仅 `EP_HOME` 环境变量 | 直接使用该路径作为 EP_HOME（高级用户/测试场景） |
| 同时设置 `--session` 和 `EP_HOME` | **报错退出**，提示二者互斥 |
| 都不设置 | 使用 `~/.ep/`（default 行为，完全兼容） |

`--session` 是面向 agent 的高层抽象，`EP_HOME` 是面向人类/测试的低层覆盖，二者不应叠加。

### 5.4 资源管理与清理

- Session 在 `sessions.json` 注册表中跟踪 `pid` 和 `port`
- `ep session delete <id>`：`process.kill(pid, 'SIGTERM')` → 原子写移除注册表项
- `ep session delete <id> --clean`：额外删除 `~/.ep/sessions/<id>/` 目录
- `ep session list`：列出所有 session，对每个 `pid` 做 `process.kill(pid, 0)` 存活检测，死进程标记 `orphaned`
- `ep session prune`：清理所有 orphaned 记录（不删数据目录）
- **退出钩子**：`ep session create` spawn 的子进程注册父进程退出检测——若父进程消失则子进程自行退出（`process.on('disconnect')` 触发 `SIGTERM`），避免孤儿进程

### 5.5 证书共享策略

见 §3.5。CA 路径固定为 `~/.ep/ca/`，不跟随 `EP_HOME`，保持 `cert.ts` 现状不改。

### 5.6 资源限制

- 注册表最多记录 **32 个 session**（覆盖 agent 并发场景，超出报错提示先 `ep session prune`）
- MCP API 不做鉴权——与当前 `ep` HTTP API 保持一致，信任本地环境（非生产服务）

## 6. 实现路线图

### Phase 1: 基础设施（底层支撑，零功能变更）

1. **`EP_HOME` 支持** — 引入 `resolveEpHome()`，替换硬编码（清单见附录 A，**含 `mcp-server.js`**）
2. **CLI `--session` 标志解析** — 解析参数，从 `sessions.json` 读取 port/epHome，传递给后续命令
3. **Session 注册表读写** — `bin/lib/sessions.js`，含原子写与乐观锁

### Phase 2: Session 管理（核心功能，新进程层 = 0）

4. **`ep session create`** — 分配端口 → spawn 子进程 → 等待 HTTP 就绪 → 写注册表
5. **`ep session list`** — 列出 + 存活检测
6. **`ep session delete`** — kill + 移除注册表（+ 可选 `--clean`）
7. **`ep session prune`** — 清理 orphaned 记录

### Phase 3: MCP 集成

8. **MCP tools 适配** — 新增 `ep_create_session` / `ep_delete_session` / `ep_list_sessions`；现有 tool 增加 `session` 参数，解析为 baseUrl

### Phase 4: Web UI 多 session 支持（可选，不阻塞 1-3）

9. **Session 切换器** — default session 的 Web UI 顶部增加 session 下拉，通过 `sessions.json` 列出其他 session，切换后跳转对应 port
10. **跨 session 管理面板** — 在 default session UI 中提供 list/delete 入口（调用各 session 的 HTTP API）

> Phase 4 不阻塞核心功能交付。MCP/CLI 用户在 Phase 3 结束时即可完整使用多 session。

## 7. 变更总结

| 统计 | Phase 1 | Phase 2 | Phase 3 | Phase 4 | 合计 |
|------|---------|---------|---------|---------|------|
| 新建文件 | 2 | 1 | 1 | 1-2 | 5-6 |
| 修改文件 | 9（含 mcp-server.js） | 1 (CLI 主入口) | 1 (mcp-server.js) | 1-2 | ~12-13 |
| 不改动文件 | ~11 | - | - | - | - |
| 新增进程层 | 0 | 0 | 0 | 0 | **0** |

## 8. 兼容性

| 场景 | 行为 |
|------|------|
| `ep` (不设任何参数) | 与当前完全一致，使用 `~/.ep/` |
| `ep route list` (无 --session) | 操作 default session，行为不变 |
| `ep session create --name x` | 新建 session，返回 ID + port |
| `ep --session xyz route add ...` | 操作指定 session |
| `ep session delete xyz` | 终止进程，清理注册 |
| `EP_HOME=/tmp/foo ep route list` | 使用指定路径（高级用法） |
| `EP_HOME=x ep --session y ...` | **报错**，二者互斥 |
| CA 证书 | 所有 session 共享 `~/.ep/ca/`，无需重复安装 |
| 现有 292 tests | 零破坏（不设 `EP_HOME` / `--session` 时路径不变） |

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

> 已通过 `grep -rn "os.homedir()" --include="*.{ts,js}"` 核实，**共 9 处**（原方案遗漏 `mcp-server.js`）。

| # | 文件 | 行 | 改动 | 备注 |
|---|------|-----|------|------|
| 1 | `core/proxy-context.ts` | 13 | `resolveEpHome()` 替换 `os.homedir() + '.ep'` | |
| 2 | `core/plugin-context-factory.ts` | 14 | 同上 | |
| 3 | `cert.ts` | 9 | **不改**（CA 共享，见 §5.5） | 与原方案不同 |
| 4 | `helpers.ts` | 184 | `resolveEpHome()` 替换 | |
| 5 | `mcp-server.js` | 15 | 同上 | **原方案遗漏** |
| 6 | `bin/lib/proxy-detect.js` | 10 | 同上 | |
| 7 | `bin/lib/file-access.js` | 7 | 间接：通过 `proxy-detect.js` 获取 epDir | |
| 8 | `bin/doctor.js` | 12 | 同上 | |
| 9 | `bin/commands/supervise.js` | 71 | 同上 | |

**额外说明：** `web/` 前端代码中的 `~/.ep/` 仅为 UI 显示文案（`settings-panel.tsx` 第 567/584/596 行），不参与路径解析，Phase 1 不改。若需显示真实 EP_HOME 可在后续迭代中通过 API 下发。

### A.4 依赖传播

```
bin/lib/ep-home.js  ← 唯一真相源（纯 JS）
 ├── core/ep-home.ts              ← TS 桥接
 │    ├── core/proxy-context.ts   → ctx.epDir → 其余模块
 │    ├── core/plugin-context-factory.ts
 │    ├── helpers.ts
 │    └── (cert.ts 不改 — CA 共享)
 ├── mcp-server.js                ← MCP 代理发现（原方案遗漏）
 ├── bin/lib/proxy-detect.js      ← CLI 代理发现
 │    └── bin/lib/file-access.js  ← 间接依赖 epDir
 ├── bin/doctor.js                ← CLI 健康检查
 └── bin/commands/supervise.js    ← CLI 守护进程
```

### A.5 测试影响分析

- `tests/proxy-context.spec.ts:10` 断言 `ctx.epDir.endsWith('.ep')` —— 在 `EP_HOME` 未设置时仍成立（`~/.ep` 仍以 `.ep` 结尾），**无需改动**
- `tests/route-loader.spec.ts:8,18,19` 硬编码 `os.homedir() + '/.ep'` —— 这些是测试输入，不设 `EP_HOME` 时与生产行为一致，**无需改动**
- 其余测试均使用临时目录或 mock，**零破坏**

---

## 附录 B: 未解决问题（供后续讨论）

- **Session 之间的端口冲突恢复**：session-a 占用 9000 后退出但未清理注册表，session-b 创建时 portfinder 会跳过 9000（因被注册表占用）还是复用？建议：portfinder 探测实际端口占用，注册表仅作记录而非预留。
- **远程访问场景**：当前 `--remote` 模式下的多 session 行为未在本方案覆盖，需单独设计。
- **插件热加载**：session 隔离后，插件代码是否允许跨 session 共享源码副本（仅数据隔离）？倾向"是"，但需验证。
