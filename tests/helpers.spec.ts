import { describe, it, expect } from 'vitest'
import path from 'path'
import { execFileSync } from 'child_process'
import {
  parseEprc,
  parseEprcWithExclusions,
  ruleMapToEprcText,
  resolveTargetUrl,
  findMatchedRouteRule,
  testRulePattern,
} from '../helpers'

describe('helpers.parseEprc', () => {
  it('parses rule-first format', () => {
    const content = 'a.com b.com 10.0.0.1:8080'
    const map = parseEprc(content)
    expect(map['a.com']).toBe('10.0.0.1:8080')
    expect(map['b.com']).toBe('10.0.0.1:8080')
  })

  it('ignores blank and commented lines', () => {
    const content = `
# comment
// disabled line

valid.com 127.0.0.1
`
    const map = parseEprc(content)
    expect(map['valid.com']).toBe('127.0.0.1')
    expect(map['disabled']).toBeUndefined()
  })
})

describe('helpers.ruleMapToEprcText', () => {
  it('groups same target in one line', () => {
    const text = ruleMapToEprcText({
      'a.com': '127.0.0.1',
      'b.com': '127.0.0.1',
      'c.com': '10.0.0.2',
    })
    const lines = text.split('\n').sort()
    expect(lines.includes('a.com b.com 127.0.0.1') || lines.includes('b.com a.com 127.0.0.1')).toBeTruthy()
    expect(lines.includes('c.com 10.0.0.2')).toBeTruthy()
  })
})

describe('helpers.resolveTargetUrl', () => {
  it('returns null when no rule matches', () => {
    const target = resolveTargetUrl('https://a.com/path', {})
    expect(target).toBe(null)
  })

  it('keeps path and query when target only has host', () => {
    const target = resolveTargetUrl('https://a.com/foo/bar?q=1', {
      'a\\.com': '127.0.0.1:8080',
    })
    expect(target).toBe('https://127.0.0.1:8080/foo/bar?q=1')
  })

  it('keeps origin port when target has no port', () => {
    const target = resolveTargetUrl('https://a.com:9443/foo', {
      'a\\.com': 'http://127.0.0.1/bar',
    })
    expect(target).toBe('http://127.0.0.1:9443/bar')
  })

  it('converts http target scheme to ws for websocket source', () => {
    const target = resolveTargetUrl('wss://a.com/socket?x=1', {
      'a\\.com': 'https://127.0.0.1:8080/socket',
    })
    expect(target).toBe('wss://127.0.0.1:8080/socket?x=1')
  })

  it('rewrites path with [marker] syntax on target side', () => {
    const target = resolveTargetUrl(
      'https://365.kdocs.cn/3rd/sass_open/sass_open/embed/billing-mode',
      { '^https://365\\.kdocs\\.cn/3rd/sass_open': 'localhost:8001[3rd/sass_open]' },
    )
    expect(target).toBe('https://localhost:8001/sass_open/embed/billing-mode')
  })

  it('rewrites path with [marker] and preserves query string', () => {
    const target = resolveTargetUrl(
      'https://example.com/api/v2/users?page=1',
      { '^https://example\\.com/api/v2': 'localhost:3000[api/v2]' },
    )
    expect(target).toBe('https://localhost:3000/users?page=1')
  })

  it('handles [marker] when marker is not found in URL gracefully', () => {
    const target = resolveTargetUrl(
      'https://a.com/foo',
      { 'a\\.com': 'localhost:8080[not-exist]' },
    )
    expect(target).toBeTruthy()
  })

  it('supports wildcard host patterns for root domain and subdomains', () => {
    expect(resolveTargetUrl('https://wps.cn/path', { '*.wps.cn': 'localhost:3000' }))
      .toBe('https://localhost:3000/path')
    expect(resolveTargetUrl('https://plus.wps.cn/path', { '*.wps.cn': 'localhost:3000' }))
      .toBe('https://localhost:3000/path')
    expect(resolveTargetUrl('https://deep.plus.wps.cn/path', { '*.wps.cn': 'localhost:3000' }))
      .toBe('https://localhost:3000/path')
  })
})

