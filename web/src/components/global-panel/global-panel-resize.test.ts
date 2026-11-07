import { describe, expect, it } from 'vitest'
import { globalPanelResizeHandleOffsetClass } from './global-panel-resize'

describe('globalPanelResizeHandleOffsetClass', () => {
  it('lifts the handle above the request-detail action bar', () => {
    expect(globalPanelResizeHandleOffsetClass('request.detail')).toBe('bottom-12 right-1')
  })

  it('keeps the handle in the bottom-right corner on panels without an action bar', () => {
    expect(globalPanelResizeHandleOffsetClass('settings')).toBe('bottom-0 right-0')
    expect(globalPanelResizeHandleOffsetClass('mock.create')).toBe('bottom-0 right-0')
    expect(globalPanelResizeHandleOffsetClass('mock.edit')).toBe('bottom-0 right-0')
    expect(globalPanelResizeHandleOffsetClass('plugin.generate')).toBe('bottom-0 right-0')
    expect(globalPanelResizeHandleOffsetClass('plugin.code')).toBe('bottom-0 right-0')
    expect(globalPanelResizeHandleOffsetClass('mobile-proxy')).toBe('bottom-0 right-0')
  })
})
