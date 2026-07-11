/**
 * --session flag resolution & EP_HOME precedence.
 *
 * Rules (per proposal §5.3):
 *   - --session <id> only     → resolve id via sessions.json, set EP_HOME
 *                                to the session's epHome so proxy-detect /
 *                                file-access see its data dir, and pin the
 *                                proxy port.
 *   - EP_HOME env only        → use that path directly (already handled by
 *                                resolveEpHome() in ep-home.js)
 *   - both set                → error, exit
 *   - neither set             → default (~/.ep), backward compatible
 *
 * bin/index strips --session <id> from argv and stashes the id in
 * EP_SESSION_ID. This module reads that env var so every CLI command
 * picks up the session context without individual changes.
 */

const { resolveEpHome } = require('./ep-home')
const { getSession } = require('./sessions')

const GLOBAL_DEFAULT_PORT = 8989

function applySessionContext() {
    const sessionId = (process.env.EP_SESSION_ID || '').trim()
    const epHomeEnv = (process.env.EP_HOME || '').trim()

    if (sessionId && epHomeEnv) {
        console.error('error: --session and EP_HOME are mutually exclusive')
        process.exit(2)
    }

    if (sessionId) {
        const record = getSession(sessionId)
        if (!record) {
            console.error(`error: session not found: ${sessionId}`)
            process.exit(1)
        }
        // Pin EP_HOME so resolveEpHome() everywhere returns the session dir
        process.env.EP_HOME = record.epHome
        // Stash the port so proxy-detect can return it instead of reading
        // mcp-proxy-url.json (which may not exist for non-default sessions
        // that weren't started via MCP).
        process.env.EP_SESSION_PORT = String(record.port)
        return { sessionId, port: record.port, epHome: record.epHome }
    }

    return { sessionId: null, port: null, epHome: resolveEpHome() }
}

module.exports = {
    applySessionContext,
    GLOBAL_DEFAULT_PORT,
}
