import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useMemo, useState } from 'react'
import type { RuleItem } from '@/types'

// 提取筛选逻辑用于测试
function useRuleFilter(rules: RuleItem[]) {
  const [ruleFilter, setRuleFilter] = useState('')
  const [targetFilter, setTargetFilter] = useState('')

  const filteredRules = useMemo(() => {
    if (!ruleFilter && !targetFilter) {
      return rules
    }
    
    const lowerRuleFilter = ruleFilter.toLowerCase()
    const lowerTargetFilter = targetFilter.toLowerCase()
    
    return rules.filter((item) => {
      const matchesRule = !ruleFilter || item.rule.toLowerCase().includes(lowerRuleFilter)
      const matchesTarget = !targetFilter || item.target.toLowerCase().includes(lowerTargetFilter)
      return matchesRule && matchesTarget
    })
  }, [rules, ruleFilter, targetFilter])

  const uniqueTargets = useMemo(() => {
    const targets = new Set<string>()
    rules.forEach((item) => {
      if (item.target.trim()) {
        targets.add(item.target.trim())
      }
    })
    return Array.from(targets).sort()
  }, [rules])

  return {
    filteredRules,
    uniqueTargets,
    ruleFilter,
    targetFilter,
    setRuleFilter,
    setTargetFilter,
  }
}