describe('helpers.getFreePort', () => {
  it('supports base port larger than 9999', () => {
    const script = `
      const { getFreePort } = require('./dist/helpers')
      getFreePort().then((port) => {
        process.stdout.write(String(port))
      }).catch((err) => {
        process.stderr.write(String(err && err.message ? err.message : err))
        process.exit(1)
      })
    `
    const output = execFileSync(process.execPath, ['-e', script], {
      cwd: path.resolve(__dirname, '..'),
      env: { ...process.env, PORT: '18989' },
      encoding: 'utf8',
    }).trim()
    expect(Number(output) >= 18989).toBeTruthy()
  })
})

describe('helpers.parseEprc + resolveTargetUrl [marker] rewrite', () => {
  it('parses [marker] on pattern side and rewrites URL correctly', () => {
    const content = '^https://365.kdocs.cn/[3rd/sass_open] localhost:8001'
    const map = parseEprc(content)
    expect(map['^https://365.kdocs.cn/3rd/sass_open']).toBe('localhost:8001[3rd/sass_open]')

    const target = resolveTargetUrl(
      'https://365.kdocs.cn/3rd/sass_open/sass_open/embed/billing-mode',
      map,
    )
    expect(target).toBe('https://localhost:8001/sass_open/embed/billing-mode')
  })

  it('preserves query string through [marker] rewrite', () => {
    const map = parseEprc('^https://example.com/[api/v2] localhost:3000')
    const target = resolveTargetUrl('https://example.com/api/v2/users?page=1&size=10', map)
    expect(target).toBe('https://localhost:3000/users?page=1&size=10')
  })

  it('roundtrips through ruleMapToEprcText with [marker]', () => {
    const original = '^https://365.kdocs.cn/[3rd/sass_open] localhost:8001'
    const map = parseEprc(original)
    const text = ruleMapToEprcText(map)
    expect(text).toContain('[3rd/sass_open]')
    expect(text).toContain('localhost:8001')
    expect(text).not.toContain('localhost:8001[')
  })
})

describe('helpers.parseEprc - disabled rules support', () => {
  it('should ignore rules with // prefix', () => {
    const content = `
rule1 target1
//rule2 target2
rule3 target3
    `.trim()
    const map = parseEprc(content)
    expect(map['rule1']).toBe('target1')
    expect(map['rule2']).toBeUndefined()
    expect(map['rule3']).toBe('target3')
  })

  it('should handle mixed enabled and disabled rules', () => {
    const content = `
enabled1.com enabled2.com 127.0.0.1:3000
//disabled.com 127.0.0.1:3000
active.com 192.168.1.1
    `.trim()
    const map = parseEprc(content)
    expect(map['enabled1.com']).toBe('127.0.0.1:3000')
    expect(map['enabled2.com']).toBe('127.0.0.1:3000')
    expect(map['disabled.com']).toBeUndefined()
    expect(map['active.com']).toBe('192.168.1.1')
  })

  it('should handle disabled rules with multiple domains', () => {
    const content = '//api.example.com web.example.com 127.0.0.1:8000'
    const map = parseEprc(content)
    expect(map['api.example.com']).toBeUndefined()
    expect(map['web.example.com']).toBeUndefined()
  })

  it('should handle empty content', () => {
    const map = parseEprc('')
    expect(Object.keys(map).length).toBe(0)
  })

  it('should handle only disabled rules', () => {
    const content = `
//rule1 target1
//rule2 target2
    `.trim()
    const map = parseEprc(content)
    expect(Object.keys(map).length).toBe(0)
    expect(map['rule1']).toBeUndefined()
    expect(map['rule2']).toBeUndefined()
  })
})

describe('helpers.ruleMapToEprcText - preserves rule format', () => {
  it('should format grouped rules with target at the end', () => {
    const text = ruleMapToEprcText({
      'example.com': '127.0.0.1:3000',
      'api.example.com': '127.0.0.1:3000',
    })
    expect(text === 'example.com api.example.com 127.0.0.1:3000' || text === 'api.example.com example.com 127.0.0.1:3000').toBeTruthy()
  })

  it('should handle single rule', () => {
    const text = ruleMapToEprcText({
      'single.com': '192.168.1.1',
    })
    expect(text.trim()).toBe('single.com 192.168.1.1')
  })

  it('should handle empty rule map', () => {
    const text = ruleMapToEprcText({})
    expect(text).toBe('')
  })
})

