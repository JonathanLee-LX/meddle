# ADR-002: 插件权限与隔离策略（V1）

- **状态**: Proposed
- **日期**: 2026-02-15
- **作者**: Meddle 架构重构组
- **关联**: `RFC_PLUGIN_ARCHITECTURE.md`, `ADR-001-plugin-api.md`

## 1. 背景

插件化后，系统能力从“内核私有”变为“插件可调用”。若无权限边界和隔离策略，将出现以下风险：

- 插件误用或滥用能力，影响请求链路稳定性。
- 插件可见数据范围过大，产生信息泄露风险。
- 新增 third-party/local 插件时安全不可控。

V1 目标是在不引入过重复杂度的前提下，建立“可落地且可治理”的权限与隔离基线。

## 2. 决策结果

### 2.1 权限模型采用“默认拒绝 + 最小授权”

- 插件必须在 Manifest 显式声明权限。
- 未声明即拒绝（deny by default）。
- builtin 插件按最小权限配置；local 插件默认低权限模板。

### 2.2 V1 采用“同进程隔离 + 能力 API 门禁”

- 插件与内核暂时同进程运行（降低交付复杂度）。
- 插件不可直接访问内核对象，只能通过 `PluginContext` 能力 API。
- 能力 API 在调用层做权限校验与审计日志。

### 2.3 高风险能力默认关闭

- `network:outbound`（外发请求）默认关闭。
- `config:write`（写配置）默认仅内置插件可用。
- 任何“执行任意脚本”能力不在 V1 开放。

## 3. 权限定义（V1）

```ts
type Permission =
  | 'proxy:read'            // 读取请求/响应基础信息
  | 'proxy:write'           // 改写请求目标/头/body
  | 'response:shortcircuit' // 允许短路响应（mock）
  | 'config:read'           // 读取插件配置
  | 'config:write'          // 写插件配置
  | 'storage:read'          // 读插件命名空间存储
  | 'storage:write'         // 写插件命名空间存储
  | 'network:outbound'      // 调用受控 HTTP 客户端
```

### 3.1 权限与 API 对应关系

- `ctx.setTarget` -> `proxy:write`
- `ctx.respond` -> `response:shortcircuit`
- `ctx.config.get` -> `config:read`
- `ctx.config.set` -> `config:write`
- `ctx.store.get` -> `storage:read`
- `ctx.store.set/delete` -> `storage:write`
- `ctx.http.fetch` -> `network:outbound`

## 4. 隔离策略（V1 -> V2）

### 4.1 V1 同进程隔离

- 通过 API 封装隔离内核实现细节。
- 通过 timeout + try/catch + 熔断降级隔离故障。
- 插件状态机：`healthy` -> `degraded` -> `disabled`。

### 4.2 V2 可选 Worker 隔离（预留）

- 对高风险插件（AI、动态脚本）迁移到 Worker 线程。
- 使用消息协议传递上下文快照，主链路只保留最小同步能力。

## 5. 审计与治理

### 5.1 审计日志

审计事件至少包含：

- 时间戳
- `pluginId`
- 调用 API 名称
- 权限结果（allow/deny）
- 请求标识（requestId/traceId）
- 错误信息（如有）

### 5.2 治理动作

- 连续拒绝/超时达到阈值触发告警。
- 可在控制面查看插件风险画像（权限、错误率、超时率）。
- 支持快速禁用单插件。

## 6. 配置策略

### 6.1 权限审批模式（V1）

- builtin：仓库固定白名单。
- local：首次加载提示权限清单，用户确认后生效。
- 变更权限需再次确认。

### 6.2 环境差异

- `dev` 环境允许更高可观察权限。
- `prod` 环境默认限制 `config:write`、`network:outbound`。

## 7. 风险与缓解

- **权限过细导致开发复杂**：提供权限组合模板（logger/mock/router）。
- **权限过粗导致越权**：审计 + 拒绝默认 + 持续收敛。
- **同进程隔离不足**：优先治理高风险插件并规划 V2 Worker。

## 8. 验收标准

- 所有能力 API 都有权限门禁。
- 未授权调用被拒绝并写入审计日志。
- 插件异常/超时可降级，不影响代理主链路。
- 控制面可见插件权限与健康状态。

## 9. 后续动作

- 新增 `security/permission-guard.ts` 设计稿。
- 定义 local 插件权限确认交互草图。
- 与 ADR-003 对齐灰度与回滚流程中的权限策略。

