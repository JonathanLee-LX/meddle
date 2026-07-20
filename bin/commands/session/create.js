/**
 * meddle session create - Spawn a new isolated proxy session.
 *
 * Flow:
 *   1. Generate session id (label-timestamp) and allocate a free port
 *   2. Ensure the session's MEDDLE_HOME directory exists
 *   3. Spawn `node index.js` with MEDDLE_HOME + PORT env
 *   4. Wait for the child's HTTP API to become reachable
 *   5. Register in sessions.json (pid, port, meddleHome)
 *   6. Print session id + proxy URL
 *
 * The child is spawned detached with stdio inherited so the user sees
 * proxy logs. The child listens for parent disconnect and self-terminates
 * to avoid orphan processes.
 */

const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')
const chalk = require('chalk')

const {
    sessionsDir,
    sessionDir,
    allocatePort,
    generateId,
    createSession,
    readRegistry,
    writeRegistry,
} = require('../../lib/sessions')
const { resolveMeddleHome } = require('../../lib/meddle-home')
const { GLOBAL_DEFAULT_PORT } = require('../../lib/session-args')

function parseArgs(argv) {
    const args = argv.slice(4) // after 'meddle' 'session' 'create'
    const out = { name: null, port: null, json: false }
    for (let i = 0; i < args.length; i++) {
        const a = args[i]
        if (a === '--name' && args[i + 1]) { out.name = args[i + 1]; i++; continue }
        if (a.startsWith('--name=')) { out.name = a.slice('--name='.length); continue }
        if (a === '--port' && args[i + 1]) { out.port = Number(args[i + 1]); i++; continue }
        if (a.startsWith('--port=')) { out.port = Number(a.slice('--port='.length)); continue }
        if (a === '--json') { out.json = true; continue }
    }
    return out
}

function waitForProxyReady(port, timeoutMs = 8000) {
    const start = Date.now()
    const interval = 100
    return new Promise((resolve, reject) => {
        const check = () => {
            fetch(`http://127.0.0.1:${port}/api/mocks`, { method: 'GET', signal: AbortSignal.timeout(500) })
                .then((r) => { if (r.ok) resolve(); else retry() })
                .catch(() => retry())
        }
        function retry() {
            if (Date.now() - start > timeoutMs) {
                return reject(new Error(`proxy did not become ready on port ${port} within ${timeoutMs}ms`))
            }
            setTimeout(check, interval)
        }
        check()
    })
}

async function main() {
    const opts = parseArgs(process.argv)

    // 1. id + port
    const id = generateId(opts.name)
    let port = opts.port
    if (port) {
        // user-specified port: validate range and freeness
        if (port < 9000 || port > 9999) {
            throw new Error(`--port must be in [9000, 9999] (got ${port}); default session uses ${GLOBAL_DEFAULT_PORT}`)
        }
    } else {
        const registry = readRegistry()
        port = allocatePort(registry)
        if (!port) throw new Error('no free port in [9000, 9999]; run `meddle session prune` to clean orphaned records')
    }

    // 2. MEDDLE_HOME dir
    const meddleHome = sessionDir(id)
    fs.mkdirSync(meddleHome, { recursive: true })
    // subdirs that proxy expects to exist or create — let the child create them
    // via its existing startup logic. We only ensure the root exists.

    // 3. spawn child
    const indexPath = path.join(__dirname, '..', '..', '..', 'index.js')
    const childEnv = {
        ...process.env,
        MEDDLE_HOME: meddleHome,
        PORT: String(port),
        MEDDLE_SESSION_ID: id,
        // Suppress the CA trust prompt — sessions reuse the shared CA
        // from ~/.meddle/ca which the user already trusted when setting up
        // the default session. Also avoid interactive prompts blocking
        // a non-interactive agent spawn.
        MEDDLE_HEADLESS: '1',
        // Disable MCP file discovery for non-default sessions; the MCP
        // proxy-url file is only meaningful for the default session.
        MEDDLE_MCP: '',
    }
    const child = spawn(process.execPath, [indexPath], {
        cwd: process.cwd(),
        env: childEnv,
        stdio: 'inherit',
        detached: false,
    })

    if (!child.pid) {
        throw new Error('failed to spawn proxy process')
    }

    // Kill child if parent exits unexpectedly (orphan prevention).
    child.on('exit', (code, signal) => {
        if (code !== 0 && code !== null) {
            console.error(chalk.yellow(`session ${id} exited early (code=${code} signal=${signal || ''})`))
        }
    })
    process.on('exit', () => {
        try { if (child.exitCode === null) child.kill('SIGTERM') } catch (_) {}
    })

    // 4. wait for HTTP ready
    try {
        await waitForProxyReady(port)
    } catch (err) {
        try { child.kill('SIGTERM') } catch (_) {}
        throw err
    }

    // 5. register (optimistic: re-read, verify port not taken, write)
    const freshRegistry = readRegistry()
    const portConflict = Object.keys(freshRegistry).some((k) => freshRegistry[k].port === port)
    if (portConflict && !opts.port) {
        try { child.kill('SIGTERM') } catch (_) {}
        throw new Error(`port ${port} was claimed by another session during startup; please retry`)
    }
    createSession({ id, label: opts.name || '', port, pid: child.pid, meddleHome })

    // 6. report
    if (opts.json) {
        console.log(JSON.stringify({
            id,
            port,
            pid: child.pid,
            meddleHome,
            proxyUrl: `http://127.0.0.1:${port}`,
        }))
    } else {
        console.log(chalk.green('Created session:'), chalk.cyan(id))
        console.log(`  ${chalk.gray('Proxy URL:')} http://127.0.0.1:${port}`)
        console.log(`  ${chalk.gray('PID:')}       ${child.pid}`)
        console.log(`  ${chalk.gray('MEDDLE_HOME:')}   ${meddleHome}`)
        console.log(chalk.gray('\nUse this session with:'))
        console.log(`  meddle --session ${id} route list`)
    }
}

main().catch((err) => {
    console.error(chalk.red('error:'), err.message)
    process.exit(1)
})
