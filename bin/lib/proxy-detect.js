/**
 * Proxy detection utilities
 * Detect if proxy is running and get proxy URL
 */

const fs = require('fs')
const path = require('path')
const os = require('os')

const epDir = path.resolve(os.homedir(), '.ep')
const mcpFile = path.join(epDir, 'mcp-proxy-url.json')
const DEFAULT_PROXY_BASE = 'http://127.0.0.1:9001'

/**
 * Get proxy URL from mcp-proxy-url.json or return default
 */
function getProxyUrl() {
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
        if (fs.existsSync(mcpFile)) {
          const data = JSON.parse(fs.readFileSync(mcpFile, 'utf8'))
          if (data.proxyUrl) {
            return resolve(data.proxyUrl)
          }
        }
      } catch (_) {}
      if (Date.now() - start > timeoutMs) {
        return reject(new Error('等待代理启动超时'))
      }
      setTimeout(check, interval)
    }
    check()
  })
}

module.exports = {
  epDir,
  mcpFile,
  DEFAULT_PROXY_BASE,
  getProxyUrl,
  isProxyRunning,
  waitForProxyUrl
}