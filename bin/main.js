#!/usr/bin/env node
'use strict'

// Single injectable entrypoint for the meddle binary.
// - deno compile target: `deno compile bin/main.js` injects this; routing is via
//   MEDDLE_ENTRY (proxy|mcp|cli) since the compiled binary has no index.js /
//   mcp-server.js / bin/index.js as files on disk.
// - node/npm path: `meddle` still resolves to bin/index.js (see package.json "bin");
//   this file is only required when MEDDLE_ENTRY is set (self-spawn children) or
//   when invoked explicitly (e.g. `node bin/main.js`).
//
// Existing entry files (bin/index.js, index.js, mcp-server.js) are left runnable
// directly under node — npm path has zero regression.

const { dispatch } = require('./lib/dispatch')

const { entry, argv } = dispatch({ env: process.env, argv: process.argv.slice(2) })

if (entry === 'proxy') {
    // Proxy server. process.argv must look like `node index.js [opts]` for index.js
    // semantics (it reads process.argv via helpers like getFreePort etc.), so we
    // splice argv into process.argv. index.js itself ignores argv for routing but
    // MEDDLE_* env is the real config channel, so argv here is informational.
    process.argv = [process.argv[0], 'index.js', ...argv]
    require('../index.js')
} else if (entry === 'mcp') {
    process.argv = [process.argv[0], 'mcp-server.js', ...argv]
    require('../mcp-server.js')
} else {
    // cli: bin/index.js expects argv = process.argv.slice(2) (the user command +
    // flags), and strips --session itself. Forward verbatim.
    process.argv = [process.argv[0], 'bin/index.js', ...argv]
    require('./index.js')
}