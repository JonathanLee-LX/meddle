import { createContext } from 'react'

export interface SaveShortcutRegistration {
  active: boolean
  enabled: boolean
  priority: number
  onSave: () => void | Promise<void>
}

export interface SaveShortcutRegistry {
  register: (id: string) => void
  update: (id: string, registration: SaveShortcutRegistration) => void
  unregister: (id: string) => void
}

export const SaveShortcutContext = createContext<SaveShortcutRegistry | null>(null)

export const SAVE_SHORTCUT_PRIORITY = {
  page: 100,
  panel: 200,
  modal: 300,
} as const
