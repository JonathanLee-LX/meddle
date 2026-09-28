import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { TrafficHitBadge } from './traffic-hit-badge'

describe('TrafficHitBadge', () => {
  it('renders a clear Mock badge', () => {
    render(
      <TrafficHitBadge
        record={{ mock: true, source: 'https://a.example/x', target: 'https://a.example/x' }}
      />,
    )
    const badge = screen.getByRole('status')
    expect(badge).toHaveAttribute('data-hit-kind', 'mock')
    expect(badge).toHaveAttribute('data-slot', 'traffic-hit-badge')
    expect(badge).toHaveTextContent('Mock')
    expect(badge.className).toMatch(/bg-muted/)
    expect(badge.className).not.toMatch(/border-dashed/)
  })

  it('renders a clear Rule badge', () => {
    render(
      <TrafficHitBadge
        record={{ source: 'https://api.example/cart', target: 'https://staging.example/cart' }}
      />,
    )
    const badge = screen.getByRole('status')
    expect(badge).toHaveAttribute('data-hit-kind', 'rule')
    expect(badge).toHaveTextContent('Rule')
    expect(badge.className).toMatch(/bg-muted/)
    expect(badge.className).not.toMatch(/border-dashed/)
  })

  it('renders muted dashed pass placeholder (not noisy)', () => {
    render(
      <TrafficHitBadge
        record={{ source: 'https://cdn.example/a.js', target: 'https://cdn.example/a.js' }}
      />,
    )
    const badge = screen.getByRole('status')
    expect(badge).toHaveAttribute('data-hit-kind', 'pass')
    expect(badge).toHaveTextContent('—')
    expect(badge.className).toMatch(/border-dashed/)
    expect(badge.className).toMatch(/text-muted-foreground/)
  })
})
