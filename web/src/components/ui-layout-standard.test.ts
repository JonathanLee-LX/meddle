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
    ['./plugin-config.tsx', 'app-page-stack'],
    ['./rule-config.tsx', 'app-page-stack'],
    ['./mock-config.tsx', 'app-page-stack'],
  ])('%s uses %s', (path, className) => {
    expect(readSource(path)).toContain(className)
  })
})
