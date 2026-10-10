import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  BACKEND_HEARTBEAT_BANNER_TEXT,
  BackendHeartbeatBanner,
} from './backend-heartbeat-banner'

vi.mock('@/hooks/use-backend-heartbeat', () => ({
  useBackendHeartbeat: vi.fn(),
}))

import { useBackendHeartbeat } from '@/hooks/use-backend-heartbeat'

const mockedUse = vi.mocked(useBackendHeartbeat)

describe('BackendHeartbeatBanner', () => {
  it('renders nothing while reachable', () => {
    mockedUse.mockReturnValue({ unreachable: false, consecutiveFailures: 0 })
    const { container } = render(<BackendHeartbeatBanner />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the single-line reachability copy when unreachable', () => {
    mockedUse.mockReturnValue({ unreachable: true, consecutiveFailures: 3 })
    render(<BackendHeartbeatBanner />)
    const banner = screen.getByTestId('backend-heartbeat-banner')
    expect(banner.textContent).toBe(BACKEND_HEARTBEAT_BANNER_TEXT)
    expect(BACKEND_HEARTBEAT_BANNER_TEXT).toBe(
      '连不上 Meddle 服务，正在重试。请确认 meddle 仍在运行',
    )
    expect(banner).not.toHaveTextContent('后端连不上')
    expect(banner).not.toHaveTextContent('页面壳')
    expect(banner.querySelectorAll('p')).toHaveLength(1)
    expect(banner.querySelector('p')?.className ?? '').not.toMatch(/font-medium|font-semibold|font-bold/)
    expect(banner).toHaveAttribute('role', 'status')
  })
})
