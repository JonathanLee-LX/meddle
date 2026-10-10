import { describe, it, expect, vi } from 'vitest'
import * as path from 'path'
import { registerAppInfoRoutes, readAppInfoFromPackageJson, resolveAppInfo } from '../server/app-info'

// eslint-disable-next-line @typescript-eslint/no-var-requires
const rootPkg = require('../package.json')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const webPkg = require('../web/package.json')

function captureGet(ctx: any) {
    const handlers: Record<string, (req: any, res: any) => void> = {}
    const app = { get: vi.fn((route: string, handler: any) => { handlers[route] = handler }) } as any
    registerAppInfoRoutes(app, ctx)
    return handlers
}

describe('app info / version (#112)', () => {
    it('reads the Meddle version from the root package.json, not web/package.json', () => {
        const info = readAppInfoFromPackageJson(path.join(__dirname, '..', 'server'))
        expect(info).toEqual({ name: rootPkg.name, version: rootPkg.version })
        expect(info?.version).not.toBe(webPkg.version)
    })

    it('finds the root package.json from a nested (compiled) directory', () => {
        const info = readAppInfoFromPackageJson(path.join(__dirname, '..', 'dist', 'server'))
        expect(info?.version).toBe(rootPkg.version)
    })

    it('prefers the version passed in by index.js through ctx.appInfo', () => {
        expect(resolveAppInfo({ appInfo: { name: 'x', version: '9.9.9-test' } })).toEqual({ name: 'x', version: '9.9.9-test' })
        expect(resolveAppInfo({}).version).toBe(rootPkg.version)
    })

    it('GET /api/version returns the package.json version', () => {
        const handlers = captureGet({ appInfo: { name: rootPkg.name, version: rootPkg.version } })
        const res = { json: vi.fn() }
        handlers['/api/version']({}, res)
        expect(res.json).toHaveBeenCalledWith({ name: rootPkg.name, version: rootPkg.version })
        expect(rootPkg.version).not.toBe('1.0.0')
    })
})
