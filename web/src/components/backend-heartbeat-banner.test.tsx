import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { BackendHeartbeatBanner } from './backend-heartbeat-banner'

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

  it('shows the Chinese reachability banner when unreachable', () => {
    mockedUse.mockReturnValue({ unreachable: true, consecutiveFailures: 3 })
    render(<BackendHeartbeatBanner />)
    const banner = screen.getByTestId('backend-heartbeat-banner')
    expect(banner).toHaveTextContent('后端连不上')
    expect(banner).toHaveAttribute('role', 'status')
  })
})
