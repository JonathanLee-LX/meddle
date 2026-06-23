import { useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react'
import {
  SaveShortcutContext,
  type SaveShortcutRegistration,
  type SaveShortcutRegistry,
} from './save-shortcut-context'

interface SaveShortcutProviderProps {
  children: ReactNode
}

interface RegisteredSaveShortcut {
  order: number
  registration?: SaveShortcutRegistration
}

export function SaveShortcutProvider({ children }: SaveShortcutProviderProps) {
  const registrationsRef = useRef(new Map<string, RegisteredSaveShortcut>())
  const nextOrderRef = useRef(0)

  const register = useCallback((id: string) => {
    registrationsRef.current.set(id, {
      order: nextOrderRef.current++,
    })
  }, [])

  const update = useCallback((id: string, registration: SaveShortcutRegistration) => {
    const current = registrationsRef.current.get(id)
    if (!current) {
      register(id)
    }
    const target = registrationsRef.current.get(id)
    if (target) {
      if (!target.registration?.active && registration.active) {
        target.order = nextOrderRef.current++
      }
      target.registration = registration
    }
  }, [register])

  const unregister = useCallback((id: string) => {
    registrationsRef.current.delete(id)
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || event.repeat) return
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 's') return

      const target = [...registrationsRef.current.values()]
        .filter(
          (entry): entry is RegisteredSaveShortcut & { registration: SaveShortcutRegistration } =>
            Boolean(entry.registration?.active),
        )
        .sort((left, right) => (
          right.registration.priority - left.registration.priority ||
          right.order - left.order
        ))[0]

      if (!target) return

      event.preventDefault()
      event.stopPropagation()
      if (target.registration.enabled) {
        void target.registration.onSave()
      }
    }

    window.addEventListener('keydown', handleKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true })
  }, [])

  const value = useMemo<SaveShortcutRegistry>(() => ({
    register,
    update,
    unregister,
  }), [register, unregister, update])

  return (
    <SaveShortcutContext.Provider value={value}>
      {children}
    </SaveShortcutContext.Provider>
  )
}
