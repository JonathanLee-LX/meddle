import { useCallback, useState, type UIEvent } from 'react'

/** Vertical scroll position (px) after which the editor title bar is lifted. */
export const EDITOR_BAR_SCROLL_THRESHOLD = 4

/**
 * Issue #111: whether the editor body has been scrolled past the threshold.
 * Put `onScroll` on the editor's own scroll container; scrolling inside a
 * descendant (a textarea, a code editor, a nested table) is ignored. Changing
 * `resetKey` (another file / rule / editor) resets the state, since the
 * scroll container may unmount without a final scroll event.
 */
export function useEditorScrolled(resetKey?: unknown) {
  const [scrolled, setScrolled] = useState(false)
  const [key, setKey] = useState(resetKey)
  if (!Object.is(key, resetKey)) {
    setKey(resetKey)
    setScrolled(false)
  }
  const onScroll = useCallback((event: UIEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget) return
    setScrolled(event.currentTarget.scrollTop > EDITOR_BAR_SCROLL_THRESHOLD)
  }, [])
  return { scrolled, onScroll }
}
