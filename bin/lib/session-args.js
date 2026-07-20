/**
 * --session flag resolution & MEDDLE_HOME precedence.
 *
 * Rules (per proposal §5.3):
 *   - --session <id> only     → resolve id via sessions.json, set MEDDLE_HOME
 *                                to the session's meddleHome so proxy-detect /
 *                                file-access see its data dir, and pin the
 *                                proxy port.
 *   - MEDDLE_HOME env only        → use that path directly (already handled by
 *                                resolveMeddleHome() in meddle-home.js)
 *   - both set                → error, exit
 *   - neither set             → default (~/.meddle), backward compatible
 *
 * bin/index strips --session <id> from argv and stashes the id in
 * MEDDLE_SESSION_ID. This module reads that env var so every CLI command
 * picks up the session context without individual changes.
 */

const { resolveMeddleHome } = require('./meddle-home')
const { getSession } = require('./sessions')

const GLOBAL_DEFAULT_PORT = 8989

function applySessionContext() {
    const sessionId = (process.env.MEDDLE_SESSION_ID || '').trim()
    const meddleHomeEnv = (process.env.MEDDLE_HOME || '').trim()

    if (sessionId && meddleHomeEnv) {
        console.error('error: --session and MEDDLE_HOME are mutually exclusive')
        process.exit(2)
    }

    if (sessionId) {
        const record = getSession(sessionId)
        if (!record) {
            console.error(`error: session not found: ${sessionId}`)
            process.exit(1)
        }
        // Pin MEDDLE_HOME so resolveMeddleHome() everywhere returns the session dir
        process.env.MEDDLE_HOME = record.meddleHome
        // Stash the port so proxy-detect can return it instead of reading
        // mcp-proxy-url.json (which may not exist for non-default sessions
        // that weren't started via MCP).
        process.env.MEDDLE_SESSION_PORT = String(record.port)
        return { sessionId, port: record.port, meddleHome: record.meddleHome }
    }

    return { sessionId: null, port: null, meddleHome: resolveMeddleHome() }
}

module.exports = {
    applySessionContext,
    GLOBAL_DEFAULT_PORT,
}
