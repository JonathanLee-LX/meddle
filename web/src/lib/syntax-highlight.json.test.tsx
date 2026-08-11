import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { highlightCode } from './syntax-highlight'

function renderHighlight(code: string) {
  const { container } = render(<>{highlightCode(code, 'json')}</>)
  return container.textContent || ''
}

function classNamesForText(code: string, needle: string): string[] {
  const { container } = render(<>{highlightCode(code, 'json')}</>)
  const spans = Array.from(container.querySelectorAll('span'))
  const matching = spans.filter(s => s.textContent === needle)
  return matching.map(s => s.className)
}

describe('highlightCode JSON', () => {
  it('highlights object keys in minified JSON', () => {
    const classes = classNamesForText('{"name":"meddle","count":3}', '"name"')
    expect(classes.length).toBeGreaterThan(0)
    expect(classes[0]).toContain('text-purple-600') // key color
  })

  it('highlights object keys in pretty-printed JSON', () => {
    // 格式化后: 键后是换行/空格再冒号（如 "name": "meddle"）
    const pretty = JSON.stringify({ name: 'meddle', count: 3 }, null, 2)
    const classes = classNamesForText(pretty, '"name"')
    expect(classes.length).toBeGreaterThan(0)
    expect(classes[0]).toContain('text-purple-600')
  })

  it('highlights string values distinct from keys in pretty JSON', () => {
    const pretty = JSON.stringify({ name: 'meddle' }, null, 2)
    const keyClasses = classNamesForText(pretty, '"name"')
    const valueClasses = classNamesForText(pretty, '"meddle"')
    expect(keyClasses[0]).toContain('text-purple-600')
    expect(valueClasses[0]).toContain('text-emerald-600')
  })

  it('preserves all characters in pretty-printed nested JSON', () => {
    const pretty = JSON.stringify({ a: { b: [1, 'x', true, null] }, c: 1.5 }, null, 2)
    const text = renderHighlight(pretty)
    expect(text).toBe(pretty)
  })

  it('preserves all characters in minified nested JSON', () => {
    const raw = '{"a":{"b":[1,"x",true,null]},"c":1.5}'
    const text = renderHighlight(raw)
    expect(text).toBe(raw)
  })

  it('highlights nested keys in pretty-printed JSON', () => {
    const pretty = JSON.stringify({ a: { b: { c: 1 } }, d: 2 }, null, 2)
    const outerKey = classNamesForText(pretty, '"a"')
    const innerKey = classNamesForText(pretty, '"b"')
    const deepKey = classNamesForText(pretty, '"c"')
    expect(outerKey[0]).toContain('text-purple-600')
    expect(innerKey[0]).toContain('text-purple-600')
    expect(deepKey[0]).toContain('text-purple-600')
  })
})
