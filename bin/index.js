#!/usr/bin/env node

// Strip --session <id> / --session=<id> from argv so command routing
// and all downstream `process.argv.slice(N)` calls see a clean argv.
// The session id is stashed in MEDDLE_SESSION_ID for session-args.js to
// pick up when applying the session context.
(function stripSessionFlag() {
  const argv = process.argv
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--session' && i + 1 < argv.length) {
      process.env.MEDDLE_SESSION_ID = argv[i + 1]
      argv.splice(i, 2)
      return
    }
    if (argv[i].startsWith('--session=')) {
      process.env.MEDDLE_SESSION_ID = argv[i].slice('--session='.length)
      argv.splice(i, 1)
      return
    }
  }
})()

const args = process.argv.slice(2)
const command = args[0]
const subcommand = args[1]

// Command routing map
const commands = {
  'doctor': './doctor.js',
  'start': './commands/start.js',
  'supervise': './commands/supervise.js',
  'url': './commands/url.js',
  'status': './commands/status.js',
  'session': './commands/session/index.js',
  'mock': './commands/mock/index.js',
  'route': './commands/route/index.js'
}

// Check for --help flag
if (command === '--help' || command === '-h' || command === 'help') {
  showHelp()
  process.exit(0)
}

// Handle nested commands (mock/route/session)
if (command === 'mock' || command === 'route' || command === 'session') {
  require(commands[command])
} else if (commands[command]) {
  require(commands[command])
} else if (!command || command.startsWith('--')) {
  // No command or only flags - start proxy (default behavior)
  require('../index.js')
} else {
  console.log(`Unknown command: ${command}`)
  showHelp()
  process.exit(1)
}

function showHelp() {
  console.log(`
Meddle - 开发代理工具

用法:
  meddle                          启动代理服务器 (默认)
  meddle start [options]          启动代理服务器
  meddle supervise [options]      以前台守护模式启动并自动重启
  meddle --remote                 启动局域网手机代理并解密 HTTPS
  meddle doctor                   检查配置文件健康状况
  meddle url                      获取代理 URL
  meddle status                   查看代理状态

Session 命令 (多实例隔离，预览功能):
  meddle session create [--name <label>] [--port <port>]
                              创建一个新的代理 session（独立 MEDDLE_HOME + 端口）
  meddle session list             列出所有 session（含存活检测）
  meddle session delete <id> [--clean]
                              终止 session 并从注册表移除（--clean 同时删除数据目录）
  meddle session prune            清理所有孤儿 session 记录
  meddle --session <id> <command> 对指定 session 执行命令（如 route list）

Mock 命令:
  meddle mock list [--json]       列出所有 mock 规则
  meddle mock add [options]       添加 mock 规则
  meddle mock update <id> [opts]  更新 mock 规则
  meddle mock delete <id>         删除 mock 规则
  meddle mock enable <id>         启用 mock 规则
  meddle mock disable <id>        禁用 mock 规则

Route 命令:
  meddle route list [--json]      列出所有路由文件
  meddle route show <file> [--json] 查看路由文件规则
  meddle route preview <url> [--file <name>] [--json] 预览 URL 的转发目标
  meddle route active             查看当前激活的路由文件
  meddle route active set <file>  设置激活的路由文件
  meddle route create <name>      创建路由文件
  meddle route add <file> <pattern> <target>   添加路由规则
  meddle route update <file> <pattern> <target> 更新路由规则
  meddle route delete <file> <pattern> 删除路由规则

全局选项:
  --help, -h                  显示帮助信息
  --session <id>              指定目标 session（与 MEDDLE_HOME 互斥）
  --json                      JSON 格式输出 (用于 list/show/preview 命令)
  --open                      启动后自动打开浏览器
  --remote                    允许局域网设备连接代理
  --remote-token <token>      为远程代理启用 Basic 认证
  --intercept-https           解密所有 HTTPS 流量
  --no-intercept-https        远程模式下不解密 HTTPS
  --daemon                    supervise 后台运行，日志写入 ~/.meddle/supervisor.log
  --max-restarts <n>          supervise 最大重启次数，0 表示不限
  --restart-delay <ms>        supervise 重启延迟，默认 1000ms

示例:
  meddle                          # 启动代理服务器
  meddle --open                   # 启动并打开浏览器
  meddle --remote                 # 启动手机抓包代理
  meddle --remote --remote-token "change-me"
  meddle supervise --remote       # 守护模式启动远程代理
  meddle doctor                   # 检查配置文件
  meddle mock list --json         # JSON 格式列出 mock 规则
  meddle mock add --name "API" --pattern "api.test.com" --status 200
  meddle route list               # 列出路由文件
  meddle route preview "https://api.example.com/v1/users"  # 预览转发目标
  meddle route preview "https://cdn.com/assets/js/app.js" --file dev-rules --json
  meddle route add dev-rules "api.test.com" "localhost:3000"
  meddle route active set beta-rules

更多信息请访问: https://github.com/JonathanLee-LX/meddle
  `)
}
