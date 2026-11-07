import { afterEach, describe, expect, it } from 'vitest'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

/**
 * Issue #160: MCP Streamable HTTP must complete initialize, tools/list, and
 * at least one tool call. A stateless transport reused across requests 500s.
 */

const repoRoot = join(__dirname, '..')
const children: ChildProcessWithoutNullStreams[] = []
const homes: string[] = []
const PROTOCOL = '2025-03-26'
const ACCEPT = 'application/json, text/event-stream'

afterEach(async () => {
    for (const child of children.splice(0)) await stopProcess(child)
    for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
})

function makeHome(): string {
    const home = mkdtempSync(join(tmpdir(), 'meddle-mcp-http-'))
    homes.push(home)
    return home
}

async function reservePort(): Promise<number> {
    const server = createServer()
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
    const address = server.address()
    const port = typeof address === 'object' && address ? address.port : 0
    await new Promise<void>((resolve) => server.close(() => resolve()))
    return port
}

async function stopProcess(child: ChildProcessWithoutNullStreams): Promise<void> {
    if (child.exitCode !== null) return
    child.kill('SIGTERM')
    await Promise.race([once(child, 'exit'), delay(2_000)])
    if (child.exitCode === null) child.kill('SIGKILL')
}

async function startMcpHttp(home: string): Promise<{ base: string; output: string[] }> {
    const port = await reservePort()
    const child = spawn(process.execPath, [join(repoRoot, 'mcp-server.js')], {
        cwd: repoRoot,
        env: {
            ...process.env,
            MEDDLE_HOME: home,
            MEDDLE_HEADLESS: '1',
            MEDDLE_MCP_HTTP: '1',
            MEDDLE_MCP_PORT: String(port),
            MEDDLE_BIND_HOST: '127.0.0.1',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    })
    children.push(child)
    const output: string[] = []
    child.stdout.on('data', (c) => output.push(c.toString()))
    child.stderr.on('data', (c) => output.push(c.toString()))
    const base = `http://127.0.0.1:${port}`
    const deadline = Date.now() + 15_000
    while (Date.now() < deadline) {
        if (child.exitCode !== null) throw new Error(`mcp http exited early: ${output.join('')}`)
        if (output.join('').includes('MCP HTTP server listening')) return { base, output }
        await delay(50)
    }
    throw new Error(`mcp http did not start: ${output.join('')}`)
}

async function rpc(base: string, body: unknown, extraHeaders: Record<string, string> = {}) {
    const res = await fetch(base, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: ACCEPT,
            ...extraHeaders,
        },
        body: JSON.stringify(body),
    })
    const text = await res.text()
    let json: any = null
    try { json = JSON.parse(text) } catch { /* SSE or empty */ }
    return { status: res.status, text, json, headers: res.headers }
}

describe('MCP HTTP transport (issue #160)', () => {
    it('completes initialize, tools/list, and one tool call', async () => {
        const { base, output } = await startMcpHttp(makeHome())

        const init = await rpc(base, {
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: {
                protocolVersion: PROTOCOL,
                capabilities: {},
                clientInfo: { name: 'meddle-test', version: '0.0.0' },
            },
        })
        expect(init.status, `initialize ${init.status} ${init.text} log=${output.join('')}`).toBe(200)
        expect(init.json?.result?.protocolVersion).toBeTruthy()
        const session = init.headers.get('mcp-session-id')
        expect(session, 'initialize must return mcp-session-id').toBeTruthy()

        const sessionHeaders = {
            'mcp-session-id': session as string,
            'mcp-protocol-version': PROTOCOL,
        }

        const listed = await rpc(base, {
            jsonrpc: '2.0',
            id: 2,
            method: 'tools/list',
            params: {},
        }, sessionHeaders)
        expect(listed.status, `tools/list ${listed.status} ${listed.text}`).toBe(200)
        const names = (listed.json?.result?.tools || []).map((t: { name: string }) => t.name)
        expect(names).toContain('list_sessions')
        expect(names.length).toBeGreaterThan(0)

        const called = await rpc(base, {
            jsonrpc: '2.0',
            id: 3,
            method: 'tools/call',
            params: { name: 'list_sessions', arguments: {} },
        }, sessionHeaders)
        expect(called.status, `tools/call ${called.status} ${called.text}`).toBe(200)
        expect(called.json?.error).toBeUndefined()
        expect(called.json?.result?.content?.[0]?.text).toBeTruthy()
    }, 30_000)
})
