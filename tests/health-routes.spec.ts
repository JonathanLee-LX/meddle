import express from 'express'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AddressInfo } from 'node:net'
import { registerHealthRoutes } from '../server/health'
import type { ServerContext } from '../server/index'

const servers: import('node:http').Server[] = []

afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
        if (server.listening) server.close(() => resolve())
        else resolve()
    })))
})

async function listen(app: express.Express): Promise<number> {
    const server = app.listen(0, '127.0.0.1')
    servers.push(server)
    await new Promise<void>((resolve) => server.once('listening', () => resolve()))
    return (server.address() as AddressInfo).port
}

describe('health routes /api/ping (#105)', () => {
    it('returns 204 and does not call getRuntimeHealth (no sampling side effects)', async () => {
        const getRuntimeHealth = vi.fn(() => {
            throw new Error('getRuntimeHealth must not be called by /api/ping')
        })
        const app = express()
        registerHealthRoutes(app, { getRuntimeHealth } as unknown as ServerContext)

        const port = await listen(app)
        const response = await fetch(`http://127.0.0.1:${port}/api/ping`, { method: 'GET' })

        expect(response.status).toBe(204)
        expect(await response.text()).toBe('')
        expect(getRuntimeHealth).not.toHaveBeenCalled()
    })

    it('keeps /api/health calling getRuntimeHealth (unchanged semantics)', async () => {
        const snapshot = { status: 'ok', pid: 1 }
        const getRuntimeHealth = vi.fn(() => snapshot)
        const app = express()
        registerHealthRoutes(app, { getRuntimeHealth } as unknown as ServerContext)

        const port = await listen(app)
        const response = await fetch(`http://127.0.0.1:${port}/api/health`)

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual(snapshot)
        expect(getRuntimeHealth).toHaveBeenCalledTimes(1)
    })
})
