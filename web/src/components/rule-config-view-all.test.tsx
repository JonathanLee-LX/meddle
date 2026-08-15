import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { RuleConfig } from './rule-config'

const files = [
  { name: '默认规则', enabled: true, ruleCount: 2 },
  { name: '开发规则', enabled: false, ruleCount: 1 },
]

function renderRuleConfig({ empty = false } = {}) {
  const fetchRuleFileRawContent = vi.fn(async (name: string) => {
    if (empty) return ''
    if (name === '默认规则') return 'example.com 127.0.0.1:3000\napi.test.com localhost:8080'
    return '//disabled.com 127.0.0.1:4000'
  })

  render(
    <RuleConfig
      rules={[]}
      setRules={vi.fn()}
      ruleFiles={files}
      activeFileName="默认规则"
      fetchRuleFiles={vi.fn().mockResolvedValue(files)}
      fetchFileContent={vi.fn().mockResolvedValue(undefined)}
      fetchRuleFileRawContent={fetchRuleFileRawContent}
      saveRuleFileRawContent={vi.fn().mockResolvedValue(true)}
      saveFileContent={vi.fn().mockResolvedValue(true)}
      createRuleFile={vi.fn().mockResolvedValue({ success: true })}
      toggleRuleFile={vi.fn().mockResolvedValue(true)}
      renameRuleFile={vi.fn().mockResolvedValue({ success: true })}
      deleteRuleFile={vi.fn().mockResolvedValue(true)}
    />,
  )

  return { fetchRuleFileRawContent }
}

describe('RuleConfig view all rules', () => {
  it('renders a "查看所有规则" button to the left of the create button', () => {
    renderRuleConfig()
    const viewAllButton = screen.getByRole('button', { name: '查看所有规则' })
    const createButton = screen.getByRole('button', { name: '创建规则文件' })
    const actionSlot = createButton.closest('[data-slot="rule-file-actions"]')
    expect(actionSlot).toContainElement(viewAllButton)
    expect(viewAllButton.compareDocumentPosition(createButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('opens a dialog listing rules from all rule files', async () => {
    const user = userEvent.setup()
    const { fetchRuleFileRawContent } = renderRuleConfig()

    await user.click(screen.getByRole('button', { name: '查看所有规则' }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('查看所有规则')).toBeInTheDocument()
    expect(fetchRuleFileRawContent).toHaveBeenCalledWith('默认规则')
    expect(fetchRuleFileRawContent).toHaveBeenCalledWith('开发规则')

    expect(await within(dialog).findByText('example.com')).toBeInTheDocument()
    expect(within(dialog).getByText('api.test.com')).toBeInTheDocument()
    expect(within(dialog).getByText('disabled.com')).toBeInTheDocument()
    expect(within(dialog).getByText('默认规则')).toBeInTheDocument()
    expect(within(dialog).getByText('开发规则')).toBeInTheDocument()
  })

  it('shows an empty state when no rules exist', async () => {
    const user = userEvent.setup()
    renderRuleConfig({ empty: true })

    await user.click(screen.getByRole('button', { name: '查看所有规则' }))

    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByText(/暂无/)).toBeInTheDocument()
  })

  it('closes the dialog with the close button', async () => {
    const user = userEvent.setup()
    renderRuleConfig()

    await user.click(screen.getByRole('button', { name: '查看所有规则' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: '关闭' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})
