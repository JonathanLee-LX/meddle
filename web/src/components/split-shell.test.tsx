import { useState } from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { MockRule, Plugin, RuleItem } from '@/types'
import { RuleConfig } from './rule-config'
import { MockConfig } from './mock-config'
import { PluginConfig } from './plugin-config'
import { PluginCodeEditor } from './plugin-code-editor'
import { PluginGenerator } from './plugin-generator'
import { DetailPanel } from './detail-panel'
import { EditorPaneActionsProvider } from './editor-pane-actions'
import { EditorSaveButton, EditorTitleBar } from './pane-bar'
import { useEditorScrolled } from '@/hooks/use-editor-scrolled'

vi.mock('./monaco-editor', () => ({ MonacoEditor: ({ value }: { value?: string }) => <pre data-testid="code">{value}</pre> }))
vi.mock('@/components/ui/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/ai-config-store', async (orig) => ({ ...(await orig<object>()), getAIConfig: () => ({ provider: 'openai', apiKey: 'k', baseUrl: 'http://x', model: 'm' }), isAIConfigValid: () => true }))

beforeAll(() => {
  // Radix Select needs these in jsdom
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.releasePointerCapture ??= () => {}
  Element.prototype.scrollIntoView ??= () => {}
})
afterEach(() => {
  vi.unstubAllGlobals()
})

/** jsdom has no layout: make an element vertically scrollable and scroll it. */
function scrollTo(el: Element, top: number) {
  Object.defineProperty(el, 'scrollHeight', { value: 2000, configurable: true })
  Object.defineProperty(el, 'clientHeight', { value: 300, configurable: true })
  ;(el as HTMLElement).scrollTop = top
  fireEvent.scroll(el)
}

const expectSharedBar = (bar: Element) => {
  expect(bar).toHaveClass('app-pane-bar', 'min-h-[50px]', 'border-b', 'bg-card', 'relative', 'z-10')
  expect(bar.className).not.toMatch(/uppercase/)
  const title = bar.querySelector('[data-slot="pane-title"]')!
  expect(title.tagName).toBe('H2')
  expect(title).toHaveClass('m-0', 'text-xs', 'font-medium')
  expect(title.className).not.toMatch(/uppercase|tracking-/)
}

function RulesHarness({ activeFileName }: { activeFileName: string }) {
  const [rules, setRules] = useState<RuleItem[]>([{ rule: 'example.com', target: 'localhost:3000', enabled: true } as RuleItem])
  return (
    <RuleConfig
      rules={rules}
      setRules={setRules}
      ruleFiles={activeFileName ? [{ name: activeFileName, enabled: true, ruleCount: 1 } as never] : []}
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

const mockRule: MockRule = { id: 1, name: 'cart', urlPattern: '/api/cart', method: 'GET', statusCode: 200, delay: 0, bodyType: 'inline', body: '{}', headers: {}, enabled: true } as MockRule

describe('rules page shell (issue #111)', () => {
  it('list header + 「编辑规则 · file」 title bar share the bar style; save is the primary button in the bar', () => {
    render(<RulesHarness activeFileName="default" />)
    expectSharedBar(screen.getByRole('heading', { name: '规则文件' }).closest('[data-slot="pane-bar"]')!)
    const bar = screen.getByTestId('rule-editor-title-bar')
    expectSharedBar(bar)
    expect(within(bar).getByRole('heading', { name: '编辑规则 · default' })).toBeInTheDocument()
    expect(within(bar).getByRole('button', { name: '保存' })).toHaveAttribute('data-variant', 'default')
  })

  it('empty state (no file): shared placeholder; the control row is hidden on purpose', () => {
    render(<RulesHarness activeFileName="" />)
    expect(within(screen.getByTestId('rule-editor-title-bar')).getByRole('heading', { name: '编辑规则' })).toBeInTheDocument()
    expect(screen.getByTestId('rule-editor-empty')).toHaveTextContent('选择左侧规则文件进行编辑')
    expect(screen.queryByLabelText('规则视图')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '保存' })).not.toBeInTheDocument()
  })

  it('scrolling the rule table lifts the bar; switching to the empty state and back resets it', () => {
    const view = render(<RulesHarness activeFileName="default" />)
    const bar = () => screen.getByTestId('rule-editor-title-bar')
    const viewport = screen.getByTestId('rule-panel-card').querySelector('[data-slot="scroll-area-viewport"]')!
    scrollTo(viewport, 4)
    expect(bar()).toHaveAttribute('data-scrolled', 'false')
    scrollTo(viewport, 40)
    expect(bar()).toHaveAttribute('data-scrolled', 'true')
    // the scroll container unmounts without a final scroll event: must not stay lifted
    view.rerender(<RulesHarness activeFileName="" />)
    expect(bar()).toHaveAttribute('data-scrolled', 'false')
    view.rerender(<RulesHarness activeFileName="default" />)
    expect(bar()).toHaveAttribute('data-scrolled', 'false')
  })
})

