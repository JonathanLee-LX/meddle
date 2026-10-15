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
  { name: 'idle', enabled: false, readonly: false, ruleCount: 0 },
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
  reorderRuleFiles = vi.fn().mockResolvedValue(true),
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
        reorderRuleFiles={reorderRuleFiles}
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

  it('on touch screens (hover: none) the open lock is always shown, in muted grey', () => {
    renderRules()
    const open = lockButton('open')
    expect(open).toHaveClass('[@media(hover:none)]:opacity-100', 'text-muted-foreground')
  })

  it('a selected locked row shows its name in foreground; the lock icon stays muted', () => {
    renderRules({ activeFileName: 'locked' })
    const row = fileRow('locked')
    expect(row).toHaveAttribute('data-state', 'active')
    expect(row).toHaveClass('group')
    // Unselected: grey name. Selected (data-state=active on the row group): foreground.
    expect(within(row).getByText('locked')).toHaveClass('text-muted-foreground', 'group-data-[state=active]:text-foreground')
    const lock = lockButton('locked')
    expect(lock).toHaveClass('text-muted-foreground')
    expect(lock.className).not.toMatch(/group-data-\[state=active\]:text-foreground/)
  })

  it('a locked switch still shows its real state without fading', () => {
    renderRules()
    const onSwitch = within(fileRow('locked')).getByRole('button', { name: '禁用规则集 locked' })
    const offSwitch = within(fileRow('off')).getByRole('button', { name: '启用规则集 off' })
    for (const control of [onSwitch, offSwitch]) {
      expect(control.className).not.toMatch(/(^|\s)opacity-/)
      expect(control).toHaveClass('cursor-not-allowed')
    }
    // on: desaturated primary (not the full primary of a read-write switch); off: grey track
    const onIcon = onSwitch.querySelector('svg')!
    expect(onIcon).toHaveClass('lucide-toggle-right', 'text-[color-mix(in_oklab,var(--primary)_60%,var(--muted-foreground))]')
    expect(onIcon).not.toHaveClass('text-primary')
    expect(offSwitch.querySelector('svg')).toHaveClass('lucide-toggle-left', 'text-muted-foreground')
    const openIcon = within(fileRow('open')).getByRole('button', { name: '禁用规则集 open' }).querySelector('svg')!
    expect(openIcon).toHaveClass('text-primary')
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

    // Disabled only: the row fades (opacity only applies while data-readonly=false).
    const idleRow = fileRow('idle')
    expect(idleRow).toHaveAttribute('data-ruleset-enabled', 'false')
    expect(idleRow).toHaveAttribute('data-readonly', 'false')
    expect(idleRow).toHaveClass('data-[ruleset-enabled=false]:data-[readonly=false]:opacity-60')
    // No inline opacity that would override the fade class.
    expect(idleRow.style.opacity).toBe('')
    expect(within(idleRow).getByText('idle')).not.toHaveClass('text-muted-foreground')

    // Disabled + read-only: grey text only, no stacked fade.
    const offRow = fileRow('off')
    expect(offRow).toHaveAttribute('data-ruleset-enabled', 'false')
    expect(offRow).toHaveAttribute('data-readonly', 'true')
    expect(offRow.className).not.toMatch(/(^|\s)data-\[ruleset-enabled=false\]:opacity-60(\s|$)/)
    expect(offRow.className).not.toMatch(/(^|\s)opacity-/)
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

})

