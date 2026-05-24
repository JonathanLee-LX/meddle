import type { ComponentType, ReactNode } from 'react'

export type GlobalPanelSize = 'command' | 'md' | 'lg' | 'xl' | 'fullscreen'

export interface GlobalPanelRoute {
  id: string
  title: string
  description?: string
  size?: GlobalPanelSize
  params?: Record<string, unknown>
}

export interface CommandAction {
  id: string
  title: string
  description?: string
  section: string
  keywords?: string[]
  icon?: ComponentType<{ className?: string }>
  shortcut?: string
  danger?: boolean
  disabled?: boolean
  disabledReason?: string
  confirm?: string
  closeOnRun?: boolean
  run: () => void | Promise<void>
}

export interface GlobalPanelApi {
  open: boolean
  stack: GlobalPanelRoute[]
  currentRoute: GlobalPanelRoute | null
  openCommand: () => void
  openPanel: (route: GlobalPanelRoute) => void
  pushPanel: (route: GlobalPanelRoute) => void
  back: () => void
  close: () => void
}

export interface GlobalPanelProviderProps {
  children: ReactNode
  commands: CommandAction[] | ((api: GlobalPanelApi) => CommandAction[])
  renderPanel: (route: GlobalPanelRoute, api: GlobalPanelApi) => ReactNode
}
