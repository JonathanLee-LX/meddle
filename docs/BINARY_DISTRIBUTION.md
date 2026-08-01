# RFC：二进制分发方案（deno compile）

> 状态：设计评审中 · 选型已通过 PoC 验证 · 待评审后进入实现
> 关联：与现有 npm 发布（`.github/workflows/publish.yml`）并行，不替换、不阻塞。

---

## 1. 背景与目标

### 1.1 现状
`@jonathanleelx/meddle` 目前仅以 npm 包形式分发，安装依赖 Node.js 与 `pnpm install`，对非 Node 用户门槛高。

### 1.2 目标
- 提供**单文件可执行二进制**，下载即可用，不依赖 Node.js / Deno / pnpm。
- 覆盖 macOS（x64+arm64）、Linux（x64+arm64）、Windows（x64）共 **5 个目标**。
- 与现有 npm 分发**双轨并行**，npm 包行为零回归。

### 1.3 非目标
- 不改动核心代理 / MITM / MCP 业务逻辑。
- 不废弃 npm 包路径。
- v1 不做体积极致压缩、不做 macOS notarize（仅 ad-hoc 签名）。

---

## 2. 选型与 PoC 结论

### 2.1 备选
| 方案 | 维护 | 运行时 | 关键问题 |
|---|---|---|---|
| `@yao-pkg/pkg` | 活跃 fork | 真 Node | web/dist 嵌入零改动；但需删依赖里的原生 binary 风险面 |
| `Node SEA` | 官方(实验性 1.1) | 真 Node | 跨编译要多 runner；macOS x64 不支持；static-server 需大改 |
| `Bun --compile` | Bun 公司 | Bun | 见下 |
| `Deno compile` | Deno 公司 | V8+Rust | 见下 |

### 2.2 PoC 实测（复刻 meddle MITM：`http.createServer CONNECT` → `http2.createSecureServer({cert,key,allowHTTP1:true})` → 隧道 → 拦截）

| 用例 | Node 22 | Bun 1.3 | Deno 2.x |
|---|:--:|:--:|:--:|
| `http2.createSecureServer` 存在并创建 | ✅ | ✅ | ✅ |
| H2 经 CONNECT（ALPN h2 + 拦截）端到端 | ✅ | ✅ | ✅ |
| H1 经 CONNECT（ALPN http/1.1）TLS 握手 | ✅ | ❌ `Cert does not contain a DNS name` | ✅ |
| 无 ALPN 时服务端 `allowHTTP1` 回落服务 http/1.1 明文 | ✅ | ❌ 无响应 | ✅ |

**结论**：
- **Bun** 的 `http2.createSecureServer({allowHTTP1})` 不能可靠服务 HTTP/1.1 客户端（无法回落服务 http/1.1；`ALPN=http/1.1` 时客户端证书校验 bug）。meddle 的 MITM 服务器**写死** `allowHTTP1:true`，必须支持非 h2 客户端 ⇒ Bun 是**功能阻断项**。
- **Deno** 在全部组合下与 Node 行为一致 ⇒ 选定 **`deno compile`**。叠加：macOS 默认 ad-hoc 签名（下载即跑）、`--include-as-is` 专为 Vite 产物设计。

PoC 脚本与产物：`/tmp/opencode/mitm-poc/mitm-poc.cjs`（复用为后续冒烟回归基础）。

---

## 3. 总体架构

### 3.1 双轨并行
```
            ┌─ npm 包（不变）  ─>  pnpm i  ─>  meddle CLI
源码 (TS) ──┤
            └─ 二进制（新增）  ─>  deno compile  ─>  单文件 meddle-<os>-<arch>
```
两条产物链共享同一份源码；构建步骤互相独立。

### 3.2 关键改动一图
```
入口分派        资产嵌入              自派生
  bin/main.js   web/dist --include-as-is  mcp-server: spawn(self, env=MEDDLE_ENTRY=proxy)
   │                   │
   ├> proxy (index.js 逻辑)
   ├> mcp   (mcp-server.js 逻辑)
   └> cli    (bin/index.js 逻辑：命令路由)
```

---

## 4. 关键改动设计

### 4.1 单入口与环境变量分派（核心重构）
**现状**：`bin/index.js`（CLI 路由）/ `index.js`（代理）/ `mcp-server.js`（MCP）三入口；mcp-server 用 `spawn(process.execPath, [indexPath])` 启动代理。

**设计**：新增唯一可注入入口 `bin/main.js`：
- 根据 `process.env.MEDDLE_ENTRY`（`proxy` / `mcp` / `cli`）分派到对应逻辑模块；
- 无该 env 时进 `cli` 路由（保持 `meddle <command>` 体验，由 `bin/index.js` 的 argv 路由接管）。
- 三个原入口文件**保留**并可被 `node` 直跑（npm 路径不退化）；仅改为「可被 main.js require 的纯模块」而非顶级副作用执行。

**收益**：`deno compile bin/main.js` 得到单一注入点；`process.execPath` 即二进制本身，自派生靠 env 即可。

