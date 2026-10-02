/**
 * Pixel width for a side list pane. Display only; remembered in localStorage.
 * The editor keeps at least `editorMinPx` when the container is wide enough.
 */

export interface PaneSplitConfig {
  storageKey: string
  defaultPx: number
  minPx: number
  maxPx: number
  editorMinPx: number
}

export interface PaneSplit extends PaneSplitConfig {
  clamp: (px: number, containerWidth?: number) => number
  load: () => number
  save: (px: number) => number
  widthFromPointer: (clientX: number, containerLeft: number, containerWidth: number) => number
}

export function createPaneSplit(config: PaneSplitConfig): PaneSplit {
  const { storageKey, defaultPx, minPx, maxPx, editorMinPx } = config

  const clamp = (px: number, containerWidth?: number) => {
    if (!Number.isFinite(px)) return defaultPx
    let max = maxPx
    if (containerWidth != null && containerWidth > 0) {
      const room = containerWidth - editorMinPx
      max = Math.min(maxPx, Math.max(minPx, room))
    }
    return Math.round(Math.max(minPx, Math.min(max, px)))
  }

  const load = () => {
    if (typeof window === 'undefined') return defaultPx
    try {
      const raw = localStorage.getItem(storageKey)
      if (raw == null) return defaultPx
      return clamp(parseFloat(raw))
    } catch {
      return defaultPx
    }
  }

  const save = (px: number) => {
    const next = clamp(px)
    try {
      localStorage.setItem(storageKey, String(next))
    } catch {
      // ignore quota / private mode
    }
    return next
  }

  const widthFromPointer = (clientX: number, containerLeft: number, containerWidth: number) => {
    if (containerWidth <= 0) return defaultPx
    return clamp(clientX - containerLeft, containerWidth)
  }

  return { ...config, clamp, load, save, widthFromPointer }
}
