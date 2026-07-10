# 请求来源应用识别

Easy Proxy 会为请求日志附加“来源应用”信息。识别采用按优先级执行的 resolver 管线，确定性证据优先于推断结果。

## 识别策略

| 优先级 | 适用连接 | 识别方式 | 可信度 |
|---|---|---|---|
| 1 | macOS 本机连接 | 根据 socket 端点使用 `lsof` 反查进程，再读取 `.app/Contents/Info.plist` | 高 |
| 2 | 远程设备 HTTP/已解密 HTTPS | 根据 HTTP `User-Agent` 推断浏览器或 WebView | 中或低 |
| 3 | 未来扩展 | 远程客户端主动上报身份 | 由实现决定 |

本机进程身份一旦识别成功，不会被 User-Agent 结果覆盖。例如 Chrome 的网络请求会显示为 `Google Chrome`，即使请求头中的 UA 可被修改。

## 日志字段

`GET /api/logs` 返回的每条记录可能包含：

| 字段 | 说明 |
|---|---|
| `applicationName` | 应用或浏览器名称 |
| `applicationProcess` | 本机进程名，仅进程反查可用 |
| `applicationPid` | 本机 PID，仅进程反查可用 |
| `applicationPath` | macOS `.app` 路径 |
| `applicationBundleId` | macOS Bundle ID |
| `applicationIdentitySource` | `local-process`、`user-agent` 或 `client-reported` |
| `applicationIdentityConfidence` | `high`、`medium` 或 `low` |

User-Agent 推断结果不会伪造 PID、Bundle ID 或应用路径。

## 当前支持的 User-Agent

- Google Chrome（含 Android 和 iOS）
- Microsoft Edge
- Safari
- Mozilla Firefox
- Opera
- Samsung Internet
- DuckDuckGo Browser
- Android WebView（低可信度）
- iOS WebView（低可信度）

无法匹配的 UA 会保留为“未知应用”，不会用网络库名称冒充具体 App。

## Web 界面

- 日志表格的“应用”列显示识别结果。
- Chrome、Safari、WebView、终端和 Node 等常见类型使用不同图标与颜色，便于快速扫视。
- User-Agent 结果带有“推断”标记。
- 悬停应用名称可查看识别方式、可信度及本机进程元数据。
- 请求详情顶部同样显示应用身份和“推断”标记。
- 使用 `app:` 过滤，例如：
  - `app:Chrome`
  - `app:Safari`
  - `app:user-agent`
  - `app:medium`

## HTTPS 限制

User-Agent 位于加密后的 HTTP 请求头中：

- 开启 HTTPS 解密时，可以推断远程 HTTPS 浏览器。
- 使用纯 CONNECT 隧道、不解密 HTTPS 时，只能看到目标主机，无法读取 UA，因此应用保持未知。
- 使用证书锁定或不信任 Easy Proxy CA 的 App 无法完成 HTTPS 解密。

## 准确性与隐私

User-Agent 可被修改或伪造，因此它只是一种推断，不代表远程设备上的已验证进程。

移动 App 常使用系统 WebView 或共享网络栈，此时只能识别 `Android WebView`、`iOS WebView`，无法确定宿主 App。Easy Proxy 不保存完整 UA 到应用身份字段；原始请求头仍按现有日志详情规则记录。

## 测试

```bash
# 单元与回归测试
pnpm test
pnpm --dir web test:run

# 真实代理链路：本机进程 + 远程 Chrome UA + 未知 UA
pnpm test:identity
```

`test:identity` 需要一块具有私有 IPv4 地址的局域网网卡。特殊环境可通过 `EP_IDENTITY_SMOKE_HOST` 指定用于模拟远程连接的本机地址。
