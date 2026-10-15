# 只读规则集（规则集锁）

> Issue #137。一个规则集 = `route-rules/` 下的一个规则文件。

CLI / MCP 让 Agent 可以随意改路由规则。给规则集加上只读锁后，Agent 通过 CLI、MCP（以及任何直接调用 HTTP API 的方式）写入都会被拒绝；**加锁 / 解锁只能由人在 Meddle Web 界面中操作**，CLI 和 MCP 都没有对应的命令或工具。

> ⚠️ 这是**防误改**，不是安全隔离。有 shell 的 Agent 仍然可以直接修改磁盘上的规则文件或 `settings.json`；也可以先 `curl` 拉取页面拿到令牌，再伪造 `Origin` 调用加锁接口。详见下文「令牌与同源校验」。

## 锁存在哪里

- 存在 `settings.json` 的 `readonlyRuleFiles` 数组（规则文件名，不含 `.txt`），**不写进规则文件**。
- 字段不存在 = 所有规则集可读写。旧版 settings 无需迁移，未加锁的规则集行为与以前完全一致。
- `readonlyRuleFiles` 只能通过 Web 界面的加锁接口修改；`POST/PATCH /api/settings` 提交不同的值会被拒绝（403，`RULESET_LOCK_UI_ONLY`），整份保存时省略该字段则保留原值。

## 锁住后会被拒绝的写操作

在服务端公共写入口统一拒绝，CLI、MCP、Web 界面自身的写接口和界面里的 AI 助手一视同仁（界面需先解锁）：

| 操作 | HTTP | CLI | MCP |
|------|------|-----|-----|
| 增 / 改 / 删规则、规则开关、改规则内容 | `PUT /api/rule-files/:name/content` | `route add` / `route update` / `route delete` | `route_rule_add` / `route_rule_update` / `route_rule_delete` |
| 启用 / 停用规则集 | `PUT /api/rule-files/:name` `{ enabled }`、`PATCH/POST /api/settings` 改 `activeRuleFiles` | `route active set`（会改变锁住规则集状态时整体拒绝，不会只做一半） | `route_rule_active_set`（同左） |
| 重命名规则集 | `PUT /api/rule-files/:name` `{ newName }` | — | — |
| 删除规则集 | `DELETE /api/rule-files/:name` | — | — |

被拒绝时规则文件内容不变，返回：

```json
{ "error": "该规则集已设为只读，只能在 Meddle 界面中解锁", "code": "RULESET_READONLY", "ruleFile": "dev" }
```

- HTTP 状态码：`423 Locked`。
- CLI：退出码 **3**（专用，其它错误仍是 1；2 已被 `update --check` / `--session` 参数错误使用）。`--json` 时 stdout 输出 `{"success":false,"error":{"code":"RULESET_READONLY","message":"…","ruleFile":"dev"}}`，人类可读信息始终写到 stderr。代理未运行时 CLI 直接读写文件（file mode），同样遵守锁。
- MCP：工具返回 `isError: true`，文本为 `{"error":{"code":"RULESET_READONLY","message":"…","ruleFile":"dev"}}`。

读操作不受影响。规则集列表与详情都带 `readonly: true|false`：

- HTTP：`GET /api/rule-files`、`GET /api/rule-files/:name`（含 `content`）；`GET /api/rule-files/:name/content` 额外返回响应头 `X-Meddle-Ruleset-Readonly: true|false`。
- CLI：`meddle route list --json`、`meddle route show <file> --json`（文本输出中显示 `[read-only]` / `Read-only: Yes`）。
- MCP：`route_rule_list`（列表每项，以及指定 `ruleFile` 时的结果）。

新建规则集（`POST /api/rule-files`、`route create`、`route_rule_create_file`）总是可读写；同名已存在时本来就会失败，不会覆盖锁住的规则集。规则集排序（`PUT /api/rule-files/order`）是全局操作，不受锁影响。

## 改名

锁按文件名记录：

- **在 Meddle 界面中重命名**：锁住的规则集不能重命名，需先解锁再改名。界面中锁住规则集的重命名入口（双击名称）置灰不可用，并提示「规则集已锁定，解锁后可编辑」；服务端同样拒绝重命名锁住的规则集（`RULESET_READONLY`，423）。改名后的规则集为可读写，需要的话再手动加锁。
- **在 Meddle 之外直接改文件名**：视为一个新规则集，状态为可读写，锁不跟随。原来的锁记录找不到对应文件时会被自动清除（不报错）：Meddle 每次读取锁状态时都会清理，包括读取列表 / 详情、任何写入前的检查、加锁 / 解锁，以及在 Meddle 内新建或重命名规则集之前；代理未运行时 CLI 的文件模式也会清理。旧锁记录被清理后，再出现同名文件不会继承旧锁。
  - 注意：清理之前，同名新文件会被当作锁定（偏严格，不会误放行写入）。例如代理未运行时在 Meddle 之外改名，在下一次读取锁状态之前又直接在磁盘上新建了同名文件：此时旧锁记录又能对应到文件，不会再被清理，新文件会一直保持锁定，直到在 Meddle 界面中解锁。

## 令牌与同源校验

加锁 / 解锁接口 `PUT /api/rule-files/:name/readonly`（`{ "readonly": true|false }`）只给 Web 界面用，CLI / MCP 代码里不会调用它。请求必须同时满足：

1. 带上服务端在页面加载时下发的令牌（请求头 `X-Meddle-UI-Token`）。令牌每次启动随机生成，写在 `index.html` 的 `<meta name="meddle-ui-token">` 中；页面不是由 Meddle 提供时（如 Vite 开发服务器），或代理重启后旧令牌失效时，界面会从仅同源可用的 `GET /api/ui-token` 重新获取。
2. 同源：浏览器发送的 `Sec-Fetch-Site` 必须是 `same-origin`；若带 `Origin`，其 host 必须与 `Host` 一致；两者都没有的请求（普通 `curl`、CLI、MCP）一律拒绝。

失败返回 403（`UI_TOKEN_INVALID` 或 `UI_ORIGIN_REQUIRED`）。

**局限（如实说明）**：令牌放在页面里，任何能访问代理端口的程序都能 `curl` 先拉取页面拿到令牌，再伪造 `Origin` / `Sec-Fetch-Site` 请求头绕过校验。这些校验只是让 Agent 不会「顺手」解锁，并不能阻止有意绕过；有 shell 的 Agent 也可以直接改磁盘文件。不要把它当作权限控制。

## 界面

- 规则文件列表：开关旁有锁按钮。可读写的规则集悬停 / 键盘聚焦时显示打开的锁；只读规则集常驻锁上的锁，行文字变灰，开关、删除和重命名（双击名称）置灰不可用。拖拽排序不受锁影响。点击立即切换，标题栏显示「保存中…」→「已保存」，失败时回滚并提示。
- 只读规则集的编辑区：标题旁显示「只读」标签，保存按钮换成「解锁」；表格的开关 / 编辑 / 删除和工具栏「添加规则」「从文件加载」「文本导入」置灰并提示「规则集已锁定，解锁后可编辑」；文本视图只读但可选中复制。
