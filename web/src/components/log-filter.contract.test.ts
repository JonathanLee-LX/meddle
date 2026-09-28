import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const readSource = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

describe('log filter source select contract (#100)', () => {
  const source = readSource('./log-filter.tsx')

  it('uses Select for client source instead of four source toggles', () => {
    expect(source).toContain("from '@/components/ui/select'")
    expect(source).toContain('data-testid="log-filter-source-select"')
    expect(source).toContain('aria-label="流量来源"')
    expect(source).toContain("value: 'all', label: '全部来源'")
    expect(source).toContain("value: 'local', label: '本机'")
    expect(source).toContain("value: 'remote', label: '远程设备'")
    expect(source).toContain("value: 'plugin', label: '插件测试'")
    // Source control is SelectTrigger + SelectItem over CLIENT_SOURCES
    expect(source).toMatch(/SelectTrigger[\s\S]*?aria-label="流量来源"/)
    expect(source).toContain('CLIENT_SOURCES.map((source) => (')
    expect(source).toContain('<SelectItem key={source.value}')
    // No ToggleGroup bound to clientSourceFilter
    expect(source).not.toMatch(/value=\{clientSourceFilter\}[\s\S]{0,200}ToggleGroup/)
    expect(source).not.toMatch(/<ToggleGroup[\s\S]{0,200}value=\{clientSourceFilter\}/)
  })

  it('keeps source Select and resource types on one filter row', () => {
    expect(source).toContain('data-testid="log-filter-source-type-row"')
    expect(source).toMatch(
      /data-testid="log-filter-source-type-row"[\s\S]*?flex-nowrap[\s\S]*?overflow-x-auto/,
    )
    expect(source).toMatch(
      /data-testid="log-filter-source-type-row"[\s\S]*?log-filter-source-select[\s\S]*?aria-label="资源类型"/,
    )
    // Search stays its own row (proxy-log-filter outside the source/type row)
    const rowStart = source.indexOf('data-testid="log-filter-source-type-row"')
    expect(source.indexOf('id="proxy-log-filter"')).toBeGreaterThan(-1)
    expect(source.indexOf('id="proxy-log-filter"')).toBeLessThan(rowStart)
  })

  it('preserves clear / count / recording controls on the search row', () => {
    expect(source).toContain('aria-label="清除搜索"')
    expect(source).toContain('aria-label="清空日志"')
    expect(source).toContain('aria-label={recording ? \'暂停记录\' : \'恢复记录\'}')
    expect(source).toContain('filteredCount} / ${totalCount}')
    expect(source).toContain('${totalCount} 条')
  })
})
