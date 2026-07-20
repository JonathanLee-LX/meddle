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

module.exports = { resolveMeddleHome }
