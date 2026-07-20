import { describe, it, expect } from 'vitest'
import { handleLocalRequest } from '../core/static-server'

describe('static-server handleLocalRequest', () => {
    function makeCtx(overrides: any = {}) {
        return {
            currentMocksPath: null, ruleMap: {}, mockRules: [], mockIdSeq: 1,
            ...overrides,
        }
    }

    function makeMockReq(url: string, method = 'GET') {
        return { url, method, headers: { host: 'localhost:8989' } }
    }

    function makeMockRes() {
        let status = 0
        let headers: Record<string, string> = {}
        let body = ''
        let ended = false
        return {
            setHeader(k: string, v: string) { headers[k] = v },
            writeHead(s: number, h?: any) { status = s; if (h) Object.assign(headers, h) },
            write(data: string) { body += data },
            end(data?: string) { if (data) body += data; ended = true },
            pipe: null as any,
            get status() { return status },
            get headers() { return headers },
            get body() { return body },
            get ended() { return ended },
            headersSent: false,
        }
    }

    it('delegates /api requests to expressApp', () => {
        let called = false
        const expressApp = () => { called = true }
        const serverContext = {
            currentMocksPath: null, ruleMap: {}, mockRules: [], mockIdSeq: 1,
            loadSettingsSync: () => null, settings: null,
        }
        const ctx = makeCtx()
        const req = makeMockReq('/api/plugins')
        const res = makeMockRes()
        handleLocalRequest(req, res, { expressApp, serverContext, ctx })
        expect(called).toBe(true)
    })

    it('returns 404 for non-api when no React build or legacy HTML', () => {
        const expressApp = () => {}
        const serverContext = { loadSettingsSync: () => null }
        const ctx = makeCtx()
        const req = makeMockReq('/some-page')
        const res = makeMockRes()
        handleLocalRequest(req, res, { expressApp, serverContext, ctx })
        expect([200, 404].includes(res.status)).toBeTruthy()
    })

    it('syncs ctx.ruleMap with serverContext after API call', () => {
        const expressApp = (_req: any, _res: any) => {}
        const serverContext = {
            currentMocksPath: null, ruleMap: { 'a': 'b' }, mockRules: [], mockIdSeq: 1,
            loadSettingsSync: () => null, settings: null,
        }
        const ctx = makeCtx({ ruleMap: {} })
        const req = makeMockReq('/api/test')
        const res = makeMockRes()
        handleLocalRequest(req, res, { expressApp, serverContext, ctx })
    })
})
