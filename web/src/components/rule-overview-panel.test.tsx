import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RuleOverviewPanel } from './rule-overview-panel'
import type { RuleItem } from '@/types'

interface FetchMockOptions {
  files?: Array<{ name: string; enabled: boolean; ruleCount: number }>
  mergedRules?: Array<{ pattern: string; target: string; rawRule: string; rawTarget: string; exclusions: string[]; file: string }>
  conflicts?: Array<{
    pattern: string
    winner: { file: string; target: string; rawRule: string; rawTarget: string }
    shadowed: Array<{ file: string; target: string; rawRule: string; rawTarget: string }>
  }>
  perFileRules?: Array<{
    name: string
    enabled: boolean
    error?: string
    rules: Array<{ pattern: string; target: string; rawRule: string; rawTarget: string; exclusions: string[]; enabled: boolean }>
  }>
  status?: number
  reject?: boolean
}

const overviewPayload = {
  files: [
    { name: '默认规则', enabled: true, ruleCount: 2 },
    { name: '开发规则', enabled: false, ruleCount: 1 },
  ],
  mergedRules: [
    { pattern: 'example.com', target: '10.0.0.9:80', rawRule: 'example.com', rawTarget: '10.0.0.9:80', exclusions: [], file: '开发规则' },
    { pattern: 'api.test.com', target: 'localhost:8080', rawRule: 'api.test.com', rawTarget: 'localhost:8080', exclusions: ['sub.api.test.com'], file: '默认规则' },
  ],
  conflicts: [
    {
      pattern: 'example.com',
      winner: { file: '开发规则', target: '10.0.0.9:80', rawRule: 'example.com', rawTarget: '10.0.0.9:80' },
      shadowed: [{ file: '默认规则', target: '127.0.0.1:3000', rawRule: 'example.com', rawTarget: '127.0.0.1:3000' }],
    },
  ],
  perFileRules: [
    {
      name: '默认规则',
      enabled: true,
      rules: [
        { pattern: 'example.com', target: '127.0.0.1:3000', rawRule: 'example.com', rawTarget: '127.0.0.1:3000', exclusions: [], enabled: true },
        { pattern: 'api.test.com', target: 'localhost:8080', rawRule: 'api.test.com', rawTarget: 'localhost:8080', exclusions: ['sub.api.test.com'], enabled: true },
        { pattern: 'staging.test.com', target: '10.0.0.5:80', rawRule: 'staging.test.com', rawTarget: '10.0.0.5:80', exclusions: [], enabled: false },
      ],
    },
    {
      name: '开发规则',
      enabled: false,
      rules: [
        { pattern: 'example.com', target: '10.0.0.9:80', rawRule: 'example.com', rawTarget: '10.0.0.9:80', exclusions: [], enabled: true },
      ],
    },
  ],
}

function mockFetch(options: FetchMockOptions = {}) {
  const payload = {
    files: options.files ?? overviewPayload.files,
    mergedRules: options.mergedRules ?? overviewPayload.mergedRules,
    conflicts: options.conflicts ?? overviewPayload.conflicts,
    perFileRules: options.perFileRules ?? overviewPayload.perFileRules,
  }
  const fetchMock = vi.fn(async () => {
    if (options.reject) throw new Error('network down')
    return new Response(JSON.stringify(payload), { status: options.status ?? 200, headers: { 'Content-Type': 'application/json' } })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
})

function renderPanel(props: Partial<Parameters<typeof RuleOverviewPanel>[0]> = {}) {
  const onLocateRule = vi.fn()
  const onSelectFile = vi.fn()
  render(
    <RuleOverviewPanel
      rules={[]}
      activeFileName={null}
      onLocateRule={onLocateRule}
      onSelectFile={onSelectFile}
      {...props}
    />,
  )
  return { onLocateRule, onSelectFile }
}

async function openFilesView(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('radio', { name: '按文件' }))
}

