import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { SaveShortcutProvider } from '@/components/save-shortcut/save-shortcut-provider'
import { ThemeProvider } from '@/components/theme-provider'

const LOG = {
  id: 7,
  method: 'GET',
  source: 'https://example.com/a',
  target: 'example.com',
  time: '12:00:00',
  statusCode: 200,
  clientIp: '127.0.0.1',
  clientType: 'local',
}

class FakeWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3
  readyState = FakeWebSocket.OPEN
  url: string
  constructor(url: string) {
    this.url = url
  }
  addEventListener() {}
  removeEventListener() {}
  close() {
    this.readyState = FakeWebSocket.CLOSED
  }
  send() {}
}

const requests: { url: string; method: string }[] = []

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function installBrowser() {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.releasePointerCapture ??= () => {}
  Element.prototype.scrollIntoView ??= () => {}
  vi.stubGlobal('WebSocket', FakeWebSocket)
  requests.length = 0
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = (init?.method || 'GET').toUpperCase()
    requests.push({ url, method })
    if (url.includes('/api/logs')) return jsonResponse([LOG])
    if (url.includes('/api/settings')) {
      return jsonResponse({
        theme: 'light',
        accentColor: 'auto',
        fontSize: '100',
        mocksFilePath: '',
        clientAliases: {},
        aiConfig: { enabled: false, provider: 'openai', apiKey: '', baseUrl: '', model: '', models: [] },
      })
    }
    if (url.includes('/api/plugins')) return jsonResponse({ mode: 'off', plugins: [] })
    if (url.includes('/api/mocks')) return jsonResponse([])
    if (url.includes('/api/ping')) return jsonResponse({ ok: true })
    return jsonResponse({})
  }))
}

function logWrites() {
  return requests.filter((request) => request.url.includes('/api/logs') && request.method !== 'GET')
}

function renderApp() {
  installBrowser()
  render(
    <ThemeProvider defaultTheme="light">
      <SaveShortcutProvider>
        <MemoryRouter initialEntries={['/logs']}>
          <App />
        </MemoryRouter>
      </SaveShortcutProvider>
    </ThemeProvider>,
  )
}

function srcRoot() {
  const candidates = [join(process.cwd(), 'src'), join(process.cwd(), 'web/src')]
  const found = candidates.find((dir) => existsSync(join(dir, 'App.tsx')))
  if (!found) throw new Error(`web src root not found from ${process.cwd()}`)
  return found
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.(tsx|ts)$/.test(entry) && !/\.test\.(tsx|ts)$/.test(entry) ? [path] : []
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('traffic log clear confirmation', () => {
  it('the toolbar 清空日志 button does not clear on open, 取消, or Escape, and sends no log write', async () => {
    const user = userEvent.setup()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderApp()
    expect(await screen.findByText('1 条')).toBeInTheDocument()
    expect(screen.queryByText('暂无请求记录')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '清空日志' }))
    const dialog = await screen.findByRole('alertdialog', { name: '清空流量日志' })
    expect(within(dialog).getByRole('button', { name: '清空' })).toHaveTextContent('清空')
    expect(within(dialog).getByRole('button', { name: '取消' })).toHaveTextContent('取消')
    expect(screen.getByText('1 条')).toBeInTheDocument()
    expect(logWrites()).toEqual([])
    expect(confirm).not.toHaveBeenCalled()

    await user.click(within(dialog).getByRole('button', { name: '取消' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(screen.getByText('1 条')).toBeInTheDocument()
    expect(logWrites()).toEqual([])

    await user.click(screen.getByRole('button', { name: '清空日志' }))
    await screen.findByRole('alertdialog', { name: '清空流量日志' })
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(screen.getByText('1 条')).toBeInTheDocument()
    expect(screen.queryByText('暂无请求记录')).not.toBeInTheDocument()
    expect(logWrites()).toEqual([])
  })

  it('the command palette 清空日志 entry uses the same dialog and does not clear until 清空', async () => {
    const user = userEvent.setup()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderApp()
    expect(await screen.findByText('1 条')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /搜索操作/ }))
    const palette = await screen.findByRole('dialog', { name: '全局操作面板' })
    await user.click(within(palette).getByRole('button', { name: '清空日志' }))

    const dialog = await screen.findByRole('alertdialog', { name: '清空流量日志' })
    expect(confirm).not.toHaveBeenCalled()
    expect(screen.getByText('1 条')).toBeInTheDocument()
    expect(logWrites()).toEqual([])

    await user.click(within(dialog).getByRole('button', { name: '取消' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(screen.getByText('1 条')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /搜索操作/ }))
    const paletteAgain = await screen.findByRole('dialog', { name: '全局操作面板' })
    await user.click(within(paletteAgain).getByRole('button', { name: '清空日志' }))
    const confirmDialog = await screen.findByRole('alertdialog', { name: '清空流量日志' })
    await user.click(within(confirmDialog).getByRole('button', { name: '清空' }))

    await waitFor(() => expect(screen.getByText('0 条')).toBeInTheDocument())
    expect(screen.getByText('暂无请求记录')).toBeInTheDocument()
    expect(screen.queryByText('1 条')).not.toBeInTheDocument()
    expect(logWrites()).toEqual([])
    expect(confirm).not.toHaveBeenCalled()
  })

  it('clears the visible list only after the toolbar 清空 button, without a log write request', async () => {
    const user = userEvent.setup()
    renderApp()
    expect(await screen.findByText('1 条')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '清空日志' }))
    const dialog = await screen.findByRole('alertdialog', { name: '清空流量日志' })
    expect(logWrites()).toEqual([])
    await user.click(within(dialog).getByRole('button', { name: '清空' }))

    await waitFor(() => expect(screen.getByText('暂无请求记录')).toBeInTheDocument())
    expect(screen.getByText('0 条')).toBeInTheDocument()
    expect(logWrites()).toEqual([])
  })

  it('keeps every clearRecords call site behind the confirm dialog', () => {
    const src = srcRoot()
    const hits = sourceFiles(src)
      .map((path) => ({ path, source: readFileSync(path, 'utf8') }))
      .filter((file) => file.source.includes('clearRecords'))
      .map((file) => file.path.slice(src.length + 1))

    expect(hits.sort()).toEqual([
      'App.tsx',
      'hooks/use-logs.ts',
      'hooks/use-proxy-store.ts',
    ].sort())

    const app = readFileSync(join(srcRoot(), 'App.tsx'), 'utf8')
    expect(app).not.toContain('onClear={store.clearRecords}')
    expect(app).not.toContain('run: store.clearRecords')
    expect(app).not.toMatch(/id: 'logs.clear'[\s\S]{0,400}confirm:/)
    expect(app.match(/store\.clearRecords\(\)/g)).toHaveLength(1)
    const confirmCall = app.indexOf('store.clearRecords()')
    expect(app.slice(Math.max(0, confirmCall - 180), confirmCall)).toContain('onConfirm')
  })
})