### 4.2 自派生改造
`mcp-server.js` 中：
```js
// 现：spawn(process.execPath, [indexPath], { env: {..., MEDDLE_MCP:'1'} })
// 改：spawn(process.execPath, [], { env: {..., MEDDLE_MCP:'1', MEDDLE_ENTRY:'proxy'} })
```
`bin/commands/supervise.js`、MCP 的 `create_session`、可能存在的 `MEDDLE_HEADLESS` 派生同构改造。原则：**不再传脚本路径，全部靠 env 分派**。

### 4.3 web/dist 静态资源嵌入
- 构建期：`deno compile --include-as-is ./web/dist`（原样嵌入，不解析为模块——专为 Vite 产物）。
- 路径解析：`core/static-server.ts` 现用 `path.resolve(__dirname, '../../web/dist')`。由于 `deno compile` 保留模块在 VFS 中的相对结构，`dist/core/static-server` 的 `__dirname` 仍可经 `../../web/dist` 命中嵌入点 —— **预期零改动**（需在 M2 实测确认 VFS 布局与 `createReadStream` 行为）。
- **风险兜底**：若默认内存 VFS 上 `fs.createReadStream` / `readdirSync` 行为不一致，改用 `--self-extracting`（首次运行释放到磁盘，真实 fs 全套语义，static-server 零改动）。v1 默认采用 `--self-extracting` 求稳，内存 VFS 作为后续体积优化项。

### 4.4 插件运行时加载（外部用户文件）
- 插件位于用户 `~/.meddle/plugins/**.js`，运行时经 sandboxed require/vm 从**真实 FS** 加载 —— 嵌入不涉及、不受 `--bundle` 动态裁剪影响。
- 在 Deno CJS 下通过 `module.createRequire` 加载外部 JS；需在 M1 验证 meddle 现有插件加载形态。
- **v1 不启用 `--bundle`**：避免任何非字符串字面量的动态 `require`/`import` 被 tree-shake 裁掉；采用整 `node_modules` 嵌入（体积大但稳）。优化留作 v2。

### 4.5 node-easy-cert / 证书
- `node-easy-cert` 为纯 JS，通过外部 `openssl`/`security` CLI 完成生成与校验，无原生模块 ⇒ Deno 可用。
- 需权限：`--allow-fread --allow-write`（`~/.meddle/ca`）、`--allow-run`（`openssl`/`security`）。
- `inquirer` 信任流程已受 `MEDDLE_HEADLESS` / `MEDDLE_MCP` 控制，无 TTY 的二进制场景安全。

---

## 5. deno.json 配置（草案）
```jsonc
{
  "compilerOptions": { "lib": ["deno.window", "deno.ns"] },
  "compile": {
    "include": ["./web/dist"],     // --include-as-is 语义
    "exclude": ["**/*.spec.ts"],
    "permissions": "all"            // 详见 §5.1
  },
  "tasks": {
    "build:binary": "... see §6 ..."
  }
}
```
### 5.1 权限（baked-in，终端用户无提示）
建议逐项显式（而非 `all`）：`--allow-read --allow-write --allow-net --allow-run --allow-env --allow-sys --allow-ffi=none`，配 `--app-name meddle` 稳定存储身份。终值在 M2 调参确定。

---

## 6. 构建与产物

### 6.1 目标矩阵
| OS | Arch | `--target` | 产物名 |
|---|---|---|---|
| macOS | arm64 | `aarch64-apple-darwin` | `meddle-<v>-darwin-arm64` |
| macOS | x64 | `x86_64-apple-darwin` | `meddle-<v>-darwin-x64` |
| Linux | x64 | `x86_64-unknown-linux-gnu` | `meddle-<v>-linux-x64` |
| Linux | arm64 | `aarch64-unknown-linux-gnu` | `meddle-<v>-linux-arm64` |
| Windows | x64 | `x86_64-pc-windows-msvc` | `meddle-<v>-windows-x64.exe` |

> 注：`deno compile` 支持 `aarch64-pc-windows-msvc`（Windows ARM64）；如确有需求可纳入矩阵。

### 6.2 编译命令模板
```sh
deno compile \
  --target <target> \
  --output dist-bin/<product> \
  --include-as-is ./web/dist \
  --app-name meddle \
  -A \
  --no-check \
  bin/main.js
```
（`denort` 由 `dl.deno.land` 首次拉取并缓存；CI 缓存 `~/.cache/deno`。）

### 6.3 体积
预估单产物 ~80–100MB（整 node_modules 嵌入）。v2 评估 `--bundle --minify` 与 `--exclude` 裁剪。

---

