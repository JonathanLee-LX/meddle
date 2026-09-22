/**
 * Proxy detection utilities
 * Detect if proxy is running and get proxy URL
 *
 * On module load, applies any --session context from argv. This makes
 * every CLI command session-aware without individual changes: when
 * --session <id> is set, MEDDLE_HOME is pinned to the session's data dir
 * and getProxyUrl() returns that session's port.
 *
 * Probe priority (issue #85):
 *   1. MEDDLE_SESSION_PORT (pinned session)
 *   2. mcp-proxy-url.json (written by proxy on every start)
 *   3. DEFAULT_PROXY_BASE (http://127.0.0.1:8989)
 *
 * Stale ports in mcp-proxy-url.json must not stick forever: isProxyRunning /
 * resolveLiveProxyUrl fall through to later candidates when a probe fails,
 * and cache the first live URL for subsequent getProxyUrl() / API calls.
 */

const fs = require('fs')
const path = require('path')
const { resolveMeddleHome } = require('./meddle-home')
const { applySessionContext, GLOBAL_DEFAULT_PORT } = require('./session-args')

// Apply --session / MEDDLE_HOME precedence before computing paths.
applySessionContext()

// Resolved once for CLI (MEDDLE_HOME is set before this module loads).
const meddleDir = resolveMeddleHome()
const mcpFile = path.join(meddleDir, 'mcp-proxy-url.json')
const DEFAULT_PROXY_BASE = `http://127.0.0.1:${GLOBAL_DEFAULT_PORT}`

/** @type {string | null} */
let resolvedProxyUrl = null

function getMcpFilePath() {
  // Prefer live MEDDLE_HOME so tests can point at a temp home after require.
  const home = (process.env.MEDDLE_HOME || '').trim() || meddleDir
  return path.join(home, 'mcp-proxy-url.json')
}

/**
 * Sync best-effort URL (no liveness check). Prefer a previously resolved live
 * URL so API calls after isProxyRunning() hit the working port.
 */
function getProxyUrl() {
  if (resolvedProxyUrl) return resolvedProxyUrl
  const candidates = getCandidateProxyUrls()
  return candidates[0] || DEFAULT_PROXY_BASE
}

/**
 * Ordered candidate URLs to probe (deduped).
 * Session pin is exclusive — do not fall back to global file/default.
 */
function getCandidateProxyUrls() {
  if (process.env.MEDDLE_SESSION_PORT) {
    return [`http://127.0.0.1:${process.env.MEDDLE_SESSION_PORT}`]
  }
  const urls = []
  try {
    const file = getMcpFilePath()
    if (fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'))
      if (data.proxyUrl && typeof data.proxyUrl === 'string') {
        urls.push(data.proxyUrl.replace(/\/$/, ''))
      }
    }
  } catch (_) {}
  if (!urls.includes(DEFAULT_PROXY_BASE)) {
    urls.push(DEFAULT_PROXY_BASE)
  }
  return urls
}

/**
 * @param {string} url
 * @param {number} timeoutMs
 */
async function probeUrl(url, timeoutMs = 2000) {
  try {
    const response = await fetch(url.replace(/\/$/, '') + '/api/mocks', {
      method: 'GET',
      signal: AbortSignal.timeout(timeoutMs)
    })
    return response.ok
  } catch (_) {
    return false
  }
}

/**
 * Probe candidates in order; cache and return the first live URL, or null.
 * @param {number} timeoutMs
 * @param {(url: string, timeoutMs: number) => Promise<boolean>} [probe]
 */
async function resolveLiveProxyUrl(timeoutMs = 2000, probe = probeUrl) {
  if (resolvedProxyUrl) {
    const perTry = Math.min(timeoutMs, 800)
    if (await probe(resolvedProxyUrl, perTry)) return resolvedProxyUrl
    resolvedProxyUrl = null
  }

  const candidates = getCandidateProxyUrls()
  const perTry = Math.max(200, Math.floor(timeoutMs / Math.max(1, candidates.length)))
  for (const url of candidates) {
    if (await probe(url, perTry)) {
      resolvedProxyUrl = url
      return url
    }
  }
  return null
}

/**
 * Check if proxy is running by probing candidates (file → default fallback).
 * @param {number} timeoutMs - Timeout in milliseconds (default 2000)
 */
async function isProxyRunning(timeoutMs = 2000) {
  const url = await resolveLiveProxyUrl(timeoutMs)
  return !!url
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
          const port = process.env.MEDDLE_SESSION_PORT
          fetch(`http://127.0.0.1:${port}/api/mocks`, { method: 'GET', signal: AbortSignal.timeout(500) })
            .then((r) => { if (r.ok) resolve(`http://127.0.0.1:${port}`); else retry() })
            .catch(() => retry())
          return
        }
        const file = getMcpFilePath()
        if (fs.existsSync(file)) {
          const data = JSON.parse(fs.readFileSync(file, 'utf8'))
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

/** Test-only: clear cached live URL so the next probe re-reads candidates. */
function __resetResolvedProxyUrlForTest() {
  resolvedProxyUrl = null
}

/** Test-only: seed the cached live URL. */
function __setResolvedProxyUrlForTest(url) {
  resolvedProxyUrl = url || null
}

module.exports = {
  meddleDir,
  mcpFile,
  DEFAULT_PROXY_BASE,
  getProxyUrl,
  getCandidateProxyUrls,
  getMcpFilePath,
  resolveLiveProxyUrl,
  probeUrl,
  isProxyRunning,
  waitForProxyUrl,
  __resetResolvedProxyUrlForTest,
  __setResolvedProxyUrlForTest,
}
