import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { GlobalPanelApi, GlobalPanelProviderProps, GlobalPanelRoute } from './types'
import { GlobalPanelShell } from './global-panel-shell'
import { useGlobalShortcut } from './use-global-shortcut'

const GlobalPanelContext = createContext<GlobalPanelApi | null>(null)

export function GlobalPanelProvider({ children, commands, renderPanel }: GlobalPanelProviderProps) {
  const [open, setOpen] = useState(false)
  const [stack, setStack] = useState<GlobalPanelRoute[]>([])

  const openCommand = useCallback(() => {
    setStack([])
    setOpen(true)
  }, [])

  const openPanel = useCallback((route: GlobalPanelRoute) => {
    setStack([route])
    setOpen(true)
  }, [])

  const pushPanel = useCallback((route: GlobalPanelRoute) => {
    setStack((prev) => [...prev, route])
    setOpen(true)
  }, [])

  const back = useCallback(() => {
    setStack((prev) => prev.slice(0, -1))
  }, [])

  const close = useCallback(() => {
    setOpen(false)
    setStack([])
  }, [])

  useGlobalShortcut(openCommand)

  useEffect(() => {
    const handleOpenCommand = () => openCommand()
    const handleOpenPanel = (event: Event) => {
      const route = (event as CustomEvent<GlobalPanelRoute>).detail
      if (route?.id) openPanel(route)
    }

    window.addEventListener('global-panel:open-command', handleOpenCommand)
    window.addEventListener('global-panel:open-panel', handleOpenPanel)
    return () => {
      window.removeEventListener('global-panel:open-command', handleOpenCommand)
      window.removeEventListener('global-panel:open-panel', handleOpenPanel)
    }
  }, [openCommand, openPanel])

  const currentRoute = stack.length > 0 ? stack[stack.length - 1] : null

  const value = useMemo<GlobalPanelApi>(() => ({
    open,
    stack,
    currentRoute,
    openCommand,
    openPanel,
    pushPanel,
    back,
    close,
  }), [back, close, currentRoute, open, openCommand, openPanel, pushPanel, stack])

  const resolvedCommands = typeof commands === 'function' ? commands(value) : commands

  return (
    <GlobalPanelContext.Provider value={value}>
      {children}
      <GlobalPanelShell
        commands={resolvedCommands}
        renderPanel={(route) => renderPanel(route, value)}
      />
    </GlobalPanelContext.Provider>
  )
}

export function useGlobalPanel() {
  const value = useContext(GlobalPanelContext)
  if (!value) {
    throw new Error('useGlobalPanel must be used inside GlobalPanelProvider')
  }
  return value
}
