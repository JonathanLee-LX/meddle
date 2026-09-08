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

  it('locks critical spacing and radius token values', () => {
    const css = readSource('../index.css')

    expect(css).toMatch(/--ui-page-padding:\s*1\.5rem/)
    expect(css).toMatch(/--ui-panel-padding:\s*1\.75rem/)
    expect(css).toMatch(/--ui-content-gap:\s*2rem/)
    expect(css).toMatch(/--ui-section-gap:\s*1rem/)
    expect(css).toMatch(/--ui-field-gap:\s*0\.75rem/)
    expect(css).toMatch(/--ui-copy-leading:\s*1\.5rem/)
    expect(css).toMatch(/--radius:\s*0\.625rem/)
  })

  it('binds layout classes to the spacing tokens', () => {
    const css = readSource('../index.css')

    expect(css).toMatch(/\.app-workspace-content[\s\S]*?gap:\s*var\(--ui-content-gap\)/)
    expect(css).toMatch(/\.app-workspace-content[\s\S]*?padding:\s*var\(--ui-page-padding\)/)
    expect(css).toMatch(/\.app-page-stack[\s\S]*?gap:\s*var\(--ui-content-gap\)/)
    expect(css).toMatch(/\.app-panel-content[\s\S]*?gap:\s*var\(--ui-content-gap\)/)
    expect(css).toMatch(/\.app-panel-content[\s\S]*?padding:\s*var\(--ui-panel-padding\)/)
    expect(css).toMatch(/\.app-section[\s\S]*?gap:\s*var\(--ui-section-gap\)/)
    expect(css).toMatch(/\.app-field-group[\s\S]*?gap:\s*var\(--ui-field-gap\)/)
  })

  it('tightens page/panel spacing on small screens', () => {
    const css = readSource('../index.css')
    const mobileBlock = css.match(/@media \(max-width: 640px\) \{[\s\S]*?--ui-page-padding:[\s\S]*?\}/)?.[0] ?? ''

    expect(mobileBlock).toMatch(/--ui-page-padding:\s*1rem/)
    expect(mobileBlock).toMatch(/--ui-panel-padding:\s*1rem/)
    expect(mobileBlock).toMatch(/--ui-content-gap:\s*1\.5rem/)
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

describe('ui primitive contracts', () => {
  it('keeps Button default/selected semantics and size scale', () => {
    const source = readSource('./ui/button.tsx')

    expect(source).toContain('default: "bg-foreground text-background hover:bg-primary hover:text-primary-foreground"')
    expect(source).toContain('selected: "bg-primary text-primary-foreground hover:bg-primary/90"')
    expect(source).toContain('default: "h-9 px-4 py-2 has-[>svg]:px-3"')
    expect(source).toContain('xs: "h-6 gap-1 rounded-md px-2 text-xs')
    expect(source).toContain('sm: "h-8 rounded-md gap-1.5 px-3')
    expect(source).toContain('lg: "h-10 rounded-md px-6')
    expect(source).toContain('icon: "size-9"')
    expect(source).toContain('"icon-xs": "size-6')
    expect(source).toContain('"icon-sm": "size-8"')
    expect(source).toContain('"icon-lg": "size-10"')
    expect(source).toContain('leading-none')
    expect(source).toContain('[&_svg]:translate-y-px')
  })

  it('keeps Badge / Tabs / Input as shared primitives', () => {
    expect(readSource('./ui/badge.tsx')).toContain('data-slot="badge"')
    expect(readSource('./ui/tabs.tsx')).toContain('data-slot="tabs"')
    expect(readSource('./ui/tabs.tsx')).toContain('data-slot="tabs-list"')
    expect(readSource('./ui/tabs.tsx')).toContain('data-slot="tabs-trigger"')
    expect(readSource('./ui/input.tsx')).toContain('data-slot="input"')
    expect(readSource('./ui/input.tsx')).toContain('h-9 w-full min-w-0 rounded-md border')
  })

  it('optically aligns tab/button icons with CJK labels', () => {
    const tabs = readSource('./ui/tabs.tsx')
    expect(tabs).toContain('leading-none')
    expect(tabs).toContain('[&_svg]:block')
    expect(tabs).toContain('[&_svg]:self-center')
    expect(tabs).toContain('[&_svg]:translate-y-px')

    const button = readSource('./ui/button.tsx')
    expect(button).toContain('leading-none')
    expect(button).toContain('[&_svg]:translate-y-px')

    const app = readSource('../App.tsx')
    expect(app).toContain('<span className="leading-none">日志</span>')
    expect(app).toContain('<span className="leading-none">路由规则</span>')
    expect(app).toContain('<span className="leading-none">Mock</span>')
    expect(app).toContain('<span className="leading-none">扩展插件</span>')
    expect(app).toContain('<span className="leading-none">健康</span>')
  })
})
