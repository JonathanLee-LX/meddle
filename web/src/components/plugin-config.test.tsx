import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PluginConfig } from './plugin-config'
import type { Plugin } from '@/types'
import { PLUGIN_LIST_DEFAULT_PX, PLUGIN_LIST_STORAGE_KEY } from '@/lib/plugin-pane-split'

vi.mock('./plugin-code-editor', () => ({
  PluginCodeEditor: ({ filename }: { filename: string }) => <div data-testid="plugin-code-stub">{filename}</div>,
}))

vi.mock('./plugin-generator', () => ({
  PluginGenerator: () => <div data-testid="plugin-generate-stub">generate</div>,
}))

vi.mock('./plugin-test-dialog', () => ({
  PluginTestDialog: ({ pluginName }: { pluginName: string }) => <div data-testid="plugin-test-stub">{pluginName}</div>,
}))

const builtin: Plugin = {
  id: 'builtin.logger',
  name: 'Logger',
  version: '1.0.0',
  hooks: ['onRequest'],
  permissions: [],
  priority: 0,
  state: 'stopped',
  stats: null,
}

const loadedCustom: Plugin = {
  id: 'local.demo',
  name: 'Demo',
  version: '0.1.0',
  hooks: ['onResponse'],
  permissions: [],
  priority: 0,
  state: 'running',
  stats: null,
}

const traceHeaderPlugin: Plugin = {
  id: 'add-trace-header',
  name: 'Add Trace Header',
  version: '1.0.0',
  hooks: ['onBeforeProxy'],
  permissions: [],
  priority: 100,
  state: 'running',
  stats: null,
  source: 'custom',
  filename: 'add-trace-header.js',
}

