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
  QrCode,
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
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { LogFilter } from '@/components/log-filter'
import { LogTable } from '@/components/log-table'
import { AppHeader } from '@/components/app-header'
import { useProxyStore } from '@/hooks/use-proxy-store'
import { useFuzzyFilter } from '@/hooks/use-fuzzy-filter'
import { createMockFromLog, type CreateMockFromLogData } from '@/utils/mock-factory'
import { GlobalPanelProvider } from '@/components/global-panel/global-panel-context'
import type { CommandAction, GlobalPanelApi, GlobalPanelRoute } from '@/components/global-panel/types'
import type { MockRule, ResourceType } from '@/types'

const RuleConfig = lazy(() =>
  import('@/components/rule-config').then((module) => ({
    default: module.RuleConfig,
  })),
)
const MockConfig = lazy(() =>
  import('@/components/mock-config').then((module) => ({
    default: module.MockConfig,
  })),
)
const PluginConfig = lazy(() =>
  import('@/components/plugin-config').then((module) => ({
    default: module.PluginConfig,
  })),
)
const DetailPanel = lazy(() =>
  import('@/components/detail-panel').then((module) => ({
    default: module.DetailPanel,
  })),
)
const SettingsPanel = lazy(() =>
  import('@/components/settings-panel').then((module) => ({
    default: module.SettingsPanel,
  })),
)
const PluginGenerator = lazy(() =>
  import('@/components/plugin-generator').then((module) => ({
    default: module.PluginGenerator,
  })),
)
const PluginCodeEditor = lazy(() =>
  import('@/components/plugin-code-editor').then((module) => ({
    default: module.PluginCodeEditor,
  })),
)
const PluginTestDialog = lazy(() =>
  import('@/components/plugin-test-dialog').then((module) => ({
    default: module.PluginTestDialog,
  })),
)
const RuleAiAssistantPanel = lazy(() =>
  import('@/components/rule-ai-assistant-panel').then((module) => ({
    default: module.RuleAiAssistantPanel,
  })),
)
const MockEditorPanel = lazy(() =>
  import('@/components/mock-editor-panel').then((module) => ({
    default: module.MockEditorPanel,
  })),
)
const RoutePreview = lazy(() =>
  import('@/components/route-preview').then((module) => ({
    default: module.RoutePreview,
  })),
)
const MobileProxyPanel = lazy(() =>
  import('@/components/mobile-proxy-panel').then((module) => ({
    default: module.MobileProxyPanel,
  })),
)

function LoadingPlaceholder() {
  return (
    <div className="flex flex-col gap-3 p-6" aria-label="加载中">
      <Skeleton className="h-5 w-32" />
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  )
}

