# 设计文档：全局规则总览（Rule Overview）

> 状态：草案 v1 · 前置讨论：issue #60 → PR #62（已回滚 #65）· 目标：重新定义需求后重新实现

---

## 1. 背景与复盘

### 1.1 上版为什么被回滚

| # | 表面问题 | 根因 |
|---|---------|------|
| 1 | 内容溢出、无法滚动 | `Table`（自带 overflow 容器）嵌 Radix ScrollArea，未复用系统已验证的表格布局模式 |
| 2 | 复选框点了没反应 | 只读视图里放了 `disabled Checkbox`——视觉上可交互，实际是死控件 |
| 3 | 表格风格不一致 | 无 `table-fixed`/colgroup，长规则撑破单元格，缺「排除」列 |
| 4 | 数据对不上 | 弹窗读服务端快照，编辑器里未保存的修改看不到，两处状态互相矛盾 |
| 5 | （更深层）**功能价值缺失** | 本质是把"所有文件内容 dump 进弹窗"，没有回答用户的真实问题 |

结论：样式问题是表象；**需求定义不清 + 数据语义混乱 + 假交互控件**才是本质。本次重设计从需求重新出发。

### 1.2 从领域模型得出的关键事实

设计前先厘清代理的真实行为（`server/rule-files.ts` / `helpers.ts`）：

1. **生效规则 ≠ 所有规则的拼接**。代理按 `settings.activeRuleFiles` 顺序逐个解析**启用文件**合并（`mergeActiveRules`）。
2. **同 pattern 重复定义时，后定义覆盖先定义**（`ruleMap[pattern] = target` 顺序写入，last-write-wins）。"我改了规则怎么不生效？→ 被后面文件的同名规则覆盖了"是高频排查场景，上版完全没有覆盖。
3. `//` 前缀的禁用行：服务端解析时**直接跳过**，完全不生效。
4. 服务端解析器语义比前端 `parseEprcRules` 丰富（`[variant]` 变体、`file://` 归一化等）→ **合并/生效语义必须由服务端提供**，前端不得自行拼装，否则展示的"生效规则"会与代理实际行为漂移。
5. 现成可复用的交互机制：`route-rule:highlight` 事件（URL 预览的「定位」按钮已在用）→ 可以做到"总览里点一条规则 → 跳到对应文件并高亮那一行"。

---

## 2. 用户场景（JTBD）

| 优先级 | 场景 | 用户的问题 | 功能回应 |
|--------|------|-----------|---------|
| P0 | 排查路由 | "这个域名为什么没转发 / 转发错了？" | 生效规则全景 + 覆盖冲突标记 + 搜索 |
| P0 | 跨文件定位 | "这条规则写在哪个文件里？" | 全局搜索 + 点击跳转定位 |
| P1 | 状态总览 | "现在启用了哪些文件？各多少条规则？" | 文件级分组 + 启用状态 + 计数 |
| P1 | 检查配置 | "浏览某个文件的全部规则（含禁用的）" | 按文件视图，不切 Tab |
| P2 | 修改对照 | "我未保存的修改和已保存的差在哪？" | 未保存提示条，引导回编辑器对照 |

**非目标（明确排除）**：总览内不做任何编辑（启用/禁用、改规则）。编辑只发生在规则编辑页，总览负责"看 + 找 + 跳"。这条边界是上版死控件问题的根本解法。

---

## 3. 竞品参考

| 工具 | 相关模式 | 借鉴点 |
|------|---------|--------|
| **whistle**（同类 web 代理） | 规则以多个文件 Tab 组织 | 恰好没有全局视图——正是本功能要补的缺口；也佐证"分组浏览"在规则多时不够用 |
| **Proxyman** | 规则列表：行内启用开关 + 条件/动作摘要 + 强搜索 | 搜索是第一公民；每行信息密度高但有节奏 |
| **Charles**（Rewrite/Map Sets） | 命名规则集列表，集级启用，集内展开规则 | 两级信息架构：文件级状态 + 规则级明细 |
| **uBlock Origin**（过滤器列表） | 每个列表一行：启用开关 + 规则数 + 状态徽标 | 文件级概览行的信息要素：名称/开关语义/计数/状态 |
| **VSCode Problems** | 扁平分组列表 + 来源文件标记 + 顶部过滤框 | "跨来源扁平列表 + 来源徽标 + 即时过滤"是排查场景的最佳形态 |

**提炼**：两级信息架构（文件 → 规则）；检索优先；来源可追溯；点击可跳转。

---

## 4. 功能设计

### 4.1 信息架构：双视图

```
┌ 全局规则总览 ──────────────────────────────────────────┐
│ [生效规则] [按文件]        🔍 搜索规则/目标/文件…  [刷新] │
│ ─────────────────────────────────────────────────────── │
│              （视图区，见下方两个视图）                    │
└─────────────────────────────────────────────────────────┘
```