function renderPlugins(plugins: Plugin[] = [builtin, loadedCustom]) {
  return render(
    <div style={{ height: 600 }}>
      <PluginConfig
        plugins={plugins}
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
}

describe('PluginConfig list|edit', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ plugins: [{ filename: 'demo.js', modified: Date.now() }] }),
      })),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    localStorage.removeItem(PLUGIN_LIST_STORAGE_KEY)
  })

  it('renders the shared split and an idle editor', async () => {
    renderPlugins()
    expect(screen.getByTestId('plugin-config-layout')).toHaveAttribute('data-layout', 'list-edit')
    expect(screen.getByTestId('plugin-config-list')).toBeInTheDocument()
    expect(screen.getByTestId('plugin-config-edit')).toBeInTheDocument()
    expect(screen.getByTestId('plugin-panel-separator')).toBeInTheDocument()
    expect(screen.getByText(/选择左侧插件/)).toBeInTheDocument()
    expect(screen.queryByTestId('plugin-code-stub')).not.toBeInTheDocument()
    expect(await screen.findByTestId('plugin-config-row-custom-demo.js')).toBeInTheDocument()
  })

  it('opens the built-in plugin in the right pane', async () => {
    renderPlugins()
    fireEvent.click(screen.getByTestId('plugin-config-row-builtin-builtin.logger'))
    expect(screen.getByTestId('plugin-config-row-builtin-builtin.logger')).toHaveAttribute('data-state', 'selected')
    const edit = screen.getByTestId('plugin-config-edit')
    expect(edit).toHaveTextContent('builtin.logger · 1.0.0')
    expect(within(edit).getByRole('button', { name: '启动插件 Logger' })).toBeInTheDocument()
    expect(await screen.findByTestId('plugin-config-row-custom-demo.js')).toBeInTheDocument()
  })

  it('opens the code editor for a custom plugin and the generator from the toolbar', async () => {
    renderPlugins()
    fireEvent.click(await screen.findByTestId('plugin-config-row-custom-demo.js'))
    expect(await screen.findByTestId('plugin-code-stub')).toHaveTextContent('demo.js')

    fireEvent.click(screen.getByTestId('plugin-config-generate'))
    expect(await screen.findByTestId('plugin-generate-stub')).toBeInTheDocument()
    expect(screen.queryByTestId('plugin-code-stub')).not.toBeInTheDocument()
  })

  it('opens the test panel from the custom row without leaving the page', async () => {
    renderPlugins()
    fireEvent.click(await screen.findByRole('button', { name: '测试插件 Demo' }))
    expect(await screen.findByTestId('plugin-test-stub')).toHaveTextContent('Demo')
  })

  it('remembers the list width separately from other panes', async () => {
    localStorage.removeItem(PLUGIN_LIST_STORAGE_KEY)
    window.matchMedia = vi.fn().mockImplementation(() => ({
      matches: true,
      media: '',
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia

    renderPlugins()
    const layout = screen.getByTestId('plugin-config-layout')
    const list = screen.getByTestId('plugin-config-list')
    expect(layout).toHaveAttribute('data-plugin-list-width', String(PLUGIN_LIST_DEFAULT_PX))
    expect(list).toHaveStyle({ width: `${PLUGIN_LIST_DEFAULT_PX}px`, flex: `0 0 ${PLUGIN_LIST_DEFAULT_PX}px` })

    Object.defineProperty(layout, 'getBoundingClientRect', {
      value: () => ({ left: 0, width: 1400, top: 0, height: 800, right: 1400, bottom: 800, x: 0, y: 0, toJSON: () => {} }),
    })

    fireEvent.mouseDown(screen.getByTestId('plugin-panel-separator'))
    act(() => {
      fireEvent.mouseMove(document, { clientX: 420 })
      fireEvent.mouseUp(document)
    })

    expect(localStorage.getItem(PLUGIN_LIST_STORAGE_KEY)).toBe('420')
    expect(layout).toHaveAttribute('data-plugin-list-width', '420')
    expect(await screen.findByTestId('plugin-config-row-custom-demo.js')).toBeInTheDocument()
  })

  it('shows a custom plugin whose id is not local.<file> only in the custom group (#112)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          plugins: [{ filename: 'add-trace-header.js', modified: Date.now(), pluginId: 'add-trace-header' }],
        }),
      })),
    )
    const traceHeader: Plugin = {
      id: 'add-trace-header',
      name: 'Add Trace Header',
      version: '1.0.0',
      hooks: ['onBeforeProxy'],
      permissions: [],
      priority: 100,
      state: 'running',
      stats: null,
      source: 'custom',
      filename: 'add-trace-header.js',
    }
    renderPlugins([{ ...builtin, source: 'builtin' }, traceHeader])

    const customRow = await screen.findByTestId('plugin-config-row-custom-add-trace-header.js')
    expect(within(customRow).getByText('已启用')).toBeInTheDocument()
    expect(within(customRow).queryByText('未加载')).not.toBeInTheDocument()
    expect(screen.queryByTestId('plugin-config-row-builtin-add-trace-header')).not.toBeInTheDocument()
    expect(screen.getByTestId('plugin-config-row-builtin-builtin.logger')).toBeInTheDocument()
  })

  describe('deleting a custom plugin (#107)', () => {
    let customFiles: { filename: string; modified: number }[]

    beforeEach(() => {
      customFiles = [{ filename: 'demo.js', modified: Date.now() }]
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string, init?: RequestInit) => {
          if (init?.method === 'DELETE') {
            const filename = decodeURIComponent(url.split('/').pop() || '')
            customFiles = customFiles.filter((file) => file.filename !== filename)
            return { ok: true, json: async () => ({}) }
          }
          return { ok: true, json: async () => ({ plugins: customFiles }) }
        }),
      )
      vi.stubGlobal('confirm', vi.fn(() => true))
    })

    it('closes the test pane when its plugin is deleted', async () => {
      renderPlugins()
      fireEvent.click(await screen.findByRole('button', { name: '测试插件 Demo' }))
      expect(await screen.findByTestId('plugin-test-stub')).toHaveTextContent('Demo')

      fireEvent.click(screen.getByRole('button', { name: '删除插件 demo.js' }))

      await waitFor(() => expect(screen.queryByTestId('plugin-test-stub')).not.toBeInTheDocument())
      expect(screen.getByText(/选择左侧插件/)).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: '取消' })).not.toBeInTheDocument()
      await waitFor(() => expect(screen.queryByTestId('plugin-config-row-custom-demo.js')).not.toBeInTheDocument())
    })

    it('closes the code pane when its plugin is deleted', async () => {
      renderPlugins()
      fireEvent.click(await screen.findByTestId('plugin-config-row-custom-demo.js'))
      expect(await screen.findByTestId('plugin-code-stub')).toHaveTextContent('demo.js')

      fireEvent.click(screen.getByRole('button', { name: '删除插件 demo.js' }))

      await waitFor(() => expect(screen.queryByTestId('plugin-code-stub')).not.toBeInTheDocument())
      expect(screen.getByText(/选择左侧插件/)).toBeInTheDocument()
    })

    it('keeps an unrelated editor open', async () => {
      renderPlugins()
      fireEvent.click(screen.getByTestId('plugin-config-row-builtin-builtin.logger'))
      fireEvent.click(await screen.findByRole('button', { name: '删除插件 demo.js' }))

      await waitFor(() => expect(screen.queryByTestId('plugin-config-row-custom-demo.js')).not.toBeInTheDocument())
      expect(screen.getByTestId('plugin-config-edit')).toHaveTextContent('builtin.logger · 1.0.0')
    })

    it('keeps the editor when the delete is cancelled', async () => {
      vi.stubGlobal('confirm', vi.fn(() => false))
      renderPlugins()
      fireEvent.click(await screen.findByRole('button', { name: '测试插件 Demo' }))
      expect(await screen.findByTestId('plugin-test-stub')).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: '删除插件 demo.js' }))

      expect(screen.getByTestId('plugin-test-stub')).toBeInTheDocument()
      expect(fetch).not.toHaveBeenCalledWith(expect.stringContaining('/api/plugins/custom/'), expect.objectContaining({ method: 'DELETE' }))
    })

    it('closes the test pane for a plugin whose id is not local.<file> (#107 + #112)', async () => {
      customFiles = [{ filename: 'add-trace-header.js', modified: Date.now() }]
      renderPlugins([{ ...builtin, source: 'builtin' }, traceHeaderPlugin])
      fireEvent.click(await screen.findByRole('button', { name: '测试插件 Add Trace Header' }))
      expect(await screen.findByTestId('plugin-test-stub')).toHaveTextContent('Add Trace Header')

      fireEvent.click(screen.getByRole('button', { name: '删除插件 add-trace-header.js' }))

      await waitFor(() => expect(screen.queryByTestId('plugin-test-stub')).not.toBeInTheDocument())
      expect(screen.getByText(/选择左侧插件/)).toBeInTheDocument()
      expect(fetch).toHaveBeenCalledWith('/api/plugins/custom/add-trace-header.js', expect.objectContaining({ method: 'DELETE' }))
    })
  })

  describe('keyboard selection (#108)', () => {
    it('exposes each row as a focusable button that selects with Enter and Space', async () => {
      const user = userEvent.setup()
      renderPlugins()
      const builtinTrigger = screen.getByRole('button', { name: /^Logger/ })
      expect(builtinTrigger).toHaveAttribute('type', 'button')

      builtinTrigger.focus()
      expect(builtinTrigger).toHaveFocus()
      await user.keyboard('{Enter}')
      expect(screen.getByTestId('plugin-config-row-builtin-builtin.logger')).toHaveAttribute('data-state', 'selected')
      expect(builtinTrigger).toHaveAttribute('aria-current', 'true')
      expect(screen.getByTestId('plugin-config-edit')).toHaveTextContent('builtin.logger · 1.0.0')

      const customTrigger = await screen.findByTestId('plugin-config-row-custom-demo.js-trigger')
      customTrigger.focus()
      await user.keyboard(' ')
      expect(await screen.findByTestId('plugin-code-stub')).toHaveTextContent('demo.js')
      expect(customTrigger).toHaveAttribute('aria-current', 'true')
      expect(builtinTrigger).not.toHaveAttribute('aria-current')
    })

    it('reaches rows with Tab and moves focus with ArrowUp / ArrowDown / Home / End', async () => {
      const user = userEvent.setup()
      renderPlugins()
      const builtinTrigger = screen.getByTestId('plugin-config-row-builtin-builtin.logger-trigger')
      const customTrigger = await screen.findByTestId('plugin-config-row-custom-demo.js-trigger')

      screen.getByRole('combobox', { name: '插件模式' }).focus()
      await user.tab()
      expect(builtinTrigger).toHaveFocus()

      await user.keyboard('{ArrowDown}')
      expect(customTrigger).toHaveFocus()
      await user.keyboard('{ArrowDown}')
      expect(customTrigger).toHaveFocus()
      await user.keyboard('{ArrowUp}')
      expect(builtinTrigger).toHaveFocus()
      await user.keyboard('{End}')
      expect(customTrigger).toHaveFocus()
      await user.keyboard('{Home}')
      expect(builtinTrigger).toHaveFocus()

      // Arrow keys only move focus; Enter commits the selection.
      expect(screen.getByText(/选择左侧插件/)).toBeInTheDocument()
      await user.keyboard('{ArrowDown}{Enter}')
      expect(await screen.findByTestId('plugin-code-stub')).toHaveTextContent('demo.js')
    })

    it('uses the traffic row tokens for hover / selected and a ring-only keyboard focus', async () => {
      renderPlugins()
      const row = screen.getByTestId('plugin-config-row-builtin-builtin.logger')
      const classes = row.className.split(/\s+/)
      expect(classes).toContain('hover:bg-muted/50')
      expect(classes).toContain('data-[state=selected]:bg-accent')
      // Focus is ring-only (focus-visible), never a fill, so it stays distinct from selection.
      expect(classes).toContain('has-[[data-plugin-row-trigger]:focus-visible]:ring-[3px]')
      expect(classes).toContain('has-[[data-plugin-row-trigger]:focus-visible]:ring-inset')
      expect(classes).toContain('has-[[data-plugin-row-trigger]:focus-visible]:ring-ring/50')
      expect(classes.filter((name) => /focus/.test(name) && /:bg-/.test(name))).toEqual([])
      expect(classes.filter((name) => name.startsWith('focus:') || name.startsWith('focus-within:'))).toEqual([])
      const trigger = screen.getByTestId('plugin-config-row-builtin-builtin.logger-trigger')
      expect(trigger.className).not.toMatch(/(^|\s)(focus|focus-visible):/)
      expect(await screen.findByTestId('plugin-config-row-custom-demo.js')).toBeInTheDocument()
    })

    it('does not select the row from keys inside the action cluster', async () => {
      const user = userEvent.setup()
      renderPlugins()
      const toggle = await screen.findByRole('switch', { name: '启用插件 demo.js' })
      toggle.focus()
      await user.keyboard('{ArrowDown}')
      expect(screen.getByText(/选择左侧插件/)).toBeInTheDocument()
    })
  })
})
