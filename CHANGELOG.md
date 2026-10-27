# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.5.0] - 2026-10-27

### 从 0.4.x 升级需要注意

下面每一条都是从 0.4.x 升到 0.5.0 后，脚本、Agent、规则文件或运行方式会碰到的行为变化。配置目录仍是 `~/.meddle/`（可用 `MEDDLE_HOME` 覆盖），默认代理端口没有改，没有删除命令或标志，Node.js 要求仍是 `>=18`。

#### 1. 路由规则的排除项：省略则保留，`--exclusions=` 才清空

**变了什么。** `meddle route add` / `route update` / `route delete`、MCP 的 `route_rule_add` / `route_rule_update` / `route_rule_delete`、内置 Agent 的路由工具，以及 Web 表格保存，不再把规则文件整份解析后再重写（#145、#146）。0.4.x 的 CLI 用 `parseEprc`（这个函数不带排除项）再 `ruleMapToEprcText(ruleMap)`，所以任意一次 add / update / delete 都会丢掉注释、空行、`//` 禁用行，以及文件里**每一条**规则的 `!path`。0.5.0 只改持有目标 pattern 的那一行，其余行（含文件开头的 UTF-8 BOM）逐字节保留。

排除项何时保留、何时被替换、何时被清空（#145、#149、#151、#155）：

- **保留。** CLI：pattern 参数里没有 `!path`，并且没有传 `--exclusions`。例如 `meddle route update dev api.example.com localhost:4000` 会改目标地址，这一行原有的 `!/health` 还在，其他行不动。MCP / Agent：不传 `exclusions` 字段。`route_rule_add` 覆盖已有规则时也同样保留。0.4.x 的 `route_rule_add` 在省略 `exclusions` 时执行的是 `exclusions || []`，等于清空；`route_rule_update` 在 0.4.x 省略该字段时已经是保留。新规则本来就没有排除项。
- **清空。** CLI 传 `--exclusions=`（等号后面是空的）。`route add` 仍要带 `<target>`；`route update` 可以只清排除项、不写新的 target，当前 target 保持不变。成功时人类可读输出有 `Exclusions: cleared`，`--json` 的结果里有 `"exclusions":[]`。MCP / Agent 传 `exclusions: []`。
- **替换。** CLI 用 `--exclusions=/a,/b`（引号里可以用空格：`--exclusions="/a /b"`，每项前面的 `!` 可写可不写），或者在 pattern 参数里写 `!path`（`"api.example.com !/health"`）。两种写法不要同时用。MCP / Agent 传非空数组。
- **同一行多个 pattern。** 只改被点名的那一个。`meddle route update dev multi-a.example.com --exclusions=` 会把这一行拆开：`multi-a` 失去 `!path`，同一行上的其他 pattern 仍带着原来的排除项。
- **会失败且不改文件（退出码 1）。** 单独的 `--exclusions`（没有 `=`）、空的 `!`、列表里的空项（`--exclusions=/a,,/b`）、`--exclusions=!`、未知参数、`!path` 和 `--exclusions` 同时出现、`--exclusions` 写了多次。`route delete` 不接受 `--exclusions`，提示 `route delete does not change exclusions`。
- **Web 表格。** 排除项是表格里的一列。没改过的规则（排除项也没动）保存时保留原行字节；在表格里把排除项清空再保存，就是清掉该行的 `!path`；填上新值就是替换。文本编辑器仍通过 `PUT /api/rule-files/:name/content` 按你输入的原文整份写入。

**谁受影响。** 用 CLI、MCP、Agent 或 Web 表格改规则，且文件里有 `!path`、注释、空行或 `//` 禁用行的人。也包括以前靠「改一条规则，整个文件的排除项会被清掉」的脚本。

**怎么做。** 想保留排除项：不要传 `--exclusions`，pattern 里也不要写 `!path`；MCP 不要传 `exclusions`。想清空：`meddle route update <file> <pattern> --exclusions=`，或 MCP / Agent 的 `exclusions: []`。想替换：`--exclusions=/a,/b` 或 `"pattern !/a"`。不要再依赖整份文件被重排。

#### 2. 以 `//` 或 `#` 开头的规则写入会被拒绝

**变了什么。** 结构化写入（CLI、MCP、Agent 工具、Web 表格）会拒绝两种读回来会变成注释或禁用行的编辑。错误码都是 `RULE_LINE_SPLIT_UNSAFE`，规则文件不改（#145）。

- 拆行或删掉某个 pattern 之后，剩下的 pattern 以 `//` 或 `#` 开头。例如从 `a.com //cdn.com target` 里删除 `a.com`。提示原文是：`该行剩余的 pattern 以 // 或 # 开头，拆开后会被当成注释，请用文本编辑器手动修改`。
- 新增规则的 pattern 本身以 `#` 或 `//` 开头，例如 `#foo.com`、`//foo.com`。提示原文是：`规则不能以 // 或 # 开头，否则会被当成禁用行或注释。要写注释或禁用规则，请用文本编辑器。`

CLI 以退出码 1 结束；MCP 返回 `isError`；Web 用 toast 显示同一段文字。`#` 只有出现在一行去掉前导空白之后的第一个字符时，才是整行注释；写在规则行后部的 `#` 仍是 pattern，不是行尾注释。文件里已经存在的 `#` 注释和 `//` 禁用行不会被这次升级删掉。

**谁受影响。** 用命令或 Agent 添加 `#…` / `//…` 规则，或编辑同一行里含有以 `//`、`#` 开头的 pattern 的人。

**怎么做。** 注释和禁用规则用规则文件的文本编辑器写。结构化接口只写真正会参与匹配的 pattern。

#### 3. `openBrowserWithProxy` 改为返回 `Promise<boolean>`

**变了什么。** `openBrowserWithProxy(url, proxyServer, meddleDir, remoteDebuggingPort?)` 的返回值从同步的 `boolean` 变成 `Promise<boolean>`，调用方必须 `await`（#130、#156）。代理启动路径会等待打开结果，Promise reject 当作没打开，浏览器启动失败不会把进程打崩。Linux 上不再用 `execSync` 一直等到 Chrome 退出（那会把进程，以及跑 `tests/browser.spec.ts` 的 Vitest worker，卡住直到超时也打不出来）。Linux Chrome 改为脱离父进程启动。启动器自己不退出时会被杀掉。Chrome 立刻以退出码 0 结束（把 URL 交给了同一 profile 里已经开着的窗口）算成功，不会再改用默认浏览器；非 0 才试下一个浏览器，最后才试默认浏览器。

**谁受影响。** 直接 `require` / `import` `openBrowserWithProxy`（`dist/core/browser`）的脚本。`meddle` 自己的打开浏览器路径已经 `await`。

**怎么做。** 写成 `const opened = await openBrowserWithProxy(url, proxyServer, meddleDir)`。`true` 表示已打开，`false` 表示没有可用浏览器。不要再把返回值当成同步布尔值。

#### 4. CLI 命令错误改走 stderr，退出码为 1

**变了什么。** 人类可读的命令失败改到 stderr，退出码为 1，stdout 为空（#153、#155）。包括 `output.error` 打出的 `✗` 消息，以及 `Unknown command`。0.4.x 这两类都写在 stdout。