- **生效规则（默认视图）**：回答"代理现在实际会怎么路由"
  - 数据 = 服务端合并结果：仅**启用文件**中的**启用规则**，按合并顺序扁平排列
  - 每行：`规则 → 目标` + 来源文件 Badge + 排除（`!xxx`，muted）
  - **覆盖冲突标记**：同 pattern 在多个启用文件中定义时，生效的是最后一次定义；被覆盖的行显示 ⚠ 「已被 <文件> 覆盖」（destructive/muted 样式）
- **按文件（保留原需求）**：回答"每个文件里写了什么"
  - 按文件分组；分组头 = 文件名 + 启用 Badge + 规则数 Badge（与 Tabs 上既有徽标同款）
  - 组内显示全部规则**含禁用行**（禁用行整行淡化 + 禁用 Badge）
  - 禁用文件的分组头标「文件已禁用」并整组淡化

### 4.2 搜索（P0 能力，上版完全缺失）

- 顶部单一搜索框，**即时过滤**（规则、目标、文件名，大小写不敏感；`useDeferredValue` 防抖，与主表格筛选一致）
- 过滤后显示「x / y 条」；无结果显示「无匹配 + 清空筛选」空态

### 4.3 交互设计

| 对象 | 交互 | 实现 |
|------|------|------|
| 规则行 | 点击 → 关闭总览，切到对应文件 Tab，滚动定位并高亮该行 | 复用 `fetchFileContent(name)` + `route-rule:highlight` 事件（与 URL 预览「定位」完全同机制） |
| 文件分组头 | 点击 → 跳到该文件（不定位具体行） | `fetchFileContent(name)` |
| 刷新按钮 | 重新拉取快照 | — |
| 状态徽标 | 纯展示，**无任何可点击的假控件** | Badge only |

行 hover 用系统表格默认 `hover:bg-accent/60`；跳转目标行复用主表格高亮样式（`RULE_ROW_HIGHLIGHT_CLASS`），形成"总览 → 编辑器"的闭环。

### 4.4 数据语义（上版的混乱点，这次定死）

- **总览 = 服务端已保存状态的快照**（即代理此刻真实使用的规则），描述文案明确写出
- 当前活动文件存在未保存修改时，顶部显示提示条：
  「<文件名> 有未保存修改，此处展示的是已保存内容」
  （判断：编辑器 `rules` 序列化后 ≠ 上次加载/保存的 textDraft）
- 打开时自动拉取一次；期间被外部改动不自动刷新（只读快照语义），提供手动刷新

### 4.5 载体：全局 Panel（推荐）而非 Dialog

**推荐 A：全局 Panel（`size: lg`，系统默认尺寸）**

理由：
1. 规则多时 Dialog 永远局促（上版溢出的深层原因之一）；Panel 空间大且可拖拽调整（系统已支持 resize/记忆尺寸）
2. 与 `rules.ai`、`rules.preview` 同一交互家族，心智一致
3. **命令面板可直达**：注册 `查看所有规则` 命令（section: 路由规则，keywords: 全部/总览/overview/rules），⌘K 搜索即达
4. 保留规则页按钮入口（`rule-file-actions` 内、创建按钮左侧，满足原 issue 位置要求）

备选 B：大 Dialog（`sm:max-w-4xl` + `max-h-[85vh]`）——满足原 issue 字面形态，实现略少；但空间天花板低、无命令面板直达。

### 4.6 状态设计

| 状态 | 表现 |
|------|------|
| 加载 | 内容区 Skeleton（系统已有 skeleton 组件），不阻塞打开 |
| 空态-无文件 | Empty：「还没有规则文件」+ 引导创建 |
| 空态-无规则 | Empty：「所有规则文件都是空的」 |
| 空态-无匹配 | 「无匹配结果」+ 清空筛选按钮 |
| 单文件读取失败 | 该分组内显示错误行（含重试），其余分组正常——不整体失败（上版单文件失败被吞成"空"） |
| API 整体失败 | 错误占位 + 重试 |

---

## 5. UI 规范映射（严格对齐系统既有模式）

| 元素 | 系统
|------|------|
---TRANSLATED CONTENT BELOW--- continues with table mapping elements to system components (table-fixed+colgroup, ScrollArea min-h-0 flex-1, Badge px-1 py-0 text-[10px], break-all font-mono text-xs, Input h-8, ToggleGroup 视图切换, Skeleton, Empty) and then sections 6 (技术方案: backend API GET /api/rule-files/overview returning files/mergedRules/conflicts, server-side merge semantics, frontend rule-overview-panel.tsx as separate component, App.tsx command palette entry, highlight event jump), 7 (验收标准), 8 (实施切分 PR1 backend + PR2 frontend)---

The full translation of this thinking block is not just the tail; here is the complete remainder properly translated:

