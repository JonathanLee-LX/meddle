import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useGlobalShortcut } from './use-global-shortcut'

function dispatchShortcut(init: KeyboardEventInit) {
  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    key: 'k',
    ...init,
  })
  window.dispatchEvent(event)
  return event
}

describe('useGlobalShortcut', () => {
  it('opens the command panel with Command+K', () => {
    const onOpen = vi.fn()
    renderHook(() => useGlobalShortcut(onOpen))

    const event = dispatchShortcut({ metaKey: true })

    expect(onOpen).toHaveBeenCalledOnce()
    expect(event.defaultPrevented).toBe(true)
  })

  it('supports Ctrl+K for non-macOS keyboards', () => {
    const onOpen = vi.fn()
    renderHook(() => useGlobalShortcut(onOpen))

    dispatchShortcut({ ctrlKey: true, key: 'K' })

    expect(onOpen).toHaveBeenCalledOnce()
  })

  it('ignores shortcuts while an IME composition is active', () => {
    const onOpen = vi.fn()
    renderHook(() => useGlobalShortcut(onOpen))

    dispatchShortcut({ isComposing: true, metaKey: true })

    expect(onOpen).not.toHaveBeenCalled()
  })

  it('removes the global listener when unmounted', () => {
    const onOpen = vi.fn()
    const { unmount } = renderHook(() => useGlobalShortcut(onOpen))

    act(() => unmount())
    dispatchShortcut({ metaKey: true })

    expect(onOpen).not.toHaveBeenCalled()
  })
})