// ===== Exclusion pattern tests =====

describe('helpers.parseEprcWithExclusions', () => {
  it('parses single exclusion pattern', () => {
    const content = 'xx.com !/api localhost:5173'
    const { ruleMap, excludeMap } = parseEprcWithExclusions(content)
    expect(ruleMap['xx.com']).toBe('localhost:5173')
    expect(excludeMap['xx.com']).toEqual(['/api'])
  })

  it('parses multiple exclusion patterns', () => {
    const content = 'xx.com !/api !/ws localhost:5173'
    const { ruleMap, excludeMap } = parseEprcWithExclusions(content)
    expect(ruleMap['xx.com']).toBe('localhost:5173')
    expect(excludeMap['xx.com']).toEqual(['/api', '/ws'])
  })

  it('handles rules without exclusions', () => {
    const content = 'xx.com localhost:5173'
    const { ruleMap, excludeMap } = parseEprcWithExclusions(content)
    expect(ruleMap['xx.com']).toBe('localhost:5173')
    expect(excludeMap['xx.com']).toEqual([])
  })

  it('handles multiple rules with same target and exclusions', () => {
    const content = 'a.com b.com !/api localhost:5173'
    const { ruleMap, excludeMap } = parseEprcWithExclusions(content)
    expect(ruleMap['a.com']).toBe('localhost:5173')
    expect(ruleMap['b.com']).toBe('localhost:5173')
    expect(excludeMap['a.com']).toEqual(['/api'])
    expect(excludeMap['b.com']).toEqual(['/api'])
  })
})

describe('helpers.resolveTargetUrl with exclusions', () => {
  it('matches URL not in exclusion list', () => {
    const target = resolveTargetUrl(
      'https://xx.com/src',
      { 'xx\\.com': 'localhost:5173' },
      { 'xx\\.com': ['/api'] }
    )
    expect(target).toBe('https://localhost:5173/src')
  })

  it('returns null when URL matches exclusion', () => {
    const target = resolveTargetUrl(
      'https://xx.com/api/users',
      { 'xx\\.com': 'localhost:5173' },
      { 'xx\\.com': ['/api'] }
    )
    expect(target).toBe(null)
  })

  it('falls through to next rule when excluded', () => {
    const target = resolveTargetUrl(
      'https://xx.com/api/users',
      {
        'xx\\.com': 'localhost:5173',
        'xx\\.com/api': 'localhost:8080',
      },
      { 'xx\\.com': ['/api'] }
    )
    // The second rule 'xx\.com/api' matches and is NOT excluded, so it takes over
    expect(target).toBe('https://localhost:8080/api/users')
  })

  it('works without excludeMap', () => {
    const target = resolveTargetUrl(
      'https://xx.com/api/users',
      { 'xx\\.com': 'localhost:5173' }
    )
    expect(target).toBe('https://localhost:5173/api/users')
  })
})

describe('helpers.ruleMapToEprcText with exclusions', () => {
  it('outputs exclusions with ! prefix', () => {
    const text = ruleMapToEprcText(
      { 'xx\\.com': 'localhost:5173' },
      { 'xx\\.com': ['/api', '/ws'] }
    )
    expect(text.includes('!/api')).toBeTruthy()
    expect(text.includes('!/ws')).toBeTruthy()
    expect(text.includes('localhost:5173')).toBeTruthy()
  })

  it('handles rules without exclusions', () => {
    const text = ruleMapToEprcText(
      { 'xx\\.com': 'localhost:5173' }
    )
    expect(text).not.toContain('!')
    expect(text).toContain('localhost:5173')
  })

  it('separates rules with different exclusions', () => {
    const text = ruleMapToEprcText(
      {
        'a\\.com': 'localhost:5173',
        'b\\.com': 'localhost:5173',
      },
      {
        'a\\.com': ['/api'],
        'b\\.com': [],  // no exclusions
      }
    )
    // Rules with different exclusion settings should be on separate lines
    const lines = text.split('\n')
    expect(lines.length).toBe(2)
  })
})

// ===== testRulePattern tests for simple patterns =====

