import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const readSource = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

/**
 * Relative luminance from OKLab linear sRGB. This is the formula that
 * reproduces the measured pairs on main: violet/white 2.73, red/white 2.89,
 * and dark violet primary on the page background 6.94.
 */
function contrast(a: readonly [number, number, number], b: readonly [number, number, number]) {
  const lum = ([L, C, H]: readonly [number, number, number]) => {
    const rad = (H * Math.PI) / 180
    const labA = C * Math.cos(rad)
    const labB = C * Math.sin(rad)
    const l_ = L + 0.3963377774 * labA + 0.2158037573 * labB
    const m_ = L - 0.1055613458 * labA - 0.0638541728 * labB
    const s_ = L - 0.0894841775 * labA - 1.2914855480 * labB
    const l = l_ ** 3
    const m = m_ ** 3
    const s = s_ ** 3
    const rgb = [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
    ].map((channel) => Math.min(1, Math.max(0, channel)))
    return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]
  }
  const hi = Math.max(lum(a), lum(b))
  const lo = Math.min(lum(a), lum(b))
  return (hi + 0.05) / (lo + 0.05)
}

function parseOklch(value: string): [number, number, number] {
  const match = value.match(/oklch\(\s*([0-9.]+)\s+([0-9.]+)\s+(-?[0-9.]+)/)
  if (!match) throw new Error(`expected oklch color, got ${value}`)
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

type Decl = { selector: string; prop: string; value: string; index: number }

function parseCustomProps(css: string): Decl[] {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const decls: Decl[] = []
  const blockRe = /([^{}]+)\{([^{}]+)\}/g
  let block: RegExpExecArray | null
  let index = 0
  while ((block = blockRe.exec(source))) {
    const selectors = block[1].split(',').map((selector) => selector.trim()).filter(Boolean)
    if (selectors.some((selector) => selector.startsWith('@'))) continue
    for (const part of block[2].split(';')) {
      const colon = part.indexOf(':')
      if (colon < 0) continue
      const prop = part.slice(0, colon).trim()
      const value = part.slice(colon + 1).trim()
      if (!prop.startsWith('--')) continue
      for (const selector of selectors) decls.push({ selector, prop, value, index: index++ })
    }
  }
  return decls
}

function specificity(selector: string) {
  const classes = selector.match(/\.[A-Za-z0-9_-]+/g)?.length ?? 0
  const attrs = selector.match(/\[[^\]]+\]/g)?.length ?? 0
  const pseudos = selector.match(/:(?!:)[A-Za-z-]+/g)?.length ?? 0
  return classes + attrs + pseudos
}

function selectorMatches(selector: string, theme: 'light' | 'dark', accent: string) {
  if (selector === ':root') return true
  if (selector === '.dark') return theme === 'dark'
  const accentName = selector.match(/data-accent='([^']+)'/)?.[1]
  if (!accentName || accentName !== accent) return false
  if (selector.includes('.dark') && theme !== 'dark') return false
  return selector.includes(':root')
}

function resolveTokens(decls: Decl[], theme: 'light' | 'dark', accent: string) {
  const winners = new Map<string, Decl>()
  for (const decl of decls) {
    if (!selectorMatches(decl.selector, theme, accent)) continue
    const previous = winners.get(decl.prop)
    if (
      !previous
      || specificity(decl.selector) > specificity(previous.selector)
      || (specificity(decl.selector) === specificity(previous.selector) && decl.index >= previous.index)
    ) {
      winners.set(decl.prop, decl)
    }
  }
  const raw = Object.fromEntries([...winners].map(([prop, decl]) => [prop, decl.value]))
  const visiting = new Set<string>()
  const lookup = (name: string): string => {
    if (visiting.has(name)) throw new Error(`cycle at ${name}`)
    const value = raw[name]
    if (!value) throw new Error(`missing ${name} for ${theme}/${accent}`)
    visiting.add(name)
    const resolved = value.replace(/var\((--[\w-]+)\)/g, (_match, ref: string) => lookup(ref))
    visiting.delete(name)
    return resolved
  }
  return Object.fromEntries(Object.keys(raw).map((prop) => [prop, lookup(prop)]))
}