describe('Mock page shell (issue #111)', () => {
  it('「Mock 规则」 / 「编辑 Mock · cart」 in shared bars, names verbatim, no uppercase; the form scroll lifts the bar', async () => {
    render(
      <div style={{ height: 600 }}>
        <MockConfig mockRules={[mockRule]} fetchMocks={vi.fn(async () => undefined)} createMock={vi.fn(async () => null)} updateMock={vi.fn(async () => true)} deleteMock={vi.fn(async () => true)} />
      </div>,
    )
    expectSharedBar(screen.getByRole('heading', { name: 'Mock 规则' }).closest('[data-slot="pane-bar"]')!)
    fireEvent.click(screen.getByText('/api/cart'))
    const bar = screen.getByTestId('mock-editor-title-bar')
    expectSharedBar(bar)
    expect(within(bar).getByRole('heading', { name: '编辑 Mock · cart' })).toBeInTheDocument()
    expect(within(bar).getByRole('button', { name: '保存' })).toHaveAttribute('data-variant', 'default')
    expect(within(bar).getByRole('button', { name: '取消' })).toHaveAttribute('data-variant', 'ghost')
    const scroller = document.querySelector('[data-slot="mock-editor-scroll"]')!
    scrollTo(scroller, 10)
    expect(bar).toHaveAttribute('data-scrolled', 'true')
    scrollTo(scroller, 0)
    expect(bar).toHaveAttribute('data-scrolled', 'false')
  })

  it('HTTP method: shared dropdown labelled by its Label; the picked method is saved', async () => {
    const updateMock = vi.fn(async () => true)
    const user = userEvent.setup()
    render(
      <div style={{ height: 600 }}>
        <MockConfig mockRules={[mockRule]} fetchMocks={vi.fn(async () => undefined)} createMock={vi.fn(async () => null)} updateMock={updateMock} deleteMock={vi.fn(async () => true)} />
      </div>,
    )
    fireEvent.click(screen.getByText('/api/cart'))
    expect(document.querySelector('select')).toBeNull()
    const trigger = screen.getByRole('combobox', { name: 'HTTP 方法' })
    expect(trigger).toHaveTextContent('GET')
    await user.click(trigger)
    await user.click(await screen.findByRole('option', { name: 'PUT' }))
    expect(trigger).toHaveTextContent('PUT')
    await user.click(within(screen.getByTestId('mock-editor-title-bar')).getByRole('button', { name: '保存' }))
    await waitFor(() => expect(updateMock).toHaveBeenCalled())
    const [id, updates] = updateMock.mock.calls[0] as unknown as [number, Partial<MockRule>]
    expect(id).toBe(1)
    expect(updates.method).toBe('PUT')
  })
})

describe('plugin page shell (issue #111)', () => {
  it('list header and editor title bar use the shared bars', () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ plugins: [], files: [] }) })))
    render(
      <div style={{ height: 600 }}>
        <PluginConfig
          plugins={[] as Plugin[]}
          pluginMode="on"
          switchPluginMode={vi.fn(async () => undefined)}
          fetchPlugins={vi.fn(async () => undefined)}
          startPlugin={vi.fn(async () => undefined)}
          stopPlugin={vi.fn(async () => undefined)}
          togglePlugin={vi.fn(async () => undefined)}
          thirdPartyPlugins={[]}
          thirdPartySecurity={{ allowAll: false, trusted: [] }}
          fetchThirdPartyPlugins={vi.fn(async () => undefined)}
          loadThirdPartyPlugin={vi.fn(async () => undefined)}
          unloadThirdPartyPlugin={vi.fn(async () => undefined)}
        />
      </div>,
    )
    expectSharedBar(screen.getByRole('heading', { name: '插件' }).closest('[data-slot="pane-bar"]')!)
    expectSharedBar(screen.getByTestId('plugin-editor-title-bar'))
  })

  it('code editor: 保存 is the primary button, 保存并热加载 is outline', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ code: 'exports.plugin = {}' }) })))
    const host = document.createElement('div')
    document.body.appendChild(host)
    render(
      <EditorPaneActionsProvider host={host} registerDismiss={vi.fn()}>
        <PluginCodeEditor embedded plainHeading filename="demo.js" />
      </EditorPaneActionsProvider>,
    )
    await screen.findByTestId('code')
    expect(within(host).getByRole('button', { name: '保存' })).toHaveAttribute('data-variant', 'default')
    expect(within(host).getByRole('button', { name: '保存并热加载' })).toHaveAttribute('data-variant', 'outline')
    host.remove()
  })

  it('generator: 保存插件 is primary; after saving, 热加载 is outline (not green)', async () => {
    const plugin = { code: 'exports.plugin = {}', filename: 'gen.js', manifest: { id: 'local.gen', name: 'gen', version: '1.0.0', hooks: ['onRequestStart'], permissions: [] } }
    const sse = `data: ${JSON.stringify({ status: 'success', plugin })}\n\n`
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('generate-stream')) {
        return { ok: true, body: new Response(sse).body }
      }
      return { ok: true, json: async () => ({ success: true }) }
    }))
    const user = userEvent.setup()
    render(<PluginGenerator embedded plainHeading onOpenChange={vi.fn()} onPluginSaved={vi.fn()} />)
    await user.type(screen.getByPlaceholderText('例如：请求日志分析器'), 'gen')
    await user.type(screen.getByLabelText(/描述|功能/), 'demo')
    await user.click(screen.getByRole('button', { name: /生成插件/ }))
    const save = await screen.findByRole('button', { name: '保存插件' })
    expect(save).toHaveAttribute('data-variant', 'default')
    await act(async () => { fireEvent.click(save) })
    const hot = await screen.findByRole('button', { name: /热加载/ })
    expect(hot).toHaveAttribute('data-variant', 'outline')
    expect(hot.className).not.toMatch(/bg-green/)
  })
})

