/**
 * MEDDLE_HOME resolver — single source of truth for meddle data directory.
 *
 * Resolution order:
 *   1. MEDDLE_HOME env var (if set and non-empty)
 *   2. ~/.meddle (default, backward compatible)
 *
 * Kept in sync with bin/lib/meddle-home.js. The JS copy exists so the CLI
 * can resolve MEDDLE_HOME without a build step; this TS copy is for the
 * compiled server code. The logic is intentionally two lines.
 */

import * as os from 'os'
import * as path from 'path'

export function resolveMeddleHome(): string {
    const fromEnv = (process.env.MEDDLE_HOME || '').trim()
    if (fromEnv) return path.resolve(fromEnv)
    return path.resolve(os.homedir(), '.meddle')
}
