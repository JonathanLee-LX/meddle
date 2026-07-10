import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { RuleConfig } from './rule-config'

function renderRuleConfig(renameRuleFile = vi.fn().mockResolvedValue({ success: true, name: '新名称' })) {
  const fetchFileContent = vi.fn().mockResolvedValue(undefined)

  render(
    <RuleConfig
      rules={[]}
      setRules={vi.fn()}
      ruleFiles={[{ name: '旧名称', enabled: true, ruleCount: 0 }]}
      activeFileName="旧名称"
      fetchRuleFiles={vi.fn().mockResolvedValue([{ name: '旧名称', enabled: true, ruleCount: 0 }])}
      fetchFileContent={fetchFileContent}
      fetchRuleFileRawContent={vi.fn().mockResolvedValue('')}
      saveRuleFileRawContent={vi.fn().mockResolvedValue(true)}
      saveFileContent={vi.fn().mockResolvedValue(true)}
      createRuleFile={vi.fn().mockResolvedValue({ success: true })}
      toggleRuleFile={vi.fn().mockResolvedValue(true)}
      renameRuleFile={renameRuleFile}
      deleteRuleFile={vi.fn().mockResolvedValue(true)}
    />,
  )

  return { fetchFileContent, renameRuleFile }
}

describe('RuleConfig file rename', () => {
  it('renames a rule file by double-clicking its tab name', async () => {
    const user = userEvent.setup()
    const { fetchFileContent, renameRuleFile } = renderRuleConfig()

    await user.dblClick(screen.getByText('旧名称'))
    const input = screen.getByRole('textbox', { name: '重命名规则文件 旧名称' })
    await user.clear(input)
    await user.type(input, '新名称{Enter}')

    await waitFor(() => expect(renameRuleFile).toHaveBeenCalledWith('旧名称', '新名称'))
    expect(fetchFileContent).toHaveBeenCalledWith('新名称')
  })

  it('cancels inline rename with Escape', async () => {
    const user = userEvent.setup()
    const { renameRuleFile } = renderRuleConfig()

    await user.dblClick(screen.getByText('旧名称'))
    const input = screen.getByRole('textbox', { name: '重命名规则文件 旧名称' })
    await user.type(input, '{Escape}')

    expect(renameRuleFile).not.toHaveBeenCalled()
    expect(screen.getByText('旧名称')).toBeInTheDocument()
  })
})
