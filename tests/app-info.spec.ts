import { describe, it, expect, vi, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { formatDisplayDir, registerAppInfoRoutes, readAppInfoFromPackageJson, resolveAppInfo } from '../server/app-info'
import { resolveMeddleHome } from '../core/meddle-home'

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

describe('GET /api/version route-rules directory (#139)', () => {
    afterEach(() => {
        vi.unstubAllEnvs()
    })

    function getVersionPayload(meddleDir: string) {
        const handlers = captureGet({ appInfo: { name: rootPkg.name, version: rootPkg.version }, meddleDir })
        const res = { json: vi.fn() }
        handlers['/api/version']({}, res)
        return res.json.mock.calls[0][0]
    }

    it('reports ~/.meddle/route-rules/ when MEDDLE_HOME is not set', () => {
        vi.stubEnv('MEDDLE_HOME', '')
        const payload = getVersionPayload(resolveMeddleHome())
        expect(payload).toMatchObject({ name: rootPkg.name, version: rootPkg.version })
        expect(payload.routeRulesDir).toBe(path.join(os.homedir(), '.meddle', 'route-rules'))
        expect(payload.routeRulesDirDisplay).toBe(`~${path.sep}.meddle${path.sep}route-rules${path.sep}`)
    })

    it('reports the actual $MEDDLE_HOME/route-rules/ when MEDDLE_HOME is set', () => {
        const home = fs.mkdtempSync(path.join(os.tmpdir(), 'meddle-home-139-'))
        try {
            vi.stubEnv('MEDDLE_HOME', home)
            const payload = getVersionPayload(resolveMeddleHome())
            const expected = path.join(path.resolve(home), 'route-rules')
            expect(payload.routeRulesDir).toBe(expected)
            expect(payload.routeRulesDirDisplay).toBe(formatDisplayDir(expected))
            expect(payload.routeRulesDirDisplay).toContain(`${path.sep}route-rules${path.sep}`)
            expect(payload.routeRulesDirDisplay).not.toContain('.meddle')
        } finally {
            fs.rmSync(home, { recursive: true, force: true })
        }
    })

    it('omits the directory fields when the server has no meddleDir', () => {
        const handlers = captureGet({ appInfo: { name: 'x', version: '1.2.3' } })
        const res = { json: vi.fn() }
        handlers['/api/version']({}, res)
        expect(res.json).toHaveBeenCalledWith({ name: 'x', version: '1.2.3' })
    })
})

describe('formatDisplayDir (#139)', () => {
    const home = path.resolve('/home/alice')

    it('uses ~ for paths under the home directory and adds a trailing separator', () => {
        expect(formatDisplayDir(path.join(home, '.meddle', 'route-rules'), home)).toBe(`~${path.sep}.meddle${path.sep}route-rules${path.sep}`)
    })

    it('keeps absolute paths outside the home directory', () => {
        const dir = path.resolve('/srv/meddle-data/route-rules')
        expect(formatDisplayDir(dir, home)).toBe(dir + path.sep)
    })

    it('does not treat a sibling with the same prefix as the home directory', () => {
        const dir = path.resolve('/home/alice2/route-rules')
        expect(formatDisplayDir(dir, home)).toBe(dir + path.sep)
    })
})
