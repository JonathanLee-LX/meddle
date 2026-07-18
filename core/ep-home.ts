/**
 * EP_HOME resolver — single source of truth for easy-proxy data directory.
 *
 * Resolution order:
 *   1. EP_HOME env var (if set and non-empty)
 *   2. ~/.ep (default, backward compatible)
 *
 * Kept in sync with bin/lib/ep-home.js. The JS copy exists so the CLI
 * can resolve EP_HOME without a build step; this TS copy is for the
 * compiled server code. The logic is intentionally two lines.
 */

import * as os from 'os'
import * as path from 'path'

export function resolveEpHome(): string {
    const fromEnv = (process.env.EP_HOME || '').trim()
    if (fromEnv) return path.resolve(fromEnv)
    return path.resolve(os.homedir(), '.ep')
}
