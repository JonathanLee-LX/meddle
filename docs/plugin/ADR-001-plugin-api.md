# ADR-001: 插件 API 与 Hook 协议定版（V1）

- **状态**: Proposed
- **日期**: 2026-02-15
- **作者**: Meddle 架构重构组
- **关联 RFC**: `RFC_PLUGIN_ARCHITECTURE.md`

## 1. 决策背景

为支撑 Meddle 从“功能集合”演进为“可扩展平台”，需要冻结一套稳定的插件 API 与 Hook 协议，避免后续能力扩展反复破坏内核边界。

本 ADR 聚焦：

- 插件定义与生命周期接口
- 请求生命周期 Hook 语义
- 上下文对象与能力 API 边界
- 错误处理、超时与降级约束
- 版本策略与兼容策略

## 2. 决策结果

### 2.1 插件 Manifest（V1）

```ts
export type PluginManifest = {
  id: string
  name?: string                 // 可选，未提供时使用 id 作为显示名
  version: string
  apiVersion: '1.x'
  type?: 'builtin' | 'local'    // 可选，默认 local
  permissions: Permission[]
  hooks: HookName[]
  priority?: number
  dependencies?: string[]
  configSchema?: JsonSchema
}
```

#### 约束

- `id` 全局唯一，格式建议 `org.plugin-name`。
- `name` 可选，未提供时使用 `id` 作为显示名。
- `apiVersion` 采用主版本兼容策略（`1.x`）。
- 未声明在 `hooks` 的回调不会被注册。
- `priority` 默认 `100`，数字越小优先级越高。

### 2.2 插件运行时接口（V1）

```ts
export type Plugin = {
  manifest: PluginManifest
  setup(ctx: PluginContext): Promise<void> | void
  start?(): Promise<void> | void
  stop?(): Promise<void> | void
  dispose?(): Promise<void> | void

  onRequestStart?(ctx: HookContext): Promise<void> | void
  onAfterRequest?(ctx: RequestSentContext): Promise<void> | void
  onBeforeProxy?(ctx: HookContext): Promise<void> | void
  onBeforeResponse?(ctx: ResponseContext): Promise<void> | void
  onAfterResponse?(ctx: ResponseContext): Promise<void> | void
  onError?(ctx: ErrorContext): Promise<void> | void
}
```

#### 生命周期语义

- `setup`: 插件装配阶段，只执行一次。
- `start`: 插件启用时调用。
- `stop`: 插件停用时调用。
- `dispose`: 插件卸载时调用，释放资源。

#### Hook 语义

- `onRequestStart`: 请求进入代理，适合打点/预处理。
- `onBeforeProxy`: 即将转发前，可短路、改写 target。
- `onAfterRequest`: 请求处理阶段完成，即将发送到上游，适合审计/统计。
- `onBeforeResponse`: 响应返回前，可加工响应。
- `onAfterResponse`: 响应完成后（异步），适合日志持久化。
- `onError`: 任意阶段出错后调用。

### 2.3 Hook 协议（V1）

#### `onRequestStart(ctx)`

- 时机：请求刚进入代理，尚未进行路由决策。
- 用途：打点、预处理、注入 traceId。
- 限制：不可直接写响应。

#### `onBeforeProxy(ctx)`

- 时机：即将发起上游请求之前。
- 用途：改写 target、请求头、请求体；执行 mock 短路。
- 限制：若调用 `ctx.respond()`，必须终止后续转发。

#### `onAfterRequest(ctx)`

- 时机：请求处理阶段完成，即将发送到上游（`executeUpstream` 之前）。
- 用途：记录请求发送时间、审计日志、请求阶段统计。
- 限制：此时请求内容已确定，修改无效。

#### `onBeforeResponse(ctx)`

- 时机：收到上游响应，返回客户端之前。
- 用途：响应头/体加工、脱敏、标注。
- 限制：必须尊重响应流大小限制。

#### `onAfterResponse(ctx)`

- 时机：响应完成后。
- 用途：日志持久化、异步分析、指标上报。
- 限制：不得阻塞主链路；长任务需排入异步队列。

#### `onError(ctx)` 

- 时机：任意阶段出现错误后。
- 用途：记录、告警、补偿动作。
- 限制：不得抛出未处理异常。

### 2.4 上下文对象（当前实现）

当前实现的上下文对象如下：

