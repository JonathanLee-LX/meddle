# 插件 Pipeline 模式指南

## 概述

Meddle 插件系统支持三种运行模式，用于控制插件对请求处理的干预程度。

## 三种模式

### 1. off 模式（传统代理模式）

- **行为**：完全跳过插件系统
- **路由**：使用传统路由逻辑（helpers.ts 中的 `resolveTargetUrl`）
- **适用场景**：
  - 不需要插件功能的简单代理场景
  - 性能优先的生产环境
  - 插件调试时的对照组

### 2. shadow 模式（影子模式） ⚡ 推荐

- **行为**：插件处理请求，但不影响实际路由
- **路由**：实际路由使用传统逻辑，同时记录插件路由结果用于对比
- **记录**：
  - `baseTarget`：传统路由结果（实际使用的目标）
  - `observedTarget`：插件路由结果（仅记录，不使用）
- **适用场景**：
  - 新插件上线前的验证阶段
  - 对比插件路由与传统路由的差异
  - 收集统计数据评估插件准确性

### 3. on 模式（生产模式）

- **行为**：插件完全接管请求处理
- **路由**：由插件的 `onBeforeProxy` hook 决定最终目标
- **白名单**：可通过 `MEDDLE_PLUGIN_ON_HOSTS` 限制生效范围
- **适用场景**：
  - 插件验证完成后的正式上线
  - 需要插件实现复杂路由逻辑的场景

## Shadow 比对追踪机制

### 统计数据

Shadow 模式下自动收集以下统计数据：

| 字段 | 说明 |
|------|------|
| `total` | 总请求数 |
| `diff` | 目标不一致的请求数 |
| `same` | 目标一致的请求数 |
| `diffRate` | 差异率（diff / total） |
| `uniqueDiffPairs` | 不同的目标组合数 |
| `topDiffs` | Top 10 差异目标组合 |
| `samples` | 最近差异样本（最多 20 条） |

### Readiness 评估

切换到 on 模式前，系统自动评估是否满足条件：

```typescript
interface ReadinessResult {
  ready: boolean;          // 是否准备好切换
  reason: string;          // 原因说明
  total: number;           // 总样本数
  minSamples: number;      // 最小样本数阈值
  diffRate: number;        // 实际差异率
  maxDiffRate: number;     // 最大差异率阈值
}
```

**默认阈值**：
- 最小样本数：200 条（可配置）
- 最大差异率：5%（可配置）

**建议策略**：
- `diffRate < 1%`：可以切换，建议完全上线
- `diffRate < 5%`：可以切换，建议使用白名单逐步放量
- `diffRate >= 5%`：不建议切换，需要检查插件逻辑

## On Mode 白名单机制

### 用途

限制 on 模式只对特定 host 的请求生效，实现逐步放量。

### 配置

通过环境变量 `MEDDLE_PLUGIN_ON_HOSTS` 设置（逗号分隔）：

```bash
MEDDLE_PLUGIN_ON_HOSTS=api.example.com,test.example.com
```

### 行为

- 白名单为空：on 模式对所有请求生效
- 白名单有值：仅匹配 host 的请求走插件处理，其他请求走传统路由
- 统计信息：
  - `checked`：检查次数
  - `applied`：插件生效次数
  - `skippedByAllowlist`：因白名单跳过次数
  - `skippedByMode`：因模式跳过次数

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `MEDDLE_PLUGIN_MODE` | 插件模式（off/shadow/on） | off |
| `MEDDLE_SHADOW_WARN_MIN_SAMPLES` | Shadow 模式警告最小样本数 | 200 |
| `MEDDLE_SHADOW_WARN_DIFF_RATE` | Shadow 模式警告差异率阈值 | 0.05 |
| `MEDDLE_PLUGIN_ON_HOSTS` | On 模式 host 白名单（逗号分隔） | 空 |
| `MEDDLE_ENABLE_BUILTIN_ROUTER` | 启用内置路由插件 | true |
| `MEDDLE_ENABLE_BUILTIN_LOGGER` | 启用内置日志插件 | true |
| `MEDDLE_ENABLE_BUILTIN_MOCK` | 启用内置 Mock 插件 | **false** |

## API 接口

### 获取/设置模式

```bash
# 获取当前模式
GET /api/pipeline/mode

# 设置模式
PUT /api/pipeline/mode
Content-Type: application/json
{"mode": "shadow"}
```

### 获取 Shadow 统计

```bash
# 获取统计数据
GET /api/pipeline/shadow-stats

# 重置统计数据
POST /api/pipeline/shadow-stats/reset
```

### 获取 Readiness 评估

```bash
GET /api/pipeline/readiness
```

返回示例：
```json
{
  "ready": true,
  "reason": "差异率 1.2% < 5%，可以切换",
  "total": 500,
  "minSamples": 200,
  "diffRate": 0.012,
  "maxDiffRate": 0.05
}
```

## 切换流程建议

### 从 off 到 shadow

1. 设置 `MEDDLE_PLUGIN_MODE=shadow` 或通过 API 设置
2. 运行足够长时间的收集数据（建议至少 200 条请求）
3. 查看 `/api/pipeline/shadow-stats` 统计
4. 分析 `topDiffs` 中的差异组合

### 从 shadow 到 on

1. 获取 `/api/pipeline/readiness` 评估
2. 如果差异率 < 5%：
   - 设置白名单：`MEDDLE_PLUGIN_ON_HOSTS=api.example.com`
   - 观察白名单范围内的请求是否正常
   - 逐步扩大白名单范围
3. 如果差异率 < 1%：
   - 可以直接切换 `MEDDLE_PLUGIN_MODE=on`
   - 移除白名单限制

## 调试技巧

### 查看 Inspection 追踪

每个请求的日志详情中包含 `_inspectionStages`，记录插件处理链路：

```json
{
  "stages": [
    {
      "name": "builtin.mock",
      "type": "builtin",
      "hook": "onBeforeProxy",
      "status": "short-circuited",
      "duration": 2,
      "changes": {
        "targetBefore": "http://api.example.com/users",
        "targetAfter": "[MOCK]",
        "responseStatusCode": 200
      }
    }
  ]
}
```

### 使用插件测试 API

```bash
POST /api/plugins/test
Content-Type: application/json
{
  "pluginId": "custom.my-plugin",
  "request": {
    "method": "GET",
    "url": "https://api.example.com/users"
  },
  "integrated": true  // 使用真实路由逻辑
}
```