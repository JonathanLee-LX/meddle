import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const readSource = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

describe('app shell layout contract (P1 / #88)', () => {
  it('hosts work XOR config content (no stacked B + full-width)', () => {
    const app = readSource('../App.tsx')
    expect(app).toContain('data-testid="shell-work"')
    expect(app).toContain('data-testid="shell-config"')
    expect(app).toContain('data-shell-mode="work"')
    expect(app).toContain('data-shell-mode="config"')
    expect(app).toContain("shellMode === 'work'")
    // Single exclusive branch — work host must not wrap config pages
    expect(app).toMatch(/shellMode === 'work' \? \([\s\S]*data-testid="shell-work"[\s\S]*\) : \([\s\S]*data-testid="shell-config"/)
  })

  it('places a vertical nav beside shell content', () => {
    const header = readSource('./app-header.tsx')
    const app = readSource('../App.tsx')
    expect(header).toContain('data-testid="app-shell-nav"')
    expect(header).toContain('orientation="vertical"')
    expect(header).toContain('<TabsList')
    expect(header).toContain('<TabsTrigger')
    expect(header).toContain('SHELL_NAV')
    expect(readSource('../lib/shell-mode.ts')).toContain("label: '流量'")
    expect(app).toContain('activeTab={activeTab}')
    expect(app).toContain('onTabChange={handleTabChange}')
    const main = app.indexOf('className="app-shell-main')
    const nav = app.indexOf('<ShellNav', main)
    const work = app.indexOf('data-testid="shell-work"', main)
    expect(main).toBeGreaterThan(-1)
    expect(nav).toBeGreaterThan(main)
    expect(work).toBeGreaterThan(nav)
    const workTag = app.slice(work, app.indexOf('>', work))
    const config = app.indexOf('data-testid="shell-config"', work)
    const configTag = app.slice(config, app.indexOf('>', config))
    expect(workTag).toContain('mt-[var(--ui-section-gap)]')
    expect(configTag).toContain('mt-[var(--ui-section-gap)]')
    // Page hosts must not grow their own tab lists
    expect(app).not.toContain('TabsList')
    expect(app).not.toContain('TabsTrigger')
  })

  it('keeps log filters and table inside one master Card (#102)', () => {
    const app = readSource('../App.tsx')
    const workStart = app.indexOf('data-testid="shell-work"')
    const workMaster = app.indexOf('data-testid="log-panel-card"', workStart)
    expect(workStart).toBeGreaterThan(-1)
    expect(workMaster).toBeGreaterThan(workStart)
    expect(app.indexOf('<LogFilter', workMaster)).toBeGreaterThan(workMaster)
    expect(app.indexOf('<LogTable', workMaster)).toBeGreaterThan(workMaster)
    const workEnd = app.indexOf('data-testid="shell-config"')
    const workSlice = app.slice(workStart, workEnd)
    expect(workSlice).toMatch(/<Card[\s\n][^>]*data-testid="log-panel-card"/)
    expect(workSlice).toContain('detailOpen={store.selectedRecordId != null}')
    expect(workSlice).toContain('app-page-pad')
    expect(workSlice).toContain('border-b pb-[var(--ui-section-gap)]')
  })
})

describe('app shell traffic B host (P2 / #89)', () => {
  it('wires TrafficWorkLayout inside shell-work only', () => {
    const app = readSource('../App.tsx')
    const workStart = app.indexOf('data-testid="shell-work"')
    const configStart = app.indexOf('data-testid="shell-config"')
    expect(app.indexOf('<TrafficWorkLayout', workStart)).toBeGreaterThan(workStart)
    expect(app.indexOf('<TrafficWorkLayout', workStart)).toBeLessThan(configStart)
    expect(app.slice(configStart)).not.toContain('TrafficWorkLayout')
  })
})