| 元素 | 系统既有规范 |
|------|-------------|
| 表格布局 | 表头固定在 ScrollArea 外 + 表体 `ScrollArea className="min-h-0 flex-1"`；`table-fixed` + `<colgroup>`（列宽 2rem/3rem/9rem 刻度） |
| 长文本 | 规则/目标/排除列 `break-all font-mono text-xs`，禁止依赖 nowrap |
| 状态徽标 | `Badge variant=default/secondary`，`px-1 py-0 text-[10px]`（与 Tabs 计数徽标同款） |
| 视图切换 | `ToggleGroup variant="outline" size="sm"`（与主表格 表格/文本/图 切换同款） |
| 搜索框 | `Input h-8` + Search 图标（与主表格筛选一致） |
| 覆盖警告 | Badge `variant="destructive"` 或 muted 前置 ⚠ 图标 + `title` 说明 |
| 跳转按钮语义 | 行级 `cursor-pointer` + hover 背景变化；键盘可达（分组头 `role="button"` tabIndex） |
| 响应式 | `sm:` 以下隐藏「排除」列（信息进 `title`）；Panel 小尺寸下表格横向滚动兜底 |

线框（生效规则视图）：

```
┌ 生效规则 ────────────────────────────────────────────────┐
│ example.com        → 127.0.0.1:3000   [默认规则] !sub.xx  │
│ api.test.com       → localhost:8080   [默认规则]          │
│ staging.test.com   → 10.0.0.5:80      [开发规则]          │
│ example.com ⚠已覆盖 → 10.0.0.9:80      [开发规则] (muted) │
└──────────────────────────────────────────────────────────┘
```

---

## 6. 技术方案

### 6.1 后端（新增，~80 行）

`GET /api/rule-files/overview`，注册于 `server/rule-files.ts`：

```jsonc
{
  "files": [
    { "name": "默认规则", "enabled": true, "ruleCount": 3 }
  ],
  "mergedRules": [
    { "pattern": "example.com", "target": "127.0.0.1:3000",
      "exclusions": ["sub.example.com"], "file": "默认规则" }
  ],
  "conflicts": [
    { "pattern": "example.com",
      "winner": { "file": "开发规则", "target": "10.0.0.9:80" },
      "shadowed": [{ "file": "默认规则", "target": "127.0.0.1:3000" }] }
  ],
  "perFileRules": [
    { "name": "默认规则", "enabled": true,
      "rules": [{ "pattern": "…", "target": "…", "exclusions": [], "enabled": true }] }
  ]
}
```

要点：
- 复用 `parseEprcWithExclusions` / `mergeActiveRules` 的解析与合并路径，**保证与服务端实际路由行为一致**（单一事实来源；这是对上版"前端自行 parse 拼装"的架构纠正）
- `parseEprcWithExclusions` 需小幅扩展：保留 `//` 禁用行的条目（带 `enabled:false`）供按文件视图使用（`mergedRules` 仍只含启用行）
- 冲突检测：合并时记录 pattern 首次/末次定义即可

### 6.2 前端

- 新组件 `web/src/components/rule-overview-panel.tsx`（**独立文件**，不再把上百行塞进 rule-config.tsx——上版的另一个人为复杂度来源）
  - props：`{ activeFileName, dirtyHint, onLocateRule(file, pattern, target), onSelectFile(name) }`
- `rule-config.tsx` 仅新增：按钮入口 + dirty 判断 + 触发 `panel.openPanel('rules.overview')`
- `App.tsx`：命令面板注册 `查看所有规则`（section 路由规则）+ `renderPanel` case
- 跳转实现照抄 App.tsx 中 URL 预览「定位」的既有做法（`fetchFileContent` → 派发 `route-rule:highlight`）

### 6.3 测试计划

- 后端：overview API（合并顺序、last-write-wins 冲突、禁用文件/禁用行排除、perFileRules 含禁用行、空态、读取失败）
- 前端：双视图渲染、搜索过滤与 x/y 计数、冲突标记、行点击/分组头点击回调、未保存提示条显隐、空/加载/单文件失败态、命令面板入口、关闭行为
- 回归：`tsc --noEmit` + `vitest run`（web 与 root）

---

## 7. 验收标准（替代原 issue #60）

1. 入口：规则页 `rule-file-actions` 内、创建按钮左侧按钮 + 命令面板 `查看所有规则` 均可打开总览
2. 生效规则视图默认展示：启用文件、启用规则、按服务端合并顺序，含来源文件与排除展示
3. 重复 pattern 的覆盖关系有明确视觉标记（生效条目 + 被覆盖条目均可追溯）
4. 搜索即时过滤规则/目标/文件名，显示 x/y，支持清空
5. 点击规则行：切到对应文件并高亮定位该行；点击分组头：切到该文件
6. 按文件视图：分组头含启用状态与计数；禁用文件/禁用规则有淡化与标识
7. 界面无不可交互的假控件；无内容溢出；表格风格与主表格一致（table-fixed/colgroup/滚动模式）
8. 空态（无文件/无规则/无匹配）、加载（Skeleton）、单文件失败（局部错误+重试）齐全
9. 活动文件有未保存修改时显示提示条，说明总览为已保存快照
10. `cd web && npx tsc --noEmit`、`cd web && pnpm run test:run`、root `pnpm test` 全部通过

---

## 8. 实施切分

- **PR1（后端）**：overview API + parse 扩展 + 服务端测试
- **PR2（前端）**：rule-overview-panel + 入口/命令注册 + 前端测试
- 合计预估 ~350 行（后端 ~80，前端 ~180，测试 ~90）
