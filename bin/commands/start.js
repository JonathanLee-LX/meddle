/**
 * meddle start - Start proxy server
 */

const { spawn } = require('child_process')
const path = require('path')

// Parse arguments
const args = process.argv.slice(3)
const openFlag = args.includes('--open')
const remoteFlag = args.includes('--remote')
const interceptHttpsFlag = args.includes('--intercept-https')
const noInterceptHttpsFlag = args.includes('--no-intercept-https')

// Start proxy
const indexPath = path.join(__dirname, '..', 'index.js')
const spawnEnv = { ...process.env, DEBUG: process.env.DEBUG || '' }
if (openFlag) spawnEnv.MEDDLE_OPEN = '1'
if (remoteFlag) spawnEnv.MEDDLE_REMOTE = '1'
if (interceptHttpsFlag) spawnEnv.MEDDLE_INTERCEPT_HTTPS = '1'
if (noInterceptHttpsFlag) spawnEnv.MEDDLE_INTERCEPT_HTTPS = '0'

const remoteTokenIndex = args.indexOf('--remote-token')
if (remoteTokenIndex >= 0 && args[remoteTokenIndex + 1]) {
  spawnEnv.MEDDLE_REMOTE_TOKEN = args[remoteTokenIndex + 1]
}
const inlineRemoteToken = args.find(arg => arg.startsWith('--remote-token='))
if (inlineRemoteToken) spawnEnv.MEDDLE_REMOTE_TOKEN = inlineRemoteToken.slice('--remote-token='.length)

const child = spawn(process.execPath, [indexPath], {
  env: spawnEnv,
  stdio: 'inherit',
  cwd: process.cwd()
})

child.on('error', (err) => {
  console.error('启动代理失败:', err)
  process.exit(1)
})

child.on('exit', (code) => {
  process.exit(code || 0)
})
