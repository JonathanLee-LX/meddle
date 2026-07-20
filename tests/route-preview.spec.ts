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

  it('matches rules in file order with exclusions', () => {
    const rulesText = `
^https://plus.wps.cn !/orderadm http://localhost:8082
^https://plus.wps.cn http://localhost:8082
    `.trim()
    const excluded = previewRouteTarget(
      'https://plus.wps.cn/orderadm/api/v1/buy/conf?_t=1',
      rulesText,
    )
    expect(excluded.matched).toBe(true)
    expect(excluded.resolvedUrl).toBe(
      'http://localhost:8082/orderadm/api/v1/buy/conf?_t=1',
    )

    const onlyFirst = previewRouteTarget(
      'https://plus.wps.cn/orderadm/api/v1/buy/conf?_t=1',
      '^https://plus.wps.cn !/orderadm http://localhost:8082',
    )
    expect(onlyFirst.matched).toBe(false)
    expect(onlyFirst.resolvedUrl).toBe(
      'https://plus.wps.cn/orderadm/api/v1/buy/conf?_t=1',
    )
  })

  it('previews first matching pattern when one line has multiple patterns', () => {
    const result = previewRouteTarget(
      'https://b.com/docs',
      'a.com b.com http://shared.local',
    )
    expect(result.matched).toBe(true)
    expect(result.resolvedUrl).toBe('http://shared.local/docs')
    expect(result.matchedRule?.pattern).toBe('b.com')
  })

  it('previews ordered same-pattern lines: exclusion skip then catch-all line', () => {
    const rulesText = `
^https://host.example !/admin http://localhost:8001
^https://host.example http://localhost:8002
    `.trim()
    const admin = previewRouteTarget('https://host.example/admin/panel', rulesText)
    expect(admin.matched).toBe(true)
    expect(admin.resolvedUrl).toBe('http://localhost:8002/admin/panel')
    expect(admin.matchedRule?.target).toBe('http://localhost:8002')

    const publicPage = previewRouteTarget('https://host.example/public', rulesText)
    expect(publicPage.resolvedUrl).toBe('http://localhost:8001/public')
    expect(publicPage.matchedRule?.target).toBe('http://localhost:8001')
  })

  it('previews specific pattern before wildcard in file order', () => {
    const rulesText = `
^https://api.example.com http://api-proxy.local
*.example.com http://wildcard.local
    `.trim()
    const api = previewRouteTarget('https://api.example.com/v1', rulesText)
    expect(api.resolvedUrl).toBe('http://api-proxy.local/v1')

    const cdn = previewRouteTarget('https://cdn.example.com/static.js', rulesText)
    expect(cdn.resolvedUrl).toBe('http://wildcard.local/static.js')
  })

  it('supports wildcard host patterns in preview', () => {
    const result = previewRouteTarget(
      'https://plus.wps.cn/docs/price/detail.html?source=navbar',
      '*.wps.cn localhost:5173',
    )

    expect(result.matched).toBe(true)
    expect(result.resolvedUrl).toBe('https://localhost:5173/docs/price/detail.html?source=navbar')
    expect(result.matchedRule?.pattern).toBe('*.wps.cn')
  })
})
