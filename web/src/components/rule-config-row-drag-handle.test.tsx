import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { RuleConfig } from './rule-config'

const ruleFiles = [{ name: '默认规则', enabled: true, ruleCount: 2 }]

function renderWithRules() {
  render(
    <RuleConfig
      rules={[
        { enabled: true, rule: 'a.example.com', target: '127.0.0.1:3000', exclusions: [] },
        { enabled: true, rule: 'b.example.com', target: '127.0.0.1:3001', exclusions: [] },
      ]}
      setRules={vi.fn()}
      ruleFiles={ruleFiles}
      activeFileName="默认规则"
      fetchRuleFiles={vi.fn().mockResolvedValue(ruleFiles)}
      fetchFileContent={vi.fn().mockResolvedValue(undefined)}
      fetchRuleFileRawContent={vi.fn().mockResolvedValue('')}
      saveRuleFileRawContent={vi.fn().mockResolvedValue(true)}
      saveFileContent={vi.fn().mockResolvedValue(true)}
      createRuleFile={vi.fn().mockResolvedValue({ success: true })}
      toggleRuleFile={vi.fn().mockResolvedValue(true)}
      renameRuleFile={vi.fn().mockResolvedValue({ success: true })}
      deleteRuleFile={vi.fn().mockResolvedValue(true)}
      reorderRuleFiles={vi.fn().mockResolvedValue(true)}
    />,
  )
}

describe('RuleConfig rule-row drag handle', () => {
  it('mounts a six-dot drag handle per sortable rule row', () => {
    renderWithRules()

    const handles = screen.getAllByRole('button', { name: '拖拽排序' })
    expect(handles.length).toBeGreaterThanOrEqual(2)
    expect(document.querySelectorAll('[data-slot="rule-row-drag-handle"]')).toHaveLength(2)
  })

  it('keeps the row drag handle hidden until the row is hovered (or dragging)', () => {
    renderWithRules()

    const handle = document.querySelector('[data-slot="rule-row-drag-handle"]')
    expect(handle).not.toBeNull()
    const icon = handle!.querySelector('svg')
    expect(icon).toHaveClass('opacity-0')
    expect(icon).toHaveClass('group-hover:opacity-100')
    expect(icon).toHaveClass('group-data-[dragging=true]:opacity-100')
    expect(icon).toHaveClass('transition-opacity')

    const row = handle!.closest('[data-slot="table-row"]')
    expect(row).not.toBeNull()
    expect(row!.className.split(/\s+/)).toContain('group')
  })
})
