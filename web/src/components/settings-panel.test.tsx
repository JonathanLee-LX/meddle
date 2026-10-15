import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SettingsPanel } from './settings-panel'
import { updateSettings } from '@/lib/settings-store'

vi.mock('@/components/theme-provider', () => ({
  useTheme: () => ({
    theme: 'system',
    accentColor: 'auto',
    setTheme: vi.fn(),
    setAccentColor: vi.fn(),
    setZoom: vi.fn(),
  }),
}))

vi.mock('@/lib/settings-store', () => ({
  getCachedSettings: () => ({ fontSize: '100' }),
  loadSettings: vi.fn().mockResolvedValue({
    fontSize: '100',
    mocksFilePath: '',
    clientAliases: {},
    aiConfig: {
      enabled: false,
      provider: 'openai',
      apiKey: '',
      baseUrl: '',
      model: '',
      models: [],
    },
  }),
  updateSettings: vi.fn().mockResolvedValue(undefined),
}))

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('SettingsPanel navigation', () => {
  it('renders settings categories as a vertical sidebar and switches content', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('[]', {
      headers: { 'Content-Type': 'application/json' },
    })))

    render(<SettingsPanel embedded />)

    const navigation = screen.getByRole('tablist', { name: '设置分类' })
    expect(navigation).toHaveAttribute('data-orientation', 'vertical')
    expect(navigation).toHaveClass('group-data-[orientation=vertical]/tabs:!h-full')
    expect(within(navigation).getAllByRole('tab')).toHaveLength(4)
    expect(screen.getByText('主题')).toBeInTheDocument()
    expect(screen.getByRole('tabpanel', { name: '偏好设置' })).toHaveClass('app-panel-content')

    await user.click(within(navigation).getByRole('tab', { name: '配置文件' }))

    expect(await screen.findByText('路由规则文件')).toBeInTheDocument()
    expect(screen.getByRole('tabpanel', { name: '配置文件' })).toHaveClass('app-panel-content')

    await user.click(within(navigation).getByRole('tab', { name: '客户端' }))
    expect(screen.getByRole('tabpanel', { name: '客户端' })).toHaveClass('app-panel-content')

    await user.click(within(navigation).getByRole('tab', { name: 'AI 配置' }))
    expect(screen.getByRole('tabpanel', { name: 'AI 配置' })).toHaveClass('app-panel-content')
  })
})

describe('SettingsPanel about section (#112)', () => {
  it('shows the Meddle version reported by /api/version instead of a hardcoded 1.0.0', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      const body = url === '/api/version' ? { name: '@jonathanleelx/meddle', version: '0.5.0-beta.18' } : []
      return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<SettingsPanel embedded />)

    expect(await screen.findByText('版本: 0.5.0-beta.18')).toBeInTheDocument()
    expect(screen.queryByText('版本: 1.0.0')).not.toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/api/version')
  })

  it('shows a placeholder rather than a fake version when /api/version is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not found', { status: 404 })))

    render(<SettingsPanel embedded />)

    expect(await screen.findByTestId('settings-app-version')).toHaveTextContent('版本: —')
    expect(screen.queryByText('版本: 1.0.0')).not.toBeInTheDocument()
  })
})

