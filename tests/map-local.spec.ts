import path from 'path'
import fs from 'fs'
import os from 'os'
import { EventEmitter } from 'events'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getMimeType, handleMapLocalRequest } from '../core/map-local'

describe('map-local getMimeType', () => {
    it('returns correct MIME for common extensions', () => {
        expect(getMimeType('file.html')).toBe('text/html')
        expect(getMimeType('file.css')).toBe('text/css')
        expect(getMimeType('file.js')).toBe('application/javascript')
        expect(getMimeType('file.json')).toBe('application/json')
        expect(getMimeType('file.png')).toBe('image/png')
        expect(getMimeType('file.jpg')).toBe('image/jpeg')
        expect(getMimeType('file.svg')).toBe('image/svg+xml')
        expect(getMimeType('file.woff2')).toBe('font/woff2')
        expect(getMimeType('file.mp4')).toBe('video/mp4')
        expect(getMimeType('file.wasm')).toBe('application/wasm')
    })

    it('returns application/octet-stream for unknown extensions', () => {
        expect(getMimeType('file.xyz')).toBe('application/octet-stream')
        expect(getMimeType('file')).toBe('application/octet-stream')
    })

    it('is case-insensitive for extensions', () => {
        expect(getMimeType('FILE.HTML')).toBe('text/html')
        expect(getMimeType('style.CSS')).toBe('text/css')
    })

    it('handles dotfiles and multiple dots', () => {
        expect(getMimeType('.gitignore')).toBe('application/octet-stream')
        expect(getMimeType('app.min.js')).toBe('application/javascript')
        expect(getMimeType('archive.tar.gz')).toBe('application/gzip')
    })
})

describe('map-local handleMapLocalRequest', () => {
    let tmpDir: string
    let tmpFile: string

    beforeAll(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meddle-test-'))
        tmpFile = path.join(tmpDir, 'test.json')
        fs.writeFileSync(tmpFile, '{"hello":"world"}', 'utf8')
    })

    afterAll(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true })
    })

    function makeCtx() {
        return {
            meddleDir: tmpDir, certDir: tmpDir, settingsPath: '', AUTO_OPEN: false,
            REFACTOR_CONFIG: {}, INITIAL_PLUGIN_MODE: 'off', MAX_RECORD_SIZE: 100,
            MAX_DETAIL_SIZE: 50, MAX_BODY_SIZE: 1024 * 1024,
            SHADOW_WARN_MIN_SAMPLES: 10, SHADOW_WARN_DIFF_RATE: 0.5,
            PLUGIN_ON_HOSTS: new Set(), ENABLE_BUILTIN_ROUTER_PLUGIN: false,
            ENABLE_BUILTIN_LOGGER_PLUGIN: false, ENABLE_BUILTIN_MOCK_PLUGIN: false,
            pluginManager: {}, hookDispatcher: {}, requestPipeline: { mode: 'off' },
            builtinLoggerPlugin: {}, shadowCompareTracker: {}, onModeGate: {}, pipelineGate: {},
            ruleMap: {}, currentMocksPath: null, mockRules: [], mockIdSeq: 1,
            proxyRecordArr: [] as any[], recordIdSeq: 0,
            proxyRecordDetailMap: new Map(), httpsServerMap: new Map(),
            localWSServer: null,
        }
    }

    function makeMockReq(method = 'GET') {
        const req = new EventEmitter()
        req.method = method
        req.headers = {}
        req.resume = () => {}
        return req
    }

    function makeMockRes() {
        const chunks: any[] = []
        let headStatus = 0
        let headHeaders = {}
        let ended = false
        return {
            writeHead(status: number, headers?: any) { headStatus = status; headHeaders = headers || {} },
            end(data?: any) { if (data) chunks.push(data); ended = true },
            write(data: any) { chunks.push(data) },
            get status() { return headStatus },
            get headers() { return headHeaders },
            get body() { return Buffer.concat(chunks.map(c => Buffer.isBuffer(c) ? c : Buffer.from(c))).toString('utf8') },
            get ended() { return ended },
        }
    }

    it('serves an existing file with correct MIME type', () => {
        const ctx = makeCtx()
        const req = makeMockReq()
        const res = makeMockRes()
        handleMapLocalRequest(ctx, req, res, 'https://example.com/data', 'file://' + tmpFile)
        expect(res.status).toBe(200)
        expect(res.body.includes('"hello"')).toBeTruthy()
        expect(ctx.proxyRecordArr.length).toBe(1)
        expect(ctx.proxyRecordArr[0].statusCode).toBe(200)
        expect(ctx.proxyRecordArr[0].mapLocal).toBe(true)
    })

    it('returns 404 for non-existent file', () => {
        const ctx = makeCtx()
        const req = makeMockReq()
        const res = makeMockRes()
        handleMapLocalRequest(ctx, req, res, 'https://example.com/missing', 'file:///nonexistent/file.txt')
        expect(res.status).toBe(404)
        expect(res.body.includes('File not found')).toBeTruthy()
    })

    it('returns 403 for directory', () => {
        const ctx = makeCtx()
        const req = makeMockReq()
        const res = makeMockRes()
        handleMapLocalRequest(ctx, req, res, 'https://example.com/dir', 'file://' + tmpDir)
        expect(res.status).toBe(403)
        expect(res.body.includes('Is a directory')).toBeTruthy()
    })

    it('increments recordIdSeq on each request', () => {
        const ctx = makeCtx()
        handleMapLocalRequest(ctx, makeMockReq(), makeMockRes(), 'url1', 'file://' + tmpFile)
        handleMapLocalRequest(ctx, makeMockReq(), makeMockRes(), 'url2', 'file://' + tmpFile)
        expect(ctx.proxyRecordArr.length).toBe(2)
        expect(ctx.proxyRecordArr[0].id).not.toBe(ctx.proxyRecordArr[1].id)
    })
})
