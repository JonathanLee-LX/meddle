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
    const loadMockRules = vi.fn()
    const saveMockRules = vi.fn()
    const broadcastToAllClients = vi.fn()
    const requestPipeline = {
        mode: 'off',
        setMode: vi.fn((mode: string) => {
            requestPipeline.mode = mode
        }),
    }
    const onModeGate = {
        reset: vi.fn(),
        getStats: () => ({ mode: requestPipeline.mode, allowed: 0, denied: 0, total: 0 }),
        shouldAllow: () => true,
        setMode: vi.fn(),
    }
    const plugin = {
        manifest: {
            id: 'local.demo',
            name: 'Demo Plugin',
            version: '1.0.0',
            hooks: ['onBeforeProxy'],
            permissions: ['network'],
            priority: 10,
        },
    }
    const pluginStates = new Map([['local.demo', 'running']])
    const reloadCustomPlugins = vi.fn().mockResolvedValue([plugin])

    const ctx = {
        meddleDir: tempDir,
        settingsPath,
        currentMocksPath: path.join(tempDir, 'custom-mocks.json'),
        reloadAllRuleFiles,
        loadMockRules,
        getMockFilePath: () => path.join(tempDir, 'mocks.json'),
        mockRules: [],
        mockIdSeq: 1,
        saveMockRules,
        broadcastToAllClients,
        proxyRecordArr: [
            {
                id: 1,
                method: 'GET',
                source: 'https://example.cn/api/users',
                target: 'https://upstream.example.cn/api/users',
                time: '15:00:00',
                statusCode: 200,
                duration: 42,
            },
            {
                id: 2,
                method: 'POST',
                source: 'https://example.cn/api/orders',
                target: 'https://upstream.example.cn/api/orders',
                time: '15:00:01',
                statusCode: 500,
                duration: 88,
            },
        ],
        proxyRecordDetailMap: new Map([[2, {
            requestHeaders: { 'content-type': 'application/json' },
            requestBody: '{"id":1}',
            responseHeaders: { 'content-type': 'application/json' },
            responseBody: '{"error":"fail"}',
            statusCode: 500,
            method: 'POST',
            url: 'https://example.cn/api/orders',
        }]]),
        requestPipeline,
        shadowCompareTracker: {
            reset: vi.fn(),
            getStats: () => ({ total: 3, diff: 0, diffRate: '0.00' }),
            record: vi.fn(() => false),
        },
        onModeGate,
        pluginManager: {
            getAll: () => [plugin],
            getState: (id: string) => pluginStates.get(id) || 'unknown',
            setState: vi.fn((id: string, state: string) => {
                pluginStates.set(id, state)
            }),
        },
        hookDispatcher: {
            getPluginStats: () => ({ 'local.demo': { calls: 3, errors: 0 } }),
        },
        builtinLoggerPlugin: {},
        performConfigDiagnostics: () => ({
            status: 'ok',
            checks: [],
            errors: [],
            warnings: [],
        }),
        reloadCustomPlugins,
    } as unknown as ServerContext

    return {
        ctx,
        ruleDir,
        ruleFilePath: path.join(ruleDir, '默认规则.txt'),
        settingsPath,
        reloadAllRuleFiles,
        loadMockRules,
        saveMockRules,
        broadcastToAllClients,
        reloadCustomPlugins,
    }
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

    it('adds, updates, lists, and deletes mock rules after confirmation', async () => {
        const { ctx, saveMockRules, broadcastToAllClients } = createTestContext()
        const tools = createAgentTools()
        const addTool = tools.get('mock_rule_add')
        const listTool = tools.get('mock_rule_list')
        const updateTool = tools.get('mock_rule_update')
        const deleteTool = tools.get('mock_rule_delete')

        const addInput = {
            name: 'AI Mock',
            urlPattern: 'example\\.cn/api',
            method: 'GET',
            statusCode: 201,
            headers: { 'content-type': 'application/json' },
            body: '{"ok":true}',
        }
        const addConfirmation = await addTool?.prepareConfirmation?.(addInput, { serverContext: ctx })
        expect(addConfirmation?.summary).toContain('新增 Mock 规则')
        expect(addConfirmation?.diff).toContain('+ name=AI Mock method=GET pattern=example\\.cn/api status=201 enabled=true')

        const addResult = await addTool?.execute(addInput, { serverContext: ctx })
        expect(addResult).toMatchObject({ status: 'success', rule: { id: 1, name: 'AI Mock' } })
        expect(ctx.mockRules).toHaveLength(1)
        expect(saveMockRules).toHaveBeenCalledTimes(1)
        expect(broadcastToAllClients).toHaveBeenCalledTimes(1)

        const listResult = listTool?.execute({}, { serverContext: ctx }) as { rules: Array<{ id: number }> }
        expect(listResult.rules.map((rule) => rule.id)).toEqual([1])

        const updateInput = { id: 1, enabled: false, statusCode: 404 }
        const updateConfirmation = await updateTool?.prepareConfirmation?.(updateInput, { serverContext: ctx })
        expect(updateConfirmation?.diff).toContain('- id=1 name=AI Mock method=GET pattern=example\\.cn/api status=201 enabled=true')
        expect(updateConfirmation?.diff).toContain('+ id=1 name=AI Mock method=GET pattern=example\\.cn/api status=404 enabled=false')

        const updateResult = await updateTool?.execute(updateInput, { serverContext: ctx })
        expect(updateResult).toMatchObject({ status: 'success', rule: { id: 1, enabled: false, statusCode: 404 } })
        expect(saveMockRules).toHaveBeenCalledTimes(2)
        expect(broadcastToAllClients).toHaveBeenCalledTimes(2)

        const deleteConfirmation = await deleteTool?.prepareConfirmation?.({ id: 1 }, { serverContext: ctx })
        expect(deleteConfirmation?.summary).toContain('删除 Mock 规则')
        expect(deleteConfirmation?.diff).toContain('- id=1 name=AI Mock method=GET pattern=example\\.cn/api status=404 enabled=false')

        const deleteResult = await deleteTool?.execute({ id: 1 }, { serverContext: ctx })
        expect(deleteResult).toMatchObject({ status: 'success', id: 1 })
        expect(ctx.mockRules).toHaveLength(0)
        expect(saveMockRules).toHaveBeenCalledTimes(3)
        expect(broadcastToAllClients).toHaveBeenCalledTimes(3)
    })

    it('reads logs, plugin status, pipeline status, and config diagnostics', () => {
        const { ctx } = createTestContext()
        const tools = createAgentTools()

        const logList = tools.get('log_list')?.execute({ method: 'POST', limit: 5 }, { serverContext: ctx }) as {
            records: Array<{ id: number }>
        }
        expect(logList.records.map((record) => record.id)).toEqual([2])

        const logDetail = tools.get('log_detail_get')?.execute({ id: 2 }, { serverContext: ctx }) as {
            detail: { statusCode: number } | null
        }
        expect(logDetail.detail?.statusCode).toBe(500)

        const pluginList = tools.get('plugin_list')?.execute({}, { serverContext: ctx }) as {
            total: number
            plugins: Array<{ id: string; state: string; stats: unknown }>
        }
        expect(pluginList.total).toBe(1)
        expect(pluginList.plugins[0]).toMatchObject({ id: 'local.demo', state: 'running' })

        const pluginHealth = tools.get('plugin_health_get')?.execute({}, { serverContext: ctx }) as {
            pluginStates: Record<string, string>
        }
        expect(pluginHealth.pluginStates['local.demo']).toBe('running')

        const pipelineStatus = tools.get('pipeline_status_get')?.execute({}, { serverContext: ctx }) as {
            mode: string
            shadowStats: { total: number }
        }
        expect(pipelineStatus.mode).toBe('off')
        expect(pipelineStatus.shadowStats.total).toBe(3)

        const doctor = tools.get('config_doctor')?.execute({}, { serverContext: ctx }) as { status: string }
        expect(doctor.status).toBe('ok')
    })

    it('toggles plugin state after confirmation', async () => {
        const { ctx, settingsPath } = createTestContext()
        const tool = createAgentTools().get('plugin_toggle')

        const confirmation = await tool?.prepareConfirmation?.(
            { pluginId: 'local.demo', enabled: false },
            { serverContext: ctx },
        )
        expect(confirmation?.summary).toContain('禁用插件')
        expect(confirmation?.diff).toContain('- local.demo: state=running')
        expect(confirmation?.diff).toContain('+ local.demo: state=disabled')

        const result = await tool?.execute({ pluginId: 'local.demo', enabled: false }, { serverContext: ctx })
        const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8')) as { disabledPlugins: string[] }

        expect(result).toMatchObject({ status: 'success', pluginId: 'local.demo', state: 'disabled' })
        expect(ctx.pluginManager.getState('local.demo')).toBe('disabled')
        expect(ctx.pluginManager.setState).toHaveBeenCalledWith('local.demo', 'disabled')
        expect(settings.disabledPlugins).toContain('local.demo')
    })

    it('reloads custom plugins after confirmation', async () => {
        const { ctx, reloadCustomPlugins } = createTestContext()
        const tool = createAgentTools().get('plugin_reload')

        const confirmation = await tool?.prepareConfirmation?.({}, { serverContext: ctx })
        expect(confirmation?.summary).toContain('热加载自定义插件')

        const result = await tool?.execute({}, { serverContext: ctx }) as { status: string; count: number }

        expect(result).toMatchObject({ status: 'success', count: 1 })
        expect(reloadCustomPlugins).toHaveBeenCalledTimes(1)
    })

    it('refreshes config through the same runtime path as the API', async () => {
        const { ctx, loadMockRules, reloadAllRuleFiles } = createTestContext()
        const tool = createAgentTools().get('config_refresh')

        const confirmation = await tool?.prepareConfirmation?.({}, { serverContext: ctx })
        expect(confirmation?.summary).toContain('刷新配置')

        const result = await tool?.execute({}, { serverContext: ctx }) as { status: string; mocksPath: string }

        expect(result).toMatchObject({ status: 'success', mocksPath: path.join(path.dirname(ctx.settingsPath), 'mocks.json') })
        expect(ctx.currentMocksPath).toBeNull()
        expect(reloadAllRuleFiles).toHaveBeenCalledTimes(1)
        expect(loadMockRules).toHaveBeenCalledTimes(1)
    })

    it('resets shadow stats after confirmation', async () => {
        const { ctx } = createTestContext()
        const tool = createAgentTools().get('pipeline_shadow_stats_reset')

        const confirmation = await tool?.prepareConfirmation?.({}, { serverContext: ctx })
        expect(confirmation?.summary).toContain('重置 shadow 统计')
        expect(confirmation?.diff).toContain('+ shadowStats=reset')

        const result = await tool?.execute({}, { serverContext: ctx }) as { status: string }

        expect(result).toMatchObject({ status: 'success' })
        expect(ctx.shadowCompareTracker.reset).toHaveBeenCalledTimes(1)
        expect(ctx.onModeGate.reset).toHaveBeenCalledTimes(1)
    })

    it('sets pipeline mode after confirmation', async () => {
        const { ctx, settingsPath } = createTestContext()
        const tool = createAgentTools().get('pipeline_mode_set')

        const confirmation = await tool?.prepareConfirmation?.({ mode: 'shadow' }, { serverContext: ctx })
        expect(confirmation?.summary).toContain('off -> shadow')
        expect(confirmation?.diff).toContain('+ pluginMode=shadow')

        const result = await tool?.execute({ mode: 'shadow' }, { serverContext: ctx })
        const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8')) as { pluginMode: string }

        expect(result).toMatchObject({ status: 'success', oldMode: 'off', mode: 'shadow' })
        expect(ctx.requestPipeline.mode).toBe('shadow')
        expect(settings.pluginMode).toBe('shadow')
        expect(ctx.onModeGate.setMode).toHaveBeenCalledWith('shadow')
    })
})
