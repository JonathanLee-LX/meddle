import { describe, it, expect, beforeEach, vi } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { ServerContext } from '../server/index'
import {
    listRuleFiles,
    mergeActiveRules,
    ensureRouteRules,
    registerRuleFilesRoutes,
} from '../server/rule-files'

describe('rule-files', () => {
    let tempDir: string
    let ctx: ServerContext

    beforeEach(() => {
        tempDir = fs.mkdtempSync('/tmp/rule-files-test-')
        const settingsPath = path.join(tempDir, 'settings.json')
        const epDir = tempDir

        ctx = {
            currentMocksPath: null,
            ruleMap: {},
            proxyRecordArr: [],
            proxyRecordDetailMap: new Map(),
            recordIdSeq: 0,
            mockRules: [],
            mockIdSeq: 0,
            requestPipeline: {
                mode: 'off',
                setMode: vi.fn(),
            },
            builtinLoggerPlugin: {},
            shadowCompareTracker: {
                reset: vi.fn(),
                getStats: () => ({ total: 0, diff: 0, diffRate: '0' }),
                record: vi.fn(() => false),
            },
            onModeGate: {
                reset: vi.fn(),
                getStats: () => ({}),
                shouldAllow: () => true,
                setMode: vi.fn(),
            },
            pluginManager: {
                getAll: () => [],
                getState: () => 'unknown',
                setState: vi.fn(),
            },
            hookDispatcher: {},
            settingsPath,
            epDir,
            settings: {},
            loadMockRules: vi.fn(),
            saveMockRules: vi.fn(),
            reloadCustomPlugins: vi.fn().mockResolvedValue([]),
            logRuleMap: vi.fn(),
            reloadAllRuleFiles: vi.fn(),
        }
    })

    describe('listRuleFiles', () => {
        it('should list rule files with rule count', () => {
            const ruleDir = path.join(tempDir, 'route-rules')
            fs.mkdirSync(ruleDir, { recursive: true })
            fs.writeFileSync(path.join(ruleDir, 'test.txt'), 'http://localhost:3000 /api/test\nhttp://localhost:8080 /api/user')
            fs.writeFileSync(path.join(ruleDir, 'prod.txt'), 'http://prod.com /api/*')

            const settingsDir = path.dirname(ctx.settingsPath)
            fs.mkdirSync(settingsDir, { recursive: true })
            fs.writeFileSync(ctx.settingsPath, JSON.stringify({ activeRuleFiles: ['test'] }))

            const result = listRuleFiles(ctx)

            expect(result).toHaveLength(2)
            const testFile = result.find(f => f.name === 'test')
            expect(testFile?.enabled).toBe(true)
            expect(testFile?.ruleCount).toBe(2)
            const prodFile = result.find(f => f.name === 'prod')
            expect(prodFile?.enabled).toBe(false)
        })

        it('should return empty array when directory does not exist', () => {
            fs.writeFileSync(ctx.settingsPath, JSON.stringify({ activeRuleFiles: [] }))
            const result = listRuleFiles(ctx)
            expect(result).toHaveLength(0)
        })

        it('should ignore non-txt files', () => {
            const ruleDir = path.join(tempDir, 'route-rules')
            fs.mkdirSync(ruleDir, { recursive: true })
            fs.writeFileSync(path.join(ruleDir, 'test.txt'), 'http://a.com /a')
            fs.writeFileSync(path.join(ruleDir, 'test.json'), '{}')
            fs.writeFileSync(path.join(ruleDir, 'test.js'), 'module.exports = {}')

            const settingsDir = path.dirname(ctx.settingsPath)
            fs.mkdirSync(settingsDir, { recursive: true })
            fs.writeFileSync(ctx.settingsPath, JSON.stringify({ activeRuleFiles: [] }))

            const result = listRuleFiles(ctx)
            expect(result).toHaveLength(1)
            expect(result[0].name).toBe('test')
        })

        it('should count exclusions correctly', () => {
            const ruleDir = path.join(tempDir, 'route-rules')
            fs.mkdirSync(ruleDir, { recursive: true })
            // Rule with 2 exclusions
            fs.writeFileSync(path.join(ruleDir, 'with-exclude.txt'), '/api http://dev.local !/api/health !/api/metrics\n/other http://other.local')
            // Rule with no exclusions
            fs.writeFileSync(path.join(ruleDir, 'no-exclude.txt'), '/api http://prod.local')

            const settingsDir = path.dirname(ctx.settingsPath)
            fs.mkdirSync(settingsDir, { recursive: true })
            fs.writeFileSync(ctx.settingsPath, JSON.stringify({ activeRuleFiles: ['with-exclude'] }))

            const result = listRuleFiles(ctx)

            const withExcludeFile = result.find(f => f.name === 'with-exclude')
            expect(withExcludeFile?.ruleCount).toBe(2)
            expect(withExcludeFile?.excludeCount).toBe(2)
            expect(withExcludeFile?.enabled).toBe(true)

            const noExcludeFile = result.find(f => f.name === 'no-exclude')
            expect(noExcludeFile?.ruleCount).toBe(1)
            expect(noExcludeFile?.excludeCount).toBe(0)
            expect(noExcludeFile?.enabled).toBe(false)
        })
    })

    describe('mergeActiveRules', () => {
        it('should skip non-existent files', () => {
            const settingsDir = path.dirname(ctx.settingsPath)
            fs.mkdirSync(settingsDir, { recursive: true })
            fs.writeFileSync(ctx.settingsPath, JSON.stringify({ activeRuleFiles: ['nonexistent'] }))

            const result = mergeActiveRules(ctx)
            expect(result.ruleMap).toEqual({})
            expect(result.excludeMap).toEqual({})
        })
    })

    describe('mergeActiveRules', () => {
        it('should merge rules from active files', () => {
            const ruleDir = path.join(tempDir, 'route-rules')
            fs.mkdirSync(ruleDir, { recursive: true })
            fs.writeFileSync(path.join(ruleDir, 'dev.txt'), '/api http://dev.local')
            fs.writeFileSync(path.join(ruleDir, 'prod.txt'), '/api http://prod.local')

            const settingsDir = path.dirname(ctx.settingsPath)
            fs.mkdirSync(settingsDir, { recursive: true })
            fs.writeFileSync(ctx.settingsPath, JSON.stringify({ activeRuleFiles: ['dev', 'prod'] }))

            const result = mergeActiveRules(ctx)

            expect(result.ruleMap['/api']).toBe('http://prod.local')
        })

        it('should skip non-existent files', () => {
            const settingsDir = path.dirname(ctx.settingsPath)
            fs.mkdirSync(settingsDir, { recursive: true })
            fs.writeFileSync(ctx.settingsPath, JSON.stringify({ activeRuleFiles: ['nonexistent'] }))

            const result = mergeActiveRules(ctx)
            expect(result.ruleMap).toEqual({})
            expect(result.excludeMap).toEqual({})
        })

        it('should return empty object when no active files', () => {
            const settingsDir = path.dirname(ctx.settingsPath)
            fs.mkdirSync(settingsDir, { recursive: true })
            fs.writeFileSync(ctx.settingsPath, JSON.stringify({ activeRuleFiles: [] }))

            const result = mergeActiveRules(ctx)
            expect(result.ruleMap).toEqual({})
            expect(result.excludeMap).toEqual({})
        })
    })

    describe('ensureRouteRules', () => {
        it('should create default rule file when none exist', () => {
            const settingsDir = path.dirname(ctx.settingsPath)
            fs.mkdirSync(settingsDir, { recursive: true })
            fs.writeFileSync(ctx.settingsPath, JSON.stringify({}))

            const result = ensureRouteRules(ctx)

            expect(result).toHaveLength(1)
            expect(result[0]).toBe('默认规则')
            const defaultFile = path.join(tempDir, 'route-rules', '默认规则.txt')
            expect(fs.existsSync(defaultFile)).toBe(true)
        })

        it('should use existing active files', () => {
            const ruleDir = path.join(tempDir, 'route-rules')
            fs.mkdirSync(ruleDir, { recursive: true })
            fs.writeFileSync(path.join(ruleDir, 'existing.txt'), 'http://test.local /api')

            const settingsDir = path.dirname(ctx.settingsPath)
            fs.mkdirSync(settingsDir, { recursive: true })
            fs.writeFileSync(ctx.settingsPath, JSON.stringify({ activeRuleFiles: ['existing'] }))

            const result = ensureRouteRules(ctx)

            expect(result).toEqual(['existing'])
        })

        it('should set first file as active when none are active', () => {
            const ruleDir = path.join(tempDir, 'route-rules')
            fs.mkdirSync(ruleDir, { recursive: true })
            fs.writeFileSync(path.join(ruleDir, 'first.txt'), 'http://a.com /a')
            fs.writeFileSync(path.join(ruleDir, 'second.txt'), 'http://b.com /b')

            const settingsDir = path.dirname(ctx.settingsPath)
            fs.mkdirSync(settingsDir, { recursive: true })
            fs.writeFileSync(ctx.settingsPath, JSON.stringify({}))

            const result = ensureRouteRules(ctx)

            expect(result).toEqual(['first'])
        })
    })

    describe('registerRuleFilesRoutes', () => {
        it('should register all routes', () => {
            const mockApp = {
                get: vi.fn(),
                post: vi.fn(),
                put: vi.fn(),
                delete: vi.fn(),
            } as any

            const ruleDir = path.join(tempDir, 'route-rules')
            fs.mkdirSync(ruleDir, { recursive: true })
            fs.writeFileSync(path.join(ruleDir, 'test.txt'), '/api -> http://test.local')

            const settingsDir = path.dirname(ctx.settingsPath)
            fs.mkdirSync(settingsDir, { recursive: true })
            fs.writeFileSync(ctx.settingsPath, JSON.stringify({ activeRuleFiles: ['test'] }))

            registerRuleFilesRoutes(mockApp, ctx)

            expect(mockApp.get).toHaveBeenCalledWith('/api/rule-files', expect.any(Function))
            expect(mockApp.post).toHaveBeenCalledWith('/api/rule-files', expect.any(Function))
            expect(mockApp.get).toHaveBeenCalledWith('/api/rule-files/:name/content', expect.any(Function))
            expect(mockApp.put).toHaveBeenCalledWith('/api/rule-files/:name/content', expect.any(Function))
            expect(mockApp.put).toHaveBeenCalledWith('/api/rule-files/:name', expect.any(Function))
            expect(mockApp.delete).toHaveBeenCalledWith('/api/rule-files/:name', expect.any(Function))
        })
    })
})
