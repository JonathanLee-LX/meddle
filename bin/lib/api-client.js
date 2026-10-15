/**
 * HTTP API client for proxy operations
 */

const { getProxyUrl } = require('./proxy-detect')

const DEFAULT_TIMEOUT = 2000

/**
 * Make API request to proxy server
 */
async function apiRequest(method, pathname, body, timeoutMs = DEFAULT_TIMEOUT) {
  const base = getProxyUrl()
  const url = base.replace(/\/$/, '') + pathname
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(timeoutMs)
  }
  if (body !== undefined) {
    opts.body = typeof body === 'string' ? body : JSON.stringify(body)
  }

  const response = await fetch(url, opts)

  if (!response.ok) {
    const text = await response.text()
    const err = new Error(text || response.statusText)
    err.status = response.status
    // Structured errors (e.g. issue #137 RULESET_READONLY) keep their code.
    try {
      const data = JSON.parse(text)
      if (data && typeof data === 'object') {
        if (typeof data.code === 'string') err.code = data.code
        if (typeof data.ruleFile === 'string') err.ruleFile = data.ruleFile
      }
    } catch (_) {}
    throw err
  }

  const contentType = response.headers.get('content-type')
  if (contentType && contentType.includes('application/json')) {
    return response.json()
  }
  // Issue #145: `Response.text()` strips a leading UTF-8 BOM, so a rule file
  // read and written back through the API would silently lose it.
  return new TextDecoder('utf-8', { ignoreBOM: true }).decode(await response.arrayBuffer())
}

/**
 * GET request
 */
async function apiGet(pathname, timeoutMs = DEFAULT_TIMEOUT) {
  return apiRequest('GET', pathname, undefined, timeoutMs)
}

/**
 * POST request
 */
async function apiPost(pathname, body, timeoutMs = DEFAULT_TIMEOUT) {
  return apiRequest('POST', pathname, body, timeoutMs)
}

/**
 * PUT request
 */
async function apiPut(pathname, body, timeoutMs = DEFAULT_TIMEOUT) {
  return apiRequest('PUT', pathname, body, timeoutMs)
}

/**
 * DELETE request
 */
async function apiDelete(pathname, timeoutMs = DEFAULT_TIMEOUT) {
  return apiRequest('DELETE', pathname, undefined, timeoutMs)
}

module.exports = {
  apiRequest,
  apiGet,
  apiPost,
  apiPut,
  apiDelete
}