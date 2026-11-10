import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { RuleItem } from '@/types'
import { RuleConfig } from './rule-config'

const rules: RuleItem[] = [
  { enabled: true, rule: 'example.com', target: '127.0.0.1:3000', exclusions: ['/health'] },
]

describe('RuleConfig narrow table (#166)', () => {
  it('gives pattern, exclusion, and target fields a rem minimum and a horizontal scroller', () => {
    render(
      <RuleConfig
        rules={rules}
        setRules={vi.fn()}
        ruleFiles={[{ name: 'dev', enabled: true, ruleCount: 1 }]}
        activeFileName="dev"
        fetchRuleFiles={vi.fn().mockResolvedValue([])}
        fetchFileContent={vi.fn().mockResolvedValue(undefined)}
        fetchRuleFileRawContent={vi.fn().mockResolvedValue('example.com !/health 127.0.0.1:3000')}
        saveRuleFileRawContent={vi.fn().mockResolvedValue(true)}
        saveFileContent={vi.fn().mockResolvedValue(true)}
        createRuleFile={vi.fn().mockResolvedValue({ success: true })}
        toggleRuleFile={vi.fn().mockResolvedValue(true)}
        renameRuleFile={vi.fn().mockResolvedValue({ success: true })}
        deleteRuleFile={vi.fn().mockResolvedValue(true)}
        reorderRuleFiles={vi.fn().mockResolvedValue(true)}
      />,
    )

    const scroll = screen.getByTestId('rule-table-scroll')
    const viewport = scroll.querySelector('[data-slot="scroll-area-viewport"]')
    expect(viewport).toBeTruthy()
    const track = screen.getByTestId('rule-table-track')
    expect(track).toHaveClass('min-w-[calc(640/14*1rem)]')
    expect(scroll).toContainElement(track)

    for (const value of ['example.com', '/health', '127.0.0.1:3000']) {
      const field = screen.getByDisplayValue(value)
      expect(field).toHaveClass('min-w-[calc(140/14*1rem)]')
      expect(field.closest('td')).toHaveClass('min-w-[calc(140/14*1rem)]')
      expect(scroll).toContainElement(field)
    }

    expect(screen.getByRole('button', { name: '删除规则' })).toBeInTheDocument()
  })
})
