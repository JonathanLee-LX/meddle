import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Play, Square, Loader2, Shield, ShieldAlert, Sparkles, RefreshCw, Zap, TestTube2, Code2 } from 'lucide-react'
import type { Plugin } from '@/types'

interface PluginConfigProps {
  // 插件列表相关
  plugins: Plugin[]
  pluginMode: 'on' | 'off' | 'shadow'
  switchPluginMode: (mode: 'on' | 'off' | 'shadow') => Promise<void>
  fetchPlugins: () => Promise<void>
  startPlugin: (id: string) => Promise<void>
  stopPlugin: (id: string) => Promise<void>
  togglePlugin: (id: string, enabled: boolean) => Promise<void>
  // 第三方插件相关
  thirdPartyPlugins: Plugin[]
  thirdPartySecurity: { allowAll: boolean; trusted: string[] }
  fetchThirdPartyPlugins: () => Promise<void>
  loadThirdPartyPlugin: (path: string) => Promise<void>
  unloadThirdPartyPlugin: (id: string) => Promise<void>
}

interface CustomPluginFile {
  filename: string
  modified: string | number | Date
}

export function PluginConfig({
  plugins,
  pluginMode,
  switchPluginMode,
  fetchPlugins,
  startPlugin,
  stopPlugin,
  togglePlugin,
  thirdPartyPlugins,
  thirdPartySecurity,
  fetchThirdPartyPlugins,
  loadThirdPartyPlugin,
  unloadThirdPartyPlugin,
}: PluginConfigProps) {
  const [loading, setLoading] = useState(false)
  const [thirdPartyPath, setThirdPartyPath] = useState('')
  const [loadingThirdParty, setLoadingThirdParty] = useState(false)
  const [customPlugins, setCustomPlugins] = useState<CustomPluginFile[]>([])
  const [hotReloading, setHotReloading] = useState(false)

  useEffect(() => {
    fetchPlugins()
    fetchThirdPartyPlugins()
    fetchCustomPlugins()
  }, [fetchPlugins, fetchThirdPartyPlugins])

  useEffect(() => {
    const handleCustomPluginsUpdated = () => {
      void fetchCustomPlugins()
    }

    window.addEventListener('plugins-custom-updated', handleCustomPluginsUpdated)
    return () => window.removeEventListener('plugins-custom-updated', handleCustomPluginsUpdated)
  }, [])

  const fetchCustomPlugins = async () => {
    try {
      const res = await fetch('/api/plugins/custom')
      const data = await res.json()
      setCustomPlugins(data.plugins || [])
    } catch (error) {
      console.error('加载自定义插件失败:', error)
    }
  }

  const handleDeleteCustomPlugin = async (filename: string) => {
    if (!confirm(`确定要删除插件 ${filename} 吗？`)) {
      return
    }
    
    try {
      const res = await fetch(`/api/plugins/custom/${encodeURIComponent(filename)}`, {
        method: 'DELETE'
      })
      
      if (res.ok) {
        await fetchCustomPlugins()
      } else {
        const error = await res.json()
        alert(error.error || '删除失败')
      }
    } catch (error) {
      console.error('删除插件失败:', error)
      alert('删除失败')
    }
  }

  const handleHotReload = async () => {
    setHotReloading(true)
    try {
      const res = await fetch('/api/plugins/reload', {
        method: 'POST'
      })
      
      if (res.ok) {
        const data = await res.json()
        alert(`成功热加载 ${data.count} 个插件！`)
        await fetchPlugins()
        await fetchCustomPlugins()
      } else {
        const error = await res.json()
        alert(error.error || '热加载失败')
      }
    } catch (error) {
      console.error('热加载失败:', error)
      alert('热加载失败')
    } finally {
      setHotReloading(false)
    }
  }

  const handleTestPlugin = (pluginId: string, pluginName: string, hooks: string[]) => {
    window.dispatchEvent(new CustomEvent('global-panel:open-panel', {
      detail: {
        id: 'plugin.test',
        title: `测试插件：${pluginName}`,
        size: 'xl',
        params: { pluginId, pluginName, hooks },
      },
    }))
  }

  const handleEditCode = (filename: string) => {
    window.dispatchEvent(new CustomEvent('global-panel:open-panel', {
      detail: {
        id: 'plugin.code',
        title: `编辑插件代码：${filename}`,
        size: 'xl',
        params: { filename },
      },
    }))
  }

  const handleStartPlugin = async (id: string) => {
    setLoading(true)
    try {
      await startPlugin(id)
      await fetchPlugins()
    } finally {
      setLoading(false)
    }
  }

  const handleStopPlugin = async (id: string) => {
    setLoading(true)
    try {
      await stopPlugin(id)
      await fetchPlugins()
    } finally {
      setLoading(false)
    }
  }

  const handleLoadThirdParty = async () => {
    if (!thirdPartyPath.trim()) return
    setLoadingThirdParty(true)
    try {
      await loadThirdPartyPlugin(thirdPartyPath)
      setThirdPartyPath('')
      await fetchThirdPartyPlugins()
    } finally {
      setLoadingThirdParty(false)
    }
  }

  const handleUnloadThirdParty = async (id: string) => {
    setLoadingThirdParty(true)
    try {
      await unloadThirdPartyPlugin(id)
      await fetchThirdPartyPlugins()
    } finally {
      setLoadingThirdParty(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Built-in Plugins */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-medium">内置插件</h3>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">插件模式:</span>
            <Select value={pluginMode} onValueChange={(v) => switchPluginMode(v as 'on' | 'off' | 'shadow')}>
              <SelectTrigger className="w-28 h-7 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="off">关闭</SelectItem>
                <SelectItem value="on">开启</SelectItem>
                <SelectItem value="shadow">影子模式</SelectItem>
              </SelectContent>
            </Select>
            {pluginMode === 'off' && (
              <Badge variant="destructive" className="text-xs">插件未生效</Badge>
            )}
          </div>
        </div>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>名称</TableHead>
                <TableHead>版本</TableHead>
                <TableHead>Hooks</TableHead>
                <TableHead>状态</TableHead>
                <TableHead className="w-24">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {plugins.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                    暂无内置插件
                  </TableCell>
                </TableRow>
              ) : (
                plugins.map((plugin) => (
                  <TableRow key={plugin.id}>
                    <TableCell className="font-medium">{plugin.name}</TableCell>
                    <TableCell>{plugin.version}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {plugin.hooks.map((hook) => (
                          <Badge key={hook} variant="secondary" className="text-xs">
                            {hook}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={plugin.state === 'running' ? 'default' : 'secondary'}>
                        {plugin.state}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {plugin.state === 'running' ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleStopPlugin(plugin.id)}
                          disabled={loading}
                        >
                          <Square className="h-4 w-4" />
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleStartPlugin(plugin.id)}
                          disabled={loading}
                        >
                          <Play className="h-4 w-4" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Custom AI Plugins */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-medium">自定义插件</h3>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={fetchCustomPlugins}
              disabled={loading || hotReloading}
            >
              <RefreshCw className="h-4 w-4 mr-1" />
              刷新列表
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleHotReload}
              disabled={loading || hotReloading}
              className="text-orange-600 border-orange-300 hover:bg-orange-50"
            >
              {hotReloading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  加载中...
                </>
              ) : (
                <>
                  <Zap className="h-4 w-4 mr-1" />
                  热加载插件
                </>
              )}
            </Button>
            <Button
              size="sm"
              onClick={() => window.dispatchEvent(new CustomEvent('global-panel:open-panel', {
                detail: { id: 'plugin.generate', title: 'AI 插件生成器', size: 'xl' },
              }))}
            >
              <Sparkles className="h-4 w-4 mr-1" />
              AI 生成插件
            </Button>
          </div>
        </div>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>插件名称</TableHead>
                <TableHead className="w-16 text-center">启用</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>修改时间</TableHead>
                <TableHead className="w-32">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {customPlugins.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                    暂无自定义插件，点击上方按钮使用 AI 生成插件
                  </TableCell>
                </TableRow>
              ) : (
                customPlugins.map((plugin) => {
                  const pluginId = plugin.filename.replace(/\.js$/, '').replace(/^/, 'local.')
                  const loadedPlugin = plugins.find(p => p.id === pluginId)
                  const isEnabled = loadedPlugin ? loadedPlugin.state !== 'disabled' : false
                  
                  return (
                    <TableRow key={plugin.filename} className={!isEnabled && loadedPlugin ? 'opacity-60' : ''}>
                      <TableCell className="font-medium font-mono text-sm">{plugin.filename}</TableCell>
                      <TableCell className="text-center">
                        {loadedPlugin && (
                          <Switch
                            checked={isEnabled}
                            onCheckedChange={(checked) => togglePlugin(loadedPlugin.id, checked)}
                          />
                        )}
                      </TableCell>
                      <TableCell>
                        {loadedPlugin ? (
                          isEnabled ? (
                            <Badge variant="outline" className="text-green-600 border-green-300">
                              已启用
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-orange-600 border-orange-300">
                              已禁用
                            </Badge>
                          )
                        ) : (
                          <Badge variant="outline" className="text-gray-600 border-gray-300">
                            未加载
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(plugin.modified).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleEditCode(plugin.filename)}
                            title="查看/编辑代码"
                          >
                            <Code2 className="h-4 w-4" />
                          </Button>
                          {loadedPlugin && isEnabled && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleTestPlugin(loadedPlugin.id, loadedPlugin.name, loadedPlugin.hooks)}
                              className="text-blue-600"
                              title="测试插件"
                            >
                              <TestTube2 className="h-4 w-4" />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDeleteCustomPlugin(plugin.filename)}
                            className="text-destructive"
                            title="删除插件"
                          >
                            删除
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Third-party Plugins */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-medium">第三方插件</h3>
          <div className="flex items-center gap-2">
            {thirdPartySecurity.allowAll ? (
              <Shield className="h-4 w-4 text-green-500" />
            ) : (
              <ShieldAlert className="h-4 w-4 text-yellow-500" />
            )}
            <span className="text-xs text-muted-foreground">
              {thirdPartySecurity.allowAll ? '已信任所有插件' : `已信任: ${thirdPartySecurity.trusted.length} 个`}
            </span>
          </div>
        </div>
        <div className="flex gap-2 mb-4">
          <Input
            value={thirdPartyPath}
            onChange={(e) => setThirdPartyPath(e.target.value)}
            placeholder="输入插件路径..."
            className="flex-1"
          />
          <Button onClick={handleLoadThirdParty} disabled={loadingThirdParty || !thirdPartyPath.trim()}>
            {loadingThirdParty ? <Loader2 className="h-4 w-4 animate-spin" /> : '加载'}
          </Button>
        </div>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>名称</TableHead>
                <TableHead>版本</TableHead>
                <TableHead>状态</TableHead>
                <TableHead className="w-24">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {thirdPartyPlugins.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                    暂无第三方插件
                  </TableCell>
                </TableRow>
              ) : (
                thirdPartyPlugins.map((plugin) => (
                  <TableRow key={plugin.id}>
                    <TableCell className="font-medium">{plugin.name}</TableCell>
                    <TableCell>{plugin.version}</TableCell>
                    <TableCell>
                      <Badge variant={plugin.state === 'running' ? 'default' : 'secondary'}>
                        {plugin.state}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleUnloadThirdParty(plugin.id)}
                        disabled={loadingThirdParty}
                        className="text-destructive"
                      >
                        卸载
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

    </div>
  )
}
