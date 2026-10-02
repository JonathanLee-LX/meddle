import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { RuleConfig } from './rule-config'

function renderWithFiles(names: string[], activeFileName = names[0]) {
  const reorderRuleFiles = vi.fn().mockResolvedValue(true)
  const toggleRuleFile = vi.fn().mockResolvedValue(true)
  const fetchFileContent = vi.fn().mockResolvedValue(undefined)
  const ruleFiles = names.map((name) => ({ name, enabled: true, ruleCount: 0 }))

  render(
    <RuleConfig
      rules={[]}
      setRules={vi.fn()}
      ruleFiles={ruleFiles}
      activeFileName={activeFileName}
      fetchRuleFiles={vi.fn().mockResolvedValue(ruleFiles)}
      fetchFileContent={fetchFileContent}
      fetchRuleFileRawContent={vi.fn().mockResolvedValue('')}
      saveRuleFileRawContent={vi.fn().mockResolvedValue(true)}
      saveFileContent={vi.fn().mockResolvedValue(true)}
      createRuleFile={vi.fn().mockResolvedValue({ success: true })}
      toggleRuleFile={toggleRuleFile}
      renameRuleFile={vi.fn().mockResolvedValue({ success: true })}
      deleteRuleFile={vi.fn().mockResolvedValue(true)}
      reorderRuleFiles={reorderRuleFiles}
    />,
  )

  return { reorderRuleFiles, toggleRuleFile, fetchFileContent }
}

describe('RuleConfig rule-file tab drag handle', () => {
  it('mounts a six-dot drag handle per tab when there are two or more files', () => {
    renderWithFiles(['alpha', 'beta'])

    expect(screen.getByRole('button', { name: '拖拽排序 alpha' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '拖拽排序 beta' })).toBeInTheDocument()
    expect(document.querySelectorAll('[data-slot="rule-file-tab-drag-handle"]')).toHaveLength(2)
  })

  it('keeps the drag handle hidden until the tab is hovered (or dragging)', () => {
    renderWithFiles(['alpha', 'beta'])

    const handle = screen.getByRole('button', { name: '拖拽排序 alpha' })
    expect(handle).toHaveClass('opacity-0')
    expect(handle).toHaveClass('group-hover:opacity-100')
    expect(handle).toHaveClass('group-data-[dragging=true]:opacity-100')
    expect(handle).toHaveClass('transition-opacity')

    // Same reveal pattern as the per-tab delete control on the group TabsTrigger.
    const tab = screen.getByRole('tab', { name: /alpha/ })
    expect(tab.className.split(/\s+/)).toContain('group')
  })

  it('hides the drag handle when only one rule file exists', () => {
    renderWithFiles(['solo'])

    expect(screen.queryByRole('button', { name: '拖拽排序 solo' })).not.toBeInTheDocument()
    expect(document.querySelector('[data-slot="rule-file-tab-drag-handle"]')).toBeNull()
  })

  it('keeps double-click rename on the tab name without requiring the handle', async () => {
    const user = userEvent.setup()
    const renameRuleFile = vi.fn().mockResolvedValue({ success: true, name: 'renamed' })
    const ruleFiles = [
      { name: 'alpha', enabled: true, ruleCount: 0 },
      { name: 'beta', enabled: true, ruleCount: 0 },
    ]

    render(
      <RuleConfig
        rules={[]}
        setRules={vi.fn()}
        ruleFiles={ruleFiles}
        activeFileName="alpha"
        fetchRuleFiles={vi.fn().mockResolvedValue(ruleFiles)}
        fetchFileContent={vi.fn().mockResolvedValue(undefined)}
        fetchRuleFileRawContent={vi.fn().mockResolvedValue('')}
        saveRuleFileRawContent={vi.fn().mockResolvedValue(true)}
        saveFileContent={vi.fn().mockResolvedValue(true)}
        createRuleFile={vi.fn().mockResolvedValue({ success: true })}
        toggleRuleFile={vi.fn().mockResolvedValue(true)}
        renameRuleFile={renameRuleFile}
        deleteRuleFile={vi.fn().mockResolvedValue(true)}
        reorderRuleFiles={vi.fn().mockResolvedValue(true)}
      />,
    )

    await user.dblClick(screen.getByText('alpha'))
    expect(screen.getByRole('textbox', { name: '重命名规则文件 alpha' })).toBeInTheDocument()
  })

  it('uses a vertical file list scroller (#102)', () => {
    renderWithFiles(['alpha', 'beta', 'gamma'])

    expect(screen.getByTestId('rule-config-layout')).toHaveAttribute('data-layout', 'files-vertical')
    expect(screen.getByTestId('rule-file-list')).toBeInTheDocument()
    const scroller = screen.getByRole('tablist').closest('[data-slot="rule-file-tabs-scroll"]')
    expect(scroller).toHaveClass('overflow-y-auto')
    expect(scroller).toHaveClass('overflow-x-hidden')
  })
})