`--json` 没有改成「改读 stderr 上的 `✗`」。`route add` / `route update` / `route delete` 失败时，stdout 是一个 JSON 对象 `{"success":false,"error":{"message":"…"}}`，退出码 1，正文里没有 `✗`。同一段 `message` 还会用 `console.error` 再写到 stderr（没有 `✗`）。相对 0.4.x，这是 route 命令的变化：当时 `--json` 下 `output.error` 是空操作，失败往往没有任何输出。仍直接调用 `output.error` 的命令（例如 `mock delete` 缺少 `<id>`）在 `--json` 下继续不打印错误正文，只以退出码 1 表示失败，和 0.4.x 相同。

**谁受影响。** 从 stdout 里抓 `✗` 或 `Unknown command` 的脚本，以及把「stdout 非空」当成 route 命令失败的脚本。

**怎么做。** 以退出码判断成败。人读的错误读 stderr。route 的 `--json` 解析 stdout 上的 JSON。只读规则集被拒绝是退出码 3，见下一条。

#### 5. 规则集可以加只读锁，写入会以专用错误拒绝

**变了什么。** Web 界面可以把一个规则文件加锁。锁记在 `settings.json` 的 `readonlyRuleFiles`（字段不存在 = 全部可写，旧文件不用迁移）。锁住之后，CLI、MCP、HTTP API 和界面里的 AI 助手写入都会被拒绝，文件内容不变（#137、#143）：

- HTTP `423`，正文 `{"error":"该规则集已设为只读，只能在 Meddle 界面中解锁","code":"RULESET_READONLY","ruleFile":"…"}`。
- CLI 退出码 **3**。`--json` 时 stdout 为 `{"success":false,"error":{"code":"RULESET_READONLY","message":"…","ruleFile":"…"}}`，人类可读的 `✗` 行始终在 stderr。普通参数错误仍是退出码 1。
- MCP 返回 `isError: true`，文本是同一个 `error` 对象。

没有加锁 / 解锁的 CLI 命令或 MCP 工具。加锁接口 `PUT /api/rule-files/:name/readonly` 要带页面令牌和同源请求，用来防止 Agent 顺手解锁，不是权限隔离。锁住的规则集不能在界面里重命名，需要先解锁。`POST` / `PATCH /api/settings` 若提交一份不同的 `readonlyRuleFiles`，返回 403，`code` 为 `RULESET_LOCK_UI_ONLY`，消息是「规则集只读锁只能在 Meddle 界面中修改」。会改变锁住规则集启用状态的 `activeRuleFiles` 更新也会被拒绝。`meddle route list/show --json` 和 MCP `route_rule_list` 增加了 `readonly` 字段。

**谁受影响。** 会给规则集加锁的人；用脚本整份 POST settings，或用 `route active set` / `route_rule_active_set` 改启用列表的人。没加过锁时，读写结果和 0.4.x 一致。

**怎么做。** 把退出码 3 和 `RULESET_READONLY` 当成「需要人在界面里解锁」。整份保存 settings 时不要带上一份不同的 `readonlyRuleFiles`。

#### 6. `mocksFilePath` 的解析方式，以及坏掉的 Mock 文件

**变了什么。**

- 代理读取 `settings.json` 里的 `mocksFilePath` 时：`~` 和 `~/…` 展开到用户主目录；相对路径相对于 `MEDDLE_HOME`（默认 `~/.meddle`），不再相对于启动代理时的当前目录（#121、#126）。settings 里的原文不会被自动改写。若这个相对路径按旧规则（启动目录）能找到文件、按新规则找不到，启动时警告一次，设置页和 config doctor 会给出原来的路径和现在的路径。「改用此路径」只填入输入框，还需要点「应用」。
- 自定义路径指向的文件还不存在时，不再静默退回默认的 `mocks.json`。代理按空规则使用该路径，第一次保存才创建文件。修改 `mocksFilePath` 立即生效，不必重启（#118、#119）。
- Web 保存设置改为 `PATCH /api/settings`，只提交改动的字段，避免一个旧标签页把另一个标签页刚改的 `mocksFilePath` 写回去。`POST /api/settings` 仍是整份替换（#121）。
- `mocks.json` 解析失败时，创建 / 更新 / 开关 / 删除（API 和 Agent）在改内存之前拒绝，HTTP 409，`code` 为 `MOCKS_FILE_INVALID`，消息带完整路径和行、列。空文件或只有空白视为空列表。写盘前会再读一次磁盘，并用临时文件加 rename（#120、#122）。
- 重复或非法的 mock id 不再丢掉规则：同一个 id 的最后一条保留原 id，更早的重复项以及无效 id 会分配新的递增 id（#115、#117）。指向 mock 文件的符号链接在写入时保留链接本身和权限（#123、#124）。
- `meddle mock` 在连不上代理、改为直接读写文件时，用的是 settings 里的原始字符串（不展开 `~`，相对路径相对当前工作目录）。代理进程则按上面的新规则解析。

**谁受影响。** `mocksFilePath` 写成相对路径或 `~` 的人；同时开着多个设置页的人；mocks 文件曾经写坏、并指望再保存一次就能覆盖的人。

**怎么做。** 相对路径改成绝对路径（设置页会提示旧文件在磁盘上的绝对路径）。`~/…` 可以继续留给代理展开；若 CLI 文件模式也要读写同一个文件，写成绝对路径。mocks 文件报格式错误时，按消息里的行列把 JSON 修好，界面会在文件重新可解析后恢复。不要依赖「新增一条规则」去覆盖坏文件。

#### 7. 代理没在跑时，CLI 写入会在 stderr 打出警告

**变了什么。** mock / route 已经把配置写进文件、但连不上正在运行的代理时，不再静默成功。stderr 会打印：`Config written to file, but could not connect to a running proxy — restart required for changes to take effect.` 退出码仍是 0。`--json` 的 stdout 仍是成功 JSON，并带 `fileOnly: true` 和同样的 `warning`；这条警告在 `--json` 下也写 stderr（#85、#86）。另外，代理每次启动都会写 `mcp-proxy-url.json`（0.4.x 只在设置了 `MEDDLE_MCP` 时写）。探测文件里的端口若已过期，会退回默认端口再做一次存活探测并更新缓存。

**谁受影响。** 把「stderr 非空」当成命令失败的脚本；用 `mcp-proxy-url.json` 是否存在来判断是不是开了 MCP 的人。

**怎么做。** 以退出码和 `--json` 的 `success` 判断成败。这条 stderr 警告的含义是「文件已写上，需要重启代理才会进到正在跑的进程」。

#### 8. Mock CLI：非法 `--headers` 会失败；`query` 按参数边界匹配

**变了什么。** `meddle mock add` / `mock update` 的 `--headers` 不是合法 JSON 时，退出码 1，stderr 为 `Invalid --headers JSON: …`。0.4.x 会把 headers 当成 `{}` 并继续成功（#76）。新增 `--query`（规则字段 `query`，同一路径不同 query 可以返回不同 body）和 `--cors`（写入 `Access-Control-Allow-Origin: {origin}`、`Allow-Credentials: true`，以及 Methods / Headers `*`）。`query` 按参数边界匹配：`window_key=A` 不会再命中 `window_key=AB`。响应头值里的 `{origin}` 在响应时替换成请求的 `Origin`。

