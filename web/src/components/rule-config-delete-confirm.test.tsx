import { useState } from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { RuleItem } from '@/types'
import { RuleConfig } from './rule-config'

vi.mock('@/components/ui/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

const RULE: RuleItem = { enabled: true, rule: 'example.com', target: '127.0.0.1:3000', exclusions: [] }

function renderRules() {
  const saveFileContent = vi.fn().mockResolvedValue(true)
  const saveRuleFileRawContent = vi.fn().mockResolvedValue(true)

  function Harness() {
    const [rules, setRules] = useState<RuleItem[]>([RULE])
    return (
      <RuleConfig
        rules={rules}
        setRules={setRules}
        ruleFiles={[{ name: 'dev', enabled: true, readonly: false, ruleCount: 1 }]}
        activeFileName="dev"
        fetchRuleFiles={vi.fn().mockResolvedValue([{ name: 'dev', enabled: true, readonly: false, ruleCount: 1 }])}
        fetchFileContent={vi.fn().mockResolvedValue(undefined)}
        fetchRuleFileRawContent={vi.fn().mockResolvedValue('example.com 127.0.0.1:3000\n')}
        saveRuleFileRawContent={saveRuleFileRawContent}
        saveFileContent={saveFileContent}
        createRuleFile={vi.fn().mockResolvedValue({ success: true })}
        toggleRuleFile={vi.fn().mockResolvedValue(true)}
        renameRuleFile={vi.fn().mockResolvedValue({ success: true })}
        deleteRuleFile={vi.fn().mockResolvedValue(true)}
        reorderRuleFiles={vi.fn().mockResolvedValue(true)}
      />
    )
  }

  render(<Harness />)
  return { saveFileContent, saveRuleFileRawContent }
}

async function openDelete(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: '删除规则' }))
  return screen.findByRole('alertdialog', { name: '删除规则' })
}

describe('rule table row delete confirmation', () => {
  it('does not remove the row or save when the dialog is cancelled or dismissed with Escape', async () => {
    const user = userEvent.setup()
    const { saveFileContent, saveRuleFileRawContent } = renderRules()

    const dialog = await openDelete(user)
    expect(screen.getByDisplayValue('example.com')).toBeInTheDocument()
    expect(saveFileContent).not.toHaveBeenCalled()
    expect(saveRuleFileRawContent).not.toHaveBeenCalled()

    await user.click(within(dialog).getByRole('button', { name: '取消' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(screen.getByDisplayValue('example.com')).toBeInTheDocument()
    expect(saveFileContent).not.toHaveBeenCalled()

    const again = await openDelete(user)
    await user.keyboard('{Escape}')
    await waitFor(() => expect(again).not.toBeInTheDocument())
    expect(screen.getByDisplayValue('example.com')).toBeInTheDocument()
    expect(saveFileContent).not.toHaveBeenCalled()
    expect(saveRuleFileRawContent).not.toHaveBeenCalled()
  })

  it('removes the row only after 删除, and writes the file only when the user saves', async () => {
    const user = userEvent.setup()
    const { saveFileContent, saveRuleFileRawContent } = renderRules()
    await waitFor(() => expect(screen.getByRole('button', { name: '保存' })).toBeEnabled())

    const dialog = await openDelete(user)
    expect(saveFileContent).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: '删除' }))

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(screen.queryByDisplayValue('example.com')).not.toBeInTheDocument()
    expect(saveFileContent).not.toHaveBeenCalled()
    expect(saveRuleFileRawContent).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(saveFileContent).toHaveBeenCalledTimes(1))
    expect(saveFileContent).toHaveBeenCalledWith('dev', [])
    expect(saveRuleFileRawContent).not.toHaveBeenCalled()
  })
})