describe('helpers.testRulePattern', () => {
  it('matches simple domain pattern with dots as literals', () => {
    // cloudcdn.qwps.cn should match literally, not treat . as regex wildcard
    expect(testRulePattern('cloudcdn.qwps.cn', 'https://cloudcdn.qwps.cn/path')).toBe(true)
    expect(testRulePattern('cloudcdn.qwps.cn', 'https://cloudcdnXqwpsYcn/path')).toBe(false)
  })

  it('preserves regex behavior for patterns with regex syntax', () => {
    // Patterns with regex metacharacters should still work as regex
    expect(testRulePattern('^https://a\\.com', 'https://a.com/path')).toBe(true)
    expect(testRulePattern('^https://a\\.com', 'https://b.com/a.com/path')).toBe(false)
  })
})

// ===== Exclusion with simple domain patterns =====

describe('helpers.resolveTargetUrl with domain exclusion', () => {
  it('excludes exact domain match from wildcard rule', () => {
    const ruleMap = { '*.wps.cn': '120.92.124.158' }
    const excludeMap = { '*.wps.cn': ['cloudcdn.qwps.cn'] }

    // cloudcdn.qwps.cn matches *.wps.cn but should be excluded
    expect(resolveTargetUrl('https://cloudcdn.qwps.cn/path', ruleMap, excludeMap)).toBe(null)

    // Other subdomains should still work
    expect(resolveTargetUrl('https://plus.wps.cn/path', ruleMap, excludeMap)).toBe('https://120.92.124.158/path')
  })

  it('handles multiple exclusion patterns', () => {
    const ruleMap = { '*.wps.cn': '120.92.124.158' }
    const excludeMap = { '*.wps.cn': ['cdn.wps.cn', 'static.wps.cn'] }

    expect(resolveTargetUrl('https://cdn.wps.cn/assets/app.js', ruleMap, excludeMap)).toBe(null)
    expect(resolveTargetUrl('https://static.wps.cn/style.css', ruleMap, excludeMap)).toBe(null)
    expect(resolveTargetUrl('https://api.wps.cn/users', ruleMap, excludeMap)).toBe('https://120.92.124.158/users')
  })

  it('exclusion pattern with dots matches literally', () => {
    const ruleMap = { '*.com': 'proxy.local' }
    const excludeMap = { '*.com': ['cdn.example.com'] }

    // cdn.example.com should be excluded
    expect(resolveTargetUrl('https://cdn.example.com/file.js', ruleMap, excludeMap)).toBe(null)

    // cdnXexampleYcom should NOT match the exclusion (dots are literal)
    expect(resolveTargetUrl('https://cdnXexampleYcom/file.js', ruleMap, excludeMap)).toBe('https://proxy.local/file.js')
  })

  it('falls through to next rule when excluded', () => {
    const ruleMap = {
      '*.wps.cn': '120.92.124.158',
      'cloudcdn\\.qwps\\.cn': 'localhost:3000',
    }
    const excludeMap = { '*.wps.cn': ['cloudcdn.qwps.cn'] }

    // First rule is excluded, second rule should match
    const result = resolveTargetUrl('https://cloudcdn.qwps.cn/bundle.js', ruleMap, excludeMap)
    expect(result).toBe('https://localhost:3000/bundle.js')
  })
})

// ===== Full scenario test matching user-reported issue =====