function App() {
  const store = useProxyStore()
  const fetchPlugins = store.fetchPlugins
  const navigate = useNavigate()
  const location = useLocation()
  const { filterText, setFilterText, resourceTypeFilter, setResourceTypeFilter, clientSourceFilter, setClientSourceFilter, filteredRecords } = useFuzzyFilter(
    store.records,
  )
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

  const handleCreateMockFromLog = useCallback(
    (data: CreateMockFromLogData) => {
      const mockData = createMockFromLog(data)
      store.closeDetail()
      navigate('/mock')
      window.dispatchEvent(
        new CustomEvent('global-panel:open-panel', {
          detail: {
            id: 'mock.create',
            title: '新建 Mock 规则',
            size: 'lg',
            params: { initialData: mockData },
          },
        }),
      )
    },
    [navigate, store],
  )

  const handleReplay = useCallback(
    async (id: number) => {
      // replayRequest 失败会直接抛出含后端错误信息的异常，由 DetailPanel 捕获显示
      const result = await store.replayRequest(id)
      store.fetchDetail(result.recordId)
      return result
    },
    [store],
  )

  const openCommandPanel = useCallback(() => {
    window.dispatchEvent(new CustomEvent('global-panel:open-command'))
  }, [])

  const openPanelRoute = useCallback((route: GlobalPanelRoute) => {
    window.dispatchEvent(new CustomEvent('global-panel:open-panel', { detail: route }))
  }, [])

  const handleSelectRecord = useCallback(
    (id: number) => {
      void store.fetchDetail(id)
      openPanelRoute({ id: 'request.detail', title: '请求详情', size: 'lg' })
    },
    [openPanelRoute, store],
  )

  const createCommands = useCallback(
    (panel: GlobalPanelApi): CommandAction[] => {
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
        {
          id: 'nav.logs',
          title: '打开日志',
          section: '导航',
          icon: Globe,
          keywords: ['logs', '请求'],
          run: () => navigate('/logs'),
        },
        {
          id: 'nav.rules',
          title: '打开路由规则',
          section: '导航',
          icon: FileText,
          keywords: ['rules', 'config'],
          run: () => navigate('/config'),
        },
        {
          id: 'nav.mock',
          title: '打开 Mock',
          section: '导航',
          icon: ClipboardList,
          keywords: ['mock'],
          run: () => navigate('/mock'),
        },
        {
          id: 'nav.plugins',
          title: '打开扩展插件',
          section: '导航',
          icon: Plug,
          keywords: ['plugin', 'plugins'],
          run: () => navigate('/plugins'),
        },
        {
          id: 'panel.settings',
          title: '打开系统设置',
          description: '偏好、配置文件、AI 配置',
          section: '全局',
          icon: Settings,
          keywords: ['settings', '配置', 'AI'],
          closeOnRun: false,
          run: () =>
            panel.openPanel({
              id: 'settings',
              title: '系统设置',
              description: '管理系统偏好、配置和 AI 功能',
              size: 'lg',
            }),
        },
        {
          id: 'panel.mobile-proxy',
          title: '打开手机代理二维码',
          description: '扫码配置手机代理并安装 HTTPS 根证书',
          section: '全局',
          icon: QrCode,
          keywords: ['手机', '二维码', 'QR', 'remote', 'proxy'],
          closeOnRun: false,
          run: () =>
            panel.openPanel({
              id: 'mobile-proxy',
              title: '手机代理',
              description: '扫描二维码，在手机上配置代理与 HTTPS 证书',
              size: 'md',
            }),
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
          run: () =>
            panel.openPanel({
              id: 'request.detail',
              title: '请求详情',
              size: 'lg',
            }),
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
          run: () =>
            panel.openPanel({
              id: 'rules.ai',
              title: 'AI 规则助手',
              description: '用自然语言生成规则，或安全合并当前配置',
              size: 'md',
            }),
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
            panel.openPanel({
              id: 'rules.preview',
              title: 'URL 预览',
              description: '使用当前编辑中的规则计算真实转发地址',
              size: 'md',
            })
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
          run: () =>
            panel.openPanel({
              id: 'mock.create',
              title: '新建 Mock 规则',
              size: 'lg',
            }),
        },
        ...store.mockRules.map((rule) => ({
          id: `mock.edit.${rule.id}`,
          title: `编辑 Mock：${rule.name || rule.urlPattern}`,
          description: `${rule.method || '*'} ${rule.urlPattern}`,
          section: 'Mock',
          icon: Pencil,
          keywords: ['mock', rule.name, rule.urlPattern],
          closeOnRun: false,
          run: () =>
            panel.openPanel({
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
          run: () =>
            panel.openPanel({
              id: 'plugin.generate',
              title: 'AI 插件生成器',
              size: 'xl',
            }),
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
              run: () =>
                panel.openPanel({
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
            run: () =>
              panel.openPanel({
                id: 'plugin.test',
                title: `测试插件：${plugin.name}`,
                size: 'xl',
                params: {
                  pluginId: plugin.id,
                  pluginName: plugin.name,
                  hooks: plugin.hooks,
                },
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
          run: () =>
            panel.openPanel({
              id: 'settings',
              title: '系统设置',
              description: '打开偏好设置',
              size: 'lg',
            }),
        },
      ]
    },
    [autoScroll, handleReplay, navigate, recording, setResourceTypeFilter, store],
  )

  const renderPanel = useCallback(
    (route: GlobalPanelRoute, panel: GlobalPanelApi) => {
      switch (route.id) {
        case 'settings':
          return <SettingsPanel embedded />
        case 'mobile-proxy':
          return <MobileProxyPanel />
        case 'request.detail':
          return (
            <DetailPanel
              embedded
              detail={store.recordDetail}
              loading={store.detailLoading}
              error={store.detailError}
              selectedRecord={store.records.find((r) => r.id === store.selectedRecordId)}
              onCreateMock={handleCreateMockFromLog}
              onReplay={handleReplay}
            />
          )
        case 'plugin.generate':
          return (
            <PluginGenerator
              embedded
              onOpenChange={(open) => {
                if (!open) panel.close()
              }}
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
            return <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">没有找到这条 Mock 规则</div>
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
              onOpenChange={(open) => {
                if (!open) panel.close()
              }}
              onSaved={store.fetchPlugins}
            />
          )
        case 'plugin.test':
          return (
            <PluginTestDialog
              embedded
              pluginId={String(route.params?.pluginId || '')}
              pluginName={String(route.params?.pluginName || '')}
              hooks={Array.isArray(route.params?.hooks) ? (route.params.hooks as string[]) : []}
              onOpenChange={(open) => {
                if (!open) panel.close()
              }}
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
              onRevealRule={(matchedRule) => {
                panel.close()
                navigate('/config')
                window.setTimeout(() => {
                  window.dispatchEvent(
                    new CustomEvent('route-rule:highlight', {
                      detail: {
                        pattern: matchedRule.pattern,
                        target: matchedRule.target,
                      },
                    }),
                  )
                }, 120)
              }}
            />
          )
        default:
          return <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">未找到这个面板</div>
      }
    },
    [handleCreateMockFromLog, handleReplay, navigate, store],
  )

  // When paused, keep a snapshot of records
  const displayRecords = recording ? filteredRecords : filteredRecords

  // 页面加载时获取插件列表（仅用于显示第三方插件）
  useEffect(() => {
    fetchPlugins()
  }, [fetchPlugins])

  return (
    <GlobalPanelProvider
      commands={createCommands}
      renderPanel={(route, panel) => <Suspense fallback={<LoadingPlaceholder />}>{renderPanel(route, panel)}</Suspense>}
    >
      <div className="flex h-dvh flex-col overflow-hidden bg-muted/20">
        <AppHeader
          onSettingsClick={() =>
            openPanelRoute({
              id: 'settings',
              title: '系统设置',
              description: '管理系统偏好、配置和 AI 功能',
              size: 'lg',
            })
          }
          onCommandClick={openCommandPanel}
          onMobileProxyClick={() =>
            openPanelRoute({
              id: 'mobile-proxy',
              title: '手机代理',
              description: '扫描二维码，在手机上配置代理与 HTTPS 证书',
              size: 'md',
            })
          }
        />

        {/* Main Content */}
        <main className="mx-auto flex min-h-0 w-full max-w-[1600px] flex-1 px-4 pt-4 lg:px-6">
          <Card className="h-full min-h-0 w-full flex-1 gap-0 overflow-hidden rounded-b-none py-0">
            <Tabs value={activeTab} onValueChange={handleTabChange} className="min-h-0 flex-1 gap-0">
              <div className="flex shrink-0 items-center gap-3 border-b px-4 py-2">
                <TabsList className="!h-auto max-w-full justify-start gap-1 overflow-x-auto p-1">
                  <TabsTrigger value="logs" className="h-8 flex-none px-3" title="查看经过代理的本机、远程设备和插件测试流量">
                    <Globe />
                    日志
                  </TabsTrigger>
                  <TabsTrigger value="config" className="h-8 flex-none px-3" title="管理代理转发规则，并在表格、文本和图表视图间切换">
                    <FileText />
                    路由规则
                  </TabsTrigger>
                  <TabsTrigger value="mock" className="h-8 flex-none px-3" title="匹配请求后返回本地响应，用于联调和异常场景测试">
                    <ClipboardList />
                    Mock
                    {store.mockRules.filter((r) => r.enabled).length > 0 && <Badge variant="secondary">{store.mockRules.filter((r) => r.enabled).length}</Badge>}
                  </TabsTrigger>
                  <TabsTrigger value="plugins" className="h-8 flex-none px-3" title="控制内置、自定义和第三方插件的运行状态">
                    <Plug />
                    扩展插件
                  </TabsTrigger>
                </TabsList>
                {activeTab === 'logs' && (
                  <Badge variant={recording ? 'default' : 'secondary'} className="ml-auto shrink-0">
                    <span className={recording ? 'size-1.5 rounded-full bg-current opacity-70' : 'size-1.5 rounded-full bg-current opacity-50'} />
                    {recording ? '记录中' : '已暂停'}
                  </Badge>
                )}
              </div>

              <TabsContent value="logs" className="mt-0 flex min-h-0 flex-col">
                <CardContent className="px-4 py-3">
                  <LogFilter
                    filterText={filterText}
                    setFilterText={setFilterText}
                    resourceTypeFilter={resourceTypeFilter}
                    setResourceTypeFilter={setResourceTypeFilter}
                    clientSourceFilter={clientSourceFilter}
                    setClientSourceFilter={setClientSourceFilter}
                    totalCount={store.records.length}
                    filteredCount={filteredRecords.length}
                    onClear={store.clearRecords}
                    recording={recording}
                    onToggleRecording={() => setRecording((r) => !r)}
                  />
                </CardContent>
                <LogTable records={displayRecords} selectedRecordId={store.selectedRecordId} onSelect={handleSelectRecord} autoScroll={autoScroll} />
              </TabsContent>

              <TabsContent value="config" className="mt-0 min-h-0 overflow-y-auto">
                <CardContent className="app-workspace-content">
                  <Suspense fallback={<LoadingPlaceholder />}>
                    <RuleConfig
                      rules={store.rules}
                      setRules={store.setRules}
                      ruleFiles={store.ruleFiles}
                      activeFileName={store.activeFileName}
                      fetchRuleFiles={store.fetchRuleFiles}
                      fetchFileContent={store.fetchFileContent}
                      fetchRuleFileRawContent={store.fetchRuleFileRawContent}
                      saveRuleFileRawContent={store.saveRuleFileRawContent}
                      saveFileContent={store.saveFileContent}
                      createRuleFile={store.createRuleFile}
                      toggleRuleFile={store.toggleRuleFile}
                      renameRuleFile={store.renameRuleFile}
                      deleteRuleFile={store.deleteRuleFile}
                    />
                  </Suspense>
                </CardContent>
              </TabsContent>

              <TabsContent value="mock" className="mt-0 min-h-0 overflow-y-auto">
                <CardContent className="app-workspace-content">
                  <Suspense fallback={<LoadingPlaceholder />}>
                    <MockConfig
                      mockRules={store.mockRules}
                      fetchMocks={store.fetchMocks}
                      createMock={store.createMock}
                      updateMock={store.updateMock}
                      deleteMock={store.deleteMock}
                    />
                  </Suspense>
                </CardContent>
              </TabsContent>

              <TabsContent value="plugins" className="mt-0 min-h-0 overflow-y-auto">
                <CardContent className="app-workspace-content">
                  <Suspense fallback={<LoadingPlaceholder />}>
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
                  </Suspense>
                </CardContent>
              </TabsContent>
            </Tabs>
          </Card>
        </main>
      </div>
    </GlobalPanelProvider>
  )
}

export default App
