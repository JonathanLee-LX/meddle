import { describe, it, expect } from 'vitest'
import path from 'path'
import { execFileSync } from 'child_process'
import {
  parseEprc,
  parseEprcWithExclusions,
  ruleMapToEprcText,
  resolveTargetUrl,
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