describe('helpers.resolveTargetUrl - real world scenario', () => {
  it('matches user reported issue: cloudcdn.qwps.cn exclusion', () => {
    // Simulating the user's actual rule:
    // *.wps.cn !cloudcdn.qwps.cn 120.92.124.158
    const content = '*.wps.cn !cloudcdn.qwps.cn 120.92.124.158'
    const { ruleMap, excludeMap } = parseEprcWithExclusions(content)

    const testUrl = 'https://cloudcdn.qwps.cn/open/web_open-homepage/index-DYjEn_Uk.js'

    // Should NOT match because cloudcdn.qwps.cn is excluded
    const result = resolveTargetUrl(testUrl, ruleMap, excludeMap)
    expect(result).toBe(null)
  })

  it('verifies preview matches actual routing behavior', () => {
    // Multiple rules scenario
    const content = `
saas-sys-beta.kso.net 120.92.124.158
*.wps.cn !cloudcdn.qwps.cn 120.92.124.158
*.kdocs.cn 120.92.124.158
    `.trim()

    const { ruleMap, excludeMap } = parseEprcWithExclusions(content)

    // cloudcdn.qwps.cn should be excluded
    expect(resolveTargetUrl('https://cloudcdn.qwps.cn/bundle.js', ruleMap, excludeMap)).toBe(null)

    // Other wps.cn subdomains should work
    expect(resolveTargetUrl('https://plus.wps.cn/api/data', ruleMap, excludeMap)).toBe('https://120.92.124.158/api/data')

    // kdocs.cn should work
    expect(resolveTargetUrl('https://365.kdocs.cn/docs', ruleMap, excludeMap)).toBe('https://120.92.124.158/docs')
  })

  it('handles exclusion with path pattern', () => {
    const content = '*.kdocs.cn !/3rd/account/api https://localhost:13001'
    const { ruleMap, excludeMap } = parseEprcWithExclusions(content)

    // URL with excluded path should not match
    expect(resolveTargetUrl('https://365.kdocs.cn/3rd/account/api/login', ruleMap, excludeMap)).toBe(null)

    // URL without excluded path should match
    expect(resolveTargetUrl('https://365.kdocs.cn/docs/page', ruleMap, excludeMap)).toBe('https://localhost:13001/docs/page')
  })

  it('matches rules in file order; first passing rule wins', () => {
    const content = `
^https://plus.wps.cn !/orderadm http://localhost:8082
^https://plus.wps.cn http://localhost:8082
    `.trim()
    const { rules, ruleMap, excludeMap } = parseEprcWithExclusions(content)

    // 旧版 map 同 pattern 后者覆盖 exclusion（仅用于展示）
    expect(excludeMap['^https://plus.wps.cn']).toEqual([])

    // 有序 rules：第 1 条 exclusion 跳过，第 2 条命中
    expect(
      resolveTargetUrl(
        'https://plus.wps.cn/orderadm/api/v1/buy/conf?_t=1',
        rules,
      ),
    ).toBe('http://localhost:8082/orderadm/api/v1/buy/conf?_t=1')
    expect(
      resolveTargetUrl('https://plus.wps.cn/other/api', rules),
    ).toBe('http://localhost:8082/other/api')

    // 仅第 1 条时 exclusion 生效，无后续规则可命中
    const { rules: rulesOnlyFirst } = parseEprcWithExclusions(
      '^https://plus.wps.cn !/orderadm http://localhost:8082',
    )
    expect(
      resolveTargetUrl(
        'https://plus.wps.cn/orderadm/api/v1/buy/conf?_t=1',
        rulesOnlyFirst,
      ),
    ).toBe(null)
    expect(
      resolveTargetUrl('https://plus.wps.cn/other/api', rulesOnlyFirst),
    ).toBe('http://localhost:8082/other/api')

    // 兼容旧版 map 调用（Object.keys 顺序不保证，此处仅断言 ruleMap 存在）
    expect(ruleMap['^https://plus.wps.cn']).toBe('http://localhost:8082')
  })
})

// ===== 多 pattern：一行多 pattern、同 pattern 多行、多规则优先级 =====

