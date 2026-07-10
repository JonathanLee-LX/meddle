<claude-mem-context>
# Memory Context

# [easy-proxy] recent context, 2026-05-21 9:59am GMT+8

Legend: 🎯session 🔴bugfix 🟣feature 🔄refactor ✅change 🔵discovery ⚖️decision 🚨security_alert 🔐security_note
Format: ID TIME TYPE TITLE
Fetch details: get_observations([IDs]) | Search: mem-search skill

Stats: 23 obs (4,730t read) | 919,770t work | 99% savings

### Apr 28, 2026
10 11:07a 🔐 Easy-Proxy 安全审计：初筛高危漏洞
11 " 🔵 环境变量使用分布：8 个文件使用 process.env
12 " 🚨 H2 连接池全局禁用 TLS 证书校验（rejectUnauthorized: false）
13 " 🔴 修复 /api/plugins/save 路径遍历漏洞
14 " 🔵 确认全局 TLS 证书校验禁用模式：跨越 HTTP/2、HTTP/1.1 和 WebSocket 三条路径
15 " 🟣 创建 TLS 配置模块 core/tls-config.ts 实现统一的证书验证控制
16 " 🔄 h2-pool.ts 引入 TLS 配置模块替换硬编码的证书校验禁用
17 11:08a 🔄 h2-pool.ts 两处硬编码的 rejectUnauthorized: false 全部替换为 getTlsVerifyOption()
18 " 🔵 确认 server/plugins.ts 中插件测试端点硬编码 require('http')/require('https')
19 " 🔄 server/plugins.ts 插件测试端点 TLS 验证修复完成
20 " 🔵 确认 index.js WebSocket 代理路径存在 rejectUnauthorized: false
21 " 🔄 index.js WebSocket 代理 TLS 验证修复完成
22 11:09a 🟣 创建 API 认证中间件 server/auth.ts
23 " 🔄 在 server/index.ts 中注册认证中间件保护所有 API 端点
24 11:10a 🔴 修复 server/auth.ts TypeScript 编译错误：缺少方法调用括号
S5 全面安全审计 easy-proxy 项目并修复发现的严重安全风险 (Apr 28 at 11:10 AM)
S4 修复 server/auth.ts TypeScript 编译错误：缺少方法调用括号 (Apr 28 at 11:10 AM)
S6 Proxy server listening on ports 8989 and 8990 (Apr 28 at 11:10 AM)
### May 6, 2026
26 7:46p ⚖️ Agent started via ep command
27 " ✅ Proxy server started via ep CLI
28 " 🔐 Proxy server security middleware and plugin system activated
29 " 🔴 request-timing plugin crash in onBeforeProxy hook
30 " 🔵 Proxy server listening on ports 8989 and 8990
S7 Start easy-proxy development proxy server using ep command (May 6 at 7:46 PM)
S8 Two plugin bugs discovered in runtime logs (May 6 at 7:46 PM)
31 7:47p 🔵 Proxy ports verified: Web UI (8989) returns HTML, Proxy (8990) rejects direct requests
32 " 🔴 Two plugin bugs discovered in runtime logs
33 " 🔵 Proxy process stable despite repeated plugin errors
S9 Start easy-proxy development proxy server using ep command (May 6 at 7:47 PM)
S10 Fix plugin this-binding in wrapPluginWithPermissionChecks and restart proxy (May 6 at 9:13 PM)
**Investigated**: - Read core/plugin-permissions.ts to verify the fix for start/stop/dispose wrapper methods (capturing method refs as startFn/stopFn/disposeFn before .call(plugin))
    - Reviewed the full wrapper flow: setup/hook methods use .call(plugin) to preserve this context

**Learned**: - The wrapper fix captures method references before the if-block to avoid potential issues with repeated property access (plugin.start → const startFn = plugin.start)
    - All 292 tests across 35 test files pass, including plugin-permissions.spec.ts (22 tests) which directly tests the wrapper logic

**Completed**: - core/plugin-permissions.ts modified: startFn/stopFn/disposeFn captured before wrapper assignment
    - pnpm run build: clean TypeScript compilation
    - Proxy started (node bin/index): all 5 plugins loaded and processing requests without errors
    - No errors found in startup logs (verified via grep)
    - All 292 tests pass (pnpm run test)

**Next Steps**: - Proxy is running successfully on port 8989
    - No pending tasks — the fix and restart are complete


Access 920k tokens of past work via get_observations([IDs]) or mem-search skill.
</claude-mem-context>