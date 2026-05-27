import { useState, useCallback, useEffect, lazy, Suspense } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import {
  Bot,
  Brush,
  ClipboardList,
  Code2,
  FilePlus2,
  FileText,
  Filter,
  Globe,
  ListFilter,
  Pause,
  Pencil,
  Play,
  Plug,
  Power,
  RotateCw,
  Save,
  Search,
  Settings,
  Sparkles,
  Square,
  TestTube2,
  Trash2,
  Upload,
} from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { RuleConfig } from '@/components/rule-config'
import { LogFilter } from '@/components/log-filter'
import { LogTable } from '@/components/log-table'
import { DetailPanel } from '@/components/detail-panel'
import { PluginConfig } from '@/components/plugin-config'
import { SettingsPanel } from '@/components/settings-panel'
import { AppHeader } from '@/components/app-header'
import { useProxyStore } from '@/hooks/use-proxy-store'
import { useFuzzyFilter } from '@/hooks/use-fuzzy-filter'
import { createMockFromLog, type CreateMockFromLogData } from '@/utils/mock-factory'
import { GlobalPanelProvider } from '@/components/global-panel/global-panel-context'
import { PluginGenerator } from '@/components/plugin-generator'
import { PluginCodeEditor } from '@/components/plugin-code-editor'
import { PluginTestDialog } from '@/components/plugin-test-dialog'
import { RuleAiAssistantPanel } from '@/components/rule-ai-assistant-panel'
import { MockEditorPanel } from '@/components/mock-editor-panel'
import { RoutePreview } from '@/components/route-preview'
import type { CommandAction, GlobalPanelApi, GlobalPanelRoute } from '@/components/global-panel/types'
import type { MockRule, ResourceType } from '@/types'

// 懒加载 MockConfig 组件
const MockConfig = lazy(() => import('@/components/mock-config').then(module => ({ default: module.MockConfig })))

// 懒加载加载占位符
function LoadingPlaceholder() {
  return (
    <div className="flex items-center justify-center py-12">
      <div className="text-muted-foreground">加载中...</div>
    </div>
  )
}

