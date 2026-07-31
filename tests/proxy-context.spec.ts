import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { createProxyContext, createDetailBodyLimitResolver } from '../core/proxy-context'

describe('proxy-context createProxyContext', () => {
    it('returns an object with required path properties', () => {
        const ctx = createProxyContext()
        expect(ctx.meddleDir).toBeTruthy()
        expect(ctx.certDir).toBeTruthy()
        expect(ctx.settingsPath).toBeTruthy()
        expect(ctx.meddleDir.endsWith('.meddle')).toBeTruthy()
        expect(ctx.certDir.includes('ca')).toBeTruthy()
        expect(ctx.settingsPath.includes('settings.json')).toBeTruthy()
    })

    it('returns an object with numeric constants', () => {
        const ctx = createProxyContext()
        expect(typeof ctx.MAX_RECORD_SIZE).toBe('number')
        expect(typeof ctx.MAX_DETAIL_SIZE).toBe('number')
        expect(typeof ctx.MAX_BODY_SIZE).toBe('number')
        expect(typeof ctx.MAX_DETAIL_BODY_SIZE).toBe('number')
        expect(ctx.MAX_RECORD_SIZE > 0).toBeTruthy()
        expect(ctx.MAX_DETAIL_SIZE > 0).toBeTruthy()
        expect(ctx.MAX_BODY_SIZE > 0).toBeTruthy()
        expect(ctx.MAX_DETAIL_BODY_SIZE > 0).toBeTruthy()
    })

    it('exposes a detail-body-size resolver function', () => {
        const ctx = createProxyContext()
        expect(typeof ctx.resolveDetailBodySizeBytes).toBe('function')
        expect(typeof ctx.resolveDetailBodySizeBytes()).toBe('number')
        expect(ctx.resolveDetailBodySizeBytes()).toBeGreaterThan(0)
    })

    it('returns an object with runtime references', () => {
        const ctx = createProxyContext()
        expect(ctx.pluginManager).toBeTruthy()
        expect(ctx.hookDispatcher).toBeTruthy()
        expect(ctx.requestPipeline).toBeTruthy()
        expect(ctx.builtinLoggerPlugin).toBeTruthy()
        expect(ctx.shadowCompareTracker).toBeTruthy()
        expect(ctx.onModeGate).toBeTruthy()
        expect(ctx.pipelineGate).toBeTruthy()
    })

    it('initializes mutable state with defaults', () => {
        const ctx = createProxyContext()
        expect(ctx.ruleMap).toEqual({})
        expect(ctx.currentMocksPath).toBe(null)
        expect(ctx.mockRules).toEqual([])
        expect(ctx.mockIdSeq).toBe(1)
        expect(ctx.proxyRecordArr).toEqual([])
        expect(ctx.recordIdSeq).toBe(0)
        expect(ctx.proxyRecordDetailMap.size).toBe(0)
        expect(ctx.httpsServerMap.size).toBe(0)
        expect(ctx.localWSServer).toBe(null)
    })

    it('has INITIAL_PLUGIN_MODE as one of the valid modes', () => {
        const ctx = createProxyContext()
        expect(['off', 'shadow', 'on'].includes(ctx.INITIAL_PLUGIN_MODE)).toBeTruthy()
    })

    it('requestPipeline has mode and setMode', () => {
        const ctx = createProxyContext()
        expect('mode' in ctx.requestPipeline).toBeTruthy()
        expect(typeof ctx.requestPipeline.setMode).toBe('function')
    })

    it('returns distinct objects on separate calls', () => {
        const ctx1 = createProxyContext()
        const ctx2 = createProxyContext()
        expect(ctx1.proxyRecordArr).not.toBe(ctx2.proxyRecordArr)
        expect(ctx1.proxyRecordDetailMap).not.toBe(ctx2.proxyRecordDetailMap)
    })
})

describe('proxy-context createDetailBodyLimitResolver fallback chain', () => {
    let tmpRoot: string

    beforeAll(() => {
        tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'meddle-resolver-'))
        // Layout mirroring the real session layout:
        //   <tmpRoot>/settings.json                 (default session)
        //   <tmpRoot>/sessions/<id>/settings.json   (a non-default session)
        fs.mkdirSync(path.join(tmpRoot, 'sessions', 'abc-123'), { recursive: true })
    })

    afterAll(() => {
        fs.rmSync(tmpRoot, { recursive: true, force: true })
    })

    function writeSettings(file: string, kb: unknown): void {
        // bump mtime so the resolver notices the change
        fs.writeFileSync(file, JSON.stringify({ detailBodySizeKB: kb }), 'utf8')
    }

    function resolverForSession(): () => number {
        const sessionDir = path.join(tmpRoot, 'sessions', 'abc-123')
        const sessionSettings = path.join(sessionDir, 'settings.json')
        return createDetailBodyLimitResolver(sessionSettings, sessionDir, 256 * 1024)
    }

    it('falls back to default 256KB when neither session nor default settings exist', () => {
        const resolve = resolverForSession()
        expect(resolve()).toBe(256 * 1024)
    })

    it('inherits default session setting when session has none', () => {
        writeSettings(path.join(tmpRoot, 'settings.json'), 1024)
        const resolve = resolverForSession()
        expect(resolve()).toBe(1024 * 1024)
    })

    it('session setting overrides default session setting', () => {
        writeSettings(path.join(tmpRoot, 'settings.json'), 1024)
        writeSettings(path.join(tmpRoot, 'sessions', 'abc-123', 'settings.json'), 512)
        const resolve = resolverForSession()
        expect(resolve()).toBe(512 * 1024)
    })

    it('falls back to default session after session setting is removed', () => {
        // session setting present first
        writeSettings(path.join(tmpRoot, 'sessions', 'abc-123', 'settings.json'), 512)
        const resolve = resolverForSession()
        expect(resolve()).toBe(512 * 1024)
        // delete session settings -> fall back to default (1024)
        fs.rmSync(path.join(tmpRoot, 'sessions', 'abc-123', 'settings.json'))
        expect(resolve()).toBe(1024 * 1024)
    })

    it('ignores invalid setting values and falls back', () => {
        writeSettings(path.join(tmpRoot, 'settings.json'), 'not-a-number')
        writeSettings(path.join(tmpRoot, 'sessions', 'abc-123', 'settings.json'), -5)
        const resolve = resolverForSession()
        expect(resolve()).toBe(256 * 1024)
    })

    it('does not inherit from a sibling when meddleDir is not under /sessions/<id>', () => {
        // A custom home that does NOT follow the sessions/<id> layout is treated
        // as the default session itself — no default-session inheritance path.
        const customHome = fs.mkdtempSync(path.join(os.tmpdir(), 'meddle-custom-'))
        const customSettings = path.join(customHome, 'settings.json')
        writeSettings(customSettings, 768)
        const resolve = createDetailBodyLimitResolver(customSettings, customHome, 256 * 1024)
        expect(resolve()).toBe(768 * 1024) // own setting still applies
        // cleanup
        fs.rmSync(customHome, { recursive: true, force: true })
    })
})
