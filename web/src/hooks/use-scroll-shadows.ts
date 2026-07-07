import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

type ScrollShadowState = {
  /** Show shadow on the left edge (content scrolled to the right). */
  left: boolean
  /** Show shadow on the right edge (more content to the right). */
  right: boolean
}

const IDLE_STATE: ScrollShadowState = { left: false, right: false }

/**
 * Tracks horizontal scroll position on an element and reports whether left/right
 * edge shadows should be shown. Useful for tab strips and horizontally
 * scrollable regions that don't render their own scroll affordances.
 *
 * Returns a ref to attach to the scrollable element and the current shadow
 * state. Re-evaluates on scroll, resize, and content mutations.
 */
export function useScrollShadows<T extends HTMLElement>() {
  const ref = useRef<T | null>(null)
  const [state, setState] = useState<ScrollShadowState>(IDLE_STATE)

  const update = useCallback(() => {
    const el = ref.current
    if (!el) {
      setState(IDLE_STATE)
      return
    }
    const { scrollLeft, scrollWidth, clientWidth } = el
    if (scrollWidth <= clientWidth) {
      setState(IDLE_STATE)
      return
    }
    setState({
      left: scrollLeft > 1,
      right: scrollLeft + clientWidth < scrollWidth - 1,
    })
  }, [])

  // Use useLayoutEffect for initial measurement so shadows are correct on first paint.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    update()

    const onScroll = () => update()
    el.addEventListener('scroll', onScroll, { passive: true })

    let resizeObserver: ResizeObserver | undefined
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => update())
      resizeObserver.observe(el)
    }

    let mutationObserver: MutationObserver | undefined
    if (typeof MutationObserver !== 'undefined') {
      mutationObserver = new MutationObserver(() => update())
      mutationObserver.observe(el, { childList: true, subtree: true, characterData: true })
    }

    return () => {
      el.removeEventListener('scroll', onScroll)
      resizeObserver?.disconnect()
      mutationObserver?.disconnect()
    }
  }, [update])

  useEffect(() => {
    // Re-measure on window resize as a safety net.
    const onWindowResize = () => update()
    window.addEventListener('resize', onWindowResize)
    return () => window.removeEventListener('resize', onWindowResize)
  }, [update])

  return { ref, state }
}
