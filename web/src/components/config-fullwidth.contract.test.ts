import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const readSource = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

describe('config pages full-width contract (P3 / #90)', () => {
  it('only traffic uses TrafficWorkLayout B; config host is exclusive full-width', () => {
    const app = readSource('../App.tsx')
    const workStart = app.indexOf('data-testid="shell-work"')
    const configStart = app.indexOf('data-testid="shell-config"')
    expect(workStart).toBeGreaterThan(-1)
    expect(configStart).toBeGreaterThan(workStart)
    expect(app.indexOf('<TrafficWorkLayout', workStart)).toBeGreaterThan(workStart)
    expect(app.indexOf('<TrafficWorkLayout', workStart)).toBeLessThan(configStart)
    expect(app.slice(configStart)).not.toContain('TrafficWorkLayout')
    // Config main is full-width (no leftover max-w cap from earlier shell)
    expect(app).toContain('className="app-shell-main"')
    expect(app).toContain('data-testid="shell-config"')
    const configHost = app.slice(app.indexOf('data-testid="shell-config"'), app.indexOf('data-testid="config-page-rules"'))
    expect(configHost).toContain('w-full')
    expect(configHost).not.toContain('max-w-[1600px]')
  })

  it('hosts rules / mock / plugins / health / settings / mobile inside shell-config', () => {
    const app = readSource('../App.tsx')
    const configStart = app.indexOf('data-testid="shell-config"')
    const slice = app.slice(configStart)
    for (const id of [
      'config-page-rules',
      'config-page-mock',
      'config-page-plugins',
      'config-page-health',
      'config-page-settings',
      'config-page-mobile',
    ]) {
      expect(slice).toContain(`data-testid="${id}"`)
    }
  })

  it('keeps traffic → rule highlight and traffic → one-click mock create entries', () => {
    const app = readSource('../App.tsx')
    expect(app).toContain('handleJumpToRule')
    expect(app).toContain("navigate('/config')")
    expect(app).toContain('route-rule:highlight')
    expect(app).toContain('handleCreateMockFromLog')
    expect(app).toContain("navigate('/mock')")
    expect(app).toContain('MOCK_OPEN_CREATE_EVENT')
    // Must not open global-panel overlay for the primary traffic→mock path
    const createFn = app.slice(app.indexOf('handleCreateMockFromLog'), app.indexOf('handleReplay'))
    expect(createFn).not.toContain('global-panel:open-panel')
    expect(createFn).toContain('MOCK_OPEN_CREATE_EVENT')
  })

  it('mock page uses in-page list|edit layout (02-mock), not traffic B', () => {
    const mock = readSource('./mock-config.tsx')
    const split = readSource('./split-pane.tsx')
    expect(mock).toContain('<SplitPane')
    expect(mock).toContain('testId="mock-config-layout"')
    expect(mock).toContain('layout="list-edit"')
    expect(mock).toContain('listTestId="mock-config-list"')
    expect(mock).toContain('panelTestId="mock-config-edit"')
    expect(mock).toContain('widthAttr="mock-list-width"')
    expect(mock).toContain('separatorTestId="mock-panel-separator"')
    expect(split).toContain('data-testid={testId}')
    expect(split).toContain('data-layout={layout}')
    expect(split).toContain('data-testid={listTestId}')
    expect(split).toContain('data-testid={panelTestId}')
    expect(split).toContain('data-testid={separatorTestId}')
    expect(mock).toContain('MOCK_OPEN_CREATE_EVENT')
    expect(mock).toContain('MockEditorPanel')
    expect(mock).not.toContain('TrafficWorkLayout')
    // Dead Sheet editor path should be gone
    expect(mock).not.toContain('<Sheet')
  })

  it('settings / mobile are side-nav config routes', () => {
    const app = readSource('../App.tsx')
    const nav = readSource('../lib/shell-mode.ts')
    const header = readSource('./app-header.tsx')
    expect(nav).toContain("tab: 'settings'")
    expect(nav).toContain("tab: 'mobile'")
    expect(nav).toContain("path: '/settings'")
    expect(nav).toContain("path: '/mobile'")
    expect(header).toContain('shell-nav-${item.tab}')
    expect(header).not.toContain('shell-utility-settings')
    expect(header).not.toContain('shell-utility-mobile')
    expect(app).toContain('config-page-settings')
    expect(app).toContain('config-page-mobile')
  })

  it('mobile proxy panel is full-width (no narrow max-w-3xl leftover)', () => {
    const mobile = readSource('./mobile-proxy-panel.tsx')
    expect(mobile).toContain('data-testid="mobile-proxy-fullwidth"')
    expect(mobile).not.toContain('max-w-3xl')
  })
})
