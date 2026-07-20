# 测试文档

## 概述

本项目使用 [Vitest](https://vitest.dev/) 作为测试框架，配合 React Testing Library 进行组件和 Hook 测试。

## 测试文件

### 1. `src/utils/resource-type.test.ts`

测试资源类型识别功能，涵盖以下场景：

#### WebSocket
- ✅ `ws://` 和 `wss://` 协议识别

#### Fetch/XHR
- ✅ POST、PUT、DELETE 等非 GET 请求
- ✅ `/api/` 路径的 URL
- ✅ `.json` 文件

#### Documents
- ✅ `.html`、`.htm`、`.php` 等文档文件
- ✅ 无扩展名的 URL（如 `/page`）
- ✅ 根路径 URL（如 `/`）

#### CSS
- ✅ `.css` 文件识别
- ✅ 带查询参数的 URL 处理

#### JavaScript
- ✅ `.js`、`.mjs`、`.ts`、`.tsx` 文件识别

#### Fonts
- ✅ `.woff`、`.woff2`、`.ttf`、`.otf` 字体文件

#### Images
- ✅ `.png`、`.jpg`、`.jpeg`、`.gif`、`.svg`、`.webp`、`.ico` 图片文件

#### Media
- ✅ `.mp4`、`.webm`、`.mp3`、`.wav` 音视频文件

#### Manifest
- ✅ `.manifest`、`.webmanifest` 清单文件

#### WASM
- ✅ `.wasm` WebAssembly 文件

#### Other
- ✅ 未知扩展名识别为 other

#### Edge Cases
- ✅ 大小写混合的 URL
- ✅ 带查询参数的 URL
- ✅ 带 hash 片段的 URL

**测试数量**: 42 个测试用例

---

### 2. `src/hooks/use-fuzzy-filter.test.ts`

测试筛选功能，涵盖以下场景：

#### 资源类型筛选
- ✅ 所有资源类型筛选（all）
- ✅ Fetch/XHR 类型筛选
- ✅ CSS 类型筛选
- ✅ JS 类型筛选
- ✅ 图片类型筛选
- ✅ 文档类型筛选

#### 文本筛选
- ✅ 普通文本搜索
- ✅ `method:GET`、`method:POST` 方法筛选
- ✅ `status:404`、`status:2xx`、`status:4xx` 状态码筛选
- ✅ `domain:test.com` 域名筛选
- ✅ `-keyword` 负向筛选（排除）
- ✅ 多个条件 AND 逻辑组合
- ✅ 模糊匹配

#### 组合筛选
- ✅ 资源类型 + 文本筛选组合
- ✅ 切换到 "all" 清除筛选
- ✅ 独立更新筛选条件

#### 边界情况
- ✅ 空记录数组
- ✅ 空筛选文本
- ✅ 仅空格的筛选文本
- ✅ 大小写不敏感

**测试数量**: 23 个测试用例

---

## 运行测试

### 安装依赖

```bash
cd web
pnpm install
```

### 运行测试命令

```bash
# 运行测试（监听模式）
pnpm run test

# 运行测试（单次运行）
pnpm run test:run

# 运行测试并打开 UI 界面
pnpm run test:ui

# 运行测试并生成覆盖率报告
pnpm run test:coverage
```

## 测试统计

- **总测试文件**: 2
- **总测试用例**: 65
- **通过率**: 100%

## 测试覆盖的功能

### ✅ 已覆盖

1. **资源类型识别逻辑** (`getResourceType`)
   - 12 种资源类型完整覆盖
   - 边界情况处理

2. **筛选功能** (`useFuzzyFilter`)
   - 资源类型筛选
   - 文本模糊搜索
   - 高级筛选语法（method:、status:、domain:）
   - 负向筛选
   - 组合筛选

### 📋 未覆盖（可选）

以下组件测试属于 UI 交互测试，建议使用 E2E 测试或手动测试：

- LogFilter 组件 UI
- LogTable 组件 UI
- 表头 Sticky 定位效果

## 测试配置

测试配置文件: `vitest.config.ts`

```typescript
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
```

## 持续集成

可以在 CI/CD 流程中添加测试步骤：

```yaml
# .github/workflows/test.yml 示例
- name: Run tests
  run: |
    cd web
    pnpm install
    pnpm run test:run
```

## 贡献指南

添加新功能时，请确保：

1. 为核心逻辑添加单元测试
2. 测试覆盖正常场景和边界情况
3. 保持测试通过率 100%
4. 运行 `pnpm run test:run` 验证所有测试通过