function App() {
  const store = useProxyStore()
  const navigate = useNavigate()
  const location = useLocation()
  const { filterText, setFilterText, resourceTypeFilter, setResourceTypeFilter, filteredRecords } = useFuzzyFilter(store.records)
  const [recording, setRecording] = useState(true)
  const [autoScroll, setAutoScroll] = useState(true)

  // 从 URL 路径获取当前 tab
  const getTabFromPath = (pathname: string): string => {
    const tabMap: Record<string, string> = {
      '/': 'logs',
      '/logs': 'logs',
      '/config': 'config',
      '/mock': 'mock',
      '/plugins': 'plugins',
    }
    return tabMap[pathname] || 'logs'
  }

  const activeTab = getTabFromPath(location.pathname)

  const handleTabChange = (tab: string) => {
    const pathMap: Record<string, string> = {
      logs: '/logs',
      config: '/config',
      mock: '/mock',
      plugins: '/plugins',
    }
    navigate(pathMap[tab] || '/')
  }

  const handleCreateMockFromLog = useCallback((data: CreateMockFromLogData) => {
    const mockData = createMockFromLog(data)
    store.closeDetail()
    navigate('/mock')
    window.dispatchEvent(new CustomEvent('global-panel:open-panel', {
      detail: { id: 'mock.create', title: '新建 Mock 规则', size: 'lg', params: { initialData: mockData } },
    }))
  }, [navigate, store])

  const handleReplay = useCallback(async (id: number) => {
    // replayRequest 失败会直接抛出含后端错误信息的异常，由 DetailPanel 捕获显示
    const result = await store.replayRequest(id)
    store.fetchDetail(result.recordId)
    return result
  }, [store])

  const openCommandPanel = useCallback(() => {
    window.dispatchEvent(new CustomEvent('global-panel:open-command'))
  }, [])

  const openPanelRoute = useCallback((route: GlobalPanelRoute) => {
    window.dispatchEvent(new CustomEvent('global-panel:open-panel', { detail: route }))
  }, [])

  const handleSelectRecord = useCallback((id: number) => {
    void store.fetchDetail(id)
    openPanelRoute({ id: 'request.detail', title: '请求详情', size: 'lg' })
  }, [openPanelRoute, store])

  const createCommands = useCallback((panel: GlobalPanelApi): CommandAction[] => {
    const resourceTypes: { value: ResourceType; label: string }[] = [
      { value: 'all', label: '全部资源' },
      { value: 'fetch', label: 'Fetch/XHR' },
      { value: 'doc', label: 'Doc' },
      { value: 'css', label: 'CSS' },
      { value: 'js', label: 'JS' },
      { value: 'font', label: 'Font' },
      { value: 'img', label: '图片' },
      { value: 'media', label: '媒体' },
      { value: 'manifest', label: 'Manifest' },
      { value: 'websocket', label: 'WebSocket' },
      { value: 'wasm', label: 'Wasm' },
      { value: 'other', label: '其他资源' },
    ]

    return [
      { id: 'nav.logs', title: '打开日志', section: '导航', icon: Globe, keywords: ['logs', '请求'], run: () => navigate('/logs') },
      { id: 'nav.rules', title: '打开路由规则', section: '导航', icon: FileText, keywords: ['rules', 'config'], run: () => navigate('/config') },
      { id: 'nav.mock', title: '打开 Mock', section: '导航', icon: ClipboardList, keywords: ['mock'], run: () => navigate('/mock') },
      { id: 'nav.plugins', title: '打开扩展插件', section: '导航', icon: Plug, keywords: ['plugin', 'plugins'], run: () => navigate('/plugins') },
      {
        id: 'panel.settings',
        title: '打开系统设置',
        description: '偏好、配置文件、AI 配置',
        section: '全局',
        icon: Settings,
        keywords: ['settings', '配置', 'AI'],
        closeOnRun: false,
        run: () => panel.openPanel({ id: 'settings', title: '系统设置', description: '管理系统偏好、配置和 AI 功能', size: 'lg' }),
      },
      {
        id: 'logs.focus-filter',
        title: '聚焦日志过滤器',
        description: '输入 method:GET、domain:example.com 或关键词筛选请求',
        section: '日志',
        icon: Search,
        run: () => {
          navigate('/logs')
          window.setTimeout(() => document.getElementById('proxy-log-filter')?.focus(), 50)
        },
      },
      {
        id: 'logs.toggle-recording',
        title: recording ? '暂停记录日志' : '恢复记录日志',
        section: '日志',
        icon: recording ? Pause : Play,
        run: () => setRecording((value) => !value),
      },
      {
        id: 'logs.clear',
        title: '清空日志',
        section: '日志',
        icon: Trash2,
        danger: true,
        confirm: '确定要清空当前日志列表吗？',
        run: store.clearRecords,
      },
      {
        id: 'logs.toggle-auto-scroll',
        title: autoScroll ? '关闭自动滚动' : '开启自动滚动',
        section: '日志',
        icon: ListFilter,
        run: () => setAutoScroll((value) => !value),
      },
      ...resourceTypes.map((type) => ({
        id: `logs.resource.${type.value}`,
        title: `日志只看：${type.label}`,
        section: '日志',
        icon: Filter,
        keywords: ['资源类型', type.value],
        run: () => {
          navigate('/logs')
          setResourceTypeFilter(type.value)
        },
      })),
      {
        id: 'request.detail',
        title: '打开当前请求详情',
        section: '日志',
        icon: FileText,
        disabled: store.selectedRecordId == null,
        disabledReason: '请先在日志表里选择一条请求',
        closeOnRun: false,
        run: () => panel.openPanel({ id: 'request.detail', title: '请求详情', size: 'lg' }),
      },
      {
        id: 'request.replay',
        title: '重放当前请求',
        section: '日志',
        icon: RotateCw,
        disabled: store.selectedRecordId == null,
        disabledReason: '请先在日志表里选择一条请求',
        run: async () => {
          if (store.selectedRecordId != null) await handleReplay(store.selectedRecordId)
        },
      },
      {
        id: 'rules.ai',
        title: '打开 AI 规则助手',
        section: '路由规则',
        icon: Sparkles,
        keywords: ['AI', '生成规则', '合并规则'],
        closeOnRun: false,
        run: () => panel.openPanel({ id: 'rules.ai', title: 'AI 规则助手', description: '用自然语言生成规则，或安全合并当前配置', size: 'md' }),
      },
      {
        id: 'rules.preview',
        title: '预览 URL 转发结果',
        description: '输入 URL，使用当前规则计算真实转发地址',
        section: '路由规则',
        icon: Search,
        keywords: ['URL', 'preview', 'route', '转发', '预览'],
        closeOnRun: false,
        run: () => {
          panel.openPanel({ id: 'rules.preview', title: 'URL 预览', description: '使用当前编辑中的规则计算真实转发地址', size: 'md' })
        },
      },
      {
        id: 'rules.add',
        title: '添加路由规则',
        section: '路由规则',
        icon: FilePlus2,
        disabled: !store.activeFileName,
        disabledReason: '请先选择或创建一个规则文件',
        run: () => {
          navigate('/config')
          store.setRules((prev) => [{ enabled: true, rule: '', target: '', exclusions: [] }, ...prev])
        },
      },
      {
        id: 'rules.save',
        title: '保存当前规则文件',
        description: store.activeFileName ? `保存 ${store.activeFileName}` : undefined,
        section: '路由规则',
        icon: Save,
        disabled: !store.activeFileName,
        disabledReason: '请先选择一个规则文件',
        run: async () => {
          if (!store.activeFileName) return
          await store.saveFileContent(store.activeFileName, store.rules)
          await store.fetchRuleFiles()
        },
      },
      {
        id: 'rules.create-file',
        title: '创建规则文件',
        section: '路由规则',
        icon: FilePlus2,
        run: async () => {
          const name = window.prompt('请输入规则文件名称')
          if (!name?.trim()) return
          const result = await store.createRuleFile(name.trim())
          if (result.success) {
            navigate('/config')
            await store.fetchFileContent(name.trim())
          } else if (result.error) {
            window.alert(result.error)
          }
        },
      },
      ...store.ruleFiles.map((file) => ({
        id: `rules.file.open.${file.name}`,
        title: `打开规则文件：${file.name}`,
        description: `${file.ruleCount} 条规则 · ${file.enabled ? '已启用' : '未启用'}`,
        section: '规则文件',
        icon: FileText,
        keywords: ['规则文件', file.name],
        run: async () => {
          navigate('/config')
          await store.fetchFileContent(file.name)
        },
      })),
      ...store.ruleFiles.map((file) => ({
        id: `rules.file.toggle.${file.name}`,
        title: `${file.enabled ? '禁用' : '启用'}规则文件：${file.name}`,
        section: '规则文件',
        icon: Power,
        keywords: ['规则文件', file.name, '启用', '禁用'],
        run: async () => {
          await store.toggleRuleFile(file.name, !file.enabled)
        },
      })),
      ...store.ruleFiles.map((file) => ({
        id: `rules.file.delete.${file.name}`,
        title: `删除规则文件：${file.name}`,
        section: '规则文件',
        icon: Trash2,
        danger: true,
        confirm: `确定要删除规则文件「${file.name}」吗？`,
        keywords: ['规则文件', file.name, '删除'],
        run: async () => {
          await store.deleteRuleFile(file.name)
        },
      })),
      {
        id: 'mock.create',
        title: '新建 Mock 规则',
        section: 'Mock',
        icon: ClipboardList,
        keywords: ['mock', '新增规则'],
        closeOnRun: false,
        run: () => panel.openPanel({ id: 'mock.create', title: '新建 Mock 规则', size: 'lg' }),
      },
      ...store.mockRules.map((rule) => ({
        id: `mock.edit.${rule.id}`,
        title: `编辑 Mock：${rule.name || rule.urlPattern}`,
        description: `${rule.method || '*'} ${rule.urlPattern}`,
        section: 'Mock',
        icon: Pencil,
        keywords: ['mock', rule.name, rule.urlPattern],
        closeOnRun: false,
        run: () => panel.openPanel({
          id: 'mock.edit',
          title: `编辑 Mock：${rule.name || rule.urlPattern}`,
          size: 'lg',
          params: { id: rule.id },
        }),
      })),
      ...store.mockRules.map((rule) => ({
        id: `mock.toggle.${rule.id}`,
        title: `${rule.enabled ? '禁用' : '启用'} Mock：${rule.name || rule.urlPattern}`,
        description: `${rule.method || '*'} ${rule.urlPattern}`,
        section: 'Mock',
        icon: Power,
        keywords: ['mock', rule.name, rule.urlPattern, '启用', '禁用'],
        run: async () => {
          await store.updateMock(rule.id, { enabled: !rule.enabled })
          await store.fetchMocks()
        },
      })),
      ...store.mockRules.map((rule) => ({
        id: `mock.delete.${rule.id}`,
        title: `删除 Mock：${rule.name || rule.urlPattern}`,
        description: `${rule.method || '*'} ${rule.urlPattern}`,
        section: 'Mock',
        icon: Trash2,
        danger: true,
        confirm: `确定要删除 Mock「${rule.name || rule.urlPattern}」吗？`,
        keywords: ['mock', rule.name, rule.urlPattern, '删除'],
        run: async () => {
          await store.deleteMock(rule.id)
          await store.fetchMocks()
        },
      })),
      {
        id: 'mock.refresh',
        title: '刷新 Mock 列表',
        section: 'Mock',
        icon: RotateCw,
        run: store.fetchMocks,
      },
      {
        id: 'plugins.mode.off',
        title: '关闭插件模式',
        section: '插件',
        icon: Power,
        keywords: ['plugin', 'plugins', 'mode', 'off', '插件模式'],
        run: () => store.switchPluginMode('off'),
      },
      {
        id: 'plugins.mode.on',
        title: '开启插件模式',
        section: '插件',
        icon: Plug,
        keywords: ['plugin', 'plugins', 'mode', 'on', '插件模式'],
        run: () => store.switchPluginMode('on'),
      },
      {
        id: 'plugins.mode.shadow',
        title: '切换到插件影子模式',
        section: '插件',
        icon: Sparkles,
        keywords: ['plugin', 'plugins', 'mode', 'shadow', '插件模式', '影子模式'],
        run: () => store.switchPluginMode('shadow'),
      },
      {
        id: 'plugins.generate',
        title: 'AI 生成插件',
        section: '插件',
        icon: Bot,
        keywords: ['plugin', 'plugins', 'generate', 'AI', '插件生成'],
        closeOnRun: false,
        run: () => panel.openPanel({ id: 'plugin.generate', title: 'AI 插件生成器', size: 'xl' }),
      },
      {
        id: 'plugins.reload',
        title: '热加载插件',
        section: '插件',
        icon: RotateCw,
        keywords: ['plugin', 'plugins', 'reload', 'hot reload', '热加载'],
        run: async () => {
          await fetch('/api/plugins/reload', { method: 'POST' })
          await store.fetchPlugins()
        },
      },
      ...store.plugins.map((plugin) => ({
        id: `plugins.runtime.${plugin.state === 'running' ? 'stop' : 'start'}.${plugin.id}`,
        title: `${plugin.state === 'running' ? '停止' : '启动'}插件：${plugin.name}`,
        description: `${plugin.version} · ${plugin.hooks.join(', ') || '无 hooks'}`,
        section: '插件',
        icon: plugin.state === 'running' ? Square : Play,
        keywords: ['插件', plugin.name, plugin.id, ...plugin.hooks],
        run: async () => {
          if (plugin.state === 'running') {
            await store.stopPlugin(plugin.id)
          } else {
            await store.startPlugin(plugin.id)
          }
          await store.fetchPlugins()
        },
      })),
      ...store.plugins
        .filter((plugin) => plugin.id.startsWith('local.'))
        .map((plugin) => {
          const filename = `${plugin.id.replace(/^local\./, '')}.js`
          return {
            id: `plugins.edit.${plugin.id}`,
            title: `编辑插件代码：${plugin.name}`,
            description: filename,
            section: '插件',
            icon: Code2,
            keywords: ['插件', '代码', plugin.name, plugin.id, filename],
            closeOnRun: false,
            run: () => panel.openPanel({
              id: 'plugin.code',
              title: `编辑插件代码：${filename}`,
              size: 'xl',
              params: { filename },
            }),
          }
        }),
      ...store.plugins
        .filter((plugin) => plugin.id.startsWith('local.'))
        .map((plugin) => ({
          id: `plugins.test.${plugin.id}`,
          title: `测试插件：${plugin.name}`,
          description: plugin.hooks.join(', ') || '无 hooks',
          section: '插件',
          icon: TestTube2,
          keywords: ['插件', '测试', plugin.name, plugin.id, ...plugin.hooks],
          closeOnRun: false,
          run: () => panel.openPanel({
            id: 'plugin.test',
            title: `测试插件：${plugin.name}`,
            size: 'xl',
            params: { pluginId: plugin.id, pluginName: plugin.name, hooks: plugin.hooks },
          }),
        })),
      ...store.plugins.map((plugin) => ({
        id: `plugins.toggle.${plugin.id}`,
        title: `${plugin.state === 'disabled' ? '启用' : '禁用'}插件：${plugin.name}`,
        description: plugin.id,
        section: '插件',
        icon: Power,
        keywords: ['插件', plugin.name, plugin.id, '启用', '禁用'],
        run: async () => {
          await store.togglePlugin(plugin.id, plugin.state === 'disabled')
          await store.fetchPlugins()
        },
      })),
      {
        id: 'plugins.third-party.load',
        title: '加载第三方插件',
        section: '插件',
        icon: Upload,
        keywords: ['plugin', 'plugins', 'third party', 'load', '第三方插件'],
        run: async () => {
          const path = window.prompt('请输入第三方插件路径')
          if (!path?.trim()) return
          await store.loadThirdPartyPlugin(path.trim())
          await store.fetchThirdPartyPlugins()
        },
      },
      ...store.thirdPartyPlugins.map((plugin) => ({
        id: `plugins.third-party.unload.${plugin.id}`,
        title: `卸载第三方插件：${plugin.name}`,
        description: plugin.id,
        section: '插件',
        icon: Trash2,
        danger: true,
        confirm: `确定要卸载第三方插件「${plugin.name}」吗？`,
        keywords: ['第三方插件', plugin.name, plugin.id, '卸载'],
        run: async () => {
          await store.unloadThirdPartyPlugin(plugin.id)
          await store.fetchThirdPartyPlugins()
        },
      })),
      {
        id: 'settings.theme',
        title: '主题与缩放设置',
        section: '设置',
        icon: Brush,
        keywords: ['settings', 'theme', 'zoom', '主题', '缩放'],
        closeOnRun: false,
        run: () => panel.openPanel({ id: 'settings', title: '系统设置', description: '打开偏好设置', size: 'lg' }),
      },
    ]
  }, [
    autoScroll,
    handleReplay,
    navigate,
    recording,
    setResourceTypeFilter,
    store,
  ])

  const renderPanel = useCallback((route: GlobalPanelRoute, panel: GlobalPanelApi) => {
    switch (route.id) {
      case 'settings':
        return <SettingsPanel embedded />
      case 'request.detail':
        return (
          <DetailPanel
            embedded
            detail={store.recordDetail}
            loading={store.detailLoading}
            error={store.detailError}
            selectedRecord={store.records.find(r => r.id === store.selectedRecordId)}
            onCreateMock={handleCreateMockFromLog}
            onReplay={handleReplay}
          />
        )
      case 'plugin.generate':
        return (
          <PluginGenerator
            embedded
            onOpenChange={(open) => { if (!open) panel.close() }}
            onPluginSaved={async () => {
              await store.fetchPlugins()
            }}
          />
        )
      case 'mock.create':
        return (
          <MockEditorPanel
            initialData={route.params?.initialData as Partial<MockRule> | undefined}
            createMock={store.createMock}
            updateMock={store.updateMock}
            onSaved={() => {
              void store.fetchMocks()
              panel.close()
            }}
          />
        )
      case 'mock.edit': {
        const id = Number(route.params?.id)
        const rule = store.mockRules.find((item) => item.id === id)
        if (!rule) {
          return (
            <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
              没有找到这条 Mock 规则
            </div>
          )
        }
        return (
          <MockEditorPanel
            rule={rule}
            createMock={store.createMock}
            updateMock={store.updateMock}
            onSaved={() => {
              void store.fetchMocks()
              panel.close()
            }}
          />
        )
      }
      case 'plugin.code':
        return (
          <PluginCodeEditor
            embedded
            filename={String(route.params?.filename || '')}
            onOpenChange={(open) => { if (!open) panel.close() }}
            onSaved={store.fetchPlugins}
          />
        )
      case 'plugin.test':
        return (
          <PluginTestDialog
            embedded
            pluginId={String(route.params?.pluginId || '')}
            pluginName={String(route.params?.pluginName || '')}
            hooks={Array.isArray(route.params?.hooks) ? route.params.hooks as string[] : []}
            onOpenChange={(open) => { if (!open) panel.close() }}
            onPluginFixed={store.fetchPlugins}
          />
        )
      case 'rules.ai':
        return (
          <RuleAiAssistantPanel
            rules={store.rules}
            setRules={store.setRules}
            ruleFiles={store.ruleFiles}
            activeFileName={store.activeFileName}
            fetchRuleFileRawContent={store.fetchRuleFileRawContent}
          />
        )
      case 'rules.preview':
        return (
          <RoutePreview
            embedded
            rules={store.rules}
            activeFileName={store.activeFileName}
          />
        )
      default:
        return (
          <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
            未找到这个面板
          </div>
        )
    }
  }, [
    handleCreateMockFromLog,
    handleReplay,
    store,
  ])

  // When paused, keep a snapshot of records
  const displayRecords = recording ? filteredRecords : filteredRecords

  // 页面加载时获取插件列表（仅用于显示第三方插件）
  useEffect(() => {
    store.fetchPlugins()
  }, [store.fetchPlugins])

  return (
    <GlobalPanelProvider commands={createCommands} renderPanel={renderPanel}>
    <div className="min-h-screen bg-background">
      <AppHeader
        onSettingsClick={() => openPanelRoute({ id: 'settings', title: '系统设置', description: '管理系统偏好、配置和 AI 功能', size: 'lg' })}
        onCommandClick={openCommandPanel}
      />

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 py-4">
        <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-3">
          <TabsList>
            <TabsTrigger value="logs">日志</TabsTrigger>
            <TabsTrigger value="config">路由规则</TabsTrigger>
            <TabsTrigger value="mock">
              Mock
              {store.mockRules.filter(r => r.enabled).length > 0 && (
                <span className="ml-1.5 inline-flex items-center justify-center rounded-full bg-primary/10 text-primary px-1.5 py-0.5 text-[10px] font-medium">
                  {store.mockRules.filter(r => r.enabled).length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="plugins">扩展插件</TabsTrigger>
          </TabsList>

          <TabsContent value="logs" className="space-y-0 mt-0">
              <div className="rounded-lg border bg-card">
                <LogFilter
                  filterText={filterText}
                  setFilterText={setFilterText}
                  resourceTypeFilter={resourceTypeFilter}
                  setResourceTypeFilter={setResourceTypeFilter}
                  totalCount={store.records.length}
                  filteredCount={filteredRecords.length}
                  onClear={store.clearRecords}
                  recording={recording}
                  onToggleRecording={() => setRecording((r) => !r)}
                />
                <LogTable
                  records={displayRecords}
                  selectedRecordId={store.selectedRecordId}
                  onSelect={handleSelectRecord}
                  autoScroll={autoScroll}
                />
              </div>
            </TabsContent>

          <TabsContent value="config" className="mt-0">
            <div className="rounded-lg border bg-card p-4">
              <RuleConfig
                rules={store.rules}
                setRules={store.setRules}
                ruleFiles={store.ruleFiles}
                activeFileName={store.activeFileName}
                fetchRuleFiles={store.fetchRuleFiles}
                fetchFileContent={store.fetchFileContent}
                fetchRuleFileRawContent={store.fetchRuleFileRawContent}
                saveFileContent={store.saveFileContent}
                createRuleFile={store.createRuleFile}
                toggleRuleFile={store.toggleRuleFile}
                deleteRuleFile={store.deleteRuleFile}
              />
            </div>
          </TabsContent>

          <TabsContent value="mock" className="mt-0">
            <div className="rounded-lg border bg-card p-4">
              <Suspense fallback={<LoadingPlaceholder />}>
                <MockConfig
                  mockRules={store.mockRules}
                  fetchMocks={store.fetchMocks}
                  createMock={store.createMock}
                  updateMock={store.updateMock}
                  deleteMock={store.deleteMock}
                />
              </Suspense>
            </div>
          </TabsContent>

          <TabsContent value="plugins" className="mt-0">
            <div className="rounded-lg border bg-card p-4">
              <PluginConfig
                // 插件列表相关
                plugins={store.plugins}
                pluginMode={store.pluginMode}
                switchPluginMode={store.switchPluginMode}
                fetchPlugins={store.fetchPlugins}
                startPlugin={store.startPlugin}
                stopPlugin={store.stopPlugin}
                togglePlugin={store.togglePlugin}
                // 第三方插件相关
                thirdPartyPlugins={store.thirdPartyPlugins}
                thirdPartySecurity={store.thirdPartySecurity}
                fetchThirdPartyPlugins={store.fetchThirdPartyPlugins}
                loadThirdPartyPlugin={store.loadThirdPartyPlugin}
                unloadThirdPartyPlugin={store.unloadThirdPartyPlugin}
              />
            </div>
          </TabsContent>
        </Tabs>
      </main>

    </div>
    </GlobalPanelProvider>
  )
}

export default App