describe('SettingsPanel missing mocks file notice (#118)', () => {
  function stubFetch(mocksFile: unknown) {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const body = String(input) === '/api/mocks-file' ? mocksFile : []
      return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } })
    }))
  }

  async function openConfigTab() {
    const user = userEvent.setup()
    render(<SettingsPanel embedded />)
    const navigation = screen.getByRole('tablist', { name: '设置分类' })
    await user.click(within(navigation).getByRole('tab', { name: '配置文件' }))
    await screen.findByText('Mock 规则文件')
  }

  it('shows the notice under the mocks path input when the file does not exist', async () => {
    const missing = '/tmp/meddle-home/nested/fresh-mocks.json'
    stubFetch({ path: missing, exists: false, custom: true })
    await openConfigTab()
    const note = await screen.findByTestId('settings-mocks-file-missing')
    // the path is already in the input above, so the note omits it
    expect(note).toHaveTextContent(/^文件不存在，保存第一条规则时会创建$/)
    expect(note).not.toHaveTextContent(missing)
  })

  it('shows the destructive format-error note with location but no path when the file is invalid (#120)', async () => {
    const bad = '/tmp/meddle-home/broken-mocks.json'
    stubFetch({ path: bad, exists: true, custom: true, valid: false, parseError: { line: 12, column: 5, message: 'Unexpected token }' } })
    await openConfigTab()
    const note = await screen.findByTestId('settings-mocks-file-invalid')
    expect(note).toHaveClass('text-destructive')
    expect(note).toHaveTextContent('文件格式错误')
    expect(note).toHaveTextContent('第 12 行第 5 列：Unexpected token }')
    expect(note).not.toHaveTextContent(bad)
    expect(screen.queryByTestId('settings-mocks-file-missing')).not.toBeInTheDocument()
  })

  it('shows the resolved absolute path the proxy uses, not the raw ~ input (#121)', async () => {
    const resolved = '/home/alice/x/mocks.json'
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      const body = url === '/api/mocks-file'
        ? { path: resolved, exists: true, custom: true, valid: true, parseError: null }
        : url === '/api/settings' ? { mocksFilePath: '~/x/mocks.json' } : []
      return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } })
    }))
    await openConfigTab()
    await vi.waitFor(() => expect(screen.getByTestId('settings-mocks-file-resolved').textContent).toBe(resolved))
  })

  it('shows no notice when the file exists', async () => {
    stubFetch({ path: '/tmp/meddle-home/custom-mocks.json', exists: true, custom: true })
    await openConfigTab()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(screen.queryByTestId('settings-mocks-file-missing')).not.toBeInTheDocument()
  })

  it('shows no notice when the default mocks file has not been created yet', async () => {
    stubFetch({ path: '/tmp/meddle-home/mocks.json', exists: false, custom: false })
    await openConfigTab()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(screen.queryByTestId('settings-mocks-file-missing')).not.toBeInTheDocument()
  })

  it('shows no notice when the server does not report a status (older server)', async () => {
    stubFetch([])
    await openConfigTab()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(screen.queryByTestId('settings-mocks-file-missing')).not.toBeInTheDocument()
  })
})

describe('SettingsPanel legacy relative mocks path notice (#121)', () => {
  const oldPath = '/Users/alice/projects/app/team/mocks.json'
  const newPath = '/Users/alice/.meddle/team/mocks.json'

  function stub(legacy: unknown) {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const body = String(input) === '/api/mocks-file'
        ? { path: newPath, exists: false, custom: true, valid: true, parseError: null, legacyMocksPath: legacy }
        : []
      return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } })
    }))
  }

  async function open() {
    const user = userEvent.setup()
    render(<SettingsPanel embedded />)
    await user.click(within(screen.getByRole('tablist', { name: '设置分类' })).getByRole('tab', { name: '配置文件' }))
    await screen.findByText('Mock 规则文件')
    return user
  }

  it('shows both paths for a relative input; 「改用此路径」 only fills the input (no save) and the notice hides', async () => {
    vi.mocked(updateSettings).mockClear()
    stub({ configured: 'team/mocks.json', oldPath, newPath })
    const user = await open()
    expect(screen.getByTestId('settings-mocks-file-current-label')).toHaveTextContent('当前使用')
    expect(screen.queryByText(/上方显示实际使用的绝对路径/)).not.toBeInTheDocument()

    const input = screen.getByLabelText(/自定义 Mock 规则文件路径/) as HTMLInputElement
    await user.clear(input)
    await user.type(input, 'team/mocks.json')
    const wrap = await screen.findByTestId('settings-mocks-file-legacy-wrap')
    await vi.waitFor(() => expect(wrap).toHaveAttribute('data-visible', 'true'))
    const note = screen.getByTestId('settings-mocks-file-legacy')
    expect(note).toHaveTextContent('相对路径的解析规则已变更，当前可能读不到原来的 Mock 文件')
    expect(note).toHaveClass('border-l-2', 'border-amber-500')
    expect(note.className).not.toMatch(/destructive|red/)
    const oldEl = screen.getByTestId('settings-mocks-file-legacy-old')
    expect(oldEl.textContent).toBe(`原来读取：${oldPath}`)
    expect(oldEl.querySelectorAll('wbr')).toHaveLength(oldPath.split('/').length - 1)
    expect(oldEl).toHaveClass('font-mono')
    const newEl = screen.getByTestId('settings-mocks-file-legacy-new')
    expect(newEl.textContent).toBe(`现在读取：${newPath}（文件不存在）`)
    expect(newEl.querySelectorAll('wbr')).toHaveLength(newPath.split('/').length - 1)
    expect(wrap).toHaveClass('duration-150', 'ease-out', 'motion-reduce:transition-none', 'grid-rows-[1fr]', 'opacity-100')
    // the parent's gap lives inside the collapsing wrapper, so a collapsed notice leaves none
    expect(wrap).toHaveClass('-mt-[var(--ui-field-gap)]')
    expect(screen.getByTestId('settings-mocks-file-legacy-gap')).toHaveClass('pt-[var(--ui-field-gap)]')
    expect(wrap.contains(screen.getByTestId('settings-mocks-file-legacy-gap'))).toBe(true)
    // notice sits between the input and the help text
    const help = screen.getByText(/必须是 JSON 格式的 Mock 规则文件/)
    expect(input.compareDocumentPosition(wrap) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(wrap.compareDocumentPosition(help) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // no duplicate 「文件不存在」 note
    expect(screen.queryByTestId('settings-mocks-file-missing')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '改用此路径' }))
    expect(input.value).toBe(oldPath)
    // other settings (e.g. zoom) may sync on mount, but the path is never saved
    expect(vi.mocked(updateSettings).mock.calls.filter(([u]) => 'mocksFilePath' in (u as object))).toEqual([])
    expect(wrap).toHaveAttribute('data-visible', 'false')
    expect(wrap).toHaveAttribute('aria-hidden', 'true')
    expect(wrap).toHaveClass('grid-rows-[0fr]', 'opacity-0')
  })

  it('hides for an empty input and shows again for a relative one', async () => {
    stub({ configured: 'team/mocks.json', oldPath, newPath })
    const user = await open()
    const input = screen.getByLabelText(/自定义 Mock 规则文件路径/) as HTMLInputElement
    const wrap = await screen.findByTestId('settings-mocks-file-legacy-wrap')
    await user.clear(input)
    expect(wrap).toHaveAttribute('data-visible', 'false')
    await user.type(input, 'x.json')
    expect(wrap).toHaveAttribute('data-visible', 'true')
    await user.clear(input)
    await user.type(input, '~/x.json')
    expect(wrap).toHaveAttribute('data-visible', 'false')
  })

  it('renders nothing when the server reports no legacy path', async () => {
    stub(null)
    await open()
    await screen.findByTestId('settings-mocks-file-resolved')
    expect(screen.queryByTestId('settings-mocks-file-legacy-wrap')).not.toBeInTheDocument()
  })
})

