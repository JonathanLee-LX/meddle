import type { Monaco } from '@monaco-editor/react'

export type ResolvedTheme = 'light' | 'dark'

const LIGHT_THEME = 'meddle-light'
const DARK_THEME = 'meddle-dark'

/** Monaco theme id that tracks the app's resolved light/dark setting. */
export function monacoThemeId(resolvedTheme: ResolvedTheme) {
  return resolvedTheme === 'dark' ? DARK_THEME : LIGHT_THEME
}

/** Convert a CSS color (including oklch) to Monaco's #RRGGBB / #RRGGBBAA. */
export function cssColorToMonaco(color: string): string | null {
  const value = color.trim()
  if (!value || typeof document === 'undefined') return null
  const probe = document.createElement('canvas')
  probe.width = 1
  probe.height = 1
  const context = probe.getContext('2d', { willReadFrequently: true })
  if (!context) return null
  context.clearRect(0, 0, 1, 1)
  context.fillStyle = value
  context.fillRect(0, 0, 1, 1)
  const pixel = context.getImageData(0, 0, 1, 1).data
  const [red, green, blue, alpha] = pixel
  if (alpha === 0 && !value.includes('transparent')) return null
  const hex = (channel: number) => channel.toString(16).padStart(2, '0')
  const rgb = `#${hex(red)}${hex(green)}${hex(blue)}`
  return alpha === 255 ? rgb : `${rgb}${hex(alpha)}`
}

function token(name: string) {
  if (typeof document === 'undefined') return null
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name)
  return cssColorToMonaco(raw)
}

function editorColors() {
  const pairs: Array<[string, string | null]> = [
    ['editor.background', token('--card')],
    ['editor.foreground', token('--card-foreground')],
    ['editorCursor.foreground', token('--primary')],
    ['editor.selectionBackground', token('--accent')],
    ['editor.inactiveSelectionBackground', token('--muted')],
    ['editor.lineHighlightBackground', token('--muted')],
    ['editorLineNumber.foreground', token('--muted-foreground')],
    ['editorLineNumber.activeForeground', token('--foreground')],
    ['editorGutter.background', token('--card')],
    ['editorWidget.background', token('--popover')],
    ['editorWidget.border', token('--border')],
    ['editorIndentGuide.background1', token('--border')],
    ['focusBorder', token('--ring')],
    ['scrollbarSlider.background', token('--border')],
    ['scrollbarSlider.hoverBackground', token('--muted-foreground')],
  ]
  const colors: Record<string, string> = {}
  for (const [key, value] of pairs) {
    if (value) colors[key] = value
  }
  return colors
}

/** Register and activate a Monaco theme painted from the current app tokens. */
export function applyMonacoTheme(monaco: Monaco, resolvedTheme: ResolvedTheme) {
  const id = monacoThemeId(resolvedTheme)
  monaco.editor.defineTheme(id, {
    base: resolvedTheme === 'dark' ? 'vs-dark' : 'vs',
    inherit: true,
    rules: [],
    colors: editorColors(),
  })
  monaco.editor.setTheme(id)
  return id
}
