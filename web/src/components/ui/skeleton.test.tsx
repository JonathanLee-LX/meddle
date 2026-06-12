import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Skeleton } from './skeleton'

describe('Skeleton', () => {
  it('uses the neutral muted color instead of the application accent', () => {
    render(<Skeleton data-testid="skeleton" />)

    const skeleton = screen.getByTestId('skeleton')
    expect(skeleton).toHaveClass('bg-muted')
    expect(skeleton).not.toHaveClass('bg-accent')
  })
})
