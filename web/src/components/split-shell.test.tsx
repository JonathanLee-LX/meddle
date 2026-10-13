import { readFileSync } from 'node:fs'
import { useState } from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { RuleItem } from '@/types'
import { RuleConfig } from './rule-config'
import { EditorSaveButton, EditorTitleBar } from './pane-bar'
import { useEditorScrolled } from '@/hooks/use-editor-scrolled'
import { MockEditorPanel } from './mock-editor-panel'

vi.mock('./monaco-editor', () => ({ MonacoEditor: () => null }))
vi.mock('@/components/ui/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const readSource = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

function renderRules(activeFileName: string) {
  function Harness() {
    const [rules, setRules] = useState<RuleItem[]>([])
    return (
      <RuleConfig
        rules={rules}
        setRules={setRules}
        ruleFiles={activeFileName ? [{ name: activeFileName, enabled: true, ruleCount: 0 } as never] : []}
        activeFileName={activeFileName}
        fetchRuleFiles={vi.fn().mockResolvedValue([])}
        fetchFileContent={vi.fn().mockResolvedValue(undefined)}
        fetchRuleFileRawContent={vi.fn().mockResolvedValue('')}
        saveRuleFileRawContent={vi.fn().mockResolvedValue(true)}
        saveFileContent={vi.fn().mockResolvedValue(true)}
        createRuleFile={vi.fn().mockResolvedValue({ success: true })}
        toggleRuleFile={vi.fn().mockResolvedValue(true)}
        renameRuleFile={vi.fn().mockResolvedValue({ success: true })}
        deleteRuleFile={vi.fn().mockResolvedValue(true)}
        reorderRuleFiles={vi.fn().mockResolvedValue(true)}
      />
    )
  }
  return render(<Harness />)
}

describe('split-pane shell (issue #111)', () => {
  it('rules page has the 「编辑 …」 title bar with the primary save in it', () => {
    renderRules('default')
    const bar = screen.getByTestId('rule-editor-title-bar')
    expect(bar).toHaveTextContent('编辑规则 · default')
    expect(bar).toHaveAttribute('data-slot', 'editor-title-bar')
    const save = within(bar).getByRole('button', { name: '保存' })
    expect(save).toHaveAttribute('data-variant', 'default')
    expect(screen.queryByTestId('rule-editor-empty')).not.toBeInTheDocument()
  })

  it('rules page shows the shared empty state when no file is selected', () => {
    renderRules('')
    expect(screen.getByTestId('rule-editor-title-bar')).toHaveTextContent(/^编辑规则$/)
    const empty = screen.getByTestId('rule-editor-empty')
    expect(empty).toHaveAttribute('data-slot', 'editor-empty-state')
    expect(empty).toHaveTextContent('选择左侧规则文件进行编辑')
    expect(screen.queryByLabelText('规则视图')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '保存' })).not.toBeInTheDocument()
  })

  it('list header and editor title bar share one bar style; titles are not uppercased', () => {
    renderRules('default')
    const listBar = screen.getByText('规则文件').closest('[data-slot="pane-bar"]')!
    expect(listBar).not.toBeNull()
    const editorBar = screen.getByTestId('rule-editor-title-bar')
    for (const bar of [listBar, editorBar]) {
      expect(bar).toHaveClass('app-pane-bar', 'min-h-12', 'border-b', 'bg-card', 'relative', 'z-10')
      const title = bar.querySelector('[data-slot="pane-title"]')!
      expect(title).toHaveClass('text-xs', 'font-medium')
      expect(title.className).not.toMatch(/uppercase|tracking-/)
    }
  })

  it('all three pages use the shared bars and no uppercase titles', () => {
    for (const file of ['./rule-config.tsx', './mock-config.tsx', './plugin-config.tsx']) {
      const src = readSource(file)
      expect(src, file).toContain('<PaneBar')
      expect(src, file).toContain('<PaneTitle>')
      expect(src, file).toContain('<EditorTitleBar')
      expect(src, file).not.toMatch(/\buppercase\b/)
      expect(src, file).toContain('onScrollCapture={editorScroll.onScrollCapture}')
    }
    expect(readSource('./mock-config.tsx')).toContain('<PaneTitle>Mock 规则</PaneTitle>')
    expect(readSource('./mock-config.tsx')).toContain('`编辑 Mock · ${')
  })

  it('detail labels are sentence case', () => {
    const src = readSource('./detail-panel.tsx')
    expect(src).not.toMatch(/\buppercase\b/)
    for (const label of ['Request URL diff', 'Request header diff', 'Response status diff', 'Response header diff', 'Response body diff', 'Request headers', 'Request body', 'Response headers', 'Response body', '请求 headers（节选）']) {
      expect(src).toContain(`${label}<`.replace('（节选）<', '（节选）'))
    }
    expect(readSource('./route-preview.tsx')).not.toMatch(/\buppercase\b/)
  })
})

