import { useContext, useEffect, useId } from 'react'
import {
  SaveShortcutContext,
  type SaveShortcutRegistration,
} from './save-shortcut-context'

export function useSaveShortcut(registration: SaveShortcutRegistration) {
  const registry = useContext(SaveShortcutContext)
  const id = useId()

  // Components are also rendered independently in unit tests and previews.
  // In the application root the provider is always present.
  useEffect(() => {
    if (!registry) return
    registry.register(id)
    return () => registry.unregister(id)
  }, [id, registry])

  useEffect(() => {
    if (!registry) return
    registry.update(id, registration)
  }, [id, registration, registry])
}
