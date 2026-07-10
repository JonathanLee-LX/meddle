# RFC: Easy Proxy 插件化架构重构方案（V1）

## 1. 背景

当前 Easy Proxy 已具备较完整的核心能力（请求日志、规则配置、Mock、Replay 等），但能力主要以内聚在主进程代码中的方式演进。随着后续需求增加（动态 Mock、AI 请求分析、治理类能力），继续在单体流程上叠加将带来以下问题：

- 业务能力耦合在主链路，新增功能会增加改动面和回归风险。
- 不同功能共享状态但缺少统一生命周期与权限边界，治理成本上升。
- 对“实验功能/团队定制功能”缺乏低风险扩展机制。
- 技术债会持续累积，影响长期迭代速度。

本 RFC 目标是在不牺牲现有稳定性的前提下，建立一个可演进的插件平台架构。

---

## 2. 目标与非目标

### 2.1 目标（Goals）

- 支持将现有能力改造为“官方内置插件（builtin plugins）”。
- 提供统一的插件生命周期、Hook 协议、配置规范、错误隔离机制。
- 让未来功能（动态 Mock、AI 分析等）可通过插件新增，尽量不改内核。
- 保持现有用户体验和配置兼容（多文件路由规则、Mock 配置、UI 操作路径）。
- 增强可观测性：插件耗时、错误、事件吞吐可追踪。

### 2.2 非目标（Non-Goals）

- 本阶段不做“第三方远程插件市场”上线。
- 本阶段不做“跨语言插件”执行（先以 Node.js 运行时为主）。
- 本阶段不实现所有未来功能，仅搭平台和迁移基线能力。
- 本阶段不大改 UI 信息架构（在现有页面中渐进接入控制面）。

---

## 3. 架构原则

- **内核最小化**：内核仅负责协议代理、事件调度、插件运行时。
- **能力插件化**：业务能力通过插件实现，内核不承载业务规则。
- **兼容优先**：先迁移能力，不改变用户行为；变更分阶段可回滚。
- **链路分层**：关键路径 Hook 与异步扩展任务分离，保证代理实时性。
- **失败隔离**：插件异常不能拖垮代理主链路，支持降级与熔断。
- **可治理**：具备权限声明、优先级、依赖、启停和健康状态。

---

## 4. 目标架构（逻辑分层）

### 4.1 Core Kernel

职责：

- 维护请求生命周期 Pipeline（HTTP/HTTPS/WebSocket）。
- 提供 Hook 调度器（按优先级执行）。
- 承担统一上下文对象创建和清理。
- 管理插件运行时、能力注入、错误边界。

### 4.2 Plugin Runtime

职责：

- 加载插件（builtin/local）。
- 解析与校验插件 Manifest（版本、权限、依赖）。
- 生命周期管理（setup/start/stop/dispose）。
- 执行超时控制、错误捕获、健康状态记录。

### 4.3 Capability API

插件通过受控 API 访问系统能力，避免直接触碰内核内部结构：

- `ctx.log`：结构化日志和 tracing
- `ctx.store`：插件私有 KV 存储
- `ctx.config`：读取插件配置
- `ctx.emit/on`：发布订阅事件
- `ctx.http`：受控外部请求能力（后续可按权限限制）
- `ctx.respond`：在 Hook 中短路响应

### 4.4 Control Plane（管理面）

前端扩展“插件管理”页（可放在现有 Tab 体系内）：

- 插件列表（状态、版本、Hook、耗时、错误率）
- 启停与优先级调整
- 插件配置编辑（基于 schema 自动渲染）
- 运行态观察（最近错误、告警、降级状态）

---

## 5. 插件模型草案

### 5.1 Manifest 结构

```ts
type PluginManifest = {
  id: string
  name: string
  version: string
  apiVersion: string
  type: 'builtin' | 'local'
  permissions: string[]
  hooks: string[]
  priority?: number
  dependencies?: string[]
  configSchema?: object
}
```

### 5.2 Runtime 接口草案

```ts
type Plugin = {
  manifest: PluginManifest
  setup(ctx: PluginContext): Promise<void> | void
  start?(): Promise<void> | void
  stop?(): Promise<void> | void
  dispose?(): Promise<void> | void
  onRequestStart?(ctx: RequestContext): Promise<void> | void
  onBeforeProxy?(ctx: RequestContext): Promise<void> | void
  onBeforeResponse?(ctx: ResponseContext): Promise<void> | void
  onAfterResponse?(ctx: ResponseContext): Promise<void> | void
  onError?(ctx: ErrorContext): Promise<void> | void
}
```

### 5.3 Hook 语义（V1）

- `onRequestStart`: 请求进入代理，适合打点/预处理
- `onBeforeProxy`: 转发前，可改写目标、短路返回（Mock）
- `onBeforeResponse`: 响应返回客户端前，可做响应处理
- `onAfterResponse`: 响应结束后，适合日志落盘/异步分析
- `onError`: 统一错误观察与告警

---

## 6. 现有功能迁移映射

### 6.1 builtin-logger

- 覆盖请求日志、详情记录、WebSocket 推送。
- Hook：`onRequestStart`, `onAfterResponse`, `onError`。

### 6.2 builtin-router

- 覆盖路由规则文本解析与目标改写。
- Hook：`onBeforeProxy`。

### 6.3 builtin-mock