describe('helpers.ordered rules - multi-pattern', () => {
  describe('parse: one line with multiple patterns', () => {
    it('creates one rule entry per pattern in source order', () => {
      const { rules } = parseEprcWithExclusions('a.com b.com c.com http://target.local')
      expect(rules).toHaveLength(3)
      expect(rules.map((r) => r.pattern)).toEqual(['a.com', 'b.com', 'c.com'])
      expect(rules.every((r) => r.target === 'http://target.local')).toBe(true)
      expect(rules.every((r) => r.exclusions.length === 0)).toBe(true)
    })

    it('shares exclusions across all patterns on the same line', () => {
      const { rules } = parseEprcWithExclusions('a.com b.com !/api !/ws http://target.local')
      expect(rules).toHaveLength(2)
      expect(rules[0].exclusions).toEqual(['/api', '/ws'])
      expect(rules[1].exclusions).toEqual(['/api', '/ws'])
    })
  })

  describe('match: one line with multiple patterns', () => {
    const rules = parseEprcWithExclusions('a.com b.com !/api http://shared.local').rules

    it('matches first pattern when URL fits a.com only', () => {
      expect(resolveTargetUrl('https://a.com/page', rules)).toBe('http://shared.local/page')
    })

    it('matches second pattern when URL fits b.com only', () => {
      expect(resolveTargetUrl('https://b.com/page', rules)).toBe('http://shared.local/page')
    })

    it('applies shared exclusion for either pattern', () => {
      expect(resolveTargetUrl('https://a.com/api/x', rules)).toBe(null)
      expect(resolveTargetUrl('https://b.com/api/x', rules)).toBe(null)
    })

    it('returns first matching rule entry in list order when both could match', () => {
      // a.com 与 b.com 不会同时命中同一 URL；此处验证 findMatchedRouteRule 返回列表中靠前项
      const matched = findMatchedRouteRule('https://a.com/static', rules)
      expect(matched?.entry.pattern).toBe('a.com')
    })
  })

  describe('match: same pattern on multiple lines', () => {
    const rules = parseEprcWithExclusions(`
^https://host.example !/admin http://localhost:8001
^https://host.example !/internal http://localhost:8002
^https://host.example http://localhost:8003
    `.trim()).rules

    it('skips line 1 when /admin excluded, hits line 2 when line 2 exclusion does not apply', () => {
      expect(resolveTargetUrl('https://host.example/admin/users', rules)).toBe(
        'http://localhost:8002/admin/users',
      )
    })

    it('uses line 1 when path is /internal but line 1 only excludes /admin', () => {
      expect(resolveTargetUrl('https://host.example/internal/x', rules)).toBe(
        'http://localhost:8001/internal/x',
      )
    })

    it('uses line 1 for public paths when no exclusion hits', () => {
      expect(resolveTargetUrl('https://host.example/public', rules)).toBe(
        'http://localhost:8001/public',
      )
    })

    it('stops at first passing line without trying later lines', () => {
      const matched = findMatchedRouteRule('https://host.example/public', rules)
      expect(matched?.entry.target).toBe('http://localhost:8001')
      expect(matched?.resolvedUrl).toBe('http://localhost:8001/public')
    })
  })

  describe('match: same pattern two lines (exclusion then catch-all)', () => {
    const rules = parseEprcWithExclusions(`
^https://host.example !/admin http://localhost:8001
^https://host.example http://localhost:8002
    `.trim()).rules

    it('uses catch-all line when first line exclusion matches', () => {
      expect(resolveTargetUrl('https://host.example/admin/panel', rules)).toBe(
        'http://localhost:8002/admin/panel',
      )
    })

    it('uses first line when exclusion does not match', () => {
      expect(resolveTargetUrl('https://host.example/public', rules)).toBe(
        'http://localhost:8001/public',
      )
    })
  })

  describe('match: different patterns by priority (first match wins)', () => {
    const rules = parseEprcWithExclusions(`
^https://api.example.com http://api-proxy.local
*.example.com http://wildcard-proxy.local
    `.trim()).rules

    it('prefers specific regex over later wildcard', () => {
      expect(resolveTargetUrl('https://api.example.com/v1', rules)).toBe(
        'http://api-proxy.local/v1',
      )
    })

    it('falls through to wildcard when specific pattern does not match', () => {
      expect(resolveTargetUrl('https://cdn.example.com/assets.js', rules)).toBe(
        'http://wildcard-proxy.local/assets.js',
      )
    })

    it('does not use wildcard when specific rule already matched', () => {
      const matched = findMatchedRouteRule('https://api.example.com/x', rules)
      expect(matched?.entry.pattern).toBe('^https://api.example.com')
    })
  })

  describe('match: exclusion fallthrough to different pattern', () => {
    const rules = parseEprcWithExclusions(`
*.wps.cn !cloudcdn.qwps.cn http://cdn-pool.local
cloudcdn.qwps.cn http://dedicated-cdn.local
    `.trim()).rules

    it('uses dedicated rule when wildcard line excludes subdomain', () => {
      expect(resolveTargetUrl('https://cloudcdn.qwps.cn/bundle.js', rules)).toBe(
        'http://dedicated-cdn.local/bundle.js',
      )
    })

    it('uses wildcard line for other subdomains', () => {
      expect(resolveTargetUrl('https://plus.wps.cn/api', rules)).toBe(
        'http://cdn-pool.local/api',
      )
    })
  })

  describe('match: three lines same pattern with different targets', () => {
    it('only last line applies when first two always excluded for test URL', () => {
      const { rules } = parseEprcWithExclusions(`
^https://plus.wps.cn !/orderadm http://localhost:8082
^https://plus.wps.cn http://localhost:8082
*.wps.cn http://120.92.124.158
      `.trim())

      // 前两行处理 plus.wps.cn；/orderadm 被第一行跳过、第二行命中 8082
      expect(
        resolveTargetUrl('https://plus.wps.cn/orderadm/api', rules),
      ).toBe('http://localhost:8082/orderadm/api')

      // 其他子域走第三行
      expect(resolveTargetUrl('https://docs.wps.cn/x', rules)).toBe(
        'http://120.92.124.158/x',
      )
    })
  })
})

