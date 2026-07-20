# AI代码修复功能配置指南

## 功能概述

Mock配置中的代码编辑器现在支持AI自动修复语法错误功能。当代码存在语法错误时,会显示"AI修复"按钮,点击即可自动修复。

## 支持的AI服务

- **OpenAI**: GPT-4o-mini, GPT-4o, GPT-3.5-turbo等
- **Anthropic**: Claude 3.5 Sonnet, Claude 3 Opus等

## 配置方法

### 1. 创建配置文件

在 `web` 目录下创建 `.env.local` 文件:

```bash
cd web
cp .env.example .env.local
```

### 2. 配置AI服务

#### 使用OpenAI

```env
VITE_AI_PROVIDER=openai
VITE_AI_API_KEY=sk-your-openai-api-key
VITE_AI_MODEL=gpt-4o-mini
```

#### 使用Anthropic

```env
VITE_AI_PROVIDER=anthropic
VITE_AI_API_KEY=sk-ant-your-anthropic-api-key
VITE_AI_MODEL=claude-3-5-sonnet-20241022
```

#### 使用自定义API端点(代理/第三方服务)

```env
VITE_AI_PROVIDER=openai
VITE_AI_API_KEY=your-api-key
VITE_AI_BASE_URL=https://your-proxy.com/v1/chat/completions
VITE_AI_MODEL=gpt-4o-mini
```

### 3. 重启开发服务器

配置完成后,需要重启开发服务器:

```bash
pnpm run dev
```

## 配置参数说明

| 参数 | 必填 | 说明 | 示例 |
|------|------|------|------|
| `VITE_AI_PROVIDER` | 否 | AI服务提供商 | `openai` 或 `anthropic` (默认: `openai`) |
| `VITE_AI_API_KEY` | 是 | API密钥 | `sk-xxx...` |
| `VITE_AI_BASE_URL` | 否 | API基础URL | `https://api.openai.com/v1/chat/completions` |
| `VITE_AI_MODEL` | 否 | 使用的模型 | `gpt-4o-mini` 或 `claude-3-5-sonnet-20241022` |

## 默认值

### OpenAI默认配置

- Base URL: `https://api.openai.com/v1/chat/completions`
- Model: `gpt-4o-mini`

### Anthropic默认配置

- Base URL: `https://api.anthropic.com/v1/messages`
- Model: `claude-3-5-sonnet-20241022`

## 使用方法

1. 在Mock配置编辑器中输入或粘贴代码
2. 如果代码存在语法错误,会显示错误提示
3. 点击右上角的"AI修复"按钮
4. AI将自动分析并修复代码
5. 修复成功后,错误提示消失,代码可正常保存

## 降级策略

如果未配置AI API或AI修复失败,系统会自动使用基于规则的简单修复:

- JSON: 修复引号、移除尾随逗号
- JavaScript: 修复缺失的括号和引号
- HTML: 补全缺失的闭合标签
- CSS: 补全缺失的大括号

## 注意事项

1. **API密钥安全**: 
   - `.env.local` 文件不会被提交到git仓库
   - 请勿将API密钥硬编码在代码中
   - 生产环境应使用环境变量配置

2. **API费用**: 
   - 每次AI修复会调用一次API
   - OpenAI和Anthropic都按使用量计费
   - 建议使用更经济的模型如 `gpt-4o-mini`

3. **网络要求**: 
   - 需要能够访问对应的API端点
   - 如遇网络问题,可配置代理服务器

4. **隐私考虑**: 
   - 代码会发送到AI服务进行处理
   - 敏感代码请谨慎使用AI修复功能

## 故障排查

### AI修复按钮不显示

- 确认代码确实存在语法错误
- 检查是否正确配置了 `VITE_AI_API_KEY`

### AI修复失败

1. 检查API密钥是否有效
2. 检查网络连接
3. 查看浏览器控制台错误信息
4. 确认API配额是否充足

### 修复结果不理想

- 尝试使用更强大的模型(如 `gpt-4o`)
- 先使用"智能格式化"按钮格式化代码
- 对于复杂错误,建议手动修复
