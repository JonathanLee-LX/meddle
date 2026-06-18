import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { highlightEprc } from './eprc-highlight'

/**
 * 用 renderToStaticMarkup 将高亮结果序列化为 HTML 字符串，
 * 再解析为 DOM 查询 span 的 className，避免 testing-library 的 act 兼容问题。
 */
function highlightHtml(text: string): string {
  return renderToStaticMarkup(<>{highlightEprc(text)}</>)
}

interface SpanInfo {
  text: string
  className: string
}

function getSpansFor(text: string): SpanInfo[] {
  const container = document.createElement('div')
  container.innerHTML = highlightHtml(text)
  return Array.from(container.querySelectorAll('span')).map((s) => ({
    text: s.textContent ?? '',
    className: s.getAttribute('class') ?? '',
  }))
}

describe('highlightEprc', () => {
  it('高亮整行注释为灰色斜体', () => {
    const spans = getSpansFor('# 这是一条注释')
    const comment = spans.find((s) => s.text === '# 这是一条注释')
    expect(comment).toBeDefined()
    expect(comment?.className).toContain('italic')
    expect(comment?.className).toContain('text-muted-foreground')
  })

  it('高亮禁用前缀 //', () => {
    const spans = getSpansFor('//example.com localhost:3000')
    const disabled = spans.find((s) => s.text === '//')
    expect(disabled).toBeDefined()
    expect(disabled?.className).toContain('text-amber')
  })

  it('高亮排除项 !token 为红色', () => {
    const spans = getSpansFor('example.com !/api localhost:3000')
    const exclusion = spans.find((s) => s.text === '!/api')
    expect(exclusion).toBeDefined()
    expect(exclusion?.className).toContain('text-red')
  })

  it('高亮最后一个普通 token 为目标(绿色)', () => {
    const spans = getSpansFor('example.com localhost:3000')
    const target = spans.find((s) => s.text === 'localhost:3000')
    expect(target).toBeDefined()
    expect(target?.className).toContain('text-emerald')
  })

  it('高亮 [marker] 标记为紫色', () => {
    const spans = getSpansFor('example.com[old] http://localhost:3000[new]')
    const markers = spans.filter((s) => s.text === '[old]' || s.text === '[new]')
    expect(markers).toHaveLength(2)
    markers.forEach((m) => expect(m.className).toContain('text-purple'))
  })

  it('普通规则 token 使用默认前景色', () => {
    const spans = getSpansFor('example.com localhost:3000')
    const rule = spans.find((s) => s.text === 'example.com')
    expect(rule).toBeDefined()
    expect(rule?.className).toContain('text-foreground')
    expect(rule?.className).not.toContain('text-emerald')
  })

  it('保留换行且多行各自着色', () => {
    const spans = getSpansFor('# 注释\nexample.com localhost:3000')
    // 第一行注释整体着色
    const comment = spans.find((s) => s.text === '# 注释')
    expect(comment?.className).toContain('italic')
    // 第二行目标着色
    const target = spans.find((s) => s.text === 'localhost:3000')
    expect(target?.className).toContain('text-emerald')
  })

  it('空内容返回原文字符串', () => {
    // 空字符串不满足 shouldHighlight，直接返回 [text]
    const result = highlightEprc('')
    expect(result).toEqual([''])
  })
})
