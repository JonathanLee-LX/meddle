import * as fs from 'fs'
import * as path from 'path'
import type { ProxyContext, MockHandler, DiagnosticsResult } from './types'
import { listRuleFiles } from '../server/rule-files'

interface ServerContextLike {
    ruleMap: Record<string, string>;
    excludeMap: Record<string, string[]>;
    meddleDir?: string;
    settingsPath?: string;
    [key: string]: any;
}

export function createConfigDiagnostics(ctx: ProxyContext, serverContext: ServerContextLike, mockHandler: MockHandler) {
    function loadSettingsSync(): any {
        try {
            if (fs.existsSync(ctx.settingsPath)) {
                return JSON.parse(fs.readFileSync(ctx.settingsPath, 'utf8'))
            }
        } catch (error) { console.error('加载设置失败:', error) }
        return null
    }

    function performConfigDiagnostics(): DiagnosticsResult {
        const diagnostics: DiagnosticsResult = { status: 'ok', checks: [], errors: [], warnings: [] }

        if (fs.existsSync(ctx.meddleDir)) {
            diagnostics.checks.push({ name: '配置目录', status: 'ok', path: ctx.meddleDir })
        } else {
            diagnostics.errors.push('配置目录不存在: ' + ctx.meddleDir)
            diagnostics.status = 'error'
        }

        if (fs.existsSync(ctx.settingsPath)) {
            try {
                const settings = JSON.parse(fs.readFileSync(ctx.settingsPath, 'utf8'))
                diagnostics.checks.push({
                    name: '系统设置', status: 'ok', path: ctx.settingsPath,
                    details: {
                        theme: settings.theme, fontSize: settings.fontSize,
                        aiEnabled: settings.aiConfig?.enabled || false,
                        customMocksPath: settings.mocksFilePath || null
                    }
                })
            } catch (error: any) {
                diagnostics.errors.push('系统设置文件格式错误: ' + error.message)
                diagnostics.status = 'error'
            }
        } else {
            diagnostics.warnings.push('系统设置文件不存在，将使用默认设置')
        }

        const rulesDir = path.join(ctx.meddleDir, 'route-rules')
        if (fs.existsSync(rulesDir)) {
            const files = listRuleFiles(serverContext as any)
            diagnostics.checks.push({
                name: '路由规则目录', status: 'ok', path: rulesDir,
                details: {
                    totalFiles: files.length,
                    enabledFiles: files.filter((f: any) => f.enabled).length,
                    totalRules: Object.keys(ctx.ruleMap).length,
                }
            })
        } else {
            diagnostics.warnings.push('路由规则目录不存在: ' + rulesDir)
        }

        const customPaths = mockHandler.loadCustomPathsFromSettings()
        const mocksPath = customPaths.mocksFilePath || mockHandler.getMockFilePath()
        if (fs.existsSync(mocksPath)) {
            try {
                const content = fs.readFileSync(mocksPath, 'utf8')
                const data = JSON.parse(content)
                diagnostics.checks.push({
                    name: 'Mock 规则文件', status: 'ok', path: mocksPath,
                    details: { total: (data.rules || []).length, enabled: (data.rules || []).filter((r: any) => r.enabled).length, size: content.length }
                })
            } catch (error: any) {
                diagnostics.errors.push('Mock 规则文件格式错误: ' + error.message)
                diagnostics.status = 'error'
            }
        } else {
            diagnostics.warnings.push('Mock 规则文件不存在: ' + mocksPath)
        }

        const certChecks: string[] = []
        if (fs.existsSync(ctx.certDir)) {
            certChecks.push('证书目录存在')
            if (fs.existsSync(path.join(ctx.certDir, 'rootCA.crt'))) certChecks.push('根证书存在')
            else diagnostics.warnings.push('根证书不存在，HTTPS 代理可能无法使用')
            if (fs.existsSync(path.join(ctx.certDir, 'rootCA.key'))) certChecks.push('根证书私钥存在')
            diagnostics.checks.push({ name: 'SSL 证书', status: certChecks.length >= 2 ? 'ok' : 'warning', path: ctx.certDir, details: { checks: certChecks } })
        } else {
            diagnostics.warnings.push('证书目录不存在')
        }

        if (diagnostics.errors.length > 0) diagnostics.status = 'error'
        else if (diagnostics.warnings.length > 0) diagnostics.status = 'warning'
        return diagnostics
    }

    return { loadSettingsSync, performConfigDiagnostics }
}
