import { useEffect } from 'react'

export function useGlobalShortcut(onOpen: () => void) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing) return
      const key = event.key.toLowerCase()
      if (key === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        onOpen()
      }
    }

    window.addEventListener('keydown', handleKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true })
  }, [onOpen])
}
