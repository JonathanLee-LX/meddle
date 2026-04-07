/**
 * ep start - Start proxy server
 */

const { spawn } = require('child_process')
const path = require('path')

// Parse arguments
const args = process.argv.slice(3)
const openFlag = args.includes('--open')

let env = null
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--env') {
    env = args[++i]
    break
  }
}

// Start proxy
const indexPath = path.join(__dirname, '..', 'index.js')
const spawnEnv = { ...process.env, DEBUG: process.env.DEBUG || '' }
if (env) spawnEnv.EP_ENV = env

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

// Handle --open flag (browser launch)
if (openFlag) {
  // The main index.js handles browser opening when --open is passed
  // Just pass the flag through environment
  spawnEnv.EP_OPEN = '1'
}