## 7. CI workflow（新增 `.github/workflows/build-binary.yml`）
- 触发：`v*` tag（与 `publish.yml` 并行、各自独立 job）+ `workflow_dispatch`。
- 单 `ubuntu-latest` runner（deno 支持交叉编译）。
- 步骤：
  1. checkout
  2. 装 pnpm + node（仅用于 `build:web` 与 `tsc` 产出 `dist/`）+ `cd web && pnpm i`
  3. `pnpm run build:web` + `pnpm run build`（保证 `dist/` 与 `web/dist` 就绪）
  4. 装 deno（`denoland/deno-setup@v2`，缓存 `DENO_DIR`）
  5. 矩阵循环 5 个 `--target` 跑 §6.2，产物入 `dist-bin/`
  6. **冒烟**：对 `meddle-<v>-linux-x64` 跑 `--version` 与最小 MITM 断言（迁移 PoC 为 `scripts/binary-smoke.cjs`）
  7. `softprops/action-gh-release@v2` 上传 5 个产物到对应 release（与 publish 同 tag 共用 release）
- 网络：本环境对 GitHub 偶发不可达，步骤内置 3 次重试。

---

## 8. 安装脚本（`scripts/install-binary.sh`）
```sh
curl -fsSL https://raw.githubusercontent.com/JonathanLee-LX/meddle/main/scripts/install-binary.sh | bash
```
逻辑：探测 `uname -s/-m` → 选产物名 → 校验 GH release 资产 → 下载 → 校验 SHA256 → 放到 `$MEDDLE_BIN_DIR`（默认 `~/.meddle/bin`，并提示加入 PATH）→ `chmod +x`。
- macOS：Deno 已 ad-hoc 签名，无 Gatekeeper 阻断；脚本提示用户如需可自签。
- Windows：同仓提供 `scripts/install-binary.ps1`（PowerShell）。

---

## 9. README 与文档
新增「二进制安装」章节，给出 curl 一行命令 + 平台表 + 升级/卸载；在 `docs/DOCS_INDEX.md` 登记。

---

## 10. 版本与发布联动
- 维持：`v*` tag 触发 npm publish（现有）。新增：同一 tag 触发二进制 build（§7）。
- 两者解耦：任一失败不影响另一产物（release 资产由 build workflow 上传，npm 由 publish workflow 发）。
- 版本号来源一致：从 `package.json` 读取 注入到二进制的 `--define MEDDLE_VERSION="..."`（`bin/commands/version.js` 改为优先读此常量）。

---

## 11. 风险与缓解
| 风险 | 缓解 |
|---|---|
| 体积偏大 | v2 用 `--bundle --minify` + `--exclude`；v1 接受 |
| Deno node 兼容 Spot（node-easy-cert 外部 CLI / puppeteer-core spawn / chokidar fs.watch / inquirer TTY / portfinder） | M1/M2 逐项冒烟；vitest 仍跑 node 路径保证回归 |
| macOS arm64 Gatekeeper | Deno 默认 ad-hoc 签名；文档说明 |
| 内存 VFS 上 `createReadStream` 行为 | 兜底 `--self-extracting`（v1 默认） |
| CI 拉 denort 网络不稳 | 缓存 + 重试 |
| npm 与二进制行为偏差 | 共享 vitest 与二进制冒烟双保险 |

---

## 12. 验证计划
- **回归**：现有 `pnpm test`（node 侧，vitest）必须仍全绿——双轨共享业务逻辑须可被 node 标准测试覆盖。
- **编译期冒烟**：CI 对 linux-x64 产物跑 `meddle --version` + 最小 MITM 断言（CONNECT→http2 secure server→响应）= PoC 的可执行版。
- **分发验证**：release 资产 SHA256 列表 + 安装脚本自校验。

---

## 13. 里程碑
| 阶段 | 内容 | 退出条件 |
|---|---|---|
| M1 | 单入口分派重构；自派生改 env；删除死代码 `core/plugin-compiler.ts`（消除 esbuild 依赖） | `pnpm test` 全绿；`node bin/main.js` 与旧三入口行为一致 |
| M2 | `deno.json`；web/dist 嵌入；本机 `deno compile` 跑通 linux-x64；权限调参 | 本机二进制通过冒烟 |
| M3 | `build-binary.yml`：5 目标交叉编译 + release 资产上传 | tag 触发产出 5 个产物并冒烟通过 |
| M4 | `install-binary.sh` / `.ps1`；README/索引；二进制冒烟回归脚本入仓 | 文档齐 + 手动装机验证 |

---

## 14. 待评审决策
1. 安装目录默认：`~/.meddle/bin`（不影响系统、可升级）vs `/usr/local/bin`（需 sudo）—— 倾向 `~/.meddle/bin`。
2. v1 是否默认 `--self-extracting`（求稳）—— 倾向 是。
3. v1 不做 `--bundle` 体积优化（留 v2）—— 倾向 是。
4. macOS notarize 不做（靠 ad-hoc，文档说明）—— 倾向 不做。
5. `meddle version` 读取 `--define MEDDLE_VERSION` 注入常量 —— 倾向 是。
6. 删除死代码 `core/plugin-compiler.ts` 与 `esbuild` 依赖 —— 倾向 删（与二进制无关，纯清理，但为打包瘦身顺带做）。