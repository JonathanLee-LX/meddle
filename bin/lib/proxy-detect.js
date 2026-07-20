/**
 * Proxy detection utilities
 * Detect if proxy is running and get proxy URL
 *
 * On module load, applies any --session context from argv. This makes
 * every CLI command session-aware without individual changes: when
 * --session <id> is set, MEDDLE_HOME is pinned to the session's data dir
 * and getProxyUrl() returns that session's port.
 */

const fs = require('fs')
const path = require('path')
const { resolveMeddleHome } = require('./meddle-home')
const { applySessionContext, GLOBAL_DEFAULT_PORT } = require('./session-args')

// Apply --session / MEDDLE_HOME precedence before computing paths.
applySessionContext()

const meddleDir = resolveMeddleHome()
const mcpFile = path.join(meddleDir, 'mcp-proxy-url.json')
const DEFAULT_PROXY_BASE = `http://127.0.0.1:${GLOBAL_DEFAULT_PORT}`

/**
 * Get proxy URL.
 *
 * Priority:
 *   1. MEDDLE_SESSION_PORT env (set by --session resolution)
 *   2. mcp-proxy-url.json (written by proxy on startup)
 *   3. DEFAULT_PROXY_BASE (http://127.0.0.1:8989)
 */
function getProxyUrl() {
  if (process.env.MEDDLE_SESSION_PORT) {
    return `http://127.0.0.1:${process.env.MEDDLE_SESSION_PORT}`
  }
  try {
    if (fs.existsSync(mcpFile)) {
      const data = JSON.parse(fs.readFileSync(mcpFile, 'utf8'))
      if (data.proxyUrl) return data.proxyUrl
    }
  } catch (_) {}
  return DEFAULT_PROXY_BASE
}

/**
 * Check if proxy is running by attempting to connect
 * @param {number} timeoutMs - Timeout in milliseconds (default 2000)
 */
async function isProxyRunning(timeoutMs = 2000) {
  const url = getProxyUrl()
  try {
    const response = await fetch(url + '/api/mocks', {
      method: 'GET',
      signal: AbortSignal.timeout(timeoutMs)
    })
    return response.ok
  } catch (_) {
    return false
  }
}

/**
 * Wait for proxy to start
 * @param {number} timeoutMs - Timeout in milliseconds (default 5000)
 */
function waitForProxyUrl(timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const start = Date.now()
    const interval = 50
    const check = () => {
      try {
        if (process.env.MEDDLE_SESSION_PORT) {
          // For --session mode, poll the HTTP endpoint directly.
          const port = process.env.MEDDLE_SESSION_PORT
          fetch(`http://127.0.0.1:${port}/api/mocks`, { method: 'GET', signal: AbortSignal.timeout(500) })
            .then((r) => { if (r.ok) resolve(`http://127.0.0.1:${port}`); else retry() })
            .catch(() => retry())
          return
        }
        if (fs.existsSync(mcpFile)) {
          const data = JSON.parse(fs.readFileSync(mcpFile, 'utf8'))
          if (data.proxyUrl) {
            return resolve(data.proxyUrl)
          }
        }
      } catch (_) {}
      retry()
    }
    function retry() {
      if (Date.now() - start > timeoutMs) {
        return reject(new Error('等待代理启动超时'))
      }
      setTimeout(check, interval)
    }
    check()
  })
}

module.exports = {
  meddleDir,
  mcpFile,
  DEFAULT_PROXY_BASE,
  getProxyUrl,
  isProxyRunning,
  waitForProxyUrl
}
