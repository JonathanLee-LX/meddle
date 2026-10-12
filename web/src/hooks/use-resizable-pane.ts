import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { useMediaQuery } from '@/hooks/use-media-query'

interface ResizablePaneOptions {
  load: () => number
  save: (px: number) => number
  clamp: (px: number, containerWidth?: number) => number
  widthFromPointer: (clientX: number, containerLeft: number, containerWidth: number) => number
}

/** Pixel split from the `md` (768px) breakpoint up. Below it the pane stacks and ignores the width. */
export const SPLIT_PANE_SIDE_BY_SIDE_QUERY = '(min-width: 768px)'

export function useResizablePane({ load, save, clamp, widthFromPointer }: ResizablePaneOptions) {
  const layoutRef = useRef<HTMLDivElement>(null)
  const resizingRef = useRef(false)
  const [paneWidth, setPaneWidth] = useState(load)
  const [resizing, setResizing] = useState(false)
  const isWide = useMediaQuery(SPLIT_PANE_SIDE_BY_SIDE_QUERY)
  resizingRef.current = resizing

  useEffect(() => {
    const el = layoutRef.current
    if (!el || !isWide) return
    const apply = () => {
      if (resizingRef.current) return
      const width = el.getBoundingClientRect().width
      if (width <= 0) return
      setPaneWidth((current) => clamp(current, width))
    }
    apply()
    const observer = new ResizeObserver(apply)
    observer.observe(el)
    return () => observer.disconnect()
  }, [clamp, isWide])

  useEffect(() => {
    if (!resizing) return

    const onMove = (event: MouseEvent) => {
      const el = layoutRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      setPaneWidth(widthFromPointer(event.clientX, rect.left, rect.width))
    }

    const onUp = () => {
      setResizing(false)
      setPaneWidth((current) => save(current))
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [resizing, save, widthFromPointer])

  const onResizeStart = useCallback((event: ReactMouseEvent) => {
    event.preventDefault()
    setResizing(true)
  }, [])

  return { layoutRef, paneWidth, resizing, isWide, onResizeStart }
}
