import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { createConfigDiagnostics } from '../core/config-diagnostics'

describe('config-diagnostics createConfigDiagnostics', () => {
    let tmpDir: string

    beforeAll(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meddle-cd-test-'))
    })
    afterAll(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true })
    })

    function makeCtx(overrides: any = {}) {
        return {
            meddleDir: tmpDir, certDir: path.join(tmpDir, 'ca'),
            settingsPath: path.join(tmpDir, 'settings.json'),
            ruleMap: {}, ...overrides,
        }
    }

    function makeMockHandler(overrides: any = {}) {
        return {
            loadCustomPathsFromSettings: () => ({ mocksFilePath: null }),
            getMockFilePath: () => path.join(tmpDir, 'mocks.json'),
            ...overrides,
        }
    }

    function makeServerContext(overrides: any = {}) {
        return { ruleMap: {}, meddleDir: tmpDir, settingsPath: path.join(tmpDir, 'settings.json'), ...overrides }
    }

    describe('loadSettingsSync', () => {
        it('returns null when settings file does not exist', () => {
            const ctx = makeCtx({ settingsPath: path.join(tmpDir, 'nonexistent.json') })
            const diag = createConfigDiagnostics(ctx, makeServerContext(), makeMockHandler())
            expect(diag.loadSettingsSync()).toBe(null)
        })

        it('returns parsed settings when file exists', () => {
            const settingsFile = path.join(tmpDir, 'settings-load.json')
            fs.writeFileSync(settingsFile, JSON.stringify({ theme: 'dark', fontSize: 14 }), 'utf8')
            const ctx = makeCtx({ settingsPath: settingsFile })
            const diag = createConfigDiagnostics(ctx, makeServerContext(), makeMockHandler())
            const settings = diag.loadSettingsSync()
            expect(settings.theme).toBe('dark')
            expect(settings.fontSize).toBe(14)
        })
    })

    describe('performConfigDiagnostics', () => {
        it('reports ok status when meddleDir exists', () => {
            const ctx = makeCtx()
            const diag = createConfigDiagnostics(ctx, makeServerContext(), makeMockHandler())
            const result = diag.performConfigDiagnostics()
            expect(result.checks.some((c: any) => c.name === '配置目录' && c.status === 'ok')).toBeTruthy()
        })

        it('reports error when meddleDir does not exist', () => {
            const ctx = makeCtx({ meddleDir: '/nonexistent/meddle/dir' })
            const diag = createConfigDiagnostics(ctx, makeServerContext(), makeMockHandler())
            const result = diag.performConfigDiagnostics()
            expect(result.status).toBe('error')
            expect(result.errors.some((e: string) => e.includes('配置目录不存在'))).toBeTruthy()
        })

        it('warns when settings file does not exist', () => {
            const ctx = makeCtx({ settingsPath: path.join(tmpDir, 'nonexistent-settings.json') })
            const diag = createConfigDiagnostics(ctx, makeServerContext(), makeMockHandler())
            const result = diag.performConfigDiagnostics()
            expect(result.warnings.some((w: string) => w.includes('系统设置文件不存在'))).toBeTruthy()
        })

        it('reports ok for valid settings file', () => {
            const settingsFile = path.join(tmpDir, 'valid-settings.json')
            fs.writeFileSync(settingsFile, JSON.stringify({ theme: 'light' }), 'utf8')
            const ctx = makeCtx({ settingsPath: settingsFile })
            const diag = createConfigDiagnostics(ctx, makeServerContext(), makeMockHandler())
            const result = diag.performConfigDiagnostics()
            expect(result.checks.some((c: any) => c.name === '系统设置' && c.status === 'ok')).toBeTruthy()
        })

        it('reports error for malformed settings file', () => {
            const settingsFile = path.join(tmpDir, 'bad-settings.json')
            fs.writeFileSync(settingsFile, '{bad json', 'utf8')
            const ctx = makeCtx({ settingsPath: settingsFile })
            const diag = createConfigDiagnostics(ctx, makeServerContext(), makeMockHandler())
            const result = diag.performConfigDiagnostics()
            expect(result.status).toBe('error')
            expect(result.errors.some((e: string) => e.includes('系统设置文件格式错误'))).toBeTruthy()
        })

        it('warns when mock rules file does not exist', () => {
            const ctx = makeCtx()
            const diag = createConfigDiagnostics(ctx, makeServerContext(), makeMockHandler({
                getMockFilePath: () => path.join(tmpDir, 'nonexistent-mocks.json'),
            }))
            const result = diag.performConfigDiagnostics()
            expect(result.warnings.some((w: string) => w.includes('Mock 规则文件不存在'))).toBeTruthy()
        })

        it('reports ok for valid mock rules file', () => {
            const mocksFile = path.join(tmpDir, 'valid-mocks.json')
            fs.writeFileSync(mocksFile, JSON.stringify({ rules: [{ id: 1, enabled: true }] }), 'utf8')
            const ctx = makeCtx()
            const diag = createConfigDiagnostics(ctx, makeServerContext(), makeMockHandler({
                getMockFilePath: () => mocksFile,
            }))
            const result = diag.performConfigDiagnostics()
            expect(result.checks.some((c: any) => c.name === 'Mock 规则文件' && c.status === 'ok')).toBeTruthy()
        })

        it('checks SSL certificate directory', () => {
            const certDir = path.join(tmpDir, 'ca')
            fs.mkdirSync(certDir, { recursive: true })
            const ctx = makeCtx({ certDir })
            const diag = createConfigDiagnostics(ctx, makeServerContext(), makeMockHandler())
            const result = diag.performConfigDiagnostics()
            expect(result.checks.some((c: any) => c.name === 'SSL 证书')).toBeTruthy()
        })
    })
})
