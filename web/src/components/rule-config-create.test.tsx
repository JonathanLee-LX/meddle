import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { RuleConfig } from './rule-config'

function renderRuleConfig() {
  const createRuleFile = vi.fn().mockResolvedValue({ success: true })
  const fetchFileContent = vi.fn().mockResolvedValue(undefined)

  render(
    <RuleConfig
      rules={[]}
      setRules={vi.fn()}
      ruleFiles={[{ name: '默认规则', enabled: true, ruleCount: 0 }]}
      activeFileName="默认规则"
      fetchRuleFiles={vi.fn().mockResolvedValue([{ name: '默认规则', enabled: true, ruleCount: 0 }])}
      fetchFileContent={fetchFileContent}
      fetchRuleFileRawContent={vi.fn().mockResolvedValue('')}
      saveRuleFileRawContent={vi.fn().mockResolvedValue(true)}
      saveFileContent={vi.fn().mockResolvedValue(true)}
      createRuleFile={createRuleFile}
      toggleRuleFile={vi.fn().mockResolvedValue(true)}
      renameRuleFile={vi.fn().mockResolvedValue({ success: true })}
      deleteRuleFile={vi.fn().mockResolvedValue(true)}
    />,
  )

  return { createRuleFile, fetchFileContent }
}

describe('RuleConfig file creation', () => {
  it('creates a rule file from an inline editor in the file tab list', async () => {
    const user = userEvent.setup()
    const { createRuleFile, fetchFileContent } = renderRuleConfig()

    await user.click(screen.getByRole('button', { name: '创建规则文件' }))

    const tabList = screen.getByRole('tablist')
    const input = within(tabList).getByRole('textbox', { name: '新规则文件名称' })
    expect(input).toHaveValue('默认规则-2')
    expect(screen.queryByText('创建新规则文件')).not.toBeInTheDocument()

    await user.clear(input)
    await user.type(input, '新规则{Enter}')

    await waitFor(() => expect(createRuleFile).toHaveBeenCalledWith('新规则', ''))
    expect(fetchFileContent).toHaveBeenCalledWith('新规则')
  })

  it('cancels the inline editor with Escape', async () => {
    const user = userEvent.setup()
    const { createRuleFile } = renderRuleConfig()

    await user.click(screen.getByRole('button', { name: '创建规则文件' }))
    await user.type(screen.getByRole('textbox', { name: '新规则文件名称' }), '{Escape}')

    expect(createRuleFile).not.toHaveBeenCalled()
    expect(screen.queryByRole('textbox', { name: '新规则文件名称' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '创建规则文件' })).toBeInTheDocument()
  })
})
