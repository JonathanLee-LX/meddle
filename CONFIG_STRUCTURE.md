# Easy Proxy 配置文件结构说明

## 📂 目录结构

```
~/.ep/
├── .eprc              # 路由规则配置文件（默认）
├── mocks.json         # Mock 规则配置文件（默认）
├── settings.json      # 系统设置配置文件
└── ca/                # SSL 证书目录
    ├── rootCA.crt     # 根证书
    ├── rootCA.key     # 根证书私钥
    └── *.crt/*.key    # 动态生成的域名证书
```

**注意**：路由规则和 Mock 规则文件支持自定义路径，可以在 `settings.json` 中配置 `rulesFilePath` 和 `mocksFilePath` 指定其他位置的配置文件。

## 📝 配置文件说明

### 1. 路由规则 (`~/.ep/.eprc`)

**用途**: 定义 HTTP 请求的路由转发规则

**格式**: EPRC 文本格式
```
# 示例规则
example.com 127.0.0.1:3000
/api/.* http://localhost:8080

# 禁用规则（使用 // 注释）
// disabled.com 127.0.0.1:3000
```

#### 路由匹配逻辑

当前路由规则的核心逻辑如下：

1. **规则格式固定为 target 在最后**
   - 仅支持：`pattern pattern1 ... !exclusion !exclusion2 ... target`
   - `target` 必须放在最后
   - 一个规则可以配置 0 个、1 个或多个 exclusion，全部写在 target 前
   - 一行可以写多个 pattern，它们共享同一个 target 和 exclusion 列表

2. **按文件内顺序逐条匹配**
   - 请求进入后，会按规则在文件中的顺序依次匹配
   - 命中第一条可用规则后立即停止，不再继续向后匹配
   - 如果该规则因 exclusion 命中被跳过，才会继续检查下一条

3. **pattern 支持正则和通配符**
   - 显式正则：如 `^https://solution\.wps\.cn`
   - 通配符：如 `*.wps.cn`
   - `*.wps.cn` 会匹配：
     - `https://plus.wps.cn/...`
     - `https://deep.plus.wps.cn/...`
   - ⚠️ **注意**：`*.wps.cn` **不会匹配** `https://wps.cn/...`（无子域名的情况），因为通配符 `*.` 表示至少有一个子域名
   - 不包含正则语法、但包含 `*` 的 pattern，会按通配符处理

4. **pattern 匹配对象是完整请求 URL**
   - 匹配时不是只看 host，而是看完整 URL
   - 例如 `solution.wps.cn/console` 可以命中 `https://solution.wps.cn/console/app`

5. **exclusion 只用于跳过当前规则**
   - exclusion 写法：`!/api`、`!^https://a\.com/private`
   - 支持多个 exclusion，例如：`open.wps.cn !/api !/oauth !/internal http://localhost:5173`
   - exclusion 与 pattern 一样，对完整 URL 做匹配
   - 只要任一 exclusion 命中，该规则立即失效，继续检查下一条规则

6. **target 的生成规则**
   - 如果 target 是 `file://` 或本地路径，则直接映射本地文件
   - 如果 target 只是 host 或 host:port（无自定义 path），则继承原请求的：
     - 协议
     - pathname
     - query
   - 如果 target 包含自定义 path（如 `localhost:3000/api`），则**不继承原请求的 pathname**，只使用 target 的 path
     - 例如：规则 `api.com localhost:3000/v2`，原请求 `/users/list` → 最终 `/v2`（丢弃原 path）
     - 如果需要保留原 path 并加前缀，请使用 `[marker]` 重写：`api.com[/] localhost:3000/v2`
   - 如果 target 没写端口而原请求带端口，则继承原请求端口
   - 如果原请求是 websocket，而 target 写成 `http(s)`，最终会自动转成 `ws(s)`

7. **支持 `[marker]` 路径重写**
   - pattern 中可写 `[marker]`
   - 命中后会把原 URL 中 marker 后面的尾路径拼到 target 后面
   - 例如：

```txt
^https://365.kdocs.cn[/3rd/work] https://localhost:13001
```

请求：

```txt
https://365.kdocs.cn/3rd/work/micro/app?a=1
```

会被改写为：

```txt
https://localhost:13001/micro/app?a=1
```

#### 推荐写法示例

```txt
# 单条规则
solution.wps.cn http://localhost:8000

# 多个 pattern 共用一个 target
solution.wps.cn/console solution.wps.cn/dev-server https://localhost:8000

# 带多个 exclusion
open.wps.cn !/api !/oauth !/internal http://localhost:5173

# 通配符
*.wps.cn 127.0.0.1:3000

# marker 重写
^https://365.kdocs.cn[/3rd/work] https://localhost:13001

# 禁用规则
// solution.wps.cn http://localhost:8000
```

