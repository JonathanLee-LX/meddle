import { useCallback, useState, type UIEvent } from 'react'

/** Vertical scroll position (px) after which the editor title bar is lifted. */
export const EDITOR_BAR_SCROLL_THRESHOLD = 4

/**
 * Tracks whether the editor body has been scrolled past the threshold. Scroll
 * events do not bubble, so this listens in the capture phase on the editor
 * wrapper and works for any scroll container inside it (plain div, ScrollArea).
 */
export function useEditorScrolled() {
  const [scrolled, setScrolled] = useState(false)
  const onScrollCapture = useCallback((event: UIEvent<HTMLElement>) => {
    const el = event.target as HTMLElement
    if (!(el instanceof HTMLElement) || el.scrollHeight <= el.clientHeight + 1) return
    setScrolled(el.scrollTop > EDITOR_BAR_SCROLL_THRESHOLD)
  }, [])
  return { scrolled, onScrollCapture }
}

