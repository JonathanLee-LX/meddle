import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { LogTable } from './log-table'

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: () => ({
    getVirtualItems: () => [{ index: 0, key: 0, size: 36, start: 0 }],
    getTotalSize: () => 36,
    scrollToOffset: vi.fn(),
  }),
}))

describe('LogTable application source', () => {
  it('shows the application name and process metadata', () => {
    render(
      <LogTable
        records={[{
          id: 1,
          method: 'GET',
          source: 'https://example.com',
          target: 'https://example.com',
          time: '10:00:00',
          clientType: 'local',
          clientName: '本机',
          applicationName: 'Google Chrome',
          applicationProcess: 'Google Chrome Helper',
          applicationPid: 2642,
          applicationBundleId: 'com.google.Chrome',
          applicationIdentitySource: 'local-process',
          applicationIdentityConfidence: 'high',
        }]}
        selectedRecordId={null}
        onSelect={vi.fn()}
        autoScroll={false}
      />,
    )

    expect(screen.getByText('应用')).toBeInTheDocument()
    expect(screen.getByText('Google Chrome').closest('[title]')).toHaveAttribute(
      'title',
      expect.stringContaining('Google Chrome Helper'),
    )
    expect(document.querySelector('[data-application-icon="chrome"]')).toBeInTheDocument()
    expect(screen.queryByText('推断')).not.toBeInTheDocument()
  })

  it('marks remote User-Agent identities as inferred', () => {
    render(
      <LogTable
        records={[{
          id: 2,
          method: 'GET',
          source: 'https://example.com',
          target: 'https://example.com',
          time: '10:00:01',
          clientType: 'remote',
          clientName: 'iPhone',
          applicationName: 'Safari',
          applicationIdentitySource: 'user-agent',
          applicationIdentityConfidence: 'medium',
        }]}
        selectedRecordId={null}
        onSelect={vi.fn()}
        autoScroll={false}
      />,
    )

    expect(screen.getByText('Safari')).toBeInTheDocument()
    expect(screen.getByText('推断')).toBeInTheDocument()
    expect(screen.getByText('Safari').closest('[title]')).toHaveAttribute(
      'title',
      expect.stringContaining('User-Agent 推断'),
    )
    expect(document.querySelector('[data-application-icon="safari"]')).toBeInTheDocument()
  })
})