const FROZEN_PRIMARY = [
  '--primary: oklch(0.205 0 0);',
  '--primary: oklch(0.922 0 0);',
  '--primary: oklch(0.546 0.245 262.881);',
  '--primary: oklch(0.541 0.281 293.009);',
  '--primary: oklch(0.527 0.154 150.069);',
  '--primary: oklch(0.646 0.222 41.116);',
  '--primary: oklch(0.586 0.253 17.585);',
  '--primary: oklch(0.702 0.183 293.541);',
  '--primary: oklch(0.707 0.165 254.624);',
  '--primary: oklch(0.723 0.219 149.579);',
  '--primary: oklch(0.705 0.213 47.604);',
  '--primary: oklch(0.645 0.246 16.439);',
]

const ACCENTS = ['neutral', 'auto', 'blue', 'violet', 'green', 'orange', 'rose'] as const
const THEMES = ['light', 'dark'] as const
const CHIP_PAIRS = [
  ['primary-soft', 'primary-soft-foreground'],
  ['success', 'success-foreground'],
  ['warning', 'warning-foreground'],
  ['error', 'error-foreground'],
  ['secondary', 'secondary-foreground'],
] as const

describe('status color contrast', () => {
  it('matches the measured failing pairs and the primary-as-text ratio', () => {
    expect(contrast([0.702, 0.183, 293.541], [0.985, 0, 0])).toBeCloseTo(2.73, 2)
    expect(contrast([0.704, 0.191, 22.216], [1, 0, 0])).toBeCloseTo(2.89, 2)
    expect(contrast([0.702, 0.183, 293.541], [0.145, 0, 0])).toBeCloseTo(6.94, 2)
  })

  it('keeps every badge and status chip at WCAG AA, without darkening --primary', () => {
    const css = readSource('../index.css')
    for (const line of FROZEN_PRIMARY) expect(css).toContain(line)

    const decls = parseCustomProps(css)
    for (const theme of THEMES) {
      for (const accent of ACCENTS) {
        const tokens = resolveTokens(decls, theme, accent)
        for (const [background, foreground] of CHIP_PAIRS) {
          const ratio = contrast(parseOklch(tokens[`--${background}`]), parseOklch(tokens[`--${foreground}`]))
          expect(ratio, `${theme} ${accent} ${background}/${foreground} = ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(4.5)
        }
        const mutedOnPage = contrast(parseOklch(tokens['--muted-foreground']), parseOklch(tokens['--background']))
        expect(mutedOnPage, `${theme} ${accent} muted text on background = ${mutedOnPage.toFixed(2)}`).toBeGreaterThanOrEqual(4.5)
      }
    }

    const darkAuto = resolveTokens(decls, 'dark', 'auto')
    expect(contrast(parseOklch(darkAuto['--primary']), parseOklch(darkAuto['--background']))).toBeCloseTo(6.94, 2)
  })

  it('points badge fills at the solid tokens and routes status colors through them', () => {
    const badge = readSource('../components/ui/badge.tsx')
    expect(badge).toContain('default: "bg-primary-soft text-primary-soft-foreground"')
    expect(badge).toContain('destructive:\n          "bg-error text-error-foreground')
    expect(badge).toContain('success: "bg-success text-success-foreground"')
    expect(badge).toContain('warning: "bg-warning text-warning-foreground"')
    expect(badge).not.toContain('text-white')
    expect(badge).not.toContain('dark:bg-destructive/60')

    const detail = readSource('../components/detail-panel.tsx')
    expect(detail).toContain('bg-success text-success-foreground')
    expect(detail).toContain('bg-warning text-warning-foreground')
    expect(detail).toContain('bg-error text-error-foreground')
    expect(detail).not.toContain('bg-green-100')
    expect(detail).not.toContain('bg-red-100')
    expect(detail).not.toContain('bg-amber-100')

    const table = readSource('../components/log-table.tsx')
    expect(table).toContain("if (code >= 500) return 'destructive'")
    expect(table).toContain("if (code >= 400) return 'warning'")
    expect(table).toContain("if (code >= 200) return 'success'")
    expect(table).toContain("const tableBadgeClassName = 'h-[16px] px-[4px] py-0 font-mono text-[10px] leading-none'")

    const mocks = readSource('../components/mock-config.tsx')
    expect(mocks).toContain("rule.statusCode >= 500 ? 'destructive' : rule.statusCode >= 400 ? 'warning' : rule.statusCode >= 300 ? 'secondary' : 'success'")

    const health = readSource('../components/health-panel.tsx')
    expect(health).toContain("status === 'critical' ? 'destructive' : status === 'degraded' ? 'warning' : 'success'")
  })
})
