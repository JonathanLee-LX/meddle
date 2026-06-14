import { Component, lazy, Suspense, useCallback, useEffect, useMemo, useState, type ErrorInfo, type ReactNode } from 'react'
import type { GlobalPanelApi, GlobalPanelProviderProps, GlobalPanelRoute } from './types'
import { GlobalPanelContext } from './global-panel-context-value'
import { useGlobalShortcut } from './use-global-shortcut'

const GlobalPanelShell = lazy(() => import('./global-panel-shell').then(module => ({
  default: module.GlobalPanelShell,
})))

interface PanelErrorBoundaryProps {
  children: ReactNode
  onClose: () => void
}

interface PanelErrorBoundaryState {
  error: Error | null
}

class PanelErrorBoundary extends Component<PanelErrorBoundaryProps, PanelErrorBoundaryState> {
  state: PanelErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): PanelErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Global panel failed to render', error, info)
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <div className="fixed inset-0 z-[82] flex items-center justify-center bg-background/80 p-6 backdrop-blur-sm">
        <div className="w-full max-w-lg rounded-lg border bg-card p-5 shadow-xl">
          <h2 className="font-semibold">面板加载失败</h2>
          <p className="mt-2 break-words text-sm text-destructive">{this.state.error.message}</p>
          <button type="button" className="mt-4 rounded-md border px-3 py-1.5 text-sm" onClick={this.props.onClose}>
            关闭面板
          </button>
        </div>
      </div>
    )
  }
}

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
      {open && (
        <PanelErrorBoundary key={currentRoute?.id || 'command'} onClose={close}>
          <Suspense fallback={null}>
            <GlobalPanelShell
              commands={resolvedCommands}
              renderPanel={(route) => renderPanel(route, value)}
            />
          </Suspense>
        </PanelErrorBoundary>
      )}
    </GlobalPanelContext.Provider>
  )
}
