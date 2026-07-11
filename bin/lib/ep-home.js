/**
 * EP_HOME resolver — single source of truth for easy-proxy data directory.
 *
 * Resolution order:
 *   1. EP_HOME env var (if set and non-empty)
 *   2. ~/.ep (default, backward compatible)
 *
 * Pure JS so the CLI can require it without a build step.
 */

const os = require('os')
const path = require('path')

function resolveEpHome() {
    const fromEnv = (process.env.EP_HOME || '').trim()
    if (fromEnv) return path.resolve(fromEnv)
    return path.resolve(os.homedir(), '.ep')
}

module.exports = { resolveEpHome }
