import { useState } from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from '@/components/ui/toast'
import type { RuleFile, RuleItem } from '@/types'
import type { ReadonlyToggleResult } from '@/lib/ui-token'
import { RuleConfig } from './rule-config'

vi.mock('@/components/ui/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

/** Issue #137: read-only rulesets in the rule page. */

const LOCKED_HINT = '规则集已锁定，解锁后可编辑'

const FILES: RuleFile[] = [
  { name: 'locked', enabled: true, readonly: true, ruleCount: 1 },
  { name: 'open', enabled: true, readonly: false, ruleCount: 0 },
  { name: 'off', enabled: false, readonly: true, ruleCount: 0 },
]
const RULE_TEXT = 'locked.example.com 127.0.0.1:3001'
const RULES: RuleItem[] = [{ enabled: true, rule: 'locked.example.com', target: '127.0.0.1:3001', exclusions: [] }]

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => { resolve = r })
  return { promise, resolve }
}

function renderRules({
  activeFileName = 'locked',
  files = FILES,
  setRuleFileReadonly = vi.fn<(name: string, readonly: boolean) => Promise<ReadonlyToggleResult>>().mockResolvedValue({ success: true }),
  renameRuleFile = vi.fn().mockResolvedValue({ success: true, name: 'renamed' }),
} = {}) {
  const setRulesSpy = vi.fn()
  const toggleRuleFile = vi.fn().mockResolvedValue(true)
  const deleteRuleFile = vi.fn().mockResolvedValue(true)
  const saveFileContent = vi.fn().mockResolvedValue(true)
  const saveRuleFileRawContent = vi.fn().mockResolvedValue(true)

  function Harness() {
    const [rules, setRules] = useState<RuleItem[]>(RULES)
    return (
      <RuleConfig
        rules={rules}
        setRules={(next) => {
          setRulesSpy(next)
          setRules(next)
        }}
        ruleFiles={files}
        activeFileName={activeFileName}
        fetchRuleFiles={vi.fn().mockResolvedValue(files)}
        fetchFileContent={vi.fn().mockResolvedValue(undefined)}
        fetchRuleFileRawContent={vi.fn().mockResolvedValue(RULE_TEXT)}
        saveRuleFileRawContent={saveRuleFileRawContent}
        saveFileContent={saveFileContent}
        createRuleFile={vi.fn().mockResolvedValue({ success: true })}
        toggleRuleFile={toggleRuleFile}
        renameRuleFile={renameRuleFile}
        deleteRuleFile={deleteRuleFile}
        reorderRuleFiles={vi.fn().mockResolvedValue(true)}
        setRuleFileReadonly={setRuleFileReadonly}
      />
    )
  }

  render(<Harness />)
  return { setRulesSpy, setRuleFileReadonly, toggleRuleFile, deleteRuleFile, saveFileContent, saveRuleFileRawContent, renameRuleFile }
}

const fileRow = (name: string) => screen.getByRole('tab', { name: new RegExp(name) })
const lockButton = (name: string) => within(fileRow(name)).getByRole('button', { name: /锁定规则集|解锁规则集/ })
const lockStatus = () => document.querySelector('[data-slot="rule-lock-status"]') as HTMLElement

beforeEach(() => {
  vi.mocked(toast.error).mockClear()
})