describe('editor title bar lift on scroll (issue #111)', () => {
  function Scroller() {
    const { scrolled, onScrollCapture } = useEditorScrolled()
    return (
      <div>
        <EditorTitleBar data-testid="bar" title="编辑 Mock · cart" scrolled={scrolled} />
        <div onScrollCapture={onScrollCapture}>
          <div data-testid="scroll" style={{ overflowY: 'auto' }} />
        </div>
      </div>
    )
  }

  it('border only at rest; shadow (light) / darker border (dark) after >4px; 150ms, reduced-motion instant', () => {
    render(<Scroller />)
    const bar = screen.getByTestId('bar')
    const el = screen.getByTestId('scroll')
    Object.defineProperty(el, 'scrollHeight', { value: 1000, configurable: true })
    Object.defineProperty(el, 'clientHeight', { value: 300, configurable: true })
    expect(bar).toHaveAttribute('data-scrolled', 'false')
    expect(bar).toHaveClass('border-b', 'bg-card', 'duration-150', 'ease-out', 'motion-reduce:transition-none')
    expect(bar).toHaveClass('data-[scrolled=true]:shadow-[0_1px_3px_rgb(0_0_0/0.06)]', 'dark:data-[scrolled=true]:shadow-none', 'dark:data-[scrolled=true]:border-black')
    el.scrollTop = 4
    fireEvent.scroll(el)
    expect(bar).toHaveAttribute('data-scrolled', 'false')
    el.scrollTop = 5
    fireEvent.scroll(el)
    expect(bar).toHaveAttribute('data-scrolled', 'true')
    el.scrollTop = 0
    fireEvent.scroll(el)
    expect(bar).toHaveAttribute('data-scrolled', 'false')
    expect(screen.getByText('编辑 Mock · cart').className).not.toMatch(/uppercase/)
  })
})

describe('save buttons (issue #111)', () => {
  it('editor save is the solid primary button and reads 「保存中…」 while saving, without a spinner', () => {
    const { rerender } = render(<EditorSaveButton onClick={vi.fn()} />)
    const button = screen.getByRole('button', { name: '保存' })
    expect(button).toHaveAttribute('data-variant', 'default')
    rerender(<EditorSaveButton onClick={vi.fn()} saving />)
    expect(button).toHaveAccessibleName('保存中…')
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')
    expect(button.querySelector('.animate-spin')).toBeNull()
  })

  it('Mock / plugin code / plugin generator / rules all use EditorSaveButton; plugin 「保存并热加载」 is secondary', () => {
    for (const file of ['./mock-editor-panel.tsx', './plugin-code-editor.tsx', './plugin-generator.tsx', './rule-config.tsx']) {
      expect(readSource(file), file).toContain('<EditorSaveButton')
    }
    const code = readSource('./plugin-code-editor.tsx')
    const reload = code.slice(code.lastIndexOf('<Button', code.indexOf('保存并热加载')), code.indexOf('保存并热加载'))
    expect(reload).toContain('variant="outline"')
    // plugin generator: the 热加载 button shown after saving is outline too, never green
    const gen = readSource('./plugin-generator.tsx')
    const hot = gen.slice(gen.lastIndexOf('<Button', gen.indexOf('data-testid="plugin-generator-hot-reload"')), gen.indexOf('data-testid="plugin-generator-hot-reload"'))
    expect(hot).toContain('variant="outline"')
    expect(hot).not.toMatch(/bg-green/)
  })
})

describe('Mock HTTP method uses the shared dropdown (issue #111)', () => {
  it('no native <select>; a combobox showing the current method', () => {
    const { container } = render(
      <MockEditorPanel
        rule={{ id: 1, name: 'cart', urlPattern: '/api/cart', method: 'POST', statusCode: 200, delay: 0, bodyType: 'inline', body: '{}', headers: {}, enabled: true } as never}
        createMock={vi.fn()}
        updateMock={vi.fn()}
      />,
    )
    expect(container.querySelector('select')).toBeNull()
    const trigger = screen.getByRole('combobox', { name: 'HTTP 方法' })
    expect(trigger).toHaveTextContent('POST')
  })
})
