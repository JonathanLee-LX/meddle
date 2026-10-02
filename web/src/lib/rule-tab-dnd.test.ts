import { describe, expect, it } from 'vitest'
import {
  listDragTransformStyle,
  restrictToHorizontalAxis,
  restrictToVerticalAxis,
  tabDragTransformStyle,
} from './rule-tab-dnd'

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

  it('restricts modifiers to the vertical axis (#102)', () => {
    const result = restrictToVerticalAxis({
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

    expect(result).toEqual({ x: 0, y: -18, scaleX: 1, scaleY: 1 })
  })

  it('emits translate-only styles with y locked to zero', () => {
    expect(tabDragTransformStyle(null)).toBeUndefined()
    expect(tabDragTransformStyle({ x: 16, y: 9, scaleX: 1.1, scaleY: 0.9 })).toBe(
      'translate3d(16px, 0px, 0)',
    )
  })

  it('emits translate-only styles with x locked to zero for vertical list', () => {
    expect(listDragTransformStyle(null)).toBeUndefined()
    expect(listDragTransformStyle({ x: 16, y: 9, scaleX: 1.1, scaleY: 0.9 })).toBe(
      'translate3d(0px, 9px, 0)',
    )
  })
})
