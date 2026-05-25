import { describe, expect, it, vi } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { createAgentTools } from '../server/agent/tools'
import type { ServerContext } from '../server/index'
import { parseEprcWithExclusions } from '../helpers'

function createTestContext() {
    const tempDir = fs.mkdtempSync('/tmp/agent-tools-test-')
    const ruleDir = path.join(tempDir, 'route-rules')
    fs.mkdirSync(ruleDir, { recursive: true })
    fs.writeFileSync(path.join(ruleDir, '默认规则.txt'), '', 'utf8')
    const settingsPath = path.join(tempDir, 'settings.json')
    fs.writeFileSync(settingsPath, JSON.stringify({ activeRuleFiles: ['默认规则'] }), 'utf8')
    const reloadAllRuleFiles = vi.fn()

    const ctx = {
        epDir: tempDir,
        settingsPath,
        reloadAllRuleFiles,
    } as unknown as ServerContext

    return { ctx, ruleFilePath: path.join(ruleDir, '默认规则.txt'), reloadAllRuleFiles }
}

describe('agent route tools', () => {
    it('prepares and executes a confirmed route rule addition', async () => {
        const { ctx, ruleFilePath, reloadAllRuleFiles } = createTestContext()
        const tool = createAgentTools().get('route_rule_add')
        expect(tool).toBeDefined()

        const input = {
            ruleFile: '默认规则',
            pattern: '*.wps.cn',
            target: '1.1.1.1',
        }

        const confirmation = await tool?.prepareConfirmation?.(input, { serverContext: ctx })
        expect(confirmation?.summary).toContain('添加路由规则')
        expect(confirmation?.diff).toContain('+ *.wps.cn 1.1.1.1')

        const result = await tool?.execute(input, { serverContext: ctx })
        const parsed = parseEprcWithExclusions(fs.readFileSync(ruleFilePath, 'utf8'))

        expect(result).toMatchObject({ status: 'success', ruleFile: '默认规则' })
        expect(parsed.ruleMap['*.wps.cn']).toBe('1.1.1.1')
        expect(reloadAllRuleFiles).toHaveBeenCalledTimes(1)
    })

    it('reports the single active route file for agent planning', () => {
        const { ctx } = createTestContext()
        const tool = createAgentTools().get('route_rule_active_get')

        const result = tool?.execute({}, { serverContext: ctx }) as {
            activeRuleFiles: string[]
            currentRuleFile: string | null
        }

        expect(result.activeRuleFiles).toEqual(['默认规则'])
        expect(result.currentRuleFile).toBe('默认规则')
    })
})