describe('detail labels are sentence case (issue #111)', () => {
  it('request / response section labels', async () => {
    const user = userEvent.setup()
    render(
      <DetailPanel
        embedded
        loading={false}
        selectedRecord={{ id: 1, method: 'GET', source: 'https://a.test/x', target: 'https://a.test/x', time: '12:00:00', statusCode: 200 } as never}
        detail={{ requestHeaders: { accept: '*/*' }, requestBody: 'x', responseHeaders: { 'content-type': 'text/plain' }, responseBody: 'ok', statusCode: 200, statusMessage: 'OK' } as never}
      />,
    )
    await user.click(screen.getByRole('tab', { name: '请求' }))
    for (const label of ['Request headers', 'Request body']) {
      const el = screen.getByText(label)
      expect(el.className).not.toMatch(/uppercase/)
    }
    await user.click(screen.getByRole('tab', { name: '响应' }))
    for (const label of ['Response headers', 'Response body']) {
      const el = screen.getByText(label)
      expect(el.className).not.toMatch(/uppercase/)
    }
  })
})

describe('editor title bar lift (issue #111)', () => {
  function Scroller() {
    const { scrolled, onScroll } = useEditorScrolled()
    return (
      <div>
        <EditorTitleBar data-testid="bar" title="编辑 Mock · cart" scrolled={scrolled} />
        <div data-testid="body" onScroll={onScroll}>
          <textarea data-testid="inner" />
        </div>
      </div>
    )
  }

  it('only the editor body itself counts: an inner textarea scrolling to top does not clear the lift', () => {
    render(<Scroller />)
    const bar = screen.getByTestId('bar')
    expect(bar).toHaveClass('border-b', 'bg-card', 'duration-150', 'ease-out', 'motion-reduce:transition-none',
      'data-[scrolled=true]:shadow-[0_1px_3px_rgb(0_0_0/0.06)]', 'dark:data-[scrolled=true]:shadow-none', 'dark:data-[scrolled=true]:border-black')
    scrollTo(screen.getByTestId('body'), 5)
    expect(bar).toHaveAttribute('data-scrolled', 'true')
    scrollTo(screen.getByTestId('inner'), 0)
    expect(bar).toHaveAttribute('data-scrolled', 'true')
    scrollTo(screen.getByTestId('body'), 0)
    expect(bar).toHaveAttribute('data-scrolled', 'false')
  })
})

describe('EditorSaveButton (issue #111)', () => {
  it('solid primary; 「保存中…」 while saving, no spinner', () => {
    const { rerender } = render(<EditorSaveButton onClick={vi.fn()} />)
    const button = screen.getByRole('button', { name: '保存' })
    expect(button).toHaveAttribute('data-variant', 'default')
    rerender(<EditorSaveButton onClick={vi.fn()} saving />)
    expect(button).toHaveAccessibleName('保存中…')
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')
    expect(button.querySelector('.animate-spin')).toBeNull()
  })

  it.each([
    [{}, '保存', '保存中…'],
    [{ label: '应用', savingLabel: '应用中…' }, '应用', '应用中…'],
  ])('keeps an aria-hidden sizing copy of the other label so the width never jumps (#138) %#', (labels, idle, busy) => {
    const { rerender } = render(<EditorSaveButton onClick={vi.fn()} {...labels} />)
    const button = screen.getByRole('button', { name: idle })
    const cell = button.querySelector('[data-slot="editor-save-label"]')!
    expect(cell).toHaveClass('inline-grid')
    let sizer = button.querySelector('[data-slot="editor-save-sizer"]')!
    expect(sizer).toHaveAttribute('aria-hidden', 'true')
    expect(sizer).toHaveClass('invisible', '[grid-area:1/1]')
    expect(sizer.textContent).toBe(busy)
    // visible label and sizer share the same grid cell
    expect(cell.children).toHaveLength(2)
    expect(cell.children[0]).toHaveClass('[grid-area:1/1]')
    expect(cell.children[0]).not.toHaveAttribute('aria-hidden')
    expect(button).toHaveAccessibleName(idle)
    expect(button.getAttribute('style') ?? '').not.toMatch(/min-width/)
    expect(button.className).not.toMatch(/min-w-/)

    rerender(<EditorSaveButton onClick={vi.fn()} {...labels} saving />)
    expect(button).toHaveAccessibleName(busy)
    sizer = button.querySelector('[data-slot="editor-save-sizer"]')!
    expect(sizer).toHaveAttribute('aria-hidden', 'true')
    expect(sizer.textContent).toBe(idle)
  })
})