describe('SettingsPanel config 「应用」 button (#138)', () => {
  it('is the solid primary save button and reads 「应用中…」 while saving (no spinner); secondary buttons stay outline', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('[]', {
      headers: { 'Content-Type': 'application/json' },
    })))
    let finish!: () => void
    vi.mocked(updateSettings).mockImplementation((updates) => (
      'mocksFilePath' in (updates as object)
        ? new Promise<void>((resolve) => { finish = resolve })
        : Promise.resolve()
    ) as ReturnType<typeof updateSettings>)

    const user = userEvent.setup()
    render(<SettingsPanel embedded />)
    await user.click(within(screen.getByRole('tablist', { name: '设置分类' })).getByRole('tab', { name: '配置文件' }))
    await screen.findByText('Mock 规则文件')

    const apply = screen.getByTestId('settings-mocks-file-apply')
    expect(apply).toHaveAccessibleName('应用')
    expect(apply).toHaveAttribute('data-variant', 'default')
    expect(apply).toBeEnabled()
    expect(screen.getByRole('button', { name: /重新加载配置/ })).toHaveAttribute('data-variant', 'outline')
    expect(screen.getByRole('button', { name: /诊断配置/ })).toHaveAttribute('data-variant', 'outline')

    await user.click(apply)
    await vi.waitFor(() => expect(apply).toHaveAccessibleName('应用中…'))
    expect(apply).toBeDisabled()
    expect(apply).toHaveAttribute('aria-busy', 'true')
    expect(apply).toHaveAttribute('data-variant', 'default')
    expect(apply.querySelector('.animate-spin')).toBeNull()

    finish()
    await vi.waitFor(() => expect(apply).toHaveAccessibleName('应用'))
    expect(apply).toBeEnabled()
    expect(apply).not.toHaveAttribute('aria-busy')
    vi.mocked(updateSettings).mockReset()
    vi.mocked(updateSettings).mockResolvedValue(undefined)
  })
})