**管理方式**:
- Web 界面："路由规则"标签页
- 手动编辑文件

### 2. Mock 规则 (`~/.ep/mocks.json`)

**用途**: 定义 Mock 响应规则

**格式**: JSON
```json
{
  "nextId": 2,
  "rules": [
    {
      "id": 1,
      "name": "模拟API响应",
      "urlPattern": "/api/user",
      "method": "GET",
      "statusCode": 200,
      "headers": { "Content-Type": "application/json" },
      "bodyType": "inline",
      "body": "{\"name\":\"test\"}",
      "delay": 0,
      "enabled": true
    }
  ]
}
```

#### Mock 规则字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | number | 规则 ID（自动生成） |
| `name` | string | 规则名称 |
| `urlPattern` | string | URL 匹配模式（支持正则） |
| `method` | string | HTTP 方法（`*` 表示所有方法） |
| `statusCode` | number | 响应状态码（默认 200） |
| `headers` | object | 自定义响应头 |
| `bodyType` | string | 响应体类型（见下文） |
| `body` | string | 响应体内容 |
| `delay` | number | 响应延迟（毫秒） |
| `enabled` | boolean | 是否启用 |

#### bodyType 类型说明

| 类型 | 说明 | body 格式 |
|------|------|----------|
| `inline` | 内联文本/JSON（默认） | 直接写文本或 JSON 字符串 |
| `file` | 本地文件 | 支持 `file://` 或本地绝对路径 |
| `base64` | Base64 编码数据 | 格式：`data:mime;base64,xxx` |

**示例**：

```json
// inline 类型（默认）
{ "bodyType": "inline", "body": "{\"status\": \"ok\"}" }

// file 类型
{ "bodyType": "file", "body": "file:///path/to/response.json" }
{ "bodyType": "file", "body": "/absolute/path/to/image.png" }

// base64 类型（用于图片等二进制）
{ "bodyType": "inline", "body": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA..." }
```

> ⚠️ **注意**：内置 Mock 插件只处理 `bodyType: 'inline'` 的规则。`file` 和 `base64` 类型由传统 Mock 处理器处理。

**管理方式**:
- Web 界面："Mock"标签页（推荐）

### 3. 系统设置 (`~/.ep/settings.json`)

**用途**: 存储系统级别的配置

**格式**: JSON
```json
{
  "theme": "dark",
  "fontSize": "large",
  "rulesFilePath": "/path/to/custom-rules.eprc",
  "mocksFilePath": "/path/to/custom-mocks.json",
  "aiConfig": {
    "enabled": true,
    "provider": "openai",
    "apiKey": "sk-...",
    "baseUrl": "https://api.openai.com/v1/chat/completions",
    "model": "gpt-4o-mini",
    "models": [
      {
        "id": "1",
        "name": "GPT-4",
        "provider": "openai",
        "apiKey": "sk-...",
        "baseUrl": "https://api.openai.com/v1/chat/completions",
        "model": "gpt-4"
      }
    ],
    "activeModelId": "1"
  }
}
```

**包含内容**:
- `theme`: 主题设置 (light/dark/system)
- `fontSize`: 字体大小 (small/medium/large)
- `rulesFilePath`: 自定义路由规则文件路径（可选）
- `mocksFilePath`: 自定义 Mock 规则文件路径（可选）
- `aiConfig`: AI 功能配置
  - `enabled`: 是否启用
  - `provider`: 服务商 (openai/anthropic)
  - `apiKey`: API 密钥
  - `baseUrl`: API 端点
  - `model`: 模型名称
  - `models`: 多模型配置（可选）
  - `activeModelId`: 当前激活的模型（可选）

**管理方式**:
- Web 界面：右上角设置按钮（推荐）
- 支持通过界面设置自定义配置文件路径

### 4. SSL 证书 (`~/.ep/ca/`)

**用途**: 存储 HTTPS 代理所需的 SSL 证书

**内容**:
- `rootCA.crt` / `rootCA.key`: 根证书和私钥
- 动态生成的域名证书：访问 HTTPS 网站时自动创建

**管理方式**:
- 自动管理，无需手动操作
- 首次使用需要信任根证书

## 🔄 配置优先级

### 路由规则配置
1. **自定义路径**（最高优先级）
   - 在 `settings.json` 中通过 `rulesFilePath` 指定
   - 示例：`/path/to/my-project/rules.eprc`

2. **项目目录**（次高优先级）
   - `./.eprc`
   - `./ep.config.json`
   - `./ep.config.js`

