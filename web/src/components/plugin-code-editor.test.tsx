import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { EditorPaneActionsProvider } from './editor-pane-actions'
import { PluginCodeEditor } from './plugin-code-editor'

vi.mock('./monaco-editor', () => ({
  MonacoEditor: ({ value }: { value: string }) => <pre data-testid="plugin-code">{value}</pre>,
}))

describe('PluginCodeEditor embedded heading', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ code: 'exports.plugin = { manifest: { id: "local.demo" } }' }),
      })),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('omits the file title when the page pane bar already shows it', async () => {
    render(<PluginCodeEditor embedded plainHeading filename="demo.js" />)

    expect(await screen.findByTestId('plugin-code')).toHaveTextContent('exports.plugin')
    expect(screen.queryByText('查看和编辑插件源码，保存后需热加载才能生效')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'demo.js' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '关闭' })).toBeInTheDocument()
  })

  it('places save actions in the pane title bar', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const registerDismiss = vi.fn()
    render(
      <EditorPaneActionsProvider host={host} registerDismiss={registerDismiss}>
        <PluginCodeEditor embedded plainHeading filename="demo.js" />
      </EditorPaneActionsProvider>,
    )

    expect(await screen.findByTestId('plugin-code')).toHaveTextContent('exports.plugin')
    expect(host).toHaveTextContent('保存')
    expect(host).toHaveTextContent('保存并热加载')
    expect(host).toHaveTextContent('还原')
    expect(host).toHaveTextContent('AI 更新代码')
    expect(screen.queryByRole('button', { name: '关闭' })).not.toBeInTheDocument()
    expect(registerDismiss).toHaveBeenCalledWith(expect.any(Function))
    host.remove()
  })
})
