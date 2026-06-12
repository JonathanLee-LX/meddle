import { describe, expect, it } from 'vitest'

import { buttonVariants } from './button'

describe('buttonVariants', () => {
  it('keeps regular buttons neutral until hover', () => {
    const classes = buttonVariants({ variant: 'default' })

    expect(classes).toContain('bg-foreground')
    expect(classes).toContain('hover:bg-primary')
    expect(classes).not.toContain('bg-primary text-primary-foreground')
  })

  it('uses the accent persistently for selected controls', () => {
    const classes = buttonVariants({ variant: 'selected' })

    expect(classes).toContain('bg-primary')
    expect(classes).toContain('text-primary-foreground')
  })

  it.each(['outline', 'secondary', 'ghost'] as const)('uses the accent when %s buttons are hovered', (variant) => {
    const classes = buttonVariants({ variant })

    expect(classes).toContain('hover:bg-accent')
    expect(classes).toContain('hover:text-accent-foreground')
  })

  it('uses the accent text color when link buttons are hovered', () => {
    expect(buttonVariants({ variant: 'link' })).toContain('hover:text-primary')
  })
})
