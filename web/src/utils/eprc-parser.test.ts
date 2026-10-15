import { describe, it, expect } from 'vitest'
import {
  getEprcTextDiagnostics,
  hostsTextToEprc,
  normalizeImportedRuleText,
  parseEprcRules,
  rulesToEprc,
  rulesToEprcPreserving,
  NEW_RULE_COMMENT_MESSAGE,
  SPLIT_UNSAFE_MESSAGE,
} from './eprc-parser'

describe('eprc-parser', () => {
  describe('parseEprcRules', () => {
    it('should parse basic rule with target', () => {
      const input = 'example.com 192.168.1.1'
      const result = parseEprcRules(input)

      expect(result).toHaveLength(1)
      expect(result[0]).toEqual({
        rule: 'example.com',
        target: '192.168.1.1',
        enabled: true,
        exclusions: [],
      })
    })

    it('should parse multiple rules with single target', () => {
      const input = 'api.example.com web.example.com 192.168.1.1'
      const result = parseEprcRules(input)

      expect(result).toHaveLength(2)
      expect(result[0]).toEqual({
        rule: 'api.example.com',
        target: '192.168.1.1',
        enabled: true,
        exclusions: [],
      })
      expect(result[1]).toEqual({
        rule: 'web.example.com',
        target: '192.168.1.1',
        enabled: true,
        exclusions: [],
      })
    })

    it('should parse disabled rules (starting with //)', () => {
      const input = '//example.com 192.168.1.1'
      const result = parseEprcRules(input)

      expect(result).toHaveLength(1)
      expect(result[0]).toEqual({
        rule: 'example.com',
        target: '192.168.1.1',
        enabled: false,
        exclusions: [],
      })
    })

    it('should skip comment lines (starting with #)', () => {
      const input = '# This is a comment\nexample.com 192.168.1.1'
      const result = parseEprcRules(input)

      expect(result).toHaveLength(1)
      expect(result[0].rule).toBe('example.com')
    })

    it('should handle URL as target', () => {
      const input = 'example.com https://target.com:8080'
      const result = parseEprcRules(input)

      expect(result).toHaveLength(1)
      expect(result[0].target).toBe('https://target.com:8080')
    })

    it('should handle empty lines', () => {
      const input = 'example.com 192.168.1.1\n\ntest.com 192.168.1.2'
      const result = parseEprcRules(input)

      expect(result).toHaveLength(2)
    })

    it('should parse single exclusion pattern', () => {
      const input = 'xx.com !/api localhost:5173'
      const result = parseEprcRules(input)

      expect(result).toHaveLength(1)
      expect(result[0]).toEqual({
        rule: 'xx.com',
        target: 'localhost:5173',
        enabled: true,
        exclusions: ['/api'],
      })
    })

    it('should parse multiple exclusion patterns', () => {
      const input = 'xx.com !/api !/ws localhost:5173'
      const result = parseEprcRules(input)

      expect(result).toHaveLength(1)
      expect(result[0]).toEqual({
        rule: 'xx.com',
        target: 'localhost:5173',
        enabled: true,
        exclusions: ['/api', '/ws'],
      })
    })

  })

  describe('hostsTextToEprc', () => {
    it('should convert system hosts lines to EPRC lines', () => {
      const input = '127.0.0.1 example.com api.example.com'
      const result = hostsTextToEprc(input)

      expect(result).toBe('example.com api.example.com 127.0.0.1')
    })

    it('should ignore blank lines and hosts comments', () => {
      const input = [
        '# local dev',
        '127.0.0.1 example.com # inline comment',
        '',
        '192.168.1.10 api.example.com',
      ].join('\n')
      const result = hostsTextToEprc(input)

      expect(result).toBe('example.com 127.0.0.1\napi.example.com 192.168.1.10')
    })

    it('should wrap IPv6 addresses as URL host targets', () => {
      const input = '::1 local.example.test'
      const result = hostsTextToEprc(input)

      expect(result).toBe('local.example.test [::1]')
    })

    it('should skip lines that do not start with an IP address', () => {
      const input = 'example.com localhost:3000'
      const result = hostsTextToEprc(input)

      expect(result).toBe('')
    })
  })

  describe('normalizeImportedRuleText', () => {
    it('should normalize hosts text before parsing imported rules', () => {
      const input = '127.0.0.1 example.com api.example.com'
      const result = parseEprcRules(normalizeImportedRuleText(input))

      expect(result).toEqual([
        { rule: 'example.com', target: '127.0.0.1', enabled: true, exclusions: [] },
        { rule: 'api.example.com', target: '127.0.0.1', enabled: true, exclusions: [] },
      ])
    })

    it('should preserve EPRC text when it is not hosts format', () => {
      const input = 'example.com localhost:3000'
      const result = normalizeImportedRuleText(input)

      expect(result).toBe(input)
    })

    it('should preserve non-host lines when hosts lines are present', () => {
      const input = '127.0.0.1 example.com\napi.example.com localhost:3000'
      const result = normalizeImportedRuleText(input)

      expect(result).toBe('example.com 127.0.0.1\napi.example.com localhost:3000')
    })

    it('should not treat EPRC lines with port targets as hosts lines', () => {
      const input = '127.0.0.1 localhost:3000'
      const result = normalizeImportedRuleText(input)

      expect(result).toBe(input)
    })
  })

  describe('rulesToEprc', () => {
    it('should convert rules back to EPRC format', () => {
      const rules = [
        { rule: 'example.com', target: '192.168.1.1', enabled: true, exclusions: [] },
        { rule: 'test.com', target: '192.168.1.2', enabled: true, exclusions: [] },
      ]
      const result = rulesToEprc(rules)

      expect(result).toBe('example.com 192.168.1.1\ntest.com 192.168.1.2')
    })

    it('should prefix disabled rules with //', () => {
      const rules = [
        { rule: 'example.com', target: '192.168.1.1', enabled: false, exclusions: [] },
      ]
      const result = rulesToEprc(rules)

      expect(result).toBe('//example.com 192.168.1.1')
    })

    it('should handle mixed enabled and disabled rules', () => {
      const rules = [
        { rule: 'example.com', target: '192.168.1.1', enabled: true, exclusions: [] },
        { rule: 'test.com', target: '192.168.1.2', enabled: false, exclusions: [] },
      ]
      const result = rulesToEprc(rules)

      expect(result).toBe('example.com 192.168.1.1\n//test.com 192.168.1.2')
    })

    it('should output exclusions with ! prefix', () => {
      const rules = [
        { rule: 'xx.com', target: 'localhost:5173', enabled: true, exclusions: ['/api', '/ws'] },
      ]
      const result = rulesToEprc(rules)

      expect(result).toBe('xx.com !/api !/ws localhost:5173')
    })

    it('should handle empty exclusions', () => {
      const rules = [
        { rule: 'example.com', target: '192.168.1.1', enabled: true, exclusions: [] },
      ]
      const result = rulesToEprc(rules)

      expect(result).toBe('example.com 192.168.1.1')
    })
  })

  describe('getEprcTextDiagnostics', () => {
    it('reports lines that cannot be parsed as rules', () => {
      const input = [
        '# comment',
        'example.com localhost:3000',
        'invalid-line',
        '//disabled.example.com localhost:4000',
      ].join('\n')

      expect(getEprcTextDiagnostics(input)).toEqual([
        { line: 3, content: 'invalid-line' },
      ])
    })
  })

  describe('round-trip conversion', () => {
    it('should maintain data through parse and convert', () => {
      const original = 'api.example.com 192.168.1.1\n//disabled.example.com 192.168.1.2'
      const parsed = parseEprcRules(original)
      const converted = rulesToEprc(parsed)

      expect(converted).toBe(original)
    })

    it('should round-trip with exclusions', () => {
      const original = 'xx.com !/api !/ws localhost:5173'
      const parsed = parseEprcRules(original)
      const converted = rulesToEprc(parsed)

      expect(converted).toBe(original)
    })
  })
})

