# 环境变量配置指南

## 概述

Mock功能的语法高亮和验证性能参数支持通过环境变量自定义配置。这允许您根据实际使用场景和硬件性能调整这些限制。

## 快速开始

### 1. 创建配置文件

复制 `.env.example` 文件为 `.env`：

```bash
cp .env.example .env
```

### 2. 编辑配置

编辑 `.env` 文件，根据需要调整参数：

```bash
# 示例配置
VITE_MAX_HIGHLIGHT_SIZE=2097152      # 2MB
VITE_MAX_HIGHLIGHT_LINES=20000       # 20000行
VITE_MAX_JSON_MATCHES=100000         # 100000次匹配
VITE_MAX_HTML_MATCHES=50000          # 50000次匹配
VITE_MAX_JS_MATCHES=50000            # 50000次匹配
```

### 3. 重新构建

修改配置后需要重新构建前端：

```bash
pnpm run build
```

## 配置参数说明

### VITE_MAX_HIGHLIGHT_SIZE

**功能**: 控制语法高亮支持的最大文件大小（字节）

**默认值**: `2097152` (2MB)

**推荐配置**:
- 低配置机器: `1048576` (1MB)
- 标准配置: `2097152` (2MB)
- 高性能机器: `5242880` (5MB) 或更高

**影响**:
- 过小: 大文件无法高亮，影响用户体验
- 过大: 可能导致浏览器卡顿

---

### VITE_MAX_HIGHLIGHT_LINES

**功能**: 控制语法高亮支持的最大行数

**默认值**: `10000`

**推荐配置**:
- 低配置机器: `5000`
- 标准配置: `10000`
- 高性能机器: `20000` 或更高

**影响**:
- 过小: 长文件无法完整高亮
- 过大: 可能影响渲染性能

---

### VITE_MAX_JSON_MATCHES

**功能**: JSON语法高亮的最大token匹配数

**默认值**: `50000`

**使用场景**: 
- 大型API响应
- 深度嵌套的JSON结构
- 包含大量数组元素的数据

**推荐配置**:
- 简单JSON: `30000`
- 标准配置: `50000`
- 复杂JSON: `100000`

---

### VITE_MAX_HTML_MATCHES

**功能**: HTML语法高亮的最大标签匹配数

**默认值**: `30000`

**使用场景**:
- 完整的HTML页面
- 复杂的单页应用
- 带有大量DOM元素的页面

**推荐配置**:
- 简单页面: `20000`
- 标准配置: `30000`
- 复杂页面: `50000`

---

### VITE_MAX_JS_MATCHES

**功能**: JavaScript语法高亮的最大token匹配数

**默认值**: `30000`

**使用场景**:
- 打包后的JS文件
- 压缩的脚本
- 大型JavaScript应用

**推荐配置**:
- 小型脚本: `20000`
- 标准配置: `30000`
- 大型应用: `50000`

## 性能调优建议

### 场景1: 主要Mock API响应（JSON）

```bash
VITE_MAX_HIGHLIGHT_SIZE=3145728
VITE_MAX_HIGHLIGHT_LINES=15000
VITE_MAX_JSON_MATCHES=100000
VITE_MAX_HTML_MATCHES=20000
VITE_MAX_JS_MATCHES=20000
```

### 场景2: 主要Mock HTML页面

```bash
VITE_MAX_HIGHLIGHT_SIZE=3145728
VITE_MAX_HIGHLIGHT_LINES=20000
VITE_MAX_JSON_MATCHES=30000
VITE_MAX_HTML_MATCHES=100000
VITE_MAX_JS_MATCHES=30000
```

### 场景3: 主要Mock JavaScript文件

```bash
VITE_MAX_HIGHLIGHT_SIZE=3145728
VITE_MAX_HIGHLIGHT_LINES=20000
VITE_MAX_JSON_MATCHES=30000
VITE_MAX_HTML_MATCHES=20000
VITE_MAX_JS_MATCHES=100000
```

### 场景4: 低性能设备

```bash
VITE_MAX_HIGHLIGHT_SIZE=1048576
VITE_MAX_HIGHLIGHT_LINES=5000
VITE_MAX_JSON_MATCHES=20000
VITE_MAX_HTML_MATCHES=15000
VITE_MAX_JS_MATCHES=15000
```

## 注意事项

1. **环境变量仅在构建时生效**: Vite在构建时将环境变量注入到代码中，因此修改后必须重新构建。

2. **数值必须是整数**: 所有参数值必须是有效的整数字符串。

3. **.env文件不应提交到Git**: `.env`文件已被添加到`.gitignore`中，避免泄露敏感配置。

4. **开发环境**: 修改`.env`后，需要重启开发服务器才能生效：
   ```bash
   pnpm run dev
   ```

5. **生产环境**: 构建生产版本时，确保设置了正确的环境变量：
   ```bash
   pnpm run build
   ```

## 故障排查

### 问题: 修改配置后没有生效

**解决方案**:
1. 确保已重新构建项目
2. 清除浏览器缓存
3. 检查`.env`文件格式是否正确（无空格、正确的变量名）

### 问题: 语法高亮性能差

**解决方案**:
1. 降低各项参数值
2. 检查是否在处理超大文件
3. 考虑升级硬件配置

### 问题: 大文件无法高亮

**解决方案**:
1. 增加`VITE_MAX_HIGHLIGHT_SIZE`
2. 增加`VITE_MAX_HIGHLIGHT_LINES`
3. 增加对应类型的匹配数限制

## 默认配置

如果不创建`.env`文件，系统将使用以下默认配置：

```bash
VITE_MAX_HIGHLIGHT_SIZE=2097152      # 2MB
VITE_MAX_HIGHLIGHT_LINES=10000       # 10000行
VITE_MAX_JSON_MATCHES=50000          # 50000次
VITE_MAX_HTML_MATCHES=30000          # 30000次
VITE_MAX_JS_MATCHES=30000            # 30000次
```

这些默认值适合大多数使用场景，在性能和功能之间取得了良好的平衡。
