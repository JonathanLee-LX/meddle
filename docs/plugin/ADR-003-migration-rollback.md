# ADR-003: 插件化迁移与回滚机制（V1）

- **状态**: Proposed
- **日期**: 2026-02-15
- **作者**: Meddle 架构重构组
- **关联**: `RFC_PLUGIN_ARCHITECTURE.md`, `ADR-001-plugin-api.md`, `ADR-002-permission-isolation.md`

## 1. 背景

插件化重构会触碰代理主链路。即使设计正确，也可能在边界场景出现行为偏差。为降低重构风险，需要明确迁移顺序、灰度策略、观测指标和回滚机制，确保“可逐步替换、可对照验证、可快速恢复”。

## 2. 决策结果

### 2.1 采用“双路径并存 + 可切换”迁移方案

- 保留 legacy 路径（现有逻辑）。
- 新增 plugin 路径（Pipeline + builtin plugins）。
- 通过 feature flag 控制流量走向：
  - `MEDDLE_PLUGIN_MODE=off` -> 全量 legacy
  - `MEDDLE_PLUGIN_MODE=shadow` -> legacy 主执行，plugin 并行观测不生效
  - `MEDDLE_PLUGIN_MODE=on` -> 全量 plugin

### 2.2 采用“功能分批迁移”而非一次性切换

顺序建议：

1. logger
2. router
3. mock
4. replay

每一批都必须先 shadow 对照，再灰度生效。

### 2.3 回滚优先级高于修复优先级

- 出现高风险异常时先回滚到 legacy，再做问题定位。
- 回滚动作必须在分钟级完成，不依赖重新部署。

## 3. 迁移流程（标准作业）

## 3.1 Step 0 - 准备

- 冻结接口协议（ADR-001）。
- 建立权限和审计基线（ADR-002）。
- 建立对照指标和报警规则。

## 3.2 Step 1 - Shadow 模式对照

- legacy 负责实际响应。
- plugin 链路并行执行，记录结果和 diff，不影响返回。
- 重点对照：
  - 路由目标是否一致
  - mock 命中与响应是否一致
  - 日志字段和顺序是否一致

## 3.3 Step 2 - 小流量灰度

- 先按固定比例/用户分组切 `MEDDLE_PLUGIN_MODE=on`。
- 观测核心指标 24h（或一个完整业务周期）。
- 指标稳定后逐步扩大。

## 3.4 Step 3 - 全量切换

- 全量启用 plugin 路径。
- legacy 保留一段观察窗口（建议 1-2 个迭代周期）。

## 3.5 Step 4 - 清理 legacy

- 清理前提：
  - 连续两个版本无高优先级回滚
  - 关键链路稳定
- 清理动作通过独立 PR 执行，避免与功能开发混合。

## 4. 回滚策略

### 4.1 回滚触发条件

满足任一条件立即触发回滚：

- 请求失败率显著上升（超过预设阈值）
- P95/P99 延迟显著劣化（超过预设阈值）
- mock 或路由行为偏差导致业务阻断
- 插件运行时异常导致服务不稳定

### 4.2 回滚动作

1. 设置 `MEDDLE_PLUGIN_MODE=off`
2. 确认新流量回到 legacy
3. 锁定当前发布版本，不继续扩大灰度
4. 导出诊断数据（hook trace, plugin error, diff report）
5. 创建根因分析任务（RCA）

### 4.3 回滚验证

- 关键用例回放（router/mock/replay）
- 错误率恢复到基线
- 延迟恢复到基线

## 5. 观测与对照指标

### 5.1 对照指标（shadow 阶段）

- 路由目标一致率（target equality rate）
- mock 命中一致率（mock match parity）
- 响应码一致率（status parity）
- 关键响应体摘要一致率（body hash parity）

### 5.2 运行指标（灰度/全量）

- 请求成功率
- P50/P95/P99 延迟
- 插件超时率
- 插件异常率
- 自动降级触发次数

## 6. 数据留存与诊断

- `diff report` 至少保留 7 天（建议按 requestId 可追溯）。
- 回滚事件需留痕（触发时间、触发人、指标截图、恢复时间）。
- 每次回滚后必须有 RCA 文档。

## 7. 发布策略建议

- 每批迁移都通过独立发布窗口。
- 避免与高风险业务需求同窗发布。
- 发布前执行标准清单：
  - 功能回归通过
  - 性能基线通过
  - 回滚路径演练通过

## 8. 风险与缓解

- **双路径维护成本上升**：限定并存窗口，分批清理。
- **shadow 成本增加**：只对关键链路采样 shadow。
- **回滚不彻底**：使用统一 flag，避免分散开关。

## 9. 验收标准

- 存在统一开关可分钟级切换路径。
- 任一批次迁移都可独立回滚。
- shadow 阶段具备可量化 diff 报告。
- 至少完成一次回滚演练并记录通过。

## 10. 后续动作

- 产出 `release/plugin-rollout-playbook.md`（运行手册）。
- 产出 `migration/shadow-diff-spec.md`（对照报告字段定义）。
- 在控制面增加“当前模式（off/shadow/on）”只读展示。

