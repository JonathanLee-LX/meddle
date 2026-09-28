/**
 * Traffic work-shell B split width helpers (display-only, localStorage).
 * Default ~60% left / 40% right per wireframe b (#95).
 * Fresh profiles (no localStorage) use TRAFFIC_SPLIT_DEFAULT_PCT;
 * an existing meddle-traffic-split-pct value always wins.
 */

export const TRAFFIC_SPLIT_STORAGE_KEY = 'meddle-traffic-split-pct'
/** Left pane % for fresh profiles — wireframe b ~60/40 (#95). */
export const TRAFFIC_SPLIT_DEFAULT_PCT = 60
export const TRAFFIC_SPLIT_MIN_PCT = 35
export const TRAFFIC_SPLIT_MAX_PCT = 75
/** Collapse right pane to Sheet below this viewport width (layout A-like). */
export const TRAFFIC_NARROW_MAX_WIDTH_PX = 900

export function clampTrafficSplitPct(pct: number): number {
  if (!Number.isFinite(pct)) return TRAFFIC_SPLIT_DEFAULT_PCT
  return Math.max(TRAFFIC_SPLIT_MIN_PCT, Math.min(TRAFFIC_SPLIT_MAX_PCT, Math.round(pct)))
}

export function loadTrafficSplitPct(): number {
  if (typeof window === 'undefined') return TRAFFIC_SPLIT_DEFAULT_PCT
  try {
    const raw = localStorage.getItem(TRAFFIC_SPLIT_STORAGE_KEY)
    if (raw == null) return TRAFFIC_SPLIT_DEFAULT_PCT
    return clampTrafficSplitPct(parseFloat(raw))
  } catch {
    return TRAFFIC_SPLIT_DEFAULT_PCT
  }
}

export function saveTrafficSplitPct(pct: number): number {
  const next = clampTrafficSplitPct(pct)
  try {
    localStorage.setItem(TRAFFIC_SPLIT_STORAGE_KEY, String(next))
  } catch {
    // ignore quota / private mode
  }
  return next
}

export function pctFromPointer(clientX: number, containerLeft: number, containerWidth: number): number {
  if (containerWidth <= 0) return TRAFFIC_SPLIT_DEFAULT_PCT
  return clampTrafficSplitPct(((clientX - containerLeft) / containerWidth) * 100)
}
