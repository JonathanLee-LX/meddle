import type { Modifier } from '@dnd-kit/core'
import type { Transform } from '@dnd-kit/utilities'
import { CSS } from '@dnd-kit/utilities'

/** Lock rule-file tab drag to the X axis so the strip cannot grow or show a vertical scrollbar. */
export const restrictToHorizontalAxis: Modifier = ({ transform }) => ({
  ...transform,
  y: 0,
})

/** Lock rule-file list drag to the Y axis for the vertical file sidebar (#102). */
export const restrictToVerticalAxis: Modifier = ({ transform }) => ({
  ...transform,
  x: 0,
})

/**
 * Stable horizontal transform for sortable tabs.
 * Uses Translate (no scale) and forces y=0 as a belt-and-suspenders with the modifier.
 */
export function tabDragTransformStyle(transform: Transform | null): string | undefined {
  if (!transform) return undefined
  return CSS.Translate.toString({ ...transform, y: 0 })
}

/** Stable vertical transform for the rule-file sidebar list. */
export function listDragTransformStyle(transform: Transform | null): string | undefined {
  if (!transform) return undefined
  return CSS.Translate.toString({ ...transform, x: 0 })
}
