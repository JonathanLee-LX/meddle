import type { ComponentProps, ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

type TooltipSide = ComponentProps<typeof TooltipContent>['side']

export interface IconButtonProps extends Omit<ComponentProps<typeof Button>, 'aria-label' | 'children'> {
  /** Accessible name. Also the tooltip unless `tooltip` is set. */
  label: string
  /** Hover and focus tooltip. Defaults to `label`. */
  tooltip?: string
  tooltipSide?: TooltipSide
  children: ReactNode
}

/**
 * Icon-only button. `label` is required and is the accessible name.
 * The same text (or `tooltip`) is shown on hover and keyboard focus.
 * When the tooltip repeats the name, it is not also announced as a description.
 */
export function IconButton({
  label,
  tooltip,
  tooltipSide = 'top',
  children,
  type = 'button',
  size = 'icon-sm',
  variant = 'outline',
  ...props
}: IconButtonProps) {
  const tip = tooltip ?? label
  return (
    <Tooltip>
      <TooltipTrigger asChild describe={tip !== label}>
        <Button type={type} size={size} variant={variant} aria-label={label} {...props}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side={tooltipSide}>{tip}</TooltipContent>
    </Tooltip>
  )
}
