import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const readSource = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

describe('application layout standard', () => {
  it('defines semantic spacing tokens and layout classes', () => {
    const css = readSource('../index.css')

    expect(css).toContain('--ui-panel-padding')
    expect(css).toContain('--ui-content-gap')
    expect(css).toContain('.app-workspace-content')
    expect(css).toContain('.app-panel-content')
    expect(css).toContain('.app-section')
    expect(css).toContain('.app-field-group')
  })

  it.each([
    ['./settings-panel.tsx', 'app-panel-content'],
    ['./plugin-generator.tsx', 'app-panel-content'],
    ['./plugin-test-dialog.tsx', 'app-panel-content'],
    ['./mock-editor-panel.tsx', 'app-panel-content'],
    ['./rule-ai-assistant-panel.tsx', 'app-panel-content'],
    ['./mobile-proxy-panel.tsx', 'app-panel-content'],
    ['./health-panel.tsx', 'app-workspace-content'],
    ['./plugin-config.tsx', 'app-page-stack'],
    ['./rule-config.tsx', 'app-page-stack'],
    ['./mock-config.tsx', 'app-page-stack'],
  ])('%s uses %s', (path, className) => {
    expect(readSource(path)).toContain(className)
  })

  it('keeps the log filters and table in one card', () => {
    const app = readSource('../App.tsx')
    const cardStart = app.indexOf('<Card data-testid="log-panel-card"')
    const cardEnd = app.indexOf('</Card>', cardStart)

    expect(cardStart).toBeGreaterThan(-1)
    expect(cardEnd).toBeGreaterThan(cardStart)
    expect(app.indexOf('<LogFilter', cardStart)).toBeLessThan(cardEnd)
    expect(app.indexOf('<LogTable', cardStart)).toBeLessThan(cardEnd)
  })

  it('keeps secondary cards flat', () => {
    expect(readSource('../App.tsx')).toContain('data-testid="log-panel-card" className="min-h-0 flex-1 gap-0 overflow-hidden py-0 shadow-none"')
    expect(readSource('./rule-config.tsx')).toContain('className="min-h-0 flex-1 gap-0 overflow-hidden py-0 shadow-none')
    expect(readSource('./mobile-proxy-panel.tsx').match(/<Card className="[^"]*shadow-none[^"]*">/g)).toHaveLength(2)
  })
})