3. **用户主目录**（默认）
   - `~/.ep/.eprc`

### Mock 规则配置
1. **自定义路径**（高优先级）
   - 在 `settings.json` 中通过 `mocksFilePath` 指定
   - 示例：`/path/to/my-mocks.json`

2. **默认位置**
   - `~/.ep/mocks.json`

### 系统设置
- 固定位置：`~/.ep/settings.json`
- 自动从 localStorage 迁移旧配置

## 💡 配置文件特点

### ✅ 优势

1. **扁平化结构**: 配置文件直接在 `~/.ep/` 下，易于查找
2. **分类清晰**: 证书文件单独在 `ca/` 子目录
3. **易于备份**: 只需备份 `~/.ep/` 目录
4. **便于编辑**: 配置文件路径简单，无嵌套目录

### 📋 配置文件对比

| 配置类型 | 位置 | 格式 | 管理方式 |
|---------|------|------|---------|
| 路由规则 | `~/.ep/.eprc` | 文本 | Web界面/手动编辑 |
| Mock规则 | `~/.ep/mocks.json` | JSON | Web界面 |
| 系统设置 | `~/.ep/settings.json` | JSON | Web界面 |
| SSL证书 | `~/.ep/ca/` | 二进制 | 自动管理 |

## 🛠️ 常用操作

### 配置健康检查

```bash
# 使用 CLI 工具检查配置
ep doctor

# 或使用 npm 命令
npm run doctor

# 或直接运行
node bin/doctor.js
```

诊断工具会检查：
- ✅ 配置目录是否存在
- ✅ 系统设置文件格式是否正确
- ✅ 路由规则文件是否有效
- ✅ Mock 规则文件是否有效
- ✅ SSL 证书文件是否存在
- ✅ 文件权限是否正常

也可以通过 Web 界面诊断：
1. 打开设置面板
2. 切换到"配置文件"标签
3. 点击"诊断配置"按钮

### 查看配置

```bash
# 查看目录结构
ls -la ~/.ep/

# 查看路由规则（默认位置）
cat ~/.ep/.eprc

# 查看 Mock 规则（默认位置）
cat ~/.ep/mocks.json | jq .

# 查看系统设置（包含自定义路径）
cat ~/.ep/settings.json | jq .

# 查看证书文件
ls -la ~/.ep/ca/
```

### 使用自定义配置文件

```bash
# 方式一：通过 Web 界面设置
# 1. 打开设置面板 → 配置文件标签
# 2. 输入自定义文件路径
# 3. 点击"应用"按钮

# 方式二：直接编辑 settings.json
cat > ~/.ep/settings.json << 'EOF'
{
  "theme": "system",
  "fontSize": "medium",
  "rulesFilePath": "/path/to/my-rules.eprc",
  "mocksFilePath": "/path/to/my-mocks.json",
  "aiConfig": {
    "enabled": false,
    "provider": "openai",
    "apiKey": "",
    "baseUrl": "",
    "model": "",
    "models": []
  }
}
EOF

# 重启代理服务以加载新配置
# 或通过 Web 界面点击"重新加载配置"
```

### 备份配置

```bash
# 完整备份
tar -czf easy-proxy-backup.tar.gz ~/.ep/

# 仅备份配置（不含证书）
tar -czf config-backup.tar.gz ~/.ep/.eprc ~/.ep/mocks.json ~/.ep/settings.json
```

### 恢复配置

```bash
# 恢复完整备份
tar -xzf easy-proxy-backup.tar.gz -C ~/

# 恢复单个配置文件
cp backup/settings.json ~/.ep/
```

## 🔐 安全提示

1. **保护敏感信息**:
   - `settings.json` 包含 API Key，不要分享
   - 不要将 `settings.json` 提交到公开仓库

2. **证书安全**:
   - 定期备份 `ca/` 目录
   - 不要分享 `rootCA.key` 私钥文件

3. **配置备份**:
   - 建议定期备份整个 `~/.ep/` 目录
   - 可使用云盘同步（注意加密敏感文件）

## 🚀 迁移说明

### 从旧版本迁移

如果你从旧版本升级，运行清理脚本自动迁移：

```bash
./scripts/clean-old-config.sh
```

脚本会自动处理：
- ✅ 迁移 `~/.ep/.epconfig/settings.json` → `~/.ep/settings.json`
- ✅ 清理空的子目录
- ✅ 恢复证书文件到 `ca/` 目录
- ✅ 从 localStorage 迁移旧配置

## 📚 相关文档

- [详细配置文档](./CONFIGURATION.md)
- [Mock 优化指南](./MOCK_OPTIMIZATION_SUMMARY.md)
- [README](./README.md)