describe('RuleConfig - Filter Functionality', () => {
  const mockRules: RuleItem[] = [
    { enabled: true, rule: 'rule1', target: 'target1', exclusions: [] },
    { enabled: true, rule: 'rule2', target: 'target2', exclusions: [] },
    { enabled: true, rule: 'example.com', target: '127.0.0.1:3000', exclusions: [] },
    { enabled: false, rule: 'disabled.com', target: 'localhost:8080', exclusions: [] },
    { enabled: true, rule: 'api.test.com', target: 'target1', exclusions: [] },
  ]

  describe('Rule Name Filtering', () => {
    it('should return all rules when no filter is applied', () => {
      const { result } = renderHook(() => useRuleFilter(mockRules))
      expect(result.current.filteredRules).toHaveLength(mockRules.length)
    })

    it('should filter rules by rule name (partial match)', () => {
      const { result } = renderHook(() => useRuleFilter(mockRules))
      
      act(() => {
        result.current.setRuleFilter('rule')
      })

      expect(result.current.filteredRules).toHaveLength(2)
      expect(result.current.filteredRules[0].rule).toBe('rule1')
      expect(result.current.filteredRules[1].rule).toBe('rule2')
    })

    it('should filter rules by rule name (exact match)', () => {
      const { result } = renderHook(() => useRuleFilter(mockRules))
      
      act(() => {
        result.current.setRuleFilter('example.com')
      })

      expect(result.current.filteredRules).toHaveLength(1)
      expect(result.current.filteredRules[0].rule).toBe('example.com')
    })

    it('should be case-insensitive for rule filtering', () => {
      const { result } = renderHook(() => useRuleFilter(mockRules))
      
      act(() => {
        result.current.setRuleFilter('RULE')
      })

      expect(result.current.filteredRules).toHaveLength(2)
    })

    it('should return empty array when no rules match', () => {
      const { result } = renderHook(() => useRuleFilter(mockRules))
      
      act(() => {
        result.current.setRuleFilter('nonexistent')
      })

      expect(result.current.filteredRules).toHaveLength(0)
    })

    it('should include disabled rules in filter results', () => {
      const { result } = renderHook(() => useRuleFilter(mockRules))
      
      act(() => {
        result.current.setRuleFilter('disabled')
      })

      expect(result.current.filteredRules).toHaveLength(1)
      expect(result.current.filteredRules[0].enabled).toBe(false)
    })
  })

  describe('Target Address Filtering', () => {
    it('should filter rules by target address', () => {
      const { result } = renderHook(() => useRuleFilter(mockRules))
      
      act(() => {
        result.current.setTargetFilter('target1')
      })

      expect(result.current.filteredRules).toHaveLength(2)
      const targets = result.current.filteredRules.map(r => r.target)
      expect(targets).toContain('target1')
    })

    it('should filter by IP address', () => {
      const { result } = renderHook(() => useRuleFilter(mockRules))
      
      act(() => {
        result.current.setTargetFilter('127.0.0.1')
      })

      expect(result.current.filteredRules).toHaveLength(1)
      expect(result.current.filteredRules[0].target).toBe('127.0.0.1:3000')
    })

    it('should filter by localhost', () => {
      const { result } = renderHook(() => useRuleFilter(mockRules))
      
      act(() => {
        result.current.setTargetFilter('localhost')
      })

      expect(result.current.filteredRules).toHaveLength(1)
      expect(result.current.filteredRules[0].target).toBe('localhost:8080')
    })

    it('should be case-insensitive for target filtering', () => {
      const { result } = renderHook(() => useRuleFilter(mockRules))
      
      act(() => {
        result.current.setTargetFilter('TARGET1')
      })

      expect(result.current.filteredRules).toHaveLength(2)
    })
  })

  describe('Combined Filtering', () => {
    it('should apply both rule and target filters (AND logic)', () => {
      const { result } = renderHook(() => useRuleFilter(mockRules))
      
      act(() => {
        result.current.setRuleFilter('rule')
        result.current.setTargetFilter('target1')
      })

      expect(result.current.filteredRules).toHaveLength(1)
      expect(result.current.filteredRules[0].rule).toBe('rule1')
      expect(result.current.filteredRules[0].target).toBe('target1')
    })

    it('should return empty when filters conflict', () => {
      const { result } = renderHook(() => useRuleFilter(mockRules))
      
      act(() => {
        result.current.setRuleFilter('rule1')
        result.current.setTargetFilter('target2')
      })

      expect(result.current.filteredRules).toHaveLength(0)
    })

    it('should clear rule filter independently', () => {
      const { result } = renderHook(() => useRuleFilter(mockRules))
      
      act(() => {
        result.current.setRuleFilter('rule')
        result.current.setTargetFilter('target1')
      })
      expect(result.current.filteredRules).toHaveLength(1)

      act(() => {
        result.current.setRuleFilter('')
      })
      expect(result.current.filteredRules).toHaveLength(2) // api.test.com and rule1 both have target1
    })

    it('should clear target filter independently', () => {
      const { result } = renderHook(() => useRuleFilter(mockRules))
      
      act(() => {
        result.current.setRuleFilter('rule')
        result.current.setTargetFilter('target1')
      })
      expect(result.current.filteredRules).toHaveLength(1)

      act(() => {
        result.current.setTargetFilter('')
      })
      expect(result.current.filteredRules).toHaveLength(2) // rule1 and rule2
    })
  })

  describe('Unique Targets List', () => {
    it('should return sorted unique targets', () => {
      const { result } = renderHook(() => useRuleFilter(mockRules))
      
      expect(result.current.uniqueTargets).toEqual([
        '127.0.0.1:3000',
        'localhost:8080',
        'target1',
        'target2',
      ])
    })

    it('should handle empty rules array', () => {
      const { result } = renderHook(() => useRuleFilter([]))
      
      expect(result.current.uniqueTargets).toEqual([])
    })

    it('should filter out empty targets', () => {
      const rulesWithEmptyTarget: RuleItem[] = [
        { enabled: true, rule: 'rule1', target: 'target1', exclusions: [] },
        { enabled: true, rule: 'rule2', target: '', exclusions: [] },
        { enabled: true, rule: 'rule3', target: '  ', exclusions: [] },
      ]
      const { result } = renderHook(() => useRuleFilter(rulesWithEmptyTarget))

      expect(result.current.uniqueTargets).toEqual(['target1'])
    })

    it('should deduplicate targets', () => {
      const rulesWithDuplicates: RuleItem[] = [
        { enabled: true, rule: 'rule1', target: 'target1', exclusions: [] },
        { enabled: true, rule: 'rule2', target: 'target1', exclusions: [] },
        { enabled: true, rule: 'rule3', target: 'target2', exclusions: [] },
      ]
      const { result } = renderHook(() => useRuleFilter(rulesWithDuplicates))

      expect(result.current.uniqueTargets).toEqual(['target1', 'target2'])
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty rules array', () => {
      const { result } = renderHook(() => useRuleFilter([]))
      
      expect(result.current.filteredRules).toHaveLength(0)
    })

    it('should handle whitespace in filters', () => {
      const { result } = renderHook(() => useRuleFilter(mockRules))
      
      act(() => {
        result.current.setRuleFilter('rule')
      })

      expect(result.current.filteredRules).toHaveLength(2)
      
      // 验证空格不影响筛选（如果用户输入了空格，应该精确匹配）
      act(() => {
        result.current.setRuleFilter('  rule  ')
      })
      
      // 不会匹配，因为没有规则名称包含前后空格
      expect(result.current.filteredRules).toHaveLength(0)
    })

    it('should handle special characters in filters', () => {
      const rulesWithSpecialChars: RuleItem[] = [
        { enabled: true, rule: 'api.example.com', target: '127.0.0.1:3000', exclusions: [] },
        { enabled: true, rule: 'web-app.test.com', target: 'localhost:8080', exclusions: [] },
      ]
      const { result } = renderHook(() => useRuleFilter(rulesWithSpecialChars))

      act(() => {
        result.current.setRuleFilter('.')
      })

      expect(result.current.filteredRules).toHaveLength(2)
    })

    it('should handle rules with same target', () => {
      const rulesWithSameTarget: RuleItem[] = [
        { enabled: true, rule: 'rule1', target: 'common-target', exclusions: [] },
        { enabled: true, rule: 'rule2', target: 'common-target', exclusions: [] },
        { enabled: true, rule: 'rule3', target: 'common-target', exclusions: [] },
      ]
      const { result } = renderHook(() => useRuleFilter(rulesWithSameTarget))

      act(() => {
        result.current.setTargetFilter('common')
      })

      expect(result.current.filteredRules).toHaveLength(3)
    })

    it('should update filtered results when rules array changes', () => {
      const { result, rerender } = renderHook(
        ({ rules }) => useRuleFilter(rules),
        { initialProps: { rules: mockRules } }
      )

      expect(result.current.filteredRules).toHaveLength(5)

      const newRules = [...mockRules, { enabled: true, rule: 'newRule', target: 'newTarget', exclusions: [] }]
      rerender({ rules: newRules })

      expect(result.current.filteredRules).toHaveLength(6)
    })
  })
})
