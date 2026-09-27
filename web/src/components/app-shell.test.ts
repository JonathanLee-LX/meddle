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

  it('moves primary nav into the header (07-shell)', () => {
    const header = readSource('./app-header.tsx')
    const app = readSource('../App.tsx')
    expect(header).toContain('data-testid="app-shell-nav"')
    expect(header).toContain('SHELL_NAV')
    expect(readSource('../lib/shell-mode.ts')).toContain("label: '流量'")
    expect(app).toContain('activeTab={activeTab}')
    expect(app).toContain('onTabChange={handleTabChange}')
    // Old in-card TabsList for page nav should be gone
    expect(app).not.toContain('TabsList')
    expect(app).not.toContain('TabsTrigger')
  })

  it('keeps log filters and table inside the work host card', () => {
    const app = readSource('../App.tsx')
    const workStart = app.indexOf('data-testid="shell-work"')
    const workCard = app.indexOf('data-testid="log-panel-card"', workStart)
    expect(workStart).toBeGreaterThan(-1)
    expect(workCard).toBeGreaterThan(workStart)
    expect(app.indexOf('<LogFilter', workCard)).toBeGreaterThan(workCard)
    expect(app.indexOf('<LogTable', workCard)).toBeGreaterThan(workCard)
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
