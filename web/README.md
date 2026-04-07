# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) (or [oxc](https://oxc.rs) when used in [rolldown-vite](https://vite.dev/guide/rolldown)) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

## 环境变量配置

本项目支持通过环境变量自定义Mock功能的语法高亮和验证性能参数。

### 快速开始

1. 复制环境变量示例文件：
   ```bash
   cp .env.example .env
   ```

2. 根据需要编辑 `.env` 文件中的配置项

3. 重新构建项目：
   ```bash
   pnpm run build
   ```

### 可配置参数

- `VITE_MAX_HIGHLIGHT_SIZE` - 最大高亮文件大小（字节，默认: 2097152 / 2MB）
- `VITE_MAX_HIGHLIGHT_LINES` - 最大高亮行数（默认: 10000）
- `VITE_MAX_JSON_MATCHES` - JSON最大匹配数（默认: 50000）
- `VITE_MAX_HTML_MATCHES` - HTML最大匹配数（默认: 30000）
- `VITE_MAX_JS_MATCHES` - JavaScript最大匹配数（默认: 30000）
- `VITE_ENABLE_RULE_GRAPH_VIEW` - 是否开启规则页的“图表视图”（默认: `false`）

### 详细文档

查看 [ENV_CONFIG.md](./ENV_CONFIG.md) 了解详细的配置说明和性能调优建议。

### 验证配置

运行以下命令检查当前配置：
```bash
node test-env-config.cjs
```
