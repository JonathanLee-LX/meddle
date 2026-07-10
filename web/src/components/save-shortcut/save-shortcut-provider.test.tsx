import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { SaveShortcutProvider } from './save-shortcut-provider'
import { useSaveShortcut } from './use-save-shortcut'

function wrapper({ children }: { children: ReactNode }) {
  return <SaveShortcutProvider>{children}</SaveShortcutProvider>
}

function dispatchSaveShortcut(init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    key: 's',
    metaKey: true,
    ...init,
  })
  window.dispatchEvent(event)
  return event
}

describe('SaveShortcutProvider', () => {
  it('runs the highest-priority active save action', () => {
    const pageSave = vi.fn()
    const panelSave = vi.fn()

    renderHook(() => {
      useSaveShortcut({ active: true, enabled: true, priority: 100, onSave: pageSave })
      useSaveShortcut({ active: true, enabled: true, priority: 200, onSave: panelSave })
    }, { wrapper })

    const event = dispatchSaveShortcut()

    expect(panelSave).toHaveBeenCalledOnce()
    expect(pageSave).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(true)
  })

  it('blocks shortcut fallthrough when the highest-priority action is disabled', () => {
    const pageSave = vi.fn()
    const panelSave = vi.fn()

    renderHook(() => {
      useSaveShortcut({ active: true, enabled: true, priority: 100, onSave: pageSave })
      useSaveShortcut({ active: true, enabled: false, priority: 200, onSave: panelSave })
    }, { wrapper })

    const event = dispatchSaveShortcut()

    expect(panelSave).not.toHaveBeenCalled()
    expect(pageSave).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(true)
  })

  it('uses the most recently registered action when priorities match', () => {
    const firstSave = vi.fn()
    const secondSave = vi.fn()

    renderHook(() => {
      useSaveShortcut({ active: true, enabled: true, priority: 200, onSave: firstSave })
      useSaveShortcut({ active: true, enabled: true, priority: 200, onSave: secondSave })
    }, { wrapper })

    dispatchSaveShortcut({ ctrlKey: true, metaKey: false })

    expect(secondSave).toHaveBeenCalledOnce()
    expect(firstSave).not.toHaveBeenCalled()
  })

  it('uses the most recently activated action when mounted panels share a priority', () => {
    const firstSave = vi.fn()
    const secondSave = vi.fn()
    const { rerender } = renderHook(
      ({ secondActive }) => {
        useSaveShortcut({ active: true, enabled: true, priority: 200, onSave: firstSave })
        useSaveShortcut({ active: secondActive, enabled: true, priority: 200, onSave: secondSave })
      },
      { wrapper, initialProps: { secondActive: false } },
    )

    dispatchSaveShortcut()
    expect(firstSave).toHaveBeenCalledOnce()

    act(() => rerender({ secondActive: true }))
    dispatchSaveShortcut()
    expect(secondSave).toHaveBeenCalledOnce()
  })

  it('updates enabled state without changing registration priority', () => {
    const onSave = vi.fn()
    const { rerender } = renderHook(
      ({ enabled }) => useSaveShortcut({ active: true, enabled, priority: 100, onSave }),
      { wrapper, initialProps: { enabled: false } },
    )

    dispatchSaveShortcut()
    expect(onSave).not.toHaveBeenCalled()

    act(() => rerender({ enabled: true }))
    dispatchSaveShortcut()
    expect(onSave).toHaveBeenCalledOnce()
  })
})