describe('rule file list — lock button (issue #137)', () => {
  it('shows a pressed closed lock on read-only rows and a hover-only open lock on read-write rows', () => {
    renderRules()
    const locked = lockButton('locked')
    expect(locked).toHaveAttribute('aria-pressed', 'true')
    expect(locked).toHaveAccessibleName('解锁规则集')
    expect(locked).toHaveClass('opacity-100', 'text-muted-foreground', 'size-6')
    expect(locked.querySelector('svg')).toHaveClass('size-4', 'lucide-lock')

    const open = lockButton('open')
    expect(open).toHaveAttribute('aria-pressed', 'false')
    expect(open).toHaveAccessibleName('锁定规则集')
    expect(open).toHaveClass('opacity-0', 'group-hover:opacity-100', 'group-focus-within:opacity-100', 'size-6')
    expect(open.querySelector('svg')).toHaveClass('size-4', 'lucide-lock-open')
  })

  it('greys a read-only row (muted text, inert switch) distinctly from a disabled row (faded)', async () => {
    const { toggleRuleFile, deleteRuleFile } = renderRules()
    const lockedRow = fileRow('locked')
    expect(within(lockedRow).getByText('locked')).toHaveClass('text-muted-foreground')
    expect(lockedRow).toHaveAttribute('data-readonly', 'true')
    expect(lockedRow).toHaveAttribute('data-ruleset-enabled', 'true')
    expect(lockedRow.className).not.toMatch(/(^|\s)opacity-60(\s|$)/)

    const openRow = fileRow('open')
    expect(within(openRow).getByText('open')).not.toHaveClass('text-muted-foreground')

    // disabled + read-only combine: faded row *and* muted text
    const offRow = fileRow('off')
    expect(offRow).toHaveAttribute('data-ruleset-enabled', 'false')
    expect(offRow).toHaveClass('data-[ruleset-enabled=false]:opacity-60')
    expect(within(offRow).getByText('off')).toHaveClass('text-muted-foreground')

    // The switch stays focusable but does nothing.
    const user = userEvent.setup()
    const lockedSwitch = within(lockedRow).getByRole('button', { name: '禁用规则集 locked' })
    expect(lockedSwitch).toHaveAttribute('aria-disabled', 'true')
    expect(lockedSwitch).not.toHaveAttribute('disabled')
    await user.click(lockedSwitch)
    lockedSwitch.focus()
    await user.keyboard('{Enter}')
    expect(toggleRuleFile).not.toHaveBeenCalled()
    const lockedDelete = within(lockedRow).getByRole('button', { name: '删除规则文件 locked' })
    expect(lockedDelete).toHaveAttribute('aria-disabled', 'true')
    await user.click(lockedDelete)
    expect(deleteRuleFile).not.toHaveBeenCalled()

    // The read-write row's switch still works.
    await user.click(within(openRow).getByRole('button', { name: '禁用规则集 open' }))
    expect(toggleRuleFile).toHaveBeenCalledWith('open', false)
  })

  it('toggles at once (optimistic), shows 保存中… then 已保存', async () => {
    const pending = deferred<ReadonlyToggleResult>()
    const setRuleFileReadonly = vi.fn(() => pending.promise)
    renderRules({ setRuleFileReadonly })

    // Synchronous click: the very next render (no await, server still pending)
    // already shows the new icon and 保存中…. Wall-clock timing is measured in a
    // real browser for the PR; jsdom timings are not meaningful.
    fireEvent.click(lockButton('open'))
    expect(lockButton('open')).toHaveAttribute('aria-pressed', 'true')
    expect(lockButton('open')).toHaveAccessibleName('解锁规则集')
    expect(lockButton('open').querySelector('svg')).toHaveClass('lucide-lock')
    expect(lockStatus()).toHaveTextContent('保存中…')
    expect(lockStatus()).toHaveAttribute('role', 'status')
    expect(setRuleFileReadonly).toHaveBeenCalledWith('open', true)
    // The editor of the (open) file is unaffected; the locked active file still shows its badge.

    await act(async () => pending.resolve({ success: true }))
    expect(lockStatus()).toHaveTextContent('已保存')
    expect(lockButton('open')).toHaveAttribute('aria-pressed', 'true')
  })

  it('rolls back and reports an error when saving fails', async () => {
    const pending = deferred<ReadonlyToggleResult>()
    renderRules({ setRuleFileReadonly: vi.fn(() => pending.promise) })
    const user = userEvent.setup()

    await user.click(lockButton('locked'))
    expect(lockButton('locked')).toHaveAttribute('aria-pressed', 'false')
    expect(lockStatus()).toHaveTextContent('保存中…')

    await act(async () => pending.resolve({ success: false, error: '界面令牌无效，请刷新 Meddle 页面后重试' }))
    expect(lockButton('locked')).toHaveAttribute('aria-pressed', 'true')
    expect(lockButton('locked')).toHaveAccessibleName('解锁规则集')
    expect(lockStatus()).toHaveTextContent('')
    expect(toast.error).toHaveBeenCalledWith('解锁失败：界面令牌无效，请刷新 Meddle 页面后重试')
  })

  it('is keyboard operable (Enter / Space) without selecting the tab', async () => {
    const { setRuleFileReadonly } = renderRules()
    const user = userEvent.setup()
    lockButton('open').focus()
    await user.keyboard('{Enter}')
    expect(setRuleFileReadonly).toHaveBeenLastCalledWith('open', true)
    await waitFor(() => expect(lockStatus()).toHaveTextContent('已保存'))
    lockButton('locked').focus()
    await user.keyboard(' ')
    expect(setRuleFileReadonly).toHaveBeenLastCalledWith('locked', false)
  })

  it('renaming a locked ruleset unlocks, renames and locks the new name', async () => {
    const setRuleFileReadonly = vi.fn<(name: string, readonly: boolean) => Promise<ReadonlyToggleResult>>().mockResolvedValue({ success: true })
    const renameRuleFile = vi.fn().mockResolvedValue({ success: true, name: 'renamed' })
    renderRules({ setRuleFileReadonly, renameRuleFile })
    const user = userEvent.setup()

    await user.dblClick(within(fileRow('locked')).getByText('locked'))
    const input = screen.getByRole('textbox', { name: '重命名规则文件 locked' })
    await user.clear(input)
    await user.type(input, 'renamed{Enter}')

    await waitFor(() => expect(setRuleFileReadonly).toHaveBeenCalledTimes(2))
    expect(setRuleFileReadonly.mock.calls).toEqual([['locked', false], ['renamed', true]])
    expect(renameRuleFile).toHaveBeenCalledWith('locked', 'renamed')
    expect(setRuleFileReadonly.mock.invocationCallOrder[0]).toBeLessThan(renameRuleFile.mock.invocationCallOrder[0])
    expect(renameRuleFile.mock.invocationCallOrder[0]).toBeLessThan(setRuleFileReadonly.mock.invocationCallOrder[1])
  })
})

