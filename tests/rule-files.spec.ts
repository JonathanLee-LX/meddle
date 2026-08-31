import { describe, it, expect, beforeEach, vi } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { RuleMap, ServerContext } from '../server/index'
import {
    listRuleFiles,
    mergeActiveRules,
    ensureRouteRules,
    buildRuleOverview,
    registerRuleFilesRoutes,
} from '../server/rule-files'

describe('rule-files', () => {
    let tempDir: string
    let ctx: ServerContext

    beforeEach(() => {
        tempDir = fs.mkdtempSync('/tmp/rule-files-test-')
        const settingsPath = path.join(tempDir, 'settings.json')
        const meddleDir = tempDir

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
            meddleDir,
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
        it('should merge rules from active files in order (first match wins)', () => {
            const ruleDir = path.join(tempDir, 'route-rules')
            fs.mkdirSync(ruleDir, { recursive: true })
            fs.writeFileSync(path.join(ruleDir, 'dev.txt'), '/api http://dev.local')
            fs.writeFileSync(path.join(ruleDir, 'prod.txt'), '/api http://prod.local')

            const settingsDir = path.dirname(ctx.settingsPath)
            fs.mkdirSync(settingsDir, { recursive: true })
            fs.writeFileSync(ctx.settingsPath, JSON.stringify({ activeRuleFiles: ['dev', 'prod'] }))

            const result = mergeActiveRules(ctx)
            const { resolveTargetUrl } = require('../dist/helpers')

            expect(result.rules).toHaveLength(2)
            expect(result.rules[0].target).toBe('http://dev.local')
            expect(result.rules[1].target).toBe('http://prod.local')
            // 旧版 map：同 pattern 后者覆盖
            expect(result.ruleMap['/api']).toBe('http://prod.local')
            // 有序匹配：先启用文件中的规则先生效
            expect(resolveTargetUrl('https://example.com/api/x', result.rules)).toBe(
                'http://dev.local/api/x',
            )
        })

        it('should preserve per-file rule order when merging multiple patterns', () => {
            const ruleDir = path.join(tempDir, 'route-rules')
            fs.mkdirSync(ruleDir, { recursive: true })
            fs.writeFileSync(
                path.join(ruleDir, 'base.txt'),
                'a.com b.com http://base.local\n^https://api.test !/health http://api-base.local',
            )
            fs.writeFileSync(
                path.join(ruleDir, 'override.txt'),
                '^https://api.test http://api-override.local',
            )

            const settingsDir = path.dirname(ctx.settingsPath)
            fs.mkdirSync(settingsDir, { recursive: true })
            fs.writeFileSync(
                ctx.settingsPath,
                JSON.stringify({ activeRuleFiles: ['base', 'override'] }),
            )

            const result = mergeActiveRules(ctx)
            const { resolveTargetUrl } = require('../dist/helpers')

            expect(result.rules).toHaveLength(4)
            expect(result.rules[0].pattern).toBe('a.com')
            expect(result.rules[1].pattern).toBe('b.com')
            expect(result.rules[2].pattern).toBe('^https://api.test')
            expect(result.rules[2].exclusions).toEqual(['/health'])
            expect(result.rules[3].pattern).toBe('^https://api.test')
            expect(result.rules[3].exclusions).toEqual([])

            expect(resolveTargetUrl('https://a.com/x', result.rules)).toBe('http://base.local/x')
            expect(resolveTargetUrl('https://b.com/y', result.rules)).toBe('http://base.local/y')
            expect(resolveTargetUrl('https://api.test/health', result.rules)).toBe(
                'http://api-override.local/health',
            )
            expect(resolveTargetUrl('https://api.test/v1', result.rules)).toBe(
                'http://api-base.local/v1',
            )
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

    describe('buildRuleOverview', () => {
        const setupFiles = (files: Record<string, string>, activeRuleFiles: string[]) => {
            const ruleDir = path.join(tempDir, 'route-rules')
            fs.mkdirSync(ruleDir, { recursive: true })
            for (const [name, content] of Object.entries(files)) {
                fs.writeFileSync(path.join(ruleDir, `${name}.txt`), content)
            }
            fs.writeFileSync(ctx.settingsPath, JSON.stringify({ activeRuleFiles }))
        }

        it('merges enabled rules from enabled files in active order', () => {
            setupFiles(
                {
                    first: 'a.com 1.1.1.1:80\nb.com 2.2.2.2:80',
                    second: 'c.com 3.3.3.3:80',
                },
                ['first', 'second'],
            )

            const overview = buildRuleOverview(ctx)

            expect(overview.files.map((f) => f.name).sort()).toEqual(['first', 'second'])
            expect(overview.mergedRules.map((r) => r.pattern)).toEqual(['a.com', 'b.com', 'c.com'])
            expect(overview.mergedRules.find((r) => r.pattern === 'c.com')?.file).toBe('second')
            expect(overview.conflicts).toEqual([])
        })

        it('reports last-write-wins conflicts for duplicate patterns', () => {
            setupFiles(
                {
                    base: 'example.com 127.0.0.1:3000',
                    override: 'example.com 10.0.0.9:80',
                },
                ['base', 'override'],
            )

            const overview = buildRuleOverview(ctx)

            const conflict = overview.conflicts.find((c) => c.pattern === 'example.com')
            expect(conflict?.winner).toMatchObject({ file: 'override', target: '10.0.0.9:80', rawTarget: '10.0.0.9:80' })
            expect(conflict?.shadowed).toHaveLength(1)
            expect(conflict?.shadowed[0]).toMatchObject({ file: 'base', target: '127.0.0.1:3000' })
            const merged = overview.mergedRules.find((r) => r.pattern === 'example.com')
            expect(merged?.target).toBe('10.0.0.9:80')
            expect(merged?.file).toBe('override')
        })

        it('keeps raw tokens distinct from normalized pattern/target', () => {
            setupFiles(
                {
                    file: 'example.com[www.example.com] /etc/hosts',
                },
                ['file'],
            )

            const overview = buildRuleOverview(ctx)

            const merged = overview.mergedRules[0]
            expect(merged.pattern).toBe('example.comwww.example.com')
            expect(merged.target).toBe('file:///etc/hosts[www.example.com]')
            expect(merged.rawRule).toBe('example.com[www.example.com]')
            expect(merged.rawTarget).toBe('/etc/hosts')
        })

        it('excludes disabled files from merged view but keeps them in per-file view', () => {
            setupFiles(
                {
                    active: 'a.com 1.1.1.1:80',
                    inactive: 'b.com 2.2.2.2:80',
                },
                ['active'],
            )

            const overview = buildRuleOverview(ctx)

            expect(overview.mergedRules.map((r) => r.pattern)).toEqual(['a.com'])
            const inactive = overview.perFileRules.find((f) => f.name === 'inactive')
            expect(inactive?.enabled).toBe(false)
            expect(inactive?.rules[0]).toMatchObject({ pattern: 'b.com', enabled: true })
        })

        it('keeps disabled rules only in per-file view with enabled=false', () => {
            setupFiles(
                {
                    file: 'a.com 1.1.1.1:80\n//b.com 2.2.2.2:80\n# comment',
                },
                ['file'],
            )

            const overview = buildRuleOverview(ctx)

            expect(overview.mergedRules.map((r) => r.pattern)).toEqual(['a.com'])
            const rules = overview.perFileRules.find((f) => f.name === 'file')?.rules
            expect(rules).toHaveLength(2)
            expect(rules?.[1]).toMatchObject({ pattern: 'b.com', enabled: false })
        })

        it('carries exclusions into merged rules', () => {
            setupFiles(
                {
                    file: 'a.com !sub.a.com 1.1.1.1:80',
                },
                ['file'],
            )

            const overview = buildRuleOverview(ctx)

            expect(overview.mergedRules[0].exclusions).toEqual(['sub.a.com'])
        })

        it('reports per-file read errors without failing the whole overview', () => {
            const ruleDir = path.join(tempDir, 'route-rules')
            fs.mkdirSync(ruleDir, { recursive: true })
            // 用目录伪装规则文件，readFileSync 会抛 EISDIR（对 root 同样生效）
            fs.mkdirSync(path.join(ruleDir, 'broken.txt'))
            fs.writeFileSync(path.join(ruleDir, 'ok.txt'), 'a.com 1.1.1.1:80')
            fs.writeFileSync(ctx.settingsPath, JSON.stringify({ activeRuleFiles: ['ok'] }))

            const overview = buildRuleOverview(ctx)

            const broken = overview.perFileRules.find((f) => f.name === 'broken')
            expect(broken?.error).toBeTruthy()
            expect(broken?.rules).toEqual([])
            // 其它文件不受影响
            expect(overview.mergedRules.map((r) => r.pattern)).toEqual(['a.com'])
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
            expect(mockApp.get).toHaveBeenCalledWith('/api/rule-files/overview', expect.any(Function))
            expect(mockApp.post).toHaveBeenCalledWith('/api/rule-files', expect.any(Function))
            expect(mockApp.get).toHaveBeenCalledWith('/api/rule-files/:name/content', expect.any(Function))
            expect(mockApp.put).toHaveBeenCalledWith('/api/rule-files/:name/content', expect.any(Function))
            expect(mockApp.put).toHaveBeenCalledWith('/api/rule-files/:name', expect.any(Function))
            expect(mockApp.delete).toHaveBeenCalledWith('/api/rule-files/:name', expect.any(Function))
        })
    })
})
