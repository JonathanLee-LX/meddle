import { describe, it, expect } from 'vitest'
import { createProxyContext } from '../core/proxy-context'

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
        expect(ctx.MAX_RECORD_SIZE > 0).toBeTruthy()
        expect(ctx.MAX_DETAIL_SIZE > 0).toBeTruthy()
        expect(ctx.MAX_BODY_SIZE > 0).toBeTruthy()
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
