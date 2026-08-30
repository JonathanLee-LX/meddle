import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { RuleConfig } from './rule-config'

const files = [{ name: '默认规则', enabled: true, ruleCount: 1 }]

function renderRuleConfig() {
  render(
    <RuleConfig
      rules={[]}
      setRules={vi.fn()}
      ruleFiles={files}
      activeFileName="默认规则"
      fetchRuleFiles={vi.fn().mockResolvedValue(files)}
      fetchFileContent={vi.fn().mockResolvedValue(undefined)}
      fetchRuleFileRawContent={vi.fn().mockResolvedValue('')}
      saveRuleFileRawContent={vi.fn().mockResolvedValue(true)}
      saveFileContent={vi.fn().mockResolvedValue(true)}
      createRuleFile={vi.fn().mockResolvedValue({ success: true })}
      toggleRuleFile={vi.fn().mockResolvedValue(true)}
      renameRuleFile={vi.fn().mockResolvedValue({ success: true })}
      deleteRuleFile={vi.fn().mockResolvedValue(true)}
    />,
  )
}

describe('RuleConfig rule overview entry', () => {
  it('renders the entry button left of the create button and opens the overview panel', async () => {
    const user = userEvent.setup()
    renderRuleConfig()

    const viewAllButton = screen.getByRole('button', { name: '查看所有规则' })
    const createButton = screen.getByRole('button', { name: '创建规则文件' })
    const actionSlot = createButton.closest('[data-slot="rule-file-actions"]')
    expect(actionSlot).toContainElement(viewAllButton)
    expect(viewAllButton.compareDocumentPosition(createButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    const openPanelSpy = vi.fn()
    window.addEventListener('global-panel:open-panel', openPanelSpy)
    await user.click(viewAllButton)
    window.removeEventListener('global-panel:open-panel', openPanelSpy)

    expect(openPanelSpy).toHaveBeenCalledTimes(1)
    const detail = openPanelSpy.mock.calls[0][0] as CustomEvent
    expect(detail.detail).toMatchObject({ id: 'rules.overview', size: 'lg' })
  })
})
