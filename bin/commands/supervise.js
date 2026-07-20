/**
 * meddle supervise - Run meddle under a lightweight restart supervisor.
 */

const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')
const { resolveMeddleHome } = require('../lib/meddle-home')

const rawArgs = process.argv.slice(3)
const daemonFlag = rawArgs.includes('--daemon')
const restartCleanExit = rawArgs.includes('--restart-clean')
const maxRestarts = readNumberOption('--max-restarts', 0)
const restartDelayMs = readNumberOption('--restart-delay', 1000)

if (daemonFlag) {
  startDaemon()
} else {
  supervise()
}

function supervise() {
  const indexPath = path.join(__dirname, '..', '..', 'index.js')
  const proxyArgs = stripSupervisorArgs(rawArgs)
  const childEnv = { ...process.env, DEBUG: process.env.DEBUG || '', MEDDLE_SUPERVISED: '1' }

  let child = null
  let stopping = false
  let restarts = 0

  const stop = (signal) => {
    stopping = true
    if (child && child.exitCode === null) child.kill(signal)
  }

  process.on('SIGINT', () => stop('SIGINT'))
  process.on('SIGTERM', () => stop('SIGTERM'))

  const start = () => {
    child = spawn(process.execPath, [indexPath, ...proxyArgs], {
      cwd: process.cwd(),
      env: childEnv,
      stdio: 'inherit',
    })

    child.on('error', (err) => {
      console.error('[supervisor] failed to start proxy:', err.message)
      process.exit(1)
    })

    child.on('exit', (code, signal) => {
      if (stopping) process.exit(code || 0)
      if (code === 0 && !restartCleanExit) process.exit(0)

      restarts += 1
      if (maxRestarts > 0 && restarts > maxRestarts) {
        console.error(`[supervisor] restart limit reached (${maxRestarts}); last exit code=${code} signal=${signal || ''}`)
        process.exit(code || 1)
      }

      console.error(`[supervisor] proxy exited code=${code} signal=${signal || ''}; restarting in ${restartDelayMs}ms`)
      setTimeout(start, restartDelayMs)
    })
  }

  start()
}

function startDaemon() {
  const args = rawArgs.filter(arg => arg !== '--daemon')
  const meddleDir = resolveMeddleHome()
  fs.mkdirSync(meddleDir, { recursive: true })
  const logFd = fs.openSync(path.join(meddleDir, 'supervisor.log'), 'a')
  const binPath = path.join(__dirname, '..', 'index')
  const child = spawn(process.execPath, [binPath, 'supervise', ...args], {
    cwd: process.cwd(),
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: process.env,
  })
  child.unref()
  console.log(`Supervisor started: pid=${child.pid}, log=${path.join(meddleDir, 'supervisor.log')}`)
}

function stripSupervisorArgs(args) {
  const result = []
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--daemon' || arg === '--restart-clean') continue
    if (arg === '--max-restarts' || arg === '--restart-delay') {
      i += 1
      continue
    }
    if (arg.startsWith('--max-restarts=') || arg.startsWith('--restart-delay=')) continue
    result.push(arg)
  }
  return result
}

function readNumberOption(name, fallback) {
  const inline = rawArgs.find(arg => arg.startsWith(name + '='))
  const index = rawArgs.indexOf(name)
  const value = inline ? inline.slice(name.length + 1) : (index >= 0 ? rawArgs[index + 1] : undefined)
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}
