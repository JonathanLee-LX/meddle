import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { DetailPanel } from './detail-panel'
import type { ProxyRecord, RecordDetail } from '@/types'

describe('DetailPanel embedded mode (layout B / #92)', () => {
  it('renders outside Sheet/Dialog without crashing or mounting SheetTitle', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    const record: ProxyRecord = {
      id: 1,
      method: 'GET',
      source: 'https://example.com/api',
      target: 'https://example.com/api',
      time: '12:00:00',
      statusCode: 200,
    }
    const detail: RecordDetail = {
      requestHeaders: { accept: 'application/json' },
      requestBody: '',
      responseHeaders: { 'content-type': 'application/json' },
      responseBody: '{"ok":true}',
      statusCode: 200,
      statusMessage: 'OK',
    }

    const { container } = render(
      <DetailPanel
        embedded
        detail={detail}
        loading={false}
        selectedRecord={record}
      />,
    )

    expect(screen.getByTestId('detail-panel-header')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: /请求详情/ })).toBeInTheDocument()
    expect(screen.getByTestId('detail-tab-overview')).toBeInTheDocument()

    // SheetTitle / SheetHeader must never mount in embedded mode (DialogTitle requires Dialog).
    expect(container.querySelector('[data-slot="sheet-title"]')).toBeNull()
    expect(container.querySelector('[data-slot="sheet-header"]')).toBeNull()
    expect(container.querySelector('[data-slot="sheet-content"]')).toBeNull()
    expect(container.querySelector('[data-slot="sheet-description"]')).toBeNull()

    const dialogTitleErrors = consoleError.mock.calls.filter((args) =>
      args.some((arg) => String(arg).includes('DialogTitle must be used within')),
    )
    expect(dialogTitleErrors).toHaveLength(0)

    consoleError.mockRestore()
  })

  it('renders empty embedded state without Sheet primitives', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { container } = render(
      <DetailPanel embedded detail={null} loading={false} />,
    )

    expect(screen.getByTestId('detail-empty-state')).toBeInTheDocument()
    expect(screen.getByTestId('detail-panel-header')).toBeInTheDocument()
    expect(container.querySelector('[data-slot="sheet-title"]')).toBeNull()

    const dialogTitleErrors = consoleError.mock.calls.filter((args) =>
      args.some((arg) => String(arg).includes('DialogTitle must be used within')),
    )
    expect(dialogTitleErrors).toHaveLength(0)

    consoleError.mockRestore()
  })

  it('keeps the title on one line and wraps the action buttons', () => {
    const record: ProxyRecord = {
      id: 7,
      method: 'POST',
      source: 'https://api.example.com/v1/orders',
      target: 'https://upstream.example.com/v1/orders',
      time: '12:00:00',
      statusCode: 201,
      clientType: 'remote',
      clientName: 'iPhone',
      clientIp: '10.0.0.8',
      applicationName: 'Mobile Safari',
    }
    const detail: RecordDetail = {
      requestHeaders: {},
      requestBody: '',
      responseHeaders: {},
      responseBody: '',
      statusCode: 201,
      statusMessage: 'Created',
    }

    render(
      <DetailPanel
        embedded
        detail={detail}
        loading={false}
        selectedRecord={record}
        onReplay={async () => undefined}
        onCreateMock={() => undefined}
        onJumpToRule={() => undefined}
      />,
    )

    const title = screen.getByTestId('detail-panel-title')
    expect(title).toHaveTextContent('请求详情')
    expect(title).toHaveClass('shrink-0', 'whitespace-nowrap')
    expect(screen.getByRole('heading', { level: 2, name: /请求详情/ })).toContainElement(title)

    const actions = screen.getByTestId('detail-panel-actions')
    expect(actions).toHaveClass('flex-nowrap')
    expect(screen.getByRole('heading', { level: 2 })).toHaveClass('flex-nowrap')

    for (const name of ['重放', '查看规则', '创建 Mock']) {
      expect(screen.getByRole('button', { name })).toBeEnabled()
    }
  })

  it('drops the inner title inside the global panel and keeps actions on a wrapping bar', () => {
    const record: ProxyRecord = {
      id: 7,
      method: 'POST',
      source: 'https://api.example.com/v1/orders',
      target: 'https://upstream.example.com/v1/orders',
      time: '12:00:00',
      statusCode: 201,
      clientType: 'remote',
      clientName: 'iPhone',
      clientIp: '10.0.0.8',
      applicationName: 'Mobile Safari',
    }
    const detail: RecordDetail = {
      requestHeaders: {},
      requestBody: '',
      responseHeaders: {},
      responseBody: '',
      statusCode: 201,
      statusMessage: 'Created',
    }

    render(
      <DetailPanel
        embedded
        showTitle={false}
        detail={detail}
        loading={false}
        selectedRecord={record}
        onReplay={async () => undefined}
        onCreateMock={() => undefined}
        onJumpToRule={() => undefined}
      />,
    )

    expect(screen.queryByTestId('detail-panel-title')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 2, name: /请求详情/ })).not.toBeInTheDocument()
    expect(screen.getByTestId('detail-panel-header')).not.toHaveTextContent('请求详情')

    const actions = screen.getByTestId('detail-panel-actions')
    expect(actions).toHaveClass('flex-wrap')
    expect(screen.getByTestId('detail-panel-header')).not.toContainElement(actions)
    for (const name of ['重放', '查看规则', '创建 Mock']) {
      expect(screen.getByRole('button', { name })).toBeEnabled()
    }
  })

  it('shows the upstream error reason on the overview tab', () => {
    const record: ProxyRecord = {
      id: 9,
      method: 'GET',
      source: 'http://127.0.0.1:1/',
      target: 'http://127.0.0.1:1/',
      time: '12:00:00',
      statusCode: 502,
      duration: 12,
    }
    const detail: RecordDetail = {
      requestHeaders: {},
      requestBody: '',
      responseHeaders: {},
      responseBody: 'ECONNREFUSED: connect ECONNREFUSED 127.0.0.1:1',
      statusCode: 502,
      statusMessage: 'Bad Gateway',
      error: 'ECONNREFUSED: connect ECONNREFUSED 127.0.0.1:1',
    }

    render(
      <DetailPanel
        embedded
        detail={detail}
        loading={false}
        selectedRecord={record}
      />,
    )

    expect(screen.getByTestId('detail-upstream-error')).toHaveTextContent('ECONNREFUSED')
    expect(screen.getByText(/出错原因/)).toBeInTheDocument()
  })

  it('keeps replay and view-rule as named icon buttons and the hit note in a hint', async () => {
    const user = userEvent.setup()
    const record: ProxyRecord = {
      id: 7,
      method: 'GET',
      source: 'http://api.example.com/foo',
      target: 'http://127.0.0.1:3000/foo',
      time: '12:00:00',
      statusCode: 200,
    }
    const detail: RecordDetail = {
      requestHeaders: { host: 'api.example.com' },
      requestBody: '',
      responseHeaders: {},
      responseBody: '',
      statusCode: 200,
      statusMessage: 'OK',
    }
    const help = '源地址与目标地址不同，请求路径被规则改写后转发。'

    render(
      <DetailPanel
        embedded
        detail={detail}
        loading={false}
        selectedRecord={record}
        onReplay={async () => undefined}
        onCreateMock={() => undefined}
        onJumpToRule={() => undefined}
      />,
    )

    const replay = screen.getByRole('button', { name: '重放' })
    const viewRule = screen.getByRole('button', { name: '查看规则' })
    const createMock = screen.getByRole('button', { name: '创建 Mock' })
    expect(replay).not.toHaveTextContent('重放')
    expect(viewRule).not.toHaveTextContent('查看规则')
    expect(createMock).toHaveTextContent('创建 Mock')
    expect(screen.queryByText(help)).not.toBeInTheDocument()
    expect(screen.getByText('命中 Rule · 转发改写')).toBeInTheDocument()

    await user.hover(replay)
    expect(await screen.findByRole('tooltip', { name: '重放' })).toBeInTheDocument()

    const hint = screen.getByRole('button', { name: '命中说明' })
    act(() => hint.focus())
    expect(await screen.findByRole('tooltip', { name: help })).toHaveTextContent(help)
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('tooltip', { name: help })).not.toBeInTheDocument())
  })
})
