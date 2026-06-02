import { describe, it, expect } from 'vitest'
import { hostsTextToEprc, normalizeImportedRuleText, parseEprcRules, rulesToEprc } from './eprc-parser'

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
