import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const readSource = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

describe('traffic B layout contract (P2 / #89)', () => {
  it('hosts B split only inside shell-work, never shell-config', () => {
    const app = readSource('../App.tsx')
    const workStart = app.indexOf('data-testid="shell-work"')
    const configStart = app.indexOf('data-testid="shell-config"')
    expect(workStart).toBeGreaterThan(-1)
    expect(configStart).toBeGreaterThan(workStart)

    const workSlice = app.slice(workStart, configStart)
    expect(workSlice).toContain('<TrafficWorkLayout')
    expect(workSlice).toContain('data-testid="log-panel-card"')
    expect(workSlice).toContain('<LogTable')
    expect(workSlice).toContain('<DetailPanel')

    const configSlice = app.slice(configStart)
    expect(configSlice).not.toContain('TrafficWorkLayout')
    expect(configSlice).not.toContain('traffic-split-handle')
  })

  it('uses dense virtualized rows for 1k+ scroll readiness', () => {
    const table = readSource('./log-table.tsx')
    expect(table).toContain("from '@tanstack/react-virtual'")
    expect(table).toContain('useVirtualizer')
    expect(table).toMatch(/LOG_ROW_HEIGHT\s*=\s*22/)
    expect(table).toContain('getTrafficHitSummary')
  })

  it('shows hit overview by default (0 extra click path)', () => {
    const detail = readSource('./detail-panel.tsx')
    expect(detail).toContain('defaultValue="overview"')
    expect(detail).toContain('detail-overview-hit')
    expect(detail).toContain('detail-hit-box')
    expect(detail).toContain('detail-create-mock')
    expect(detail).toContain('detail-jump-to-rule')
    expect(detail).toContain('detail-empty-state')
  })

  it('selects row without opening global panel on wide B', () => {
    const app = readSource('../App.tsx')
    expect(app).toContain('isNarrowTraffic')
    expect(app).toMatch(/if \(isNarrowTraffic\) \{[\s\S]*openPanelRoute\(\{ id: 'request\.detail'/)
  })
})
