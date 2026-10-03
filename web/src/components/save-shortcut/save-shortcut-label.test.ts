import { describe, expect, it } from 'vitest'
import { getSaveShortcutAria, getSaveShortcutLabel } from './save-shortcut-label'

function nav(platform: string, userAgent = platform, hinted?: string): Navigator {
  return {
    platform,
    userAgent,
    userAgentData: hinted ? { platform: hinted } : undefined,
  } as unknown as Navigator
}

describe('save shortcut label', () => {
  it('uses the Command shortcut on Apple platforms', () => {
    expect(getSaveShortcutLabel(nav('MacIntel'))).toBe('⌘+S')
    expect(getSaveShortcutAria(nav('MacIntel'))).toBe('Meta+S')
    expect(getSaveShortcutLabel(nav('Win32', 'Windows', 'macOS'))).toBe('⌘+S')
  })

  it('uses the Control shortcut on other platforms', () => {
    expect(getSaveShortcutLabel(nav('Win32'))).toBe('Ctrl+S')
    expect(getSaveShortcutAria(nav('Linux x86_64'))).toBe('Control+S')
    expect(getSaveShortcutLabel(nav('MacIntel', 'Mac', 'Windows'))).toBe('Ctrl+S')
  })
})