'use strict'

// Single-entry env dispatch for the meddle binary.
// Pure function: no process.env / process.argv reads, no side effects.
// The binary entrypoint (bin/main.js) calls this with explicit values and then
// requires the matching module. Self-spawn children set MEDDLE_ENTRY=proxy|mcp|cli
// instead of passing a script path, so a deno-compiled binary (which has no
// index.js / mcp-server.js / bin/index.js as files on disk) can still route.

/** @typedef {'proxy' | 'mcp' | 'cli'} Entry */

const ALLOWED = ['proxy', 'mcp', 'cli']

/**
 * @param {{ env: Record<string, string | undefined>, argv: string[] }} input
 * @returns {{ entry: Entry, argv: string[] }}
 */
function dispatch({ env, argv }) {
    const raw = env && typeof env.MEDDLE_ENTRY === 'string' ? env.MEDDLE_ENTRY : ''
    const normalized = raw.trim().toLowerCase()
    let entry
    if (normalized === '') {
        entry = 'cli'
    } else if (ALLOWED.includes(normalized)) {
        entry = normalized
    } else {
        throw new Error(
            `Unknown MEDDLE_ENTRY "${raw}". Allowed values: ${ALLOWED.join(', ')} (case-insensitive). Omit to default to 'cli'.`
        )
    }
    return { entry, argv: Array.isArray(argv) ? argv.slice() : [] }
}

module.exports = { dispatch, ALLOWED }