describe('RuleOverviewPanel', () => {
  it('loads and renders the merged (effective) view by default', async () => {
    mockFetch()
    renderPanel()

    const examples = await screen.findAllByText('example.com')
    expect(examples).toHaveLength(2) // winner + 被覆盖行
    expect(screen.getByText('api.test.com')).toBeInTheDocument()
    expect(screen.getByText('!sub.api.test.com')).toBeInTheDocument()
    expect(screen.getByText('127.0.0.1:3000')).toBeInTheDocument()
  })

  it('marks shadowed rules with an override badge', async () => {
    mockFetch()
    renderPanel()

    expect(await screen.findByText('已被覆盖')).toBeInTheDocument()
    expect(screen.getByText('生效')).toBeInTheDocument()
    expect(screen.getByText(/被同名规则覆盖/)).toBeInTheDocument()
  })

  it('locates a rule row click with raw rule/target and file', async () => {
    const user = userEvent.setup()
    mockFetch()
    const { onLocateRule } = renderPanel()

    const winnerRow = (await screen.findByText('生效')).closest('tr')
    expect(winnerRow).not.toBeNull()
    await user.click(winnerRow!)

    expect(onLocateRule).toHaveBeenCalledWith('开发规则', 'example.com', '10.0.0.9:80')
  })

  it('shows the per-file view grouped by file with enabled state and counts', async () => {
    const user = userEvent.setup()
    mockFetch()
    renderPanel()

    await openFilesView(user)

    expect(await screen.findAllByText('默认规则')).not.toHaveLength(0)
    expect(screen.getByText('开发规则')).toBeInTheDocument()
    // 禁用规则行
    expect(screen.getByText('staging.test.com')).toBeInTheDocument()
    expect(screen.getAllByText('禁用').length).toBeGreaterThan(0)
    // 排除列展示
    expect(screen.getByText('!sub.api.test.com')).toBeInTheDocument()
  })

  it('calls onSelectFile when a file group header is clicked', async () => {
    const user = userEvent.setup()
    mockFetch()
    const { onSelectFile } = renderPanel()

    await openFilesView(user)
    const groupHeader = (await screen.findByText('默认规则')).closest('td')
    expect(groupHeader).not.toBeNull()
    await user.click(groupHeader!)

    expect(onSelectFile).toHaveBeenCalledWith('默认规则')
  })

  it('filters rules by keyword and shows counts', async () => {
    const user = userEvent.setup()
    mockFetch()
    renderPanel()

    await screen.findAllByText('example.com')
    await user.type(screen.getByRole('textbox', { name: '搜索规则' }), 'api.test')

    await waitFor(() => {
      expect(screen.queryAllByText('example.com')).toHaveLength(0)
    })
    expect(screen.getByText('api.test.com')).toBeInTheDocument()
    expect(screen.getByText(/1 \/ 3 条/)).toBeInTheDocument()
  })

  it('shows a no-match empty state with a clear action', async () => {
    const user = userEvent.setup()
    mockFetch()
    renderPanel()

    await screen.findAllByText('example.com')
    await user.type(screen.getByRole('textbox', { name: '搜索规则' }), 'no-such-thing')

    expect(await screen.findByText('无匹配结果')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '清空筛选' }))
    expect((await screen.findAllByText('example.com')).length).toBeGreaterThan(0)
  })

  it('shows a dirty hint when active file has unsaved edits', async () => {
    mockFetch()
    const editedRules: RuleItem[] = overviewPayload.perFileRules[0].rules.map((entry) => ({
      rule: entry.rawRule,
      target: entry.rawTarget,
      enabled: entry.enabled,
      exclusions: entry.exclusions,
    }))
    editedRules.push({ rule: 'unsaved.example.com', target: '127.0.0.1:9999', enabled: true, exclusions: [] })

    renderPanel({ rules: editedRules, activeFileName: '默认规则' })

    expect(await screen.findByText(/有未保存修改/)).toBeInTheDocument()
  })

  it('hides the dirty hint when the active file matches saved content', async () => {
    mockFetch()
    const savedRules: RuleItem[] = overviewPayload.perFileRules[0].rules.map((entry) => ({
      rule: entry.rawRule,
      target: entry.rawTarget,
      enabled: entry.enabled,
      exclusions: entry.exclusions,
    }))

    renderPanel({ rules: savedRules, activeFileName: '默认规则' })

    await screen.findAllByText('example.com')
    expect(screen.queryByText(/有未保存修改/)).not.toBeInTheDocument()
  })

  it('renders per-file read errors as a group-level error row', async () => {
    const user = userEvent.setup()
    mockFetch({
      perFileRules: [
        { name: '默认规则', enabled: true, rules: [] },
        { name: 'broken', enabled: true, error: 'EISDIR', rules: [] },
      ],
      mergedRules: [],
      conflicts: [],
      files: [
        { name: '默认规则', enabled: true, ruleCount: 0 },
        { name: 'broken', enabled: true, ruleCount: 0 },
      ],
    })
    renderPanel()

    await openFilesView(user)
    expect(await screen.findByText(/读取失败/)).toBeInTheDocument()
  })

  it('shows an API error state with retry', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn(async () => new Response('boom', { status: 500 }))
    vi.stubGlobal('fetch', fetchMock)
    renderPanel()

    expect(await screen.findByText('加载失败')).toBeInTheDocument()

    // 重试成功
    const payload = JSON.stringify(overviewPayload)
    fetchMock.mockImplementation(async () => new Response(payload, { status: 200, headers: { 'Content-Type': 'application/json' } }))
    await user.click(screen.getByRole('button', { name: '重试' }))
    expect((await screen.findAllByText('example.com')).length).toBeGreaterThan(0)
  })

  it('shows an empty state when there are no rule files', async () => {
    mockFetch({ files: [], mergedRules: [], conflicts: [], perFileRules: [] })
    renderPanel()

    expect(await screen.findByText('还没有规则文件')).toBeInTheDocument()
  })

  it('shows an empty state when all files have no rules', async () => {
    mockFetch({
      files: [{ name: '默认规则', enabled: true, ruleCount: 0 }],
      mergedRules: [],
      conflicts: [],
      perFileRules: [{ name: '默认规则', enabled: true, rules: [] }],
    })
    renderPanel()

    expect(await screen.findByText('所有规则文件都是空的')).toBeInTheDocument()
  })

  it('shows a dedicated empty state when no rule is effective', async () => {
    mockFetch({
      files: [{ name: '默认规则', enabled: true, ruleCount: 1 }],
      mergedRules: [],
      conflicts: [],
      perFileRules: [
        {
          name: '默认规则',
          enabled: true,
          rules: [
            { pattern: 'a.com', target: '1.1.1.1:80', rawRule: 'a.com', rawTarget: '1.1.1.1:80', exclusions: [], enabled: false },
          ],
        },
      ],
    })
    renderPanel()

    expect(await screen.findByText('没有生效中的规则')).toBeInTheDocument()
  })

  it('refreshes data when the refresh button is clicked', async () => {
    const user = userEvent.setup()
    const fetchMock = mockFetch()
    renderPanel()

    await screen.findAllByText('example.com')
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: '刷新总览' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
  })
})
