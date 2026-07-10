# 插件自动编译功能说明

## 问题背景

AI生成的插件代码是TypeScript格式，但Node.js运行时无法直接执行TypeScript代码。之前的实现尝试通过简单的字符串替换移除类型注解，但这种方法不可靠且容易出错。

## 解决方案

使用 **esbuild** 在保存插件时自动将TypeScript编译为JavaScript，确保插件能被Node.js正确加载和执行。

## 技术实现

### 1. 编译器模块 (`core/plugin-compiler.ts`)

提供以下核心功能：

#### `compilePluginCode(tsCode, filename)`
- 将TypeScript代码编译为JavaScript
- 使用esbuild transform API
- 配置：
  - `target: 'node18'` - 目标Node.js 18
  - `format: 'cjs'` - CommonJS模块格式
  - `sourcemap: 'inline'` - 内联source map
  - `minify: false` - 不压缩，保持可读性
  - `keepNames: true` - 保留函数名

#### `compilePluginFile(tsFilePath)`
- 读取.ts文件
- 编译为JavaScript
- 保存为同名.js文件
- 返回编译结果

#### `compilePluginsDirectory(pluginsDir)`
- 批量编译目录中所有.ts文件
- 返回统计信息（成功/失败数量、错误列表）

### 2. 保存时自动编译

修改 `POST /api/plugins/save` API：

```javascript
// 保存.ts文件后
if (data.filename.endsWith('.ts')) {
    const compileResult = await compilePluginFile(filePath)
    
    if (compileResult.success) {
        compiled = true
        // 成功：.js文件已生成
    } else {
        compileError = compileResult.error
        // 失败：.ts文件已保存，但未编译
    }
}
```

**特点**：
- ✅ 编译成功：返回成功状态，生成.js文件
- ⚠️ 编译失败：仍保存.ts文件，返回错误信息
- 不阻塞保存操作，用户可以后续手动修复

### 3. 插件加载器改进

#### 加载优先级
```
1. 对于.ts文件 → 检查是否有对应.js文件
   - 有.js → 使用.js（编译后的版本）
   - 无.js → 跳过（提示需要编译）

2. 对于独立.js文件 → 直接使用

3. 使用Node.js require加载.js文件
   - 清除require缓存，确保加载最新版本
   - 支持 exports.plugin / module.exports 导出
```

#### 代码示例

**之前（不可靠）**：
```typescript
// 简单的字符串替换，容易出错
let jsCode = code
    .replace(/: \w+(\[\])?/g, '')
    .replace(/interface \w+ {[^}]+}/g, '')
    .replace(/export /g, '');

// 使用eval执行（不安全）
const pluginFactory = eval(wrappedCode);
```

**现在（可靠）**：
```typescript
// 使用编译后的.js文件
const jsFilePath = filePath.replace(/\.ts$/, '.js');
if (fs.existsSync(jsFilePath)) {
    actualFilePath = jsFilePath;
}

// 使用Node.js原生require
delete require.cache[require.resolve(actualFilePath)];
const pluginModule = require(actualFilePath);
const pluginObj = pluginModule.plugin || pluginModule.default || pluginModule;
```

### 4. 编译状态显示

#### API改进
`GET /api/plugins/custom` 返回增强的插件信息：

```json
{
  "plugins": [
    {
      "filename": "test-plugin.ts",
      "path": "/home/user/.ep/plugins/test-plugin.ts",
      "modified": "2024-02-28T14:03:00.000Z",
      "compiled": true,
      "compiledTime": "2024-02-28T14:03:01.000Z",
      "needsRecompile": false
    }
  ]
}
```

**字段说明**：
- `compiled` - 是否已编译（.js文件存在）
- `compiledTime` - .js文件修改时间
- `needsRecompile` - .ts比.js新，需要重新编译

#### UI状态徽章

| 状态 | 徽章 | 颜色 | 说明 |
|------|------|------|------|
| JavaScript | JavaScript | 蓝色 | 独立的.js文件 |
| 已编译 | 已编译 | 绿色 | .ts已编译，.js是最新的 |
| 需要重新编译 | 需要重新编译 | 黄色 | .ts比.js新 |
| 未编译 | 未编译 | 红色 | .ts没有对应的.js |

### 5. 用户体验优化

**保存插件时**：
```
生成插件 → 保存.ts文件 → 自动编译为.js → 显示结果

成功：✅ 插件已保存并编译成功！
失败：⚠️ 插件已保存但编译失败: [错误详情]
```

**加载插件时**：
```
服务器启动 → 扫描plugins目录 → 
  发现test-plugin.ts + test-plugin.js →
  加载test-plugin.js ✅

发现plugin2.ts（无.js文件）→
  跳过 ⚠️ 未找到编译后的JS文件
```

## 编译产物示例

**输入 (TypeScript)**：
```typescript
export const plugin = {
    manifest: {
        id: 'local.test',
        name: '测试插件',
        version: '1.0.0',
        apiVersion: '1.x',
        permissions: ['proxy:read'],
        hooks: ['onRequestStart'],
    },
    
    setup(context: any) {
        context.log.info('初始化');
    },
    
    async onRequestStart(context: any) {
        context.log.info(`请求: ${context.request.url}`);
    }
};
```