**谁受影响。** `--headers` 传了非法 JSON、却依赖「命令成功、头被清空」的脚本。`query` 是 0.5.0 新字段；0.4.x 已有的 mock 规则没有这个字段，匹配不会因此变严。

**怎么做。** `--headers` 传合法 JSON。需要按查询区分响应时使用 `--query`。跨域且要带 cookie 时使用 `--cors`，或在头的值里写 `{origin}`。

#### 9. HTTPS 上游：空 body 不再挂起；deno 二进制全部走 HTTP/1.1

**变了什么。** Node 运行时里，`OPTIONS` 和 `HEAD` 直接走 HTTP/1.1。其他方法的 HTTP/2 请求默认 8 秒超时（`MEDDLE_H2_REQUEST_TIMEOUT_MS`，并且不会超过 `MEDDLE_UPSTREAM_TIMEOUT_MS`，默认 60 秒），超时后回退 HTTP/1.1（#72）。`deno compile` 的二进制检测到 deno 运行时后，HTTPS 上游全部走 HTTP/1.1，不再使用会在空 body（204、HEAD、OPTIONS，以及返回 204 的 POST）上挂住的 `node:http2`（#72、后续 #74）。插件 `mode=on` 在改写响应并重设 `content-length` 时会同时去掉 `transfer-encoding`，避免两个头并存导致 `HPE_INVALID_CONTENT_LENGTH` / `ERR_INVALID_HTTP_RESPONSE`（#72）。首次为新主机生成 MITM 证书时，RSA 密钥改用 Node 自带的 `crypto.generateKeyPairSync`，不再用 node-forge 在事件循环上同步生成 2048 位密钥（那会把整个代理堵住大约数秒）（#116、#129）。

**谁受影响。** 用官方二进制的人；依赖 HTTPS 上游一直走 HTTP/2 的人；以前 CORS 预检或 204 响应一直 pending 的人（这些请求现在会完成）。

**怎么做。** 二进制用户不用改配置。Node 版若需要更长的 HTTP/2 等待，设置 `MEDDLE_H2_REQUEST_TIMEOUT_MS`。只接受 HTTP/2、不接受 HTTP/1.1 的上游，在 deno 二进制上会走 HTTP/1.1 从而失败，这种上游请用 Node 运行 Meddle。

#### 10. 私有 GitHub 仓库升级需要 token；npm 安装不再自带 puppeteer-core

**变了什么。** `meddle update`（含 `meddle update --beta`）和安装脚本下载 Release 资产时读取 `GH_TOKEN`（优先）或 `GITHUB_TOKEN`（classic `repo`，或 fine-grained `contents:read`），并用 `Authorization: Bearer` 拉取文件和 checksum。私有仓库未设置 token 时，下载表现为 404（checksum sidecar missing）（#79、#80）。`puppeteer-core` 从 `dependencies` 挪到 `devDependencies`（#64），`deno compile` 的二进制不再内嵌它。运行时的浏览器控制 MCP 在更早的版本已经移除，它现在只被 e2e 测试引用。

**谁受影响。** 从私有 GitHub 仓库安装或升级的人。依赖「安装 `@jonathanleelx/meddle` 就会带上 `puppeteer-core`」的脚本。公开仓库的安装和升级不用 token。

**怎么做。** 私有仓库先导出 `GH_TOKEN` 或 `GITHUB_TOKEN`，再执行 `meddle update`。需要 Puppeteer 时单独安装 `puppeteer-core`。代理、CLI 和 MCP 的用法不用为此改动。

### Added