// Issue #145: a table-view save must not drop comments, blank lines or other
// rules' exclusions, and untouched rule lines stay byte-identical.
describe('rulesToEprcPreserving', () => {
  const ORIGINAL = [
    '# 联调',
    'api.example.com !/api http://localhost:5173',
    '',
    '  # 缩进的注释',
    '// disabled.example.com 127.0.0.1:9000',
    'multi-a.example.com multi-b.example.com !/health 127.0.0.1:4000',
    '   indented.example.com    !/skip   127.0.0.1:4100   ',
    '',
    '# edit 的注释',
    'edit.example.com !/keep 127.0.0.1:3000',
    '# 末尾注释',
    '',
  ].join('\n')
  const lines = ORIGINAL.split('\n')
  const withLines = (index: number, replacement: string[]) => {
    const next = lines.slice()
    next.splice(index, 1, ...replacement)
    return next.join('\n')
  }
  const parsed = () => parseEprcRules(ORIGINAL)

  it('round-trips unchanged rules byte for byte', () => {
    expect(rulesToEprcPreserving(parsed(), ORIGINAL)).toBe(ORIGINAL)
    const crlf = ORIGINAL.replace(/\n/g, '\r\n')
    expect(rulesToEprcPreserving(parseEprcRules(crlf), crlf)).toBe(crlf)
  })

  it('editing one rule rewrites only that line and keeps its comment above it', () => {
    const rules = parsed().map((r) => (r.rule === 'edit.example.com' ? { ...r, target: '127.0.0.1:3001' } : r))
    expect(rulesToEprcPreserving(rules, ORIGINAL)).toBe(withLines(9, ['edit.example.com !/keep 127.0.0.1:3001']))
  })

  it('toggling a rule off writes it as a // line in place', () => {
    const rules = parsed().map((r) => (r.rule === 'api.example.com' ? { ...r, enabled: false } : r))
    expect(rulesToEprcPreserving(rules, ORIGINAL)).toBe(withLines(1, ['//api.example.com !/api http://localhost:5173']))
  })

  it('editing one pattern of a shared line splits only that line', () => {
    const rules = parsed().map((r) => (r.rule === 'multi-b.example.com' ? { ...r, target: '127.0.0.1:4001' } : r))
    expect(rulesToEprcPreserving(rules, ORIGINAL)).toBe(
      withLines(5, ['multi-a.example.com !/health 127.0.0.1:4000', 'multi-b.example.com !/health 127.0.0.1:4001']),
    )
  })

  it('deleting a rule removes only its line; comments stay', () => {
    const rules = parsed().filter((r) => r.rule !== 'api.example.com')
    expect(rulesToEprcPreserving(rules, ORIGINAL)).toBe(withLines(1, []))
  })

  it('a rule added at the top (table "add") goes first; everything else is unchanged', () => {
    const rules = [{ enabled: true, rule: 'new.example.com', target: '127.0.0.1:5000', exclusions: [] }, ...parsed()]
    expect(rulesToEprcPreserving(rules, ORIGINAL)).toBe(`new.example.com 127.0.0.1:5000\n${ORIGINAL}`)
  })

  it('a rule appended at the end lands before the trailing newline', () => {
    const rules = [...parsed(), { enabled: true, rule: 'new.example.com', target: '127.0.0.1:5000', exclusions: ['/x'] }]
    expect(rulesToEprcPreserving(rules, ORIGINAL)).toBe(`${ORIGINAL}new.example.com !/x 127.0.0.1:5000\n`)
  })

  it('never loses a comment or blank line, even after reordering', () => {
    const rules = parsed().reverse()
    const out = rulesToEprcPreserving(rules, ORIGINAL)
    for (const line of lines.filter((l) => !l.trim() || l.trim().startsWith('#'))) {
      expect(out.split('\n')).toContain(line)
    }
    expect(rulesToEprc(parseEprcRules(out))).toBe(rulesToEprc(rules))
  })

  it('keeps a leading UTF-8 BOM byte-identical, even when the first rule is edited or deleted', () => {
    const bom = '\uFEFF'
    const text = `${bom}first.example.com !/f 127.0.0.1:1000\n${ORIGINAL}`
    const rules = parseEprcRules(text)
    expect(rules[0].rule).toBe('first.example.com')
    expect(rulesToEprcPreserving(rules, text)).toBe(text)
    const edited = rules.map((r, i) => (i === 0 ? { ...r, target: '127.0.0.1:1001' } : r))
    expect(rulesToEprcPreserving(edited, text)).toBe(`${bom}first.example.com !/f 127.0.0.1:1001\n${ORIGINAL}`)
    expect(rulesToEprcPreserving(rules.slice(1), text)).toBe(`${bom}${ORIGINAL}`)
  })

  it('refuses to write a rule whose pattern would start a line with // or #', () => {
    const text = '\uFEFFa.example.com //cdn.example.com 127.0.0.1:1\r\nx.com 2\r\n'
    const rules = parseEprcRules(text)
    expect(rules.map((r) => r.rule)).toEqual(['a.example.com', '//cdn.example.com', 'x.com'])
    // Unchanged: written back as is.
    expect(rulesToEprcPreserving(rules, text)).toBe(text)
    // Editing a.example.com (or deleting it) would leave //cdn.example.com at a line start.
    const edited = rules.map((r, i) => (i === 0 ? { ...r, target: '127.0.0.1:9' } : r))
    expect(() => rulesToEprcPreserving(edited, text)).toThrow(SPLIT_UNSAFE_MESSAGE)
    expect(() => rulesToEprcPreserving(rules.slice(1), text)).toThrow(SPLIT_UNSAFE_MESSAGE)
  })

  it.each(['#foo.com', '//foo.com'])('refuses a NEW table rule %s with the new-rule message (not the split one)', (pattern) => {
    expect(NEW_RULE_COMMENT_MESSAGE).toBe('规则不能以 // 或 # 开头，否则会被当成禁用行或注释。要写注释或禁用规则，请用文本编辑器。')
    const text = '\uFEFFa.example.com //cdn.example.com 127.0.0.1:1\r\nx.com 2\r\n'
    const rules = parseEprcRules(text)
    const added = { enabled: true, rule: pattern, target: '127.0.0.1:9', exclusions: [] }
    for (const next of [[...rules, added], [added, ...rules], [rules[0], rules[1], added, rules[2]]]) {
      expect(() => rulesToEprcPreserving(next, text)).toThrow(NEW_RULE_COMMENT_MESSAGE)
      try {
        rulesToEprcPreserving(next, text)
      } catch (err) {
        expect((err as { code?: string }).code).toBe('RULE_LINE_SPLIT_UNSAFE')
      }
    }
    // Without original text (empty file) too.
    expect(() => rulesToEprcPreserving([added], '')).toThrow(NEW_RULE_COMMENT_MESSAGE)
    // Editing the target of the existing //cdn.example.com still reports a split, not a new rule.
    const edited = rules.map((r) => (r.rule === '//cdn.example.com' ? { ...r, target: '127.0.0.1:9' } : r))
    expect(() => rulesToEprcPreserving(edited, text)).toThrow(SPLIT_UNSAFE_MESSAGE)
    // A disabled new rule is fine: it is written as a // line on purpose.
    expect(rulesToEprcPreserving([...rules, { ...added, rule: 'ok.com', enabled: false }], text)).toBe(`${text}//ok.com 127.0.0.1:9\r\n`)
  })

  it('falls back to rulesToEprc without original text', () => {
    const rules = parsed()
    expect(rulesToEprcPreserving(rules, '')).toBe(rulesToEprc(rules))
  })
})
