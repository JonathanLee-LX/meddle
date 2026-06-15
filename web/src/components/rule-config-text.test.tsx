import { useState } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { toast } from '@/components/ui/toast'
import type { RuleItem } from '@/types'
import { RuleConfig } from './rule-config'

vi.mock('@/components/ui/toast', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

describe('RuleConfig text view', () => {
  it('edits raw rule text and saves it without reformatting', async () => {
    const initialText = '# local routes\nexample.com localhost:3000'
    const updatedText = '# local routes\nexample.com !/api localhost:4000'
    let resolveSave!: (value: boolean) => void
    const saveRuleFileRawContent = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveSave = resolve
        }),
    )
    const fetchRuleFiles = vi.fn().mockResolvedValue([])
    const fetchFileContent = vi.fn().mockResolvedValue(undefined)
    const fetchRuleFileRawContent = vi.fn().mockResolvedValue(initialText)
    const saveFileContent = vi.fn().mockResolvedValue(true)
    const createRuleFile = vi.fn().mockResolvedValue({ success: true })
    const toggleRuleFile = vi.fn().mockResolvedValue(true)
    const renameRuleFile = vi.fn().mockResolvedValue({ success: true })
    const deleteRuleFile = vi.fn().mockResolvedValue(true)

    function Harness() {
      const [rules, setRules] = useState<RuleItem[]>([])

      return (
        <RuleConfig
          rules={rules}
          setRules={setRules}
          ruleFiles={[]}
          activeFileName="default"
          fetchRuleFiles={fetchRuleFiles}
          fetchFileContent={fetchFileContent}
          fetchRuleFileRawContent={fetchRuleFileRawContent}
          saveRuleFileRawContent={saveRuleFileRawContent}
          saveFileContent={saveFileContent}
          createRuleFile={createRuleFile}
          toggleRuleFile={toggleRuleFile}
          renameRuleFile={renameRuleFile}
          deleteRuleFile={deleteRuleFile}
        />
      )
    }

    const user = userEvent.setup()
    render(<Harness />)
    const viewSwitcher = screen.getByRole('group', { name: '规则视图' })
    const contentCard = viewSwitcher.closest('[data-slot="card"]')
    const stickyControls = contentCard?.querySelector('[data-slot="rule-config-sticky-controls"]')
    const tableHeaderBar = contentCard?.querySelector('[data-slot="rule-table-header"]')
    const tableHeader = contentCard?.querySelector('[data-slot="table-header"]')
    expect(contentCard).toContainElement(screen.getByRole('tablist'))
    expect(screen.getAllByRole('table').length).toBeGreaterThanOrEqual(1)
    expect(stickyControls).toHaveClass('shrink-0')
    expect(tableHeaderBar).toHaveClass('shrink-0')
    expect(tableHeader).not.toBeNull()
    expect(tableHeaderBar).toContainElement(tableHeader as HTMLElement)

    await user.click(screen.getByRole('radio', { name: '文本' }))

    const editor = await screen.findByLabelText('规则文本')
    expect(contentCard).toContainElement(editor)
    await waitFor(() => expect(editor).toHaveValue(initialText))

    fireEvent.change(editor, { target: { value: updatedText } })
    expect(screen.getByText('已解析 1 条规则')).toBeInTheDocument()

    const saveButton = screen.getByRole('button', { name: '保存' })
    fireEvent.click(saveButton)
    expect(saveButton).toBeDisabled()
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument()

    resolveSave(true)
    await waitFor(() => {
      expect(saveRuleFileRawContent).toHaveBeenCalledWith('default', updatedText)
      expect(screen.queryByRole('status', { name: 'Loading' })).not.toBeInTheDocument()
    })
    expect(screen.queryByText('已保存')).not.toBeInTheDocument()
    expect(saveButton).toHaveAccessibleName('保存')
    expect(toast.success).toHaveBeenCalledWith('规则保存成功')
  })
})