**输出 (JavaScript, CommonJS)**：
```javascript
var __defProp = Object.defineProperty;
// ... esbuild辅助函数 ...

var stdin_exports = {};
__export(stdin_exports, {
  plugin: () => plugin
});
module.exports = __toCommonJS(stdin_exports);

const plugin = {
  manifest: {
    id: "local.test",
    name: "\u6D4B\u8BD5\u63D2\u4EF6",  // Unicode转义
    version: "1.0.0",
    apiVersion: "1.x",
    permissions: ["proxy:read"],
    hooks: ["onRequestStart"]
  },
  setup(context) {
    context.log.info("\u521D\u59CB\u5316");
  },
  async onRequestStart(context) {
    context.log.info(`\u8BF7\u6C42: ${context.request.url}`);
  }
};
```

**特点**：
- ✅ 完整的CommonJS模块包装
- ✅ 移除了所有TypeScript类型注解
- ✅ 保留了函数名和结构
- ✅ Unicode字符被转义（兼容性好）
- ✅ 内联source map（方便调试）

## 测试验证

### 测试场景 1：编译功能
```bash
$ node -e "
const { compilePluginFile } = require('./dist/core/plugin-compiler');
compilePluginFile('~/.ep/plugins/test.ts').then(console.log);
"

✅ 插件编译成功
生成的JS文件长度: 3240
```

### 测试场景 2：插件加载
```bash
$ node -e "
const { loadCustomPlugins } = require('./dist/core/custom-plugin-loader');
loadCustomPlugins({ pluginsDir: '~/.ep/plugins', logger: console })
  .then(plugins => console.log('加载插件:', plugins.length));
"

发现 1 个插件文件
使用编译后的JS文件: test-plugin.js
已加载插件: local.test (test-plugin.js)
成功加载 1 个自定义插件
加载插件: 1
```

### 测试场景 3：服务器启动
```bash
$ npm start

已加载 1 个规则文件 (共 0 条规则):
  - 默认规则 (0 条)
发现 1 个插件文件
使用编译后的JS文件: test-plugin.js
已加载插件: local.test (test-plugin.js)
成功加载 1 个自定义插件
已加载 1 个自定义插件

proxy-server start on http://127.0.0.1:8989
```

## 性能考虑

### 编译性能
- **esbuild** 是用Go编写的，编译速度极快
- 单个插件编译时间：< 50ms
- 对用户体验影响极小

### 运行时性能
- ✅ 不需要运行时编译/转换
- ✅ 使用原生require加载，性能最佳
- ✅ 编译后的代码已优化，执行效率高

### 内存占用
- ✅ 不需要加载ts-node或其他运行时编译器
- ✅ 只加载编译后的.js文件
- ✅ 内存占用最小

## 错误处理

### 编译错误
```
保存插件时编译失败的场景：

1. TypeScript语法错误
   → 返回具体的语法错误信息
   → .ts文件仍保存，用户可修复

2. 缺少必需字段
   → esbuild不会检查，运行时会报错
   → 建议：添加manifest验证

3. esbuild内部错误
   → 捕获并返回错误信息
   → 不影响.ts文件保存
```

### 加载错误
```
插件加载失败的场景：

1. .ts文件无对应.js
   → 跳过该插件
   → 日志警告：未找到编译后的JS文件

2. .js文件格式错误
   → 捕获require错误
   → 日志错误：加载插件失败

3. 插件对象格式不正确
   → 验证manifest和setup
   → 日志错误：插件必须包含...
```

## 文件结构

```
~/.ep/plugins/
├── test-plugin.ts          # 源代码（TypeScript）
├── test-plugin.js          # 编译后（JavaScript）
├── logger-custom.ts        # 自定义日志插件
├── logger-custom.js        # 编译后
└── standalone.js           # 直接编写的JS插件
```

**规则**：
- .ts和.js成对出现（编译后）
- 独立.js文件也支持
- 加载器智能识别并选择最佳版本

## 未来改进

1. **增量编译**
   - 只编译修改过的文件
   - 使用文件监听自动重新编译

2. **Source Map支持**
   - 生成外部source map文件
   - 方便调试TypeScript源代码

3. **类型检查**
   - 编译前进行TypeScript类型检查
   - 提供更详细的错误信息

4. **插件打包**
   - 支持多文件插件
   - 使用esbuild bundle功能

5. **热重载**
   - 文件变化时自动重新编译和加载
   - 无需重启服务器

## 依赖版本

```json
{
  "esbuild": "^0.24.2"
}
```

## 相关文件

### 核心代码
- `/workspace/core/plugin-compiler.ts` - 编译器实现
- `/workspace/core/custom-plugin-loader.ts` - 插件加载器
- `/workspace/index.js` - API端点和集成

### 前端UI
- `/workspace/web/src/components/plugin-generator.tsx` - 生成器组件
- `/workspace/web/src/components/plugin-config.tsx` - 插件管理组件

### 文档
- `/workspace/PLUGIN_GENERATOR_FEATURE.md` - 插件生成器功能说明
- `/workspace/STREAMING_FEATURE.md` - 流式输出功能说明
- `/workspace/PLUGIN_COMPILATION.md` - 本文档
