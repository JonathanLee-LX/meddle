/**
 * MEDDLE_HOME resolver — single source of truth for meddle data directory.
 *
 * Resolution order:
 *   1. MEDDLE_HOME env var (if set and non-empty)
 *   2. ~/.meddle (default, backward compatible)
 *
 * Pure JS so the CLI can require it without a build step.
 */

const os = require('os')
const path = require('path')

function resolveMeddleHome() {
    const fromEnv = (process.env.MEDDLE_HOME || '').trim()
    if (fromEnv) return path.resolve(fromEnv)
    return path.resolve(os.homedir(), '.meddle')
}

/**
 * Same rules as core/mock-handler.resolveConfiguredMocksPath: `~` expands to
 * the user home directory; a relative path is resolved against MEDDLE_HOME.
 */
function resolveConfiguredMocksPath(raw, meddleDir, homeDir = os.homedir()) {
    const v = typeof raw === 'string' ? raw.trim() : ''
    if (!v) return null
    let p = v
    if (p === '~') p = homeDir
    else if (p.startsWith('~/') || p.startsWith('~\\')) p = path.join(homeDir, p.slice(2))
    return path.resolve(meddleDir, p)
}

module.exports = { resolveMeddleHome, resolveConfiguredMocksPath }
