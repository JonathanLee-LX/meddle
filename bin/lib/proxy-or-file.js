/**
 * Decide whether a proxy API failure may fall back to a direct file write.
 *
 * Fall back only when the proxy is not running, or the request fails before
 * any HTTP response (connection refused, timeout, DNS). A 4xx/5xx is the
 * proxy's answer: callers print that body and must not touch the file.
 * Treating a 409 (corrupt mocks.json) as "proxy down" rewrote the file and
 * dropped every existing rule.
 */

const output = require('./output')
const { isProxyRunning } = require('./proxy-detect')

const UNREACHABLE_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EPIPE',
  'ETIMEDOUT',
  'ECONNABORTED',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
  'UND_ERR_HEADERS_TIMEOUT',
])

function causeCode(err) {
  if (!err || typeof err !== 'object') return undefined
  if (err.code && err.code !== 'MOCKS_FILE_INVALID') return err.code
  if (err.cause) return causeCode(err.cause)
  return undefined
}

/** True when the proxy answered with an HTTP 4xx/5xx (api-client sets err.status). */
function isApiHttpError(err) {
  const status = err && err.status
  return Number.isInteger(status) && status >= 400 && status <= 599
}

/**
 * True when we never got an HTTP response: connection refused, DNS, reset,
 * timeout, or undici's `TypeError: fetch failed`.
 */
function isProxyUnreachableError(err) {
  if (!err || isApiHttpError(err)) return false
  if (err.name === 'AbortError' || err.name === 'TimeoutError') return true
  const code = causeCode(err)
  if (code && UNREACHABLE_CODES.has(code)) return true
  if (err.name === 'TypeError' && err.message === 'fetch failed') return true
  return false
}

/**
 * Call the proxy when it is up. `file` runs only when it is down or the
 * request never received an HTTP response. HTTP errors reject.
 *
 * @param {{ api: () => Promise<any>, file: () => any }} opts
 * @returns {Promise<{ fileOnly: boolean, value: any }>}
 */
async function withProxyOrFile({ api, file }) {
  const running = await isProxyRunning()
  if (!running) return { fileOnly: true, value: file() }
  try {
    return { fileOnly: false, value: await api() }
  } catch (err) {
    if (!isProxyUnreachableError(err)) throw err
    return { fileOnly: true, value: file() }
  }
}

/**
 * Exit 1. An HTTP error's message is the response body and is printed as-is.
 * `err.rawStderr` prints `err.message` with no `✗` prefix (mock list).
 * Other human-mode failures use the CLI `✗` style.
 */
function failCommand(err) {
  const message = err && err.message ? String(err.message) : String(err)
  if (isApiHttpError(err) || (err && err.rawStderr) || output.isJsonMode()) console.error(message)
  else output.error(message)
  process.exit(1)
}

module.exports = {
  isApiHttpError,
  isProxyUnreachableError,
  withProxyOrFile,
  failCommand,
}