// ===== Critical test: excludeMap must be passed to resolveTargetUrl =====

describe('helpers.resolveTargetUrl - excludeMap parameter is required', () => {
  it('returns wrong result when excludeMap is missing (bug scenario)', () => {
    const ruleMap = { '*.wps.cn': '120.92.124.158' }
    const excludeMap = { '*.wps.cn': ['cloudcdn.qwps.cn'] }
    const testUrl = 'https://cloudcdn.qwps.cn/bundle.js'

    // Correct behavior: pass excludeMap
    const correctResult = resolveTargetUrl(testUrl, ruleMap, excludeMap)
    expect(correctResult).toBe(null) // Excluded, should not match

    // Bug scenario: omit excludeMap (what was happening in index.js)
    const buggyResult = resolveTargetUrl(testUrl, ruleMap) // No excludeMap!
    expect(buggyResult).toBe('https://120.92.124.158/bundle.js') // Incorrectly matches!

    // This test documents why excludeMap must ALWAYS be passed
    expect(correctResult).not.toBe(buggyResult)
  })

  it('demonstrates preview vs actual routing consistency', () => {
    // Simulates the data flow:
    // Preview: uses rulesText -> parseEprcWithExclusions -> resolveTargetUrl(ruleMap, excludeMap)
    // Actual: should also use resolveTargetUrl(ruleMap, excludeMap)

    const rulesText = '*.wps.cn !cloudcdn.qwps.cn 120.92.124.158'
    const { ruleMap, excludeMap } = parseEprcWithExclusions(rulesText)
    const testUrl = 'https://cloudcdn.qwps.cn/open/web_open-homepage/index-DYjEn_Uk.js'

    // Preview path (correct)
    const previewResult = resolveTargetUrl(testUrl, ruleMap, excludeMap)

    // Actual routing should use the same call
    const actualResult = resolveTargetUrl(testUrl, ruleMap, excludeMap)

    // They MUST be consistent
    expect(previewResult).toBe(actualResult)
    expect(previewResult).toBe(null) // Both should show no match
  })

  it('ensures all URL types respect exclusions', () => {
    const ruleMap = { '*.example.com': 'proxy.local' }
    const excludeMap = { '*.example.com': ['cdn.example.com'] }

    // HTTP request
    expect(resolveTargetUrl('http://cdn.example.com/file.js', ruleMap, excludeMap)).toBe(null)
    expect(resolveTargetUrl('http://api.example.com/data', ruleMap, excludeMap)).toBe('http://proxy.local/data')

    // HTTPS request
    expect(resolveTargetUrl('https://cdn.example.com/file.js', ruleMap, excludeMap)).toBe(null)
    expect(resolveTargetUrl('https://api.example.com/data', ruleMap, excludeMap)).toBe('https://proxy.local/data')

    // WebSocket request
    expect(resolveTargetUrl('wss://cdn.example.com/socket', ruleMap, excludeMap)).toBe(null)
    expect(resolveTargetUrl('wss://api.example.com/socket', ruleMap, excludeMap)).toBe('wss://proxy.local/socket')
  })
})