```ts
type HookContext = {
  request: {
    method?: string
    url?: string
    headers?: Record<string, string | string[]>
    body?: any
  }
  target: string
  meta: Record<string, unknown>
  shortCircuited: boolean
  shortCircuitResponse: Response | null
  log: Logger
  setTarget(target: string): void
  respond(resp: Response): void
}

type ResponseContext = {
  request: HookContext['request']
  target: string
  meta: Record<string, unknown>
  response: {
    statusCode: number
    headers: Record<string, string | string[]>
    body: string | Buffer
  }
  log: Logger
}

type RequestSentContext = {
  request: HookContext['request']
  target: string
  meta: Record<string, unknown>
  log: Logger
  requestSentAt?: number  // 请求发送时间戳
}

type ErrorContext = {
  request: HookContext['request']
  target: string
  meta: Record<string, unknown>
  phase: HookName
  error: Error
  log: Logger
}
```

### 2.5 能力 API（PluginContext）

**当前实现**：

```ts
type PluginContext = {
  manifest: PluginManifest
  log: Logger                    // 日志接口（自动添加 plugin id 前缀）
  config: PluginConfigAPI        // 配置读写 API
  store: PluginStoreAPI          // 插件私有存储
  eventBus: PluginEventBusAPI    // 事件总线
  [key: string]: any             // 预留动态扩展
}

type PluginConfigAPI = {
  get<T = unknown>(key: string, fallback?: T): T
  set<T = unknown>(key: string, value: T): void
}

type PluginStoreAPI = {
  get<T = unknown>(key: string): T | undefined
  set<T = unknown>(key: string, value: T): void
  delete(key: string): void
  clear(): void
}

type PluginEventBusAPI = {
  emit(topic: string, payload: unknown): void
  on(topic: string, handler: (payload: unknown) => void): () => void
  off(topic: string, handler?: (payload: unknown) => void): void
}
```

**存储位置**：
- 配置：`~/.meddle/plugins-data/{plugin-id}.json`
- 存储：`~/.meddle/plugins-data/{plugin-id}.store.json`

> HTTP API (`http?: HttpAPI`) 当前尚未实现。

## 3. 错误与超时策略

## 3. 错误与超时策略

### 3.1 超时

- 默认单 Hook 执行超时：`10ms`（可按 Hook 类型配置）。
- 超时行为：
  - 记录慢插件告警
  - 跳过该次插件结果并继续链路
  - 连续超时达到阈值触发自动降级（禁用插件 N 分钟）

### 3.2 错误处理

- 插件异常统一捕获，不允许冒泡到内核未处理层。
- 出错后继续执行同阶段后续插件（除非该错误影响链路完整性）。
- 标记 `request.meta.pluginErrors` 供日志/排障查看。

### 3.3 短路响应规则

- 仅 `onBeforeProxy` 允许 `ctx.respond()`。
- 一旦短路：
  - 停止上游请求
  - 仍可继续 `onAfterResponse` 以便日志记录

## 4. 权限模型（V1）

### 4.1 权限枚举

```ts
type Permission =
  | 'proxy:read'
  | 'proxy:write'
  | 'response:shortcircuit'
  | 'config:read'
  | 'config:write'
  | 'storage:read'
  | 'storage:write'
  | 'network:outbound'
```

### 4.2 执行原则

- 默认拒绝：未声明权限不可使用对应能力。
- 最小授权：builtin 插件按需赋权，local 插件默认低权限模板。
- 审计记录：权限校验失败写入审计日志。

## 5. 版本与兼容策略

### 5.1 版本策略

- `apiVersion` 使用主版本语义：
  - `1.x` 内保持向后兼容
  - `2.0` 才允许破坏性变更

### 5.2 兼容策略

- 新增字段必须可选，且具备默认值。
- Hook 名称和语义在 `1.x` 不改变。
- 旧插件加载时提供兼容适配层（警告但可运行）。

## 6. 被拒绝方案

### 6.1 让插件直接访问内核全局对象

- **拒绝原因**：边界不可控，难以治理、测试和隔离。

### 6.2 一开始就做多进程插件隔离

- **拒绝原因**：复杂度和运维成本过高，不利于 V1 交付。
- **保留**：V2 可以按风险插件增量引入 Worker 隔离。

## 7. 验收检查清单

- 插件可通过 Manifest 被发现、校验、加载。
- Hook 调度顺序可预测（priority + id）。
- 插件超时和异常不影响主代理可用性。
- 权限模型生效并可审计。
- Logger/Router/Mock/Replay 能在该接口上完成迁移。

## 8. 后续动作

- 实现 `PluginManager` 与 `HookDispatcher` 最小骨架。
- 编写 `builtin-logger` 参考实现。
- 补充 ADR-002（权限与隔离）和 ADR-003（迁移与回滚）。

## 9. 相关文档

- [插件系统完整开发指南](./PLUGIN_SYSTEM_GUIDE.md) - 详细的插件开发教程，包含接口说明、示例代码和最佳实践
- [插件架构设计](./RFC_PLUGIN_ARCHITECTURE.md) - 插件系统的整体架构设计

