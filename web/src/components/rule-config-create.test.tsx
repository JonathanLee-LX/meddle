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
      reorderRuleFiles={vi.fn().mockResolvedValue(true)}
    />,
  )

  return { createRuleFile, fetchFileContent }
}

describe('RuleConfig file creation', () => {
  it('creates a rule file from an inline editor in the file tab list', async () => {
    const user = userEvent.setup()
    const { createRuleFile, fetchFileContent } = renderRuleConfig()

    const createButton = screen.getByRole('button', { name: '创建规则文件' })
    const actionSlot = createButton.closest('[data-slot="rule-file-actions"]')
    const tabScroller = screen.getByRole('tablist').closest('[data-slot="rule-file-tabs-scroll"]')
    expect(actionSlot).toContainElement(createButton)
    expect(tabScroller).not.toContainElement(createButton)

    await user.click(createButton)

    const input = screen.getByRole('textbox', { name: '新规则文件名称' })
    expect(actionSlot).toContainElement(input)
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

  it('keeps 添加规则 labeled and moves secondary actions to named icon buttons', async () => {
    const user = userEvent.setup()
    renderRuleConfig()

    const add = screen.getByRole('button', { name: '添加规则' })
    const filter = screen.getByRole('button', { name: '筛选' })
    const fromFile = screen.getByRole('button', { name: '从文件加载' })
    const textImport = screen.getByRole('button', { name: '文本导入' })
    expect(add).toHaveTextContent('添加规则')
    expect(screen.getByRole('button', { name: '保存' })).toHaveTextContent('保存')
    expect(filter).not.toHaveTextContent('筛选')
    expect(fromFile).not.toHaveTextContent('从文件加载')
    expect(textImport).not.toHaveTextContent('文本导入')
    expect(within(screen.getByTestId('rule-editor-title-bar')).getByRole('heading', { name: '默认规则' })).toBeInTheDocument()

    await user.hover(fromFile)
    expect(await screen.findByRole('tooltip')).toHaveTextContent('从文件加载')
    expect(fromFile).not.toHaveAttribute('aria-describedby')
  })

  it('accepts typed rule text in the import dialog', async () => {
    const user = userEvent.setup()
    renderRuleConfig()

    await user.click(screen.getByRole('button', { name: '文本导入' }))

    const editor = screen.getByRole('textbox', { name: '导入规则文本' })
    expect(editor.parentElement?.parentElement).toHaveClass('flex', 'h-[220px]', 'flex-col')
    await user.type(editor, 'example.com localhost:3000')

    expect(editor).toHaveValue('example.com localhost:3000')
    expect(screen.getByText('已解析 1 条规则')).toBeInTheDocument()
  })
})
