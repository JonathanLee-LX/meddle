import { render, screen } from '@testing-library/react'
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
    expect(actions).toHaveClass('flex-wrap')
    expect(screen.getByRole('heading', { level: 2 })).toHaveClass('flex-wrap')

    for (const name of ['重放', '查看规则', '创建 Mock']) {
      expect(screen.getByRole('button', { name })).toBeEnabled()
    }
  })
})
