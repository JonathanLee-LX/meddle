/**
 * Session registry — tracks all non-default proxy sessions.
 *
 * Storage: ~/.ep/sessions.json
 *
 * Concurrency: atomic writes (tmp + rename) + optimistic-lock retry on
 * port allocation. No file locking (cross-platform complexity not
 * justified for the low-frequency create path).
 *
 * NOTE: the CA directory (~/.ep/ca) is intentionally NOT registered —
 * all sessions share it. Only config (route-rules, mocks, plugins, …)
 * is isolated per session via EP_HOME.
 */

const fs = require('fs')
const path = require('path')
const { resolveEpHome } = require('./ep-home')

const MAX_SESSIONS = 32
const PORT_RANGE_START = 9000
const PORT_RANGE_END = 9999

function registryPath() {
    return path.join(resolveEpHome(), 'sessions.json')
}

function sessionsDir() {
    return path.join(resolveEpHome(), 'sessions')
}

function sessionDir(id) {
    return path.join(sessionsDir(), id)
}

/**
 * Read the registry. Returns {} if missing or corrupt.
 */
function readRegistry() {
    try {
        const raw = fs.readFileSync(registryPath(), 'utf8')
        const parsed = JSON.parse(raw)
        return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {}
    } catch (_) {
        return {}
    }
}

/**
 * Atomically write the registry (tmp file + rename).
 */
function writeRegistry(registry) {
    const file = registryPath()
    const dir = path.dirname(file)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    const tmp = file + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(registry, null, 2), 'utf8')
    fs.renameSync(tmp, file)
}

/**
 * Check whether a TCP port is currently free on 127.0.0.1.
 */
function isPortFree(port) {
    try {
        const net = require('net')
        const server = net.createServer()
        server.listen(port, '127.0.0.1')
        // sync check: if listen throws synchronously we catch below
        server.close()
        return true
    } catch (_) {
        return false
    }
}

/**
 * Allocate a free port in [PORT_RANGE_START, PORT_RANGE_END], avoiding
 * ports already recorded in the registry. Returns null if exhausted.
 *
 * Uses optimistic locking: caller should re-verify the port is still
 * free in the registry before committing.
 */
function allocatePort(registry) {
    const usedPorts = new Set()
    for (const id of Object.keys(registry)) {
        if (registry[id] && typeof registry[id].port === 'number') {
            usedPorts.add(registry[id].port)
        }
    }
    for (let port = PORT_RANGE_START; port <= PORT_RANGE_END; port++) {
        if (usedPorts.has(port)) continue
        if (!isPortFree(port)) continue
        return port
    }
    return null
}

/**
 * Generate a session ID: `{label}-{timestamp}`.
 */
function generateId(label) {
    const safe = String(label || 'session').trim().replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 32) || 'session'
    return `${safe}-${Date.now()}`
}

/**
 * Check if a process is alive. pid 0 / negative → false.
 */
function isPidAlive(pid) {
    if (!pid || typeof pid !== 'number' || pid <= 0) return false
    try {
        process.kill(pid, 0)
        return true
    } catch (err) {
        // ESRCH: no such process — definitely not alive
        if (err.code === 'ESRCH') return false
        // EPERM: exists but we don't have permission to signal — alive
        if (err.code === 'EPERM') return true
        // Unexpected error — assume alive to be safe (don't prune on fluke)
        return true
    }
}

/**
 * Create a new session record. Returns the new record (with id, port,
 * pid, epHome, createdAt, label) or throws on conflict / limit.
 *
 * `pid` should be the spawned child's pid; caller spawns first, then
 * calls this to register.
 */
function createSession({ id, label, port, pid, epHome }) {
    const registry = readRegistry()
    const ids = Object.keys(registry)
    if (ids.length >= MAX_SESSIONS) {
        throw new Error(`session limit reached (${MAX_SESSIONS}); run 'ep session prune' to clean orphaned records`)
    }
    if (registry[id]) {
        throw new Error(`session already exists: ${id}`)
    }
    const record = {
        port,
        pid,
        epHome,
        createdAt: new Date().toISOString(),
        label: label || '',
    }
    registry[id] = record
    writeRegistry(registry)
    return { id, ...record }
}

function getSession(id) {
    const registry = readRegistry()
    return registry[id] ? { id, ...registry[id] } : null
}

function listSessions() {
    const registry = readRegistry()
    return Object.keys(registry).map((id) => ({
        id,
        ...registry[id],
        alive: isPidAlive(registry[id].pid),
    }))
}

/**
 * Remove a session from the registry. Does NOT kill the process or
 * delete the EP_HOME directory — caller handles those.
 */
function deleteSession(id) {
    const registry = readRegistry()
    if (!registry[id]) return null
    const record = { id, ...registry[id] }
    delete registry[id]
    writeRegistry(registry)
    return record
}

/**
 * Remove all sessions whose pid is no longer alive. Returns the
 * removed records. Does NOT delete their EP_HOME directories.
 */
function pruneOrphaned() {
    const registry = readRegistry()
    const removed = []
    for (const id of Object.keys(registry)) {
        if (!isPidAlive(registry[id].pid)) {
            removed.push({ id, ...registry[id] })
            delete registry[id]
        }
    }
    if (removed.length > 0) writeRegistry(registry)
    return removed
}

module.exports = {
    MAX_SESSIONS,
    PORT_RANGE_START,
    PORT_RANGE_END,
    registryPath,
    sessionsDir,
    sessionDir,
    readRegistry,
    writeRegistry,
    allocatePort,
    generateId,
    isPidAlive,
    createSession,
    getSession,
    listSessions,
    deleteSession,
    pruneOrphaned,
}