- Public entry for the dashboard and the proxy. `MEDDLE_PUBLIC_URL` (for example `https://meddle.example.com` or `https://meddle.example.com:2083` when the proxy port is published through a raw TCP tunnel) is shown as 「公网入口」. Certificate and setup links use that origin, and the phone dials the public proxy port instead of the internal one. When the dashboard itself is opened from a non-local host, the Web UI infers the public entry from `window.location` (#59).
- Rule overview. The rules page has 「查看所有规则」, backed by `GET /api/rule-files/overview`. 「生效规则」 lists merged rules in the order the proxy applies them (later definitions win) with 「生效/已被覆盖」 badges. 「按文件」 lists every rule in each file, including `//` disabled lines. Search covers rule, target, and file name; choosing a row scrolls the editor to that line. `pnpm run test:e2e:rule-overview` covers it (#66, #67, #69). The dialog added in 0.5.0-beta.1 was reverted before this release (#65) and is not part of 0.5.0.
- Mock query matching and credentialed CORS (#76). Rule field `query` / CLI `--query` returns different bodies for the same path with a different query. A header value `{origin}` echoes the request `Origin`. CLI `--cors` sets `Access-Control-Allow-Origin: {origin}`, `Access-Control-Allow-Credentials: true`, and Methods/Headers `*`. The Web mock editor has a Query field.
- Rule-file tab drag-and-drop. Order is stored in `settings.ruleFileOrder` (disabled files included). Enabled files keep the same relative order in the merge, the overview, and `activeRuleFiles` (#81, #82).
- Mocks file watcher: edits to the mocks file reload without a restart (#85, #86). The watch follows a symlink, catches a write that lands before chokidar is ready, rechecks the file signature after each reload so a burst of writes is not dropped, and re-attaches when the target directory or an ancestor is deleted and created again (#123, #125, #128, #131, #132, #141, #147, #148).
- Web UI layout (#87–#103, #109, #111, #114, #136): work/config full-page shell, traffic resizable ~60/40 split with a dense virtual table and drawers, hit-column badges, thin scrollbars, full-width config pages, source filter as a Select on the same row as resource types, shared list|editor split for rules, mocks, and plugins, and a collapsible shell nav (auto-collapse under 1024px). Mock response headers can be edited as a key-value list or in a Monaco JSON editor; both edit the same object.
- Header heartbeat when the backend is unreachable (#105, #106).
- Read-only rulesets (#137, #143). Lock a rule file in the Web UI. The lock is `settings.readonlyRuleFiles`. See the upgrade notes above and `docs/RULESET_READONLY.md`. `readonly` is included on rule-file list and detail responses, `meddle route list/show --json`, and `route_rule_list`.
- `settings.json` gains optional `ruleFileOrder` and `readonlyRuleFiles`. Missing fields keep the previous behavior.

### Changed

- Route writes edit only the line that holds the pattern. Exclusions stay unless the caller sets them: CLI `--exclusions=` clears and `--exclusions=/a,/b` or a `!path` token in the pattern replaces; MCP and Agent tools keep exclusions when the field is omitted and clear them with `[]`. See the upgrade notes for the full keep/clear/reject matrix (#145, #146, #149, #151, #153, #155). `meddle --help` documents `route add [--exclusions=]`.
- A structured rule write whose pattern starts with `//` or `#`, or that would leave such a pattern at the start of a line, is rejected with `RULE_LINE_SPLIT_UNSAFE` and the file is left unchanged. Messages: `该行剩余的 pattern 以 // 或 # 开头，拆开后会被当成注释，请用文本编辑器手动修改` and `规则不能以 // 或 # 开头，否则会被当成禁用行或注释。要写注释或禁用规则，请用文本编辑器。` (#145).
- `openBrowserWithProxy` returns `Promise<boolean>`. Callers must await it (#130, #156).
- Human-readable CLI failures (`✗` and `Unknown command`) go to stderr and exit 1. `route` `--json` failures print one `{ "success": false, "error": { "message" } }` object on stdout (#153, #155).
- When a mock or route command writes the file but cannot reach a live proxy, it prints `Config written to file, but could not connect to a running proxy — restart required for changes to take effect.` on stderr (including `--json`) and still exits 0. `mcp-proxy-url.json` is written on every proxy start (#85, #86).
- `mocksFilePath`: `~` expands to the home directory, relative paths resolve against `MEDDLE_HOME`, a missing custom file is no longer replaced by the default `mocks.json`, and a change applies without restart. The Web UI saves settings with `PATCH /api/settings` (changed fields only). `POST /api/settings` remains a full replace (#118, #119, #121, #126).
- Invalid `meddle mock add/update --headers` JSON exits 1 with `Invalid --headers JSON: …` instead of saving empty headers. `query` matching is parameter-bounded (#76).
- HTTPS upstream: `OPTIONS` and `HEAD` use HTTP/1.1; other HTTP/2 requests time out after 8s (`MEDDLE_H2_REQUEST_TIMEOUT_MS`, capped by `MEDDLE_UPSTREAM_TIMEOUT_MS`) and fall back to HTTP/1.1. The deno binary sends every HTTPS upstream over HTTP/1.1. Plugin `mode=on` drops `transfer-encoding` when it rewrites `content-length` (#72, #74).
- `puppeteer-core` moved from `dependencies` to `devDependencies` and is no longer embedded in the deno binary (#64).
- Private-repo `meddle update` / `meddle update --beta` and the install script send `Authorization: Bearer` from `GH_TOKEN` (preferred) or `GITHUB_TOKEN` (#79, #80).
- The settings page shows the route-rules directory the server is actually using (`GET /api/version` adds `routeRulesDir` / `routeRulesDirDisplay`) instead of a hard-coded `~/.meddle/route-rules/` (#139, #142). The settings page shows the running app version. Custom plugins are grouped by source (#112, #113).
- Web UI primitives (Button, Badge, Tabs, Input) follow the shared size and color tokens. `web/src/components/ui-layout-standard.test.ts` and `button.test.tsx` lock the token and Button contracts, and `AGENTS.md` records the same rules (#70). The settings 「应用」 button is the solid primary button and shows 「应用中…」 while saving (#138, #140).

### Fixed

- Opening a browser on Linux no longer waits until Chrome exits, so a detached launch cannot wedge the process or the Vitest worker that runs `tests/browser.spec.ts` (#130, #156). `CI=1` no longer skips that spec; the spec skips the real launch when Chrome is not installed. The mocks-file switch test keeps a relative `mocksFilePath` inside `MEDDLE_HOME`, so `../` does not depend on how deeply the checkout is nested (#156).
- Rule add/update/delete no longer drops comments, blank lines, disabled rules, a leading BOM, or other rules' exclusions (#145, #146). `meddle route update --exclusions=` can clear one rule's exclusions (#149, #151). Renaming a rule file in the Web UI keeps the loaded text under the new name. The built-in Agent's route-update confirmation includes `newTarget`.
- An unparseable mocks file is not overwritten (`MOCKS_FILE_INVALID`, HTTP 409) (#120, #122). Creating a mock never reuses an id to overwrite another rule (#115, #117). Writing a symlinked mocks file keeps the symlink and the file mode (#123, #124). Switching `mocksFilePath` takes effect without a restart (#118, #119). A stale settings tab cannot revert fields another tab already saved (#121, #126).
- The mocks watcher keeps working when the target directory is created after the link, when several writes land within a few milliseconds, and when the mocks directory is deleted and recreated (#125, #128, #131, #132, #141, #147, #148).
- Private-repo release downloads no longer look like a missing checksum when the request was simply unauthenticated (#79, #80).
- The deno binary no longer hangs on an empty HTTPS upstream body, and Node no longer leaves `OPTIONS` / `HEAD` / a timed-out HTTP/2 request pending (#72, #74). Plugin `mode=on` no longer emits `transfer-encoding` together with `content-length` (#72).
- The first MITM certificate for a new host no longer blocks the proxy on a synchronous pure-JS RSA-2048. Key generation uses `crypto.generateKeyPairSync` (#116, #129).
- Rule-file tab and rule-row drag handles stay hidden until hover, stay on the horizontal axis, and no longer fight the pointer (#83, #84). Deleting a plugin closes a leftover editor, and the plugin list is reachable from the keyboard (#107, #108, #110). Narrow viewports collapse the sidebar into an overlay instead of squeezing the page (#109, #114).

## [0.5.0-beta.26] - 2026-10-27

### Changed

- `openBrowserWithProxy` now returns `Promise<boolean>`. Callers must await it. The proxy startup path awaits the launch and treats a rejection as not opened, so a failed launch does not take the process down (#130, #156).

### Fixed

- Opening a browser on Linux no longer waits until Chrome exits. `openBrowserWithProxy` used `execSync`, which blocked the process — and the Vitest worker running `tests/browser.spec.ts` — forever, so the test timeout never fired (#130, #156). Linux Chrome is spawned detached. A launcher that does not exit is killed, and the browser spec closes any child it started. If that Chrome exits 0 immediately (it handed the URL to an already-open window with the same profile), the open counts as success and the default browser is not used. A non-zero exit still tries the next browser, then the default one.
- `CI=1` no longer skips `tests/browser.spec.ts`. The spec stays in `pnpm test` and skips the real launch when Chrome is not installed (#130, #156).
- The mocks-file switch test keeps a relative `mocksFilePath` inside `MEDDLE_HOME`. Climbing out with `../` failed the suite when the checkout was not nested deeply enough to reach `/` (for example `/workspace`) (#156).
- CLI command failures now print on stderr and exit 1. The `✗` message (and `Unknown command`) is not written to stdout. `--json` errors are unchanged: one JSON object on stdout with `success: false` (#153, #155).
- `meddle --help` documents `route add [--exclusions=]`, including the clear form `--exclusions=`. `meddle route add --help` already described the same flag (#153, #155).

## [0.5.0-beta.25] - 2026-10-22

### Changed

- The CLI keeps a rule's exclusions unless the pattern argument has `!path` tokens (`"api.example.com !/health"`) or `--exclusions` is set. `--exclusions=` clears them and `--exclusions=/a,/b` replaces them (#149).

### Fixed

- `meddle route update` (and `route add`) can clear a rule's exclusions with `--exclusions=` (#149). The edited line loses its `!path` tokens; every other line stays byte-for-byte. Success prints `Exclusions: cleared` and `--json` includes `"exclusions":[]`. A bare `--exclusions`, an empty `!` token, an unknown flag, or combining `!path` with `--exclusions` exits 1 and leaves the file unchanged. `route delete` rejects `--exclusions` instead of ignoring it.
- Renaming a rule file in the web UI keeps the loaded text under the new name, so a table-view save immediately after the rename still preserves comments and untouched lines.
- The built-in Agent's route-update confirmation summary and preview include `newTarget`.

## [0.5.0-beta.24] - 2026-10-21

### Added

- Read-only rulesets (#137). Lock a rule file in the web UI and every CLI, MCP and API write to it is rejected with `RULESET_READONLY` (HTTP 423, CLI exit code 3). The file is left unchanged. The lock is stored in `settings.json` under `readonlyRuleFiles`. A locked ruleset cannot be renamed; unlock it first, then rename (the web UI disables rename while locked). Lock and unlock are web-UI only (page token plus a same-origin check). This guards against accidents; it is not access control.
- `readonly` field on rule-file list and detail responses, `meddle route list/show --json` and `route_rule_list`.

### Changed

- MCP `route_rule_add` without `exclusions` now keeps an existing rule's exclusions; before #145 it cleared them. Pass `exclusions: []` to clear them. `route_rule_update` (and the built-in Agent's route tools) behave the same way: omitting `exclusions` keeps them and `[]` clears them. The CLI keeps a rule's exclusions unless the pattern argument has `!path` tokens (`"api.example.com !/health"`), which replace them. The CLI currently has no way to clear exclusions; use MCP with `[]` or the web UI.
- Rule writes (CLI, MCP, Agent tools, web table view) now refuse an edit that would split a line and leave a pattern starting with `//` or `#` at the start of a line, because that line would read back as a disabled rule or a comment. Example: deleting `a.com` from `a.com //cdn.com target`. The error is 「该行剩余的 pattern 以 // 或 # 开头，拆开后会被当成注释，请用文本编辑器手动修改」. The CLI exits non-zero, MCP returns `isError`, and the web UI shows it as a toast. The rule file is left unchanged.
- Adding a new rule whose pattern starts with `#` or `//` (for example `#foo.com`) is now refused in the CLI, MCP, Agent tools and web table view, because the new line would read back as a comment or a disabled rule. The error is 「规则不能以 // 或 # 开头，否则会被当成禁用行或注释。要写注释或禁用规则，请用文本编辑器。」 and uses the same `RULE_LINE_SPLIT_UNSAFE` code as the split error. The rule file is left unchanged.

### Fixed

- Rule writes no longer drop other lines (#145). `meddle route add/update/delete`, the MCP `route_rule_add/update/delete` tools and the built-in Agent's route tools used to rebuild the whole rule file. That dropped comments, blank lines and disabled (`//`) rules, and the CLI also dropped every other rule's exclusions (`!path`). They now edit only the line(s) that hold the pattern. Every other line keeps its exact bytes, and the edited rule keeps its own exclusions unless new ones are given. A leading UTF-8 BOM is kept. The CLI and MCP now read rule content through the API without dropping the BOM, and so does the web UI. Saving from the web UI's table view also keeps comments, blank lines and untouched rule lines. The HTTP `PUT /api/rule-files/:name/content` endpoint and the web text editor already wrote the text exactly as given.
- Mock auto-reload now resumes when the mocks directory is deleted and recreated, for example when a symlinked dotfiles repo is removed and re-cloned. Before, edits to the mocks file stopped taking effect until Meddle was restarted (#148).

## [0.5.0-beta.18] - 2026-10-08

### Added

- Mock response headers have a key-value list and a resizable Monaco JSON editor. Both edit the same header object.
- Vertical shell nav can collapse. Mobile proxy and settings sit in that menu.

### Changed

- Mock and plugin editor actions sit in the pane title bar. Duplicate in-page headings are gone.
- Monaco follows the app theme. The save shortcut shows only the current platform.
- Shell padding is removed. Each page is inset from the header. The command trigger is a search field on the left of the header.
- Plugins use the shared list|editor split.

### Fixed

- Save-shortcut label test casts the Navigator mock through `unknown` so main CI typechecks.

## [0.5.0-beta.17] - 2026-10-02

### Changed

- Tighter shared page spacing. Traffic log table and detail sit in one card, with a quieter split handle.
- Route rules and Mock share one draggable list|editor split. Widths stay separate (rules 252px, mock 480px) and stack on narrow screens.
- Rule-file rows no longer draw a side border over the separator. The text-import rule box accepts typing.

## [0.5.0-beta.16] - 2026-10-02

### Changed

- Layout polish from #102 via #103: traffic empty-state hides detail (log Card); traffic filter `px-0`; rules vertical file groups.

## [0.5.0-beta.15] - 2026-10-02

### Added

- Web UI layout epic (#87): work/config full-page shell (#88/#91); traffic layout B — resizable ~60/40 split, dense virtual table, drawers (#89/#92/#95/#98); hit-column badges (#94/#97); thin scrollbars (#93/#96); config pages full-width + in-page Mock entries (#90/#99); traffic filter source Select on same row as resource types (#100/#101).

### Changed

- Traffic filter UX: source ToggleGroup → Select; source + resource types share one row; filter semantics unchanged (#100/#101).

## [0.5.0-beta.14] - 2026-09-23

### Fixed

- Always write `mcp-proxy-url.json` on proxy start (not only when `MEDDLE_MCP` is set) (#85/#86).
- Probe fallback: stale file port → default port / live resolve + cache (#85/#86).
- Explicit warning when mock/route CLI falls back to file-only (not silent success) (#85/#86).

### Added

- Mocks file watcher for hot reload (#85/#86).

## [0.5.0-beta.13] - 2026-09-22

### Fixed

- Tab drag handle UX (hover-only grip, horizontal axis, anti-jitter) + rule-row hover grip (#83/#84).

### Changed

- Reminder: private-repo installs still need `GH_TOKEN` (preferred) or `GITHUB_TOKEN` (`repo` or fine-grained `contents:read`) for `meddle update` / `meddle update --beta` and Release asset downloads; without a token, downloads look like 404 (checksum sidecar missing). See README.

## [0.5.0-beta.12] - 2026-09-21

### Added

- Rule file Tab drag-and-drop reorder + `ruleFileOrder` persistence (#81/#82): drag rule-file tabs (≥2) to change display order; order is stored in `settings.ruleFileOrder` (including disabled files). Enabled files keep merge / overview / `activeRuleFiles` relative order aligned with the Tab bar. Uses `@dnd-kit` with a distance activation constraint so toggle, select, rename, and delete are not misfired.

### Changed

- Reminder: private-repo installs still need `GH_TOKEN` (preferred) or `GITHUB_TOKEN` (`repo` or fine-grained `contents:read`) for `meddle update` / `meddle update --beta` and Release asset downloads; without a token, downloads look like 404 (checksum sidecar missing). See README.

## [0.5.0-beta.11] - 2026-09-20

### Fixed

- Private-repo `meddle update` via `GH_TOKEN` / `GITHUB_TOKEN` (#79/#80): unauthenticated GitHub release downloads returned 404 (checksum sidecar missing). Prefer `GH_TOKEN`, then `GITHUB_TOKEN` (`repo` or fine-grained `contents:read`), and send `Authorization: Bearer` for asset + sidecar fetches. Private installs also need a token for `meddle update --beta`.

## [0.5.0-beta.10] - 2026-09-20

### Added

- Mock query matching + credentials CORS (#76):
  - Rule field `query` / CLI `--query` — same path, different query (e.g. `window_key=A` vs `B`) can return different mock bodies. `urlPattern` may also include query in the regex.
  - Header value placeholder `{origin}` echoes the request `Origin` at response time (credentials-friendly CORS across multiple page origins without editing rules mid-session).
  - CLI `--cors` shortcut installs `Access-Control-Allow-Origin: {origin}`, `Allow-Credentials: true`, and Methods/Headers `*`.
  - CLI help documents existing `--headers` (JSON); invalid JSON now errors instead of silently clearing headers.
  - Web Mock editor exposes optional Query field; header values may use `{origin}`.

### Fixed

- Mock `--query` / rule `query` matching uses parameter-boundary semantics (URLSearchParams / exact `key=value` tokens) so `window_key=A` no longer falsely matches `window_key=AB` (follow-up to #76/#77).

## [0.5.0-beta.9] - 2026-09-16

### Fixed

- deno 二进制版 HTTPS 代理不再因上游空 body 响应（204/HEAD/OPTIONS）挂起（#72/#74 后续）：deno 的 `node:http2` 客户端对空 body 响应不触发 `response`/`end`，且与请求方法无关（POST 返回 204 同样挂起，如事件上报接口）。修复：检测到 deno 运行时（二进制分发版）时，HTTPS 上游全部走 HTTP/1.1（`proxyViaH1`），不再使用 H2 客户端。

## [0.5.0-beta.8] - 2026-09-16

### Fixed

- HTTPS 代理不再因上游空 body 响应（OPTIONS 预检 / 204 / HEAD）挂起（#72）：deno 二进制的 `node:http2` 客户端对空 body 响应不触发 `response`/`end`，`proxyViaH2` 会永久挂起，导致 Chrome 跨域 JSON POST 的 CORS 预检一直 pending。修复：OPTIONS/HEAD 直接走 HTTP/1.1（`proxyViaH1`），其余方法的 H2 请求增加请求超时（默认 8s，`MEDDLE_H2_REQUEST_TIMEOUT_MS` 可配，且不超过 H1 的 `MEDDLE_UPSTREAM_TIMEOUT_MS`），超时后 fallback 到 HTTP/1.1。

## [0.5.0-beta.7] - 2026-09-15

### Fixed

- Plugin mode=on 响应拦截不再输出非法响应头 `transfer-encoding: chunked` + `content-length` 并存（#72）：`interceptResponseWithPlugins` 在插件改写响应后重设 `content-length` 时未删除上游透传的 `transfer-encoding`，导致 Node 客户端报 `HPE_INVALID_CONTENT_LENGTH`、浏览器报 `ERR_INVALID_HTTP_RESPONSE`（请求失败/一直 pending）。HTTPS 路径因 `cleanHeadersForH2` 会删除 TE 而不受影响；修复为改写响应时同时删除 `transfer-encoding`。

## [0.5.0-beta.6] - 2026-09-08

### Added

- Web UI Phase 1 设计约束测试（#70）：新增 `ui-layout-standard.test.ts` 锁定 token / layout class 合约（spacing、radius、semantic colors、`.app-*` 布局类）；扩展 `button.test.tsx` 覆盖 Button 尺寸与 variant 约定。
- AGENTS.md 新增 Web UI design system 规则：tokens、layout classes、Button/Badge/Tabs/Input 等原语用法与 agent must-follow 清单，作为后续 UI 改动的单一事实来源。

### Changed

- Button / Badge / Tabs / Input 调用点收敛（#70）：多处业务组件（规则配置、设置、Mock、详情面板、AI 助手等）统一到 `ui/` 原语与尺寸 token，去掉一次性 `h-7` 等覆盖，与 Meddle new-york/neutral 设计系统对齐。

## [0.5.0-beta.5] - 2026-08-31

### Added

- 全局规则总览（#66，#67/#69）：路由规则页新增「查看所有规则」入口，打开总览面板。「生效规则」视图按代理实际生效顺序展示合并后的路由规则（后定义覆盖先定义），同名规则行带「生效/已被覆盖」徽标；「按文件」视图按规则文件分组展示全部规则（含 `//` 禁用行、启用状态与计数）；支持按规则/目标/文件名即时搜索；点击行可定位回规则编辑器并滚动高亮命中行。
- 后端新增 `GET /api/rule-files/overview`：返回规则文件列表、合并生效规则、同名冲突与逐文件规则明细，合并语义与代理实际路由一致；附 e2e 测试 `test:e2e:rule-overview`。

## [0.5.0-beta.4] - 2026-08-25

### Reverted

- 回滚 PR #62「查看所有规则」弹窗（#65）：该实现存在内容溢出无法滚动、disabled Checkbox 不可交互、表格未遵循系统 table-fixed/colgroup 风格、当前文件未保存修改不展示等问题。相关需求见 #60，暂时不实现。

## [0.5.0-beta.3] - 2026-08-17

### Changed

- `puppeteer-core` moved from `dependencies` to `devDependencies` (#64): the `deno compile` binary no longer embeds puppeteer-core + `@puppeteer/browsers`. Its only runtime consumer (browser-control MCP tools, `mcp-browser.js`) was removed earlier and it is now only referenced by e2e tests (`tests/e2e/*.e2e.cjs`), so the `--prod` dependency prune in the binary build no longer carries it into the artifact.

## [0.5.0-beta.2] - 2026-08-16

### Fixed

- Public proxy entry is actually usable behind a reverse proxy / tunnel: `MEDDLE_PUBLIC_URL` now carries the publicly reachable proxy port (e.g. `https://meddle.example.com:2083` for a raw TCP tunnel) through to the mobile panel and setup page, so the phone dials the public endpoint instead of the unreachable internal proxy port or the Cloudflare/nginx HTTPS origin that rejects CONNECT tunnels (`ERR_TUNNEL_CONNECTION_FAILED`).

## [0.5.0-beta.1] - 2026-08-15

### Added

- Public entry point for the management interface: when the dashboard is served behind a public domain / reverse proxy / tunnel, set `MEDDLE_PUBLIC_URL` (e.g. `https://meddle.example.com`) and the remote-access setup shows this URL as a first-class 「公网入口」 target (certificate download and setup links point at the public origin). The Web UI also auto-infers the public entry from `window.location` when the dashboard itself is open from a public (non-local) host, so no env config is needed in the common reverse-proxy setup.
- 规则配置页新增「查看所有规则」弹窗：一键列出全部规则文件下所有启用的路由规则，按规则文件分组展示（规则、目标、启用状态），便于总览和排查。

## [0.4.5-beta.6] - 2026-08-11

### Changed

- Inspect tab (plugin stage diffs): the expanded header diff now shows 变更前/变更后 with copy buttons, and each body diff has 「复制变更前 Body / 复制变更后 Body」— copy support is now consistent across request/response and Inspect tabs.

## [0.4.5] - 2026-08-11

### Fixed

- Proxy no longer crashes with `uncaughtException: read ECONNRESET` when a client resets its TLS connection to a MITM server (e.g. closing a tab / switching networks mid-request): every `secureConnection` TLS socket now gets a persistent `'error'` listener (via the new `wireMitmClientSocket`), so a socket error can no longer escape to `uncaughtException` and kill the whole proxy process. Routine resets (ECONNRESET/EPIPE) are swallowed; unexpected errors are logged via `[proxy]` debug.

## [0.4.5-beta.5] - 2026-08-11

### Fixed

- Copy buttons inside dialogs (e.g. the request detail Sheet) now actually copy: the fallback textarea is appended to the open dialog container so radix FocusScope no longer steals focus mid-copy (previously `execCommand('copy')` returned true while copying nothing).

## [0.4.5-beta.4] - 2026-08-11

### Changed

- Web UI copy buttons: failed copies now show an error toast instead of failing silently; successful copies toast 「已复制」 alongside the check feedback. Body JSON view uses `whitespace-pre` + horizontal scroll so pretty-printed indentation and syntax colors render correctly. Copy button and 源数据/格式化 tabs share a consistent height (`h-6`) and padding.

### Fixed

- Copy buttons now work over remote `http://LAN-IP` (non-secure context): the clipboard fallback runs synchronously inside the click gesture instead of after an `await`, so `execCommand('copy')` is no longer rejected for losing user activation.

## [0.4.5-beta.3] - 2026-08-10

### Changed

- Web UI copy buttons now show a green check + 「已复制」feedback for 2s after a successful copy, so the action is visibly confirmed.

### Fixed

- Binary smoke test now polls for the proxy port instead of a fixed 3s sleep — slow CI runners no longer fail with ECONNREFUSED on the dashboard check.

## [0.4.5-beta.2] - 2026-08-10

### Added

- Remote access to the management interface (Web UI / REST API / WebSocket):
  - With `--remote` / `MEDDLE_REMOTE=1`, LAN clients can now load the Web dashboard, call REST APIs, and receive live log pushes over WebSocket (previously loopback-only).
  - Optional auth: when `--remote-token` / `MEDDLE_REMOTE_TOKEN` is set, remote HTTP/WS requests must carry `Authorization: Bearer <token>` or Basic (`meddle:<token>`); loopback is always allowed and the default is no auth.
- MCP HTTP transport: `MEDDLE_MCP_HTTP=1` starts the MCP server over Streamable HTTP (`MEDDLE_MCP_PORT`, default 9010; `MEDDLE_BIND_HOST` for remote binding; `MEDDLE_MCP_TOKEN` for bearer auth). Stdio transport remains the default.

## [0.4.5-beta.1] - 2026-08-10

### Changed

- Web UI request/response detail panel:
  - JSON bodies now show a「源数据 / 格式化」tab switch (pretty-printed via the existing syntax highlighter); non-JSON bodies render as before.
  - Request/Response headers and bodies each get a copy button (uses the existing clipboard util with toast feedback).

## [0.4.4] - 2026-08-08

### Changed

- CA trust check on startup is now asynchronous and non-blocking: `security find-certificate` / `openssl verify` run in the background, so a slow Keychain service no longer delays proxy startup. No caching — the trust state is re-checked on every launch to avoid masking system cert changes.
- Plugin stability hardening (no architecture change, all in-process):
  - **Circuit breaker**: a plugin is auto-disabled after N consecutive hook failures (`breakerThreshold`, default 10), and re-enabled by a successful hook. A failing plugin no longer runs on every request.
  - **Slow-plugin detection**: hooks that block the event loop past `syncBlockThresholdMs` (default 50ms) are counted as `slowCount` in plugin stats and logged — this pins which plugin caused `eventLoopDelay` watchdog alerts.
  - **Timeout degrade**: a plugin is marked `degraded` after N consecutive hook timeouts (`timeoutDegradeAfter`, default 5) and skipped on subsequent hooks instead of being re-invoked and re-timing-out every request.
  - `degraded` is now a first-class plugin state shown in health reporting.
- All certificate-related subprocess calls now have a 5s timeout guard so a hung `security`/`openssl` can never block startup forever.

## [0.4.3] - 2026-08-07

### Fixed

- Manual `meddle update` (including `--check` / `status`) now bypasses the 24h update-check cache and always hits the network — newly released versions were previously invisible for up to 24h after publish because the CLI served the cached "latest" instead of re-checking.

## [0.4.2] - 2026-08-07

### Added

- Crash collection: fatal errors (`uncaughtException` / `unhandledRejection` / watchdog exit) now write a crash dump to `~/.meddle/crash/<fingerprint>-<ts>.json` with fingerprint dedupe (max 10 per fingerprint), env-key-only recording (never values), and credential scrubbing — `[fatal] 崩溃报告已保存: <path> (指纹 <fp>)` is printed on crash.

### Fixed

- Proxy no longer crashes with `uncaughtException: read ECONNRESET` when an upstream HTTP/2 session errors more than once: the session error listener is now persistent (`on` instead of `once`) and destroys the errored session so it is never reused. The MITM https server also attaches an `'error'` listener so a client resetting its TLS connection cannot kill the whole proxy.
- CONNECT tunnel sockets now keep persistent error listeners (`on` instead of `once`) — a second socket error after the first could previously become an uncaughtException and kill the proxy.

## [0.4.1] - 2026-08-06

### Added

- Upstream timeout is now configurable via `MEDDLE_UPSTREAM_TIMEOUT_MS` (default 60s)

### Changed

- Upstream timeouts now log a clear one-line `[proxy:upstream-timeout]` message with the target URL and elapsed seconds (e.g. `上游连接超时: 60s 内未收到 https://365.kdocs.cn/... 的响应`), instead of a generic error plus full stack trace — easier to spot and diagnose in proxy logs

### Fixed

- `meddle update` no longer fails with "operation aborted due to timeout" right after the download reaches 100%: the SHA256 sidecar's body is now consumed immediately after fetch, before the (potentially multi-minute) binary download — previously the sidecar's timeout expired during the payload download and its unread body aborted the install.

## [0.4.1-beta.2] - 2026-08-03

### Fixed

- `meddle update` no longer fails with "operation aborted due to timeout" right after the download reaches 100%: the SHA256 sidecar's body is now consumed immediately after fetch, before the (potentially multi-minute) binary download — previously the sidecar's timeout expired during the payload download and its unread body aborted the install.

## [0.4.1-beta.1] - 2026-08-03

### Changed

- Binary install location: the install script now defaults to `~/.local/bin` (POSIX convention); existing `~/.meddle/bin` installs are upgraded in place. `meddle update` installs into the directory of the RUNNING binary, so legacy installs stay where they are.

### Fixed

- Download timeout is now an IDLE timeout (reset per received chunk) instead of a total wall-time budget: a slow-but-steady 131MB download that finishes at 100% no longer fails with "operation aborted due to timeout". Genuinely stalled transfers still abort and retry.

## [0.4.0] - 2026-08-03

### Added

- Auto-update system: `meddle update` command (`--check`, `--version`, `--auto on|off`, `status`) and a non-blocking async startup version check (24h cache)
- Update channels: `--beta` / `--stable` switch channels (including downgrades); installs without a flag auto-infer the channel from the current version (prerelease → beta)
- Beta channel resolves via the npm registry `beta` dist-tag (`MEDDLE_NPM_BETA_REGISTRY_URL` to mirror)
- Binary downloads: SHA256 verification, `.bak` backup, atomic replace, progress bar (percent + bytes), retry with backoff on connection drops, 5min timeout
- Offline e2e test suite for the update flow (`pnpm run test:e2e:update`)
- `MEDDLE_UPDATE_BASE_URL` / `MEDDLE_NPM_REGISTRY_URL` / `MEDDLE_GITHUB_LATEST_URL` env vars for mirror/offline testing

### Fixed

- MITM HTTPS server port conflict (`EADDRINUSE`) no longer crashes the whole proxy — `listenWithRetry` retries with a fresh port
- Update check reports the channel's latest version instead of echoing the current one when the current version is newer than the channel

## [0.4.0-beta.10] - 2026-08-03

### Added

- `meddle update` shows a download progress bar (percent + transferred/total) while streaming the binary, and prints a "连接中断，正在重试" notice before each retry attempt.
- Binary download timeout raised from 120s to 5min for slow networks.

## [0.4.0-beta.9] - 2026-08-03

### Changed

- Explicit `--beta` / `--stable` now *switches channels*, including downgrades: `meddle update --stable` from a beta install moves to the latest stable release (instead of reporting the beta as up-to-date). Auto-inferred runs keep the only-upgrade behavior.

## [0.4.0-beta.8] - 2026-08-03

### Fixed

- `meddle update` binary downloads now retry on connection drops (`error reading a body from connection`): 3 attempts with linear backoff before giving up, so flaky networks no longer fail the whole upgrade.

## [0.4.0-beta.7] - 2026-08-03

### Fixed

- `meddle update --check --stable` (or `--beta`) on a prerelease install no longer echoes the current version as "已是最新版本". It now reports the channel's actual latest version, e.g. `当前 0.4.0-beta.6 已超过稳定频道最新版本 0.3.1`.

## [0.4.0-beta.6] - 2026-08-03

### Added

- `meddle update` now auto-infers the update channel from the current version: prerelease installs (e.g. `0.4.0-beta.4`) default to the beta channel, releases default to stable. Explicit `--beta` / `--stable` flags override the inference.

### Fixed

- Beta channel no longer queries the GitHub releases API (unauthenticated callers hit 403 rate limits). It now resolves through the npm registry `beta` dist-tag (`MEDDLE_NPM_BETA_REGISTRY_URL` mirrors it), which is published in lockstep with GitHub releases.

## [0.4.0-beta.4] - 2026-08-03

### Added

- `meddle update --beta` — check/upgrade through the beta channel: npm installs query the `beta` dist-tag, binary installs list GitHub releases and pick the highest prerelease (`--check --beta`, `status` also support the channel)

## [0.4.0-beta.3] - 2026-08-03

### Fixed

- MITM HTTPS server port conflict (`EADDRINUSE`) no longer crashes the whole proxy: `listenWithRetry` retries with a fresh port instead of letting the async listen error escape to `uncaughtException` and `process.exit(1)`

## [0.4.0-beta.2] - 2026-08-02

### Added

- Offline e2e test for `meddle update` (local HTTP fixtures, `pnpm run test:e2e:update`)
- `MEDDLE_UPDATE_BASE_URL` / `MEDDLE_NPM_REGISTRY_URL` / `MEDDLE_GITHUB_LATEST_URL` env vars for mirror/offline testing

## [0.4.0-beta.1] - 2026-08-02

### Added

- Auto-update: `meddle update` command (check / upgrade / `--version <x.y.z>` / `--auto on|off` / `status`)
- Non-blocking async version check on proxy startup (24h cache, never blocks boot)
- Binary installs: SHA256-verified download + `.bak` backup + atomic replace; auto-update downloads on startup when enabled (default off)
- npm installs: `meddle update` runs `npm install -g`

### Fixed

- Windows: `spawnSync('npm')` now uses shell (npm.cmd); replace failure restores backup with a clear error
- Binary download timeout raised to 120s for large payloads
- Auto-update skips download when the running executable path differs from the install dir (session / custom PATH)

## [0.3.1] - 2026-08-02

### Fixed

- Web lint errors: setState in effect (monaco-editor, use-mocks, use-scroll-shadows), non-component exports (rule-config, badge), missing useCallback deps (mock-config), prefer-const and no-useless-escape (code-fixer), no-explicit-any (api-client)
- Install script: use GitHub release redirect instead of API to avoid 403 rate limiting; clean output with progress bar

## [0.3.0] - 2026-08-01

### Added

- Binary distribution via `deno compile`: single-file executables for 6 platforms (linux-x64/arm64, darwin-x64/arm64, windows-x64/arm64), no Node.js required
- Single-entry dispatch (`bin/main.js`) routing proxy/mcp/cli via `MEDDLE_ENTRY` env var
- CI workflow (`.github/workflows/build-binary.yml`): v* tag triggers 6-target cross-compilation with smoke test and SHA256 release upload
- Install scripts: `scripts/install-binary.sh` (macOS/Linux) and `scripts/install-binary.ps1` (Windows) with checksum verification
- Automated binary smoke test (`scripts/binary-smoke.cjs`) using local origin server

### Changed

- Self-spawn (mcp-server, supervise, session create) now uses env-based dispatch instead of script paths
- Binary size optimized from 477MB to 133MB by excluding devDependencies, puppeteer-core, and web/node_modules

### Removed

- Dead code `core/plugin-compiler.ts` (unused esbuild dependency)

## [0.2.2] - 2026-07-31

### Fixed

- Event loop starvation (watchdog `eventLoopDelay` critical) caused by synchronous zlib decompression of large compressed upstream responses on the proxy hot path; bodies are now decompressed asynchronously off the event loop and oversized compressed inputs are refused instead of decompressed

## [0.2.1] - 2026-07-31

### Added

- `meddle --version` / `meddle -v` CLI flag as a shortcut alias for `meddle version`

## [0.2.0] - 2026-07-31

### Added

- Configurable `detailBodySizeKB` setting (default `256KB`) to cap request/response body size stored in log details, with structured `requestBodyTruncated` / `responseBodyTruncated` / `requestBodyOriginalBytes` / `responseBodyOriginalBytes` markers for truncated bodies
- Per-session inheritance for `detailBodySizeKB`: session settings → default session settings → `MEDDLE_MAX_DETAIL_BODY_KB` env → default 256KB

### Fixed

- Memory leak via unbounded detail body storage (proxy records stored up to 5MB bodies x 200 details, causing RSS to exceed the watchdog threshold)
- Memory leak via unbounded HTTP/2 session pool; sessions are now capped (default 32, configurable via `MEDDLE_MAX_H2_SESSIONS`) with LRU eviction

## [0.1.2] - 2026-07-30

### Added

- Output proxy server URL (`http://127.0.0.1:<port>`) on startup for easy access

## [0.1.1] - 2026-07-28

### Added

- `meddle version` command to display package, Node.js, and platform info

## [0.1.0] - 2026-07-28

### Fixed

- Proxy responses now stream in real-time instead of buffering the entire body

## [0.0.3] - 2026-07-27

### Added

- Automated tests for certificate trust detection (`checkCATrusted`)
- Exported `checkCATrusted` for testability

### Fixed

- Certificate trust detection bypasses unreliable `node-easy-cert` curl check;
  uses `security find-certificate` (macOS) and `openssl verify` (Linux) instead
- Linux auto-trust install for Debian (`update-ca-certificates`) and RHEL (`update-ca-trust`)

## [0.0.2] - 2026-07-27

### Fixed

- Renamed `bin/index` to `bin/index.js` so Node.js resolves the CLI entry correctly

## [0.0.1] - 2026-07-27

### Added

- Initial public release of `@jonathanleelx/meddle`
- Proxy server with routing rules, mock responses, and HTTPS interception
- Plugin system (builtin: logger, mock, router)
- MCP server integration
- CLI commands: start, supervise, status, doctor, url, mock, route, session
- Web dashboard (React + Vite)
- Multi-session isolation (preview)