describe('editor pane of a read-only ruleset (issue #137)', () => {
  it('shows the 只读 badge and an outline 解锁 button instead of 保存', async () => {
    const { setRuleFileReadonly } = renderRules()
    const titleBar = screen.getByTestId('rule-editor-title-bar')
    const heading = within(titleBar).getByRole('heading')
    expect(heading).toHaveTextContent('编辑规则 · locked只读')
    const badge = titleBar.querySelector('[data-slot="ruleset-readonly-badge"]') as HTMLElement
    expect(badge).toHaveTextContent('只读')
    expect(badge.querySelector('svg.lucide-lock')).not.toBeNull()

    expect(within(titleBar).queryByRole('button', { name: /保存/ })).toBeNull()
    const unlock = within(titleBar).getByRole('button', { name: '解锁' })
    expect(unlock).toHaveAttribute('data-variant', 'outline')
    // No solid primary action anywhere on the page.
    expect(document.querySelector('[data-slot="editor-save"]')).toBeNull()

    await userEvent.setup().click(unlock)
    expect(setRuleFileReadonly).toHaveBeenCalledWith('locked', false)
  })

  it('a read-write ruleset keeps the normal save button and no badge', () => {
    renderRules({ activeFileName: 'open' })
    const titleBar = screen.getByTestId('rule-editor-title-bar')
    expect(within(titleBar).getByRole('heading')).toHaveTextContent(/^编辑规则 · open$/)
    expect(document.querySelector('[data-slot="editor-save"]')).not.toBeNull()
    expect(within(titleBar).queryByRole('button', { name: '解锁' })).toBeNull()
  })

  it('table and toolbar controls are aria-disabled, focusable, explained, and inert', async () => {
    const { setRulesSpy } = renderRules()
    const user = userEvent.setup()

    const add = screen.getByRole('button', { name: '添加规则' })
    const fromFile = screen.getByRole('button', { name: '从文件加载' })
    const textImport = screen.getByRole('button', { name: '文本导入' })
    const rowSwitch = screen.getByRole('checkbox', { name: '禁用规则' })
    const del = screen.getByRole('button', { name: '删除规则' })
    const top = screen.getByRole('button', { name: '置顶' })

    for (const control of [add, fromFile, textImport, rowSwitch, del, top]) {
      expect(control).toHaveAttribute('aria-disabled', 'true')
      expect(control).not.toBeDisabled()
      control.focus()
      expect(control).toHaveFocus()
      await user.click(control)
    }
    expect(setRulesSpy).not.toHaveBeenCalled()
    expect(rowSwitch).toBeChecked()
    expect(screen.queryByRole('dialog')).toBeNull()

    // Rule inputs: read-only, full-strength text, still selectable.
    const ruleInput = screen.getByDisplayValue('locked.example.com')
    expect(ruleInput).toHaveAttribute('readonly')
    expect(ruleInput.className).not.toMatch(/(^|\s)opacity-/)
    await user.type(ruleInput, 'x')
    expect(ruleInput).toHaveValue('locked.example.com')
    expect(setRulesSpy).not.toHaveBeenCalled()

    // Hover / focus explains why.
    add.blur()
    fireEvent.focus(add)
    await user.hover(add)
    expect((await screen.findAllByText(LOCKED_HINT)).length).toBeGreaterThan(0)
  })

  it('the text view is read-only but selectable', async () => {
    const { setRulesSpy, saveRuleFileRawContent } = renderRules()
    const user = userEvent.setup()
    await user.click(screen.getByRole('radio', { name: '文本' }))
    const textarea = await screen.findByRole('textbox', { name: '规则文本' })
    await waitFor(() => expect(textarea).toHaveValue(RULE_TEXT))
    expect(textarea).toHaveAttribute('readonly')
    expect(textarea).toHaveAttribute('aria-readonly', 'true')
    expect(textarea).not.toBeDisabled()
    await user.type(textarea, 'evil.com 1.1.1.1')
    expect(textarea).toHaveValue(RULE_TEXT)
    ;(textarea as HTMLTextAreaElement).setSelectionRange(0, 6)
    expect((textarea as HTMLTextAreaElement).selectionEnd).toBe(6)
    // Ctrl/Cmd+S does nothing for a locked ruleset.
    await user.keyboard('{Control>}s{/Control}')
    expect(saveRuleFileRawContent).not.toHaveBeenCalled()
    expect(setRulesSpy).not.toHaveBeenCalled()
  })
})
