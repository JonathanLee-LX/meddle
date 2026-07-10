import { useState, useCallback } from 'react'
import type { Plugin } from '@/types'

/**
 * Hook for managing plugins
 */
export function usePlugins() {
  const [plugins, setPlugins] = useState<Plugin[]>([])
  const [pluginMode, setPluginMode] = useState<'on' | 'off' | 'shadow'>('off')
  const [thirdPartyPlugins, setThirdPartyPlugins] = useState<Plugin[]>([])
  const [thirdPartySecurity, setThirdPartySecurity] = useState<{ 
    allowAll: boolean
    trusted: string[] 
  }>({
    allowAll: false,
    trusted: [],
  })

  const fetchPlugins = useCallback(async () => {
    try {
      const res = await fetch('/api/plugins')
      const data = await res.json()
      setPluginMode(data.mode || 'off')
      setPlugins(data.plugins || [])
    } catch (err) {
      console.error('Failed to fetch plugins:', err)
    }
  }, [])

  const switchPluginMode = useCallback(async (mode: 'on' | 'off' | 'shadow') => {
    try {
      const res = await fetch('/api/pipeline/mode', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      })
      if (res.ok) {
        setPluginMode(mode)
      }
    } catch (err) {
      console.error('Failed to switch plugin mode:', err)
    }
  }, [])

  const startPlugin = useCallback(async (id: string) => {
    try {
      await fetch(`/api/plugins/${id}/start`, { method: 'POST' })
    } catch (err) {
      console.error('Failed to start plugin:', err)
    }
  }, [])

  const stopPlugin = useCallback(async (id: string) => {
    try {
      await fetch(`/api/plugins/${id}/stop`, { method: 'POST' })
    } catch (err) {
      console.error('Failed to stop plugin:', err)
    }
  }, [])

  const togglePlugin = useCallback(async (id: string, enabled: boolean) => {
    try {
      const res = await fetch(`/api/plugins/${encodeURIComponent(id)}/toggle`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      })
      if (res.ok) {
        setPlugins(prev => prev.map(p =>
          p.id === id ? { ...p, state: enabled ? 'running' : 'disabled' } : p
        ))
      }
    } catch (err) {
      console.error('Failed to toggle plugin:', err)
    }
  }, [])

  const fetchThirdPartyPlugins = useCallback(async () => {
    try {
      const res = await fetch('/api/plugins/third-party')
      const contentType = res.headers.get('content-type') || ''
      if (!res.ok || !contentType.includes('application/json')) {
        setThirdPartyPlugins([])
        setThirdPartySecurity({ allowAll: false, trusted: [] })
        return
      }
      const data = await res.json()
      setThirdPartyPlugins(data.plugins || [])
      setThirdPartySecurity(data.security || { allowAll: false, trusted: [] })
    } catch (err) {
      console.error('Failed to fetch third-party plugins:', err)
    }
  }, [])

  const loadThirdPartyPlugin = useCallback(async (path: string) => {
    try {
      await fetch('/api/plugins/third-party/load', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
      })
    } catch (err) {
      console.error('Failed to load third-party plugin:', err)
    }
  }, [])

  const unloadThirdPartyPlugin = useCallback(async (id: string) => {
    try {
      await fetch(`/api/plugins/third-party/${id}/unload`, { method: 'POST' })
    } catch (err) {
      console.error('Failed to unload third-party plugin:', err)
    }
  }, [])

  return {
    plugins,
    pluginMode,
    switchPluginMode,
    thirdPartyPlugins,
    thirdPartySecurity,
    fetchPlugins,
    startPlugin,
    stopPlugin,
    togglePlugin,
    fetchThirdPartyPlugins,
    loadThirdPartyPlugin,
    unloadThirdPartyPlugin,
  }
}