describe('rule file list — rename while locked (issue #143)', () => {
  it('double-clicking a locked name is disabled: aria-disabled, hint, no edit mode, no rename / unlock call', async () => {
    const { setRuleFileReadonly, renameRuleFile } = renderRules()
    const user = userEvent.setup()
    const name = within(fileRow('locked')).getByText('locked')
    expect(name).toHaveAttribute('data-slot', 'rule-file-name')
    expect(name).toHaveAttribute('aria-disabled', 'true')
    expect(name).not.toHaveAttribute('disabled')
    expect(name).toHaveAttribute('title', LOCKED_HINT)
    expect(name).toHaveClass('cursor-not-allowed')

    await user.dblClick(name)
    expect(screen.queryByRole('textbox', { name: '重命名规则文件 locked' })).toBeNull()
    // Disabled-and-locked row behaves the same.
    await user.dblClick(within(fileRow('off')).getByText('off'))
    expect(screen.queryByRole('textbox', { name: /重命名规则文件/ })).toBeNull()

    expect(renameRuleFile).not.toHaveBeenCalled()
    expect(setRuleFileReadonly).not.toHaveBeenCalled()
  })

  it('has no other rename entry point (no 重命名 menu item or button) on a locked row', async () => {
    renderRules()
    const row = fileRow('locked')
    fireEvent.contextMenu(within(row).getByText('locked'))
    expect(screen.queryByRole('menuitem', { name: /重命名/ })).toBeNull()
    expect(within(row).queryByRole('button', { name: /重命名|更多/ })).toBeNull()
  })

  it('locking a ruleset mid-rename blocks the commit without calling rename or unlock', async () => {
    const pending = deferred<ReadonlyToggleResult>()
    const setRuleFileReadonly = vi.fn(() => pending.promise)
    const { renameRuleFile } = renderRules({ activeFileName: 'open', setRuleFileReadonly })
    const user = userEvent.setup()

    await user.dblClick(within(fileRow('open')).getByText('open'))
    const input = screen.getByRole('textbox', { name: '重命名规则文件 open' })
    // Lock it while the inline editor is open (optimistic lock state applies at once).
    fireEvent.click(lockButton('open'))
    expect(setRuleFileReadonly).toHaveBeenCalledTimes(1)
    expect(setRuleFileReadonly).toHaveBeenLastCalledWith('open', true)
    await user.clear(input)
    await user.type(input, 'renamed{Enter}')

    expect(renameRuleFile).not.toHaveBeenCalled()
    expect(setRuleFileReadonly).toHaveBeenCalledTimes(1)
    expect(await screen.findAllByText(LOCKED_HINT)).not.toHaveLength(0)
    await act(async () => pending.resolve({ success: true }))
  })

  it('an unlocked ruleset still renames by double-click, without touching the lock', async () => {
    const renameRuleFile = vi.fn().mockResolvedValue({ success: true, name: 'renamed' })
    const { setRuleFileReadonly } = renderRules({ activeFileName: 'open', renameRuleFile })
    const user = userEvent.setup()

    const name = within(fileRow('open')).getByText('open')
    expect(name).not.toHaveAttribute('aria-disabled')
    expect(name).toHaveAttribute('title', '双击重命名')
    await user.dblClick(name)
    const input = screen.getByRole('textbox', { name: '重命名规则文件 open' })
    await user.clear(input)
    await user.type(input, 'renamed{Enter}')

    await waitFor(() => expect(renameRuleFile).toHaveBeenCalledWith('open', 'renamed'))
    expect(renameRuleFile).toHaveBeenCalledTimes(1)
    expect(setRuleFileReadonly).not.toHaveBeenCalled()
  })

  it('reordering rulesets stays allowed while locked (keyboard drag of a locked tab)', async () => {
    const reorderRuleFiles = vi.fn().mockResolvedValue(true)
    renderRules({ reorderRuleFiles })
    // jsdom has no layout: give each tab a stacked rect so dnd-kit can find neighbours.
    const tabs = screen.getAllByRole('tab')
    tabs.forEach((tab, index) => {
      tab.getBoundingClientRect = () => ({
        x: 0, y: index * 40, top: index * 40, left: 0, right: 200, bottom: index * 40 + 40, width: 200, height: 40,
        toJSON: () => ({}),
      }) as DOMRect
    })

    const handle = screen.getByRole('button', { name: '拖拽排序 locked' })
    expect(fileRow('locked')).toHaveAttribute('data-readonly', 'true')
    handle.focus()
    fireEvent.keyDown(handle, { key: ' ', code: 'Space' })
    await act(async () => {})
    fireEvent.keyDown(document.activeElement ?? handle, { key: 'ArrowDown', code: 'ArrowDown' })
    await act(async () => {})
    fireEvent.keyDown(document.activeElement ?? handle, { key: ' ', code: 'Space' })
    await act(async () => {})

    await waitFor(() => expect(reorderRuleFiles).toHaveBeenCalledWith(['open', 'locked', 'off', 'idle']))
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
    // Flat, arrow cursor: doesn't look like an editable field.
    for (const input of [ruleInput, screen.getByDisplayValue('127.0.0.1:3001')]) {
      expect(input).toHaveClass('bg-muted', 'cursor-default', 'shadow-none')
      expect(input).not.toHaveClass('dark:bg-muted')
    }
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
