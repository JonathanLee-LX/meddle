'use strict'

const path = require('path')

// Pure constructor for the meddle self-spawn contract, parameterised by runtime
// context (binary vs node). All six prod self-spawn sites (mcp-server x2, supervise
// x2, session/create, start) build their { args, options } through this so the
// contract lives in ONE place.
//
// Reentry model:
//   binary (deno compile): process.execPath IS meddle, reads MEDDLE_ENTRY, dispatches.
//     -> reentryArgv = []  (no script path)
//   npm/node: process.execPath is plain `node`, needs a script path to bin/main.js,
//     which then dispatches via MEDDLE_ENTRY.
//     -> reentryArgv = [absPathToBinMainJs]
// Callers pass reentryArgv explicitly via getReentryArgv() so buildProxySpawn stays
// pure (no process reads) and unit-testable with injected reentryArgv.

let reentryOverride = null // test hook; undefined = detect from process

function getReentryArgv() {
    if (reentryOverride !== null) return reentryOverride.slice()
    // The deno-compiled meddle binary's execPath does NOT look like node, and it
    // dispatches via MEDDLE_ENTRY itself, so no script path is needed. Plain `node`
    // needs bin/main.js to re-enter the dispatcher.
    const exe = (process.execPath || '').toLowerCase()
    const looksLikeNode = /(^|[\\\/])node(\.exe)?$/i.test(exe) || /[\\\/]node-[0-9]/i.test(exe)
    if (!looksLikeNode) return [] // the meddle binary
    // node: re-enter via bin/main.js (this file's neighbour).
    return [path.join(__dirname, '..', 'main.js')]
}

function buildSpawn({ baseEnv, extraEnv, extraArgv, entry, reentryArgv } = {}) {
    const env = Object.assign({}, baseEnv || {}, extraEnv || {}, { MEDDLE_ENTRY: entry })
    const reentry = Array.isArray(reentryArgv) ? reentryArgv : [] // default = binary form
    const args = reentry.concat(Array.isArray(extraArgv) ? extraArgv : [])
    return { args, options: { env, stdio: 'inherit' } }
}

function buildProxySpawn(opts = {}) {
    return buildSpawn({ ...(opts || {}), entry: 'proxy' })
}

function buildCliSpawn(opts = {}) {
    return buildSpawn({ ...(opts || {}), entry: 'cli' })
}

// Test-only hook; do not call from prod code.
function __setReentryOverrideForTest(v) { reentryOverride = v === undefined ? null : v }

module.exports = { buildProxySpawn, buildCliSpawn, getReentryArgv, __setReentryOverrideForTest }