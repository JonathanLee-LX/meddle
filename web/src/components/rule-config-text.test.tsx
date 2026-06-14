import { useState } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { RuleItem } from '@/types'
import { RuleConfig } from './rule-config'

describe('RuleConfig text view', () => {
  it('edits raw rule text and saves it without reformatting', async () => {
    const initialText = '# local routes\nexample.com localhost:3000'
    const updatedText = '# local routes\nexample.com !/api localhost:4000'
    const saveRuleFileRawContent = vi.fn().mockResolvedValue(true)
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
    await user.click(screen.getByRole('radio', { name: '文本' }))

    const editor = await screen.findByLabelText('规则文本')
    await waitFor(() => expect(editor).toHaveValue(initialText))

    fireEvent.change(editor, { target: { value: updatedText } })
    expect(screen.getByText('已解析 1 条规则')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => {
      expect(saveRuleFileRawContent).toHaveBeenCalledWith('default', updatedText)
    })
  })
})
