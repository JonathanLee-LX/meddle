/**
 * meddle start - Start proxy server
 */

const { spawn } = require('child_process')
const { buildProxySpawn, getReentryArgv } = require('../lib/spawn-proxy')

// Parse arguments
const args = process.argv.slice(3)
const openFlag = args.includes('--open')
const remoteFlag = args.includes('--remote')
const interceptHttpsFlag = args.includes('--intercept-https')
const noInterceptHttpsFlag = args.includes('--no-intercept-https')

// Start proxy
const extraEnv = { DEBUG: process.env.DEBUG || '' }
if (openFlag) extraEnv.MEDDLE_OPEN = '1'
if (remoteFlag) extraEnv.MEDDLE_REMOTE = '1'
if (interceptHttpsFlag) extraEnv.MEDDLE_INTERCEPT_HTTPS = '1'
if (noInterceptHttpsFlag) extraEnv.MEDDLE_INTERCEPT_HTTPS = '0'

const remoteTokenIndex = args.indexOf('--remote-token')
if (remoteTokenIndex >= 0 && args[remoteTokenIndex + 1]) {
  extraEnv.MEDDLE_REMOTE_TOKEN = args[remoteTokenIndex + 1]
}
const inlineRemoteToken = args.find(arg => arg.startsWith('--remote-token='))
if (inlineRemoteToken) extraEnv.MEDDLE_REMOTE_TOKEN = inlineRemoteToken.slice('--remote-token='.length)

const { args: spawnArgs, options: spawnOptions } = buildProxySpawn({
  baseEnv: process.env,
  reentryArgv: getReentryArgv(),
  extraEnv,
})
const child = spawn(process.execPath, spawnArgs, {
  ...spawnOptions,
  cwd: process.cwd(),
})

child.on('error', (err) => {
  console.error('启动代理失败:', err)
  process.exit(1)
})

child.on('exit', (code) => {
  process.exit(code || 0)
})
