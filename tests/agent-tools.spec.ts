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

    return { ctx, ruleDir, ruleFilePath: path.join(ruleDir, '默认规则.txt'), settingsPath, reloadAllRuleFiles }
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

    it('creates and activates a route rule file after confirmation', async () => {
        const { ctx, ruleDir, settingsPath, reloadAllRuleFiles } = createTestContext()
        const tool = createAgentTools().get('route_rule_create_file')
        expect(tool).toBeDefined()

        const input = {
            ruleFile: 'AI 规则',
            content: '*.example.cn 1.1.1.1',
            enabled: true,
        }

        const confirmation = await tool?.prepareConfirmation?.(input, { serverContext: ctx })
        expect(confirmation?.summary).toContain('创建规则文件')
        expect(confirmation?.diff).toContain('+ 规则文件: AI 规则')

        const result = await tool?.execute(input, { serverContext: ctx })
        const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8')) as { activeRuleFiles: string[] }

        expect(result).toMatchObject({ status: 'success' })
        expect(fs.readFileSync(path.join(ruleDir, 'AI 规则.txt'), 'utf8')).toContain('*.example.cn 1.1.1.1')
        expect(settings.activeRuleFiles).toContain('AI 规则')
        expect(reloadAllRuleFiles).toHaveBeenCalledTimes(1)
    })

    it('sets active route files in the requested order', async () => {
        const { ctx, ruleDir, settingsPath, reloadAllRuleFiles } = createTestContext()
        fs.writeFileSync(path.join(ruleDir, '第二规则.txt'), '*.example.cn 1.1.1.1', 'utf8')
        const tool = createAgentTools().get('route_rule_active_set')

        const confirmation = await tool?.prepareConfirmation?.({ ruleFiles: ['第二规则', '默认规则'] }, { serverContext: ctx })
        expect(confirmation?.diff).toContain('- 当前启用: 默认规则')
        expect(confirmation?.diff).toContain('+ 新启用: 第二规则, 默认规则')

        const result = await tool?.execute({ ruleFiles: ['第二规则', '默认规则'] }, { serverContext: ctx })
        const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8')) as { activeRuleFiles: string[] }

        expect(result).toMatchObject({ activeRuleFiles: ['第二规则', '默认规则'] })
        expect(settings.activeRuleFiles).toEqual(['第二规则', '默认规则'])
        expect(reloadAllRuleFiles).toHaveBeenCalledTimes(1)
    })

    it('updates and deletes route rules after confirmation', async () => {
        const { ctx, ruleFilePath, reloadAllRuleFiles } = createTestContext()
        fs.writeFileSync(ruleFilePath, '*.example.cn !health 1.1.1.1', 'utf8')
        const tools = createAgentTools()
        const updateTool = tools.get('route_rule_update')
        const deleteTool = tools.get('route_rule_delete')

        const updateInput = {
            ruleFile: '默认规则',
            pattern: '*.example.cn',
            target: '2.2.2.2',
            exclusions: [],
        }
        const updateConfirmation = await updateTool?.prepareConfirmation?.(updateInput, { serverContext: ctx })
        expect(updateConfirmation?.diff).toContain('- *.example.cn !health 1.1.1.1')
        expect(updateConfirmation?.diff).toContain('+ *.example.cn 2.2.2.2')

        const updateResult = await updateTool?.execute(updateInput, { serverContext: ctx })
        let parsed = parseEprcWithExclusions(fs.readFileSync(ruleFilePath, 'utf8'))
        expect(updateResult).toMatchObject({ status: 'success', target: '2.2.2.2' })
        expect(parsed.ruleMap['*.example.cn']).toBe('2.2.2.2')
        expect(parsed.excludeMap['*.example.cn']).toEqual([])

        const deleteInput = {
            ruleFile: '默认规则',
            pattern: '*.example.cn',
        }
        const deleteConfirmation = await deleteTool?.prepareConfirmation?.(deleteInput, { serverContext: ctx })
        expect(deleteConfirmation?.summary).toContain('删除路由规则')
        expect(deleteConfirmation?.diff).toContain('- *.example.cn 2.2.2.2')

        const deleteResult = await deleteTool?.execute(deleteInput, { serverContext: ctx })
        parsed = parseEprcWithExclusions(fs.readFileSync(ruleFilePath, 'utf8'))
        expect(deleteResult).toMatchObject({ status: 'success', pattern: '*.example.cn' })
        expect(parsed.ruleMap['*.example.cn']).toBeUndefined()
        expect(reloadAllRuleFiles).toHaveBeenCalledTimes(2)
    })
})
