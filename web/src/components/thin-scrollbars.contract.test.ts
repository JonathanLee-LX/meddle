import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const readSource = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

describe('thin scrollbar contract (#93)', () => {
  it('defines shared .meddle-thin-scroll (~6px) and aliases tab scroll classes', () => {
    const css = readSource('../index.css')

    expect(css).toContain('.meddle-thin-scroll')
    expect(css).toContain('.ep-tabs-scroll')
    expect(css).toContain('.meddle-tabs-scroll')
    expect(css).toMatch(/\.meddle-thin-scroll[\s\S]*?scrollbar-width:\s*thin/)
    expect(css).toMatch(/\.meddle-thin-scroll::-webkit-scrollbar[\s\S]*?width:\s*6px/)
    expect(css).toMatch(/\.meddle-thin-scroll::-webkit-scrollbar[\s\S]*?height:\s*6px/)
    expect(css).toMatch(/scrollbar-color:\s*color-mix\(in oklab, var\(--foreground\) 22%, transparent\) transparent/)
  })

  it('applies thin native scroll to traffic table horizontal overflow (P0)', () => {
    const table = readSource('./log-table.tsx')
    expect(table).toMatch(/meddle-thin-scroll[^"]*overflow-x-auto/)
  })

  it('keeps ScrollArea thumb ~6px with foreground low-opacity (P0/P1)', () => {
    const scrollArea = readSource('./ui/scroll-area.tsx')
    expect(scrollArea).toContain('w-1.5')
    expect(scrollArea).toContain('h-1.5')
    expect(scrollArea).toContain('bg-foreground/20')
    expect(scrollArea).not.toMatch(/\bw-2\.5\b/)
    expect(scrollArea).not.toMatch(/\bh-2\.5\b/)
  })

  it('detail panel uses ScrollArea for tab panes (inherits thin Thumb)', () => {
    const detail = readSource('./detail-panel.tsx')
    expect(detail).toContain("from '@/components/ui/scroll-area'")
    expect(detail).toContain('<ScrollArea className="h-full px-4 pb-4">')
  })
})
