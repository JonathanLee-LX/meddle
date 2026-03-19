import { describe, it, expect } from 'vitest'
import { previewRouteTarget } from '../core/route-preview'

describe('previewRouteTarget', () => {
  it('resolves host targets by inheriting protocol, path and query', () => {
    const result = previewRouteTarget(
      'https://solution.wps.cn/docs/price/detail.html?source=navbar',
      'solution\\.wps\\.cn/docs/price/detail\\.html localhost:5173',
    )

    expect(result.matched).toBe(true)
    expect(result.resolvedUrl).toBe('https://localhost:5173/docs/price/detail.html?source=navbar')
    expect(result.matchedRule?.pattern).toBe('solution\\.wps\\.cn/docs/price/detail\\.html')
    expect(result.notes).toContain('继承原请求协议、路径和 query')
  })

  it('returns the original url when no rule matches', () => {
    const result = previewRouteTarget(
      'https://example.com/foo',
      'solution\\.wps\\.cn/docs/price/detail\\.html localhost:5173',
    )

    expect(result.matched).toBe(false)
    expect(result.resolvedUrl).toBe('https://example.com/foo')
    expect(result.notes).toContain('未命中规则，保持原 URL')
  })

  it('rejects invalid urls', () => {
    expect(() => previewRouteTarget('not-a-url', 'foo bar')).toThrow('请输入合法的 URL')
  })
})
