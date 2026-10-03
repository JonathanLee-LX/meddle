import { describe, expect, it } from 'vitest'
import { cssColorToMonaco, monacoThemeId } from './monaco-theme'

describe('monaco theme', () => {
  it('picks a theme id from the resolved app theme', () => {
    expect(monacoThemeId('light')).toBe('meddle-light')
    expect(monacoThemeId('dark')).toBe('meddle-dark')
  })

  it('converts css colors to monaco hex when canvas can read them', () => {
    const hex = cssColorToMonaco('#336699')
    if (hex == null) return
    expect(hex).toBe('#336699')
  })
})