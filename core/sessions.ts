/**
 * Read-only session registry access for the server (TS side).
 *
 * Mirrors the read paths of bin/lib/sessions.js. Write paths (create /
 * delete / prune) stay CLI-only — the server never mutates the registry.
 * Kept in sync with bin/lib/sessions.js per the same convention as
 * core/meddle-home.ts ↔ bin/lib/meddle-home.js.
 */

import * as fs from 'fs'
import * as path from 'path'
import { resolveMeddleHome } from './meddle-home'

export interface SessionInfo {
    id: string
    port: number
    pid: number
    meddleHome: string
    createdAt: string
    label: string
    alive: boolean
}

function registryPath(): string {
    return path.join(resolveMeddleHome(), 'sessions.json')
}

function isPidAlive(pid: number): boolean {
    if (!pid || typeof pid !== 'number' || pid <= 0) return false
    try {
        process.kill(pid, 0)
        return true
    } catch (err) {
        const code = (err as NodeJS.ErrnoException).code
        // ESRCH: no such process — definitely not alive
        if (code === 'ESRCH') return false
        // EPERM: exists but we don't have permission to signal — alive
        if (code === 'EPERM') return true
        // Unexpected error — assume alive to be safe
        return true
    }
}

interface RawSessionRecord {
    port: number
    pid: number
    meddleHome: string
    createdAt: string
    label: string
}

export function listSessions(): SessionInfo[] {
    let registry: Record<string, RawSessionRecord>
    try {
        const raw = fs.readFileSync(registryPath(), 'utf8')
        const parsed = JSON.parse(raw)
        registry = (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {}
    } catch (_) {
        registry = {}
    }
    return Object.keys(registry).map((id) => {
        const r = registry[id]
        return {
            id,
            port: r.port,
            pid: r.pid,
            meddleHome: r.meddleHome,
            createdAt: r.createdAt,
            label: r.label || '',
            alive: isPidAlive(r.pid),
        }
    })
}