- 覆盖 Mock 匹配与响应短路（inline/file）。
- Hook：`onBeforeProxy`。

### 6.4 builtin-replay

- 覆盖 replay API 与日志回写。
- 以服务 API + 内部能力方式提供，不阻塞主请求流。

### 6.5 后续示例插件

- `plugin-dynamic-mock`：脚本化响应生成（入参为请求上下文）。
- `plugin-ai-analyzer`：消费 `onAfterResponse` 事件，做异步分析。

---

## 7. 数据与配置策略

- 现有配置文件保持兼容，不做破坏式变更。
- 新增 `plugins.config.json`（或内置于现有配置体系）用于：
  - 启停状态
  - 优先级
  - 插件配置
- 每个插件有独立命名空间存储，避免状态污染。

---

## 8. 安全与治理

### 8.1 权限模型（V1）

建议最小权限集合：

- `proxy:read` / `proxy:write`
- `response:shortcircuit`
- `config:read` / `config:write`
- `storage:read` / `storage:write`
- `network:outbound`

未声明权限默认拒绝，内置插件按白名单授权。

### 8.2 运行隔离（阶段化）

- V1：同进程沙箱 + 严格 API 边界 + 超时保护。
- V2：可选 Worker 线程隔离（针对高风险插件）。

### 8.3 供应链与签名（后续）

- builtin 插件由仓库管理和发布。
- local 插件引入签名校验预留点（不在 V1 强制）。

---

## 9. 性能预算与可观测性

### 9.1 性能预算

- 单插件单次 Hook 执行预算：默认 10ms（可按类型调优）。
- 关键路径总插件预算：默认 30ms（超出记录告警）。
- AI 类任务必须异步，不得阻塞转发关键路径。

### 9.2 可观测指标

- 插件级：调用次数、平均耗时、P95、错误数、超时数、降级次数。
- 请求级：Hook Trace（执行顺序、耗时分布）。
- 系统级：内存增量、事件积压长度。

---

## 10. 多 Agent 实施分工（规划）

### Agent A：平台架构

- 输出 ADR：模块边界、Hook 协议、兼容策略。

### Agent B：内核与 Pipeline

- 拆分请求流程，落地调度器和上下文模型。

### Agent C：插件运行时

- 实现加载器、生命周期、优先级、超时控制。

### Agent D：数据与可观测

- 指标模型、Hook Trace、插件健康统计。

### Agent E：控制面前端

- 插件管理页面、配置 schema 渲染、状态可视化。

### Agent F：迁移兼容

- 现有 logger/router/mock/replay 插件化改造与回滚脚本。

### Agent G：安全治理

- 权限校验、风险模型、沙箱策略。

### Agent H：测试保障

- 回归矩阵、性能基线、混沌和容灾测试方案。

---

## 11. 分阶段里程碑（建议）

### Phase 0：架构冻结（1 周）

- 完成 RFC/ADR 审核
- 冻结 Plugin API 与 Hook 语义
- 验收：文档通过评审，关键接口无争议

### Phase 1：内核抽象（1-2 周）

- 建立 Pipeline 与 Plugin Runtime 骨架
- 保持现有行为不变
- 验收：现有 E2E 用例通过，性能回退 < 5%

### Phase 2：内置插件迁移（1-2 周）

- logger/router/mock/replay 迁移到 builtin 插件
- 验收：功能完全对齐、回归通过、可回滚

### Phase 3：控制面上线（1 周）

- 插件启停、排序、配置编辑、健康可视化
- 验收：完整管理闭环可用

### Phase 4：扩展样板（1 周）

- dynamic-mock 样板 + ai-analyzer 异步样板
- 验收：新增功能可在不改内核情况下接入

### Phase 5：稳定与发布（1 周）

- 压测、故障演练、迁移文档、灰度发布
- 验收：线上稳定、可回滚、文档完备

---

## 12. 风险与缓解

- **性能回退**：设置 Hook 预算与慢插件告警，关键路径严格限时。
- **行为不一致**：灰度发布 + 双写对比 + 回滚开关。
- **复杂度上升**：提供插件模板、开发脚手架和调试工具。
- **安全风险**：最小权限默认拒绝，能力 API 白名单化。
- **迁移风险**：以 builtin 插件逐步替换，阶段验收后再切换默认路径。

---

## 13. 验收标准（Definition of Done）

- 现有核心能力完全由 builtin 插件承载并通过回归。
- 新增一个示例插件可无内核改动接入并稳定运行。
- 插件启停/排序/配置管理可在 UI 完整操作。
- 出现插件异常时，代理主链路可降级并持续服务。
- 文档（开发、运维、迁移）完整，具备团队协作可执行性。

---

## 14. 下一步（仅设计动作）

- 产出配套 ADR（建议 3 篇）：
  - ADR-001: Plugin API 与 Hook 协议
  - ADR-002: 插件权限与隔离策略
  - ADR-003: 迁移与回滚机制
- 输出“Phase 1 任务拆解看板”（按 Agent 维度分配）。
- 定义基线回归清单（功能/性能/稳定性）。

---

## 15. 相关文档

- [ADR-001: Plugin API 与 Hook 协议](./ADR-001-plugin-api.md) - 插件 API 接口定版
- [插件系统完整开发指南](./PLUGIN_SYSTEM_GUIDE.md) - 详细的插件开发教程，包含接口说明、示例代码和最佳实践
