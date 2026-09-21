import { describe, expect, it } from 'vitest'
import { restrictToHorizontalAxis, tabDragTransformStyle } from './rule-tab-dnd'

describe('rule file tab drag helpers', () => {
  it('restricts modifiers to the horizontal axis', () => {
    const result = restrictToHorizontalAxis({
      activatorEvent: null,
      active: null,
      activeNodeRect: null,
      draggingNodeRect: null,
      containerNodeRect: null,
      over: null,
      overlayNodeRect: null,
      scrollableAncestors: [],
      scrollableAncestorRects: [],
      transform: { x: 42, y: -18, scaleX: 1, scaleY: 1 },
      windowRect: null,
    })

    expect(result).toEqual({ x: 42, y: 0, scaleX: 1, scaleY: 1 })
  })

  it('emits translate-only styles with y locked to zero', () => {
    expect(tabDragTransformStyle(null)).toBeUndefined()
    expect(tabDragTransformStyle({ x: 16, y: 9, scaleX: 1.1, scaleY: 0.9 })).toBe(
      'translate3d(16px, 0px, 0)',
    )
  })
})
