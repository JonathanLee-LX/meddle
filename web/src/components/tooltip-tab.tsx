import { useState, type ComponentProps, type ReactNode } from 'react'
import { TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

type TooltipSide = ComponentProps<typeof TooltipContent>['side']

/**
 * Tab whose accessible name is `label`.
 * Pass `showTooltip` when that name is not already visible (icon-only tabs).
 * The tooltip repeats the name, so it is not announced twice.
 */
export function TooltipTab({
  label,
  side = 'right',
  showTooltip = true,
  children,
  ...props
}: ComponentProps<typeof TabsTrigger> & {
  label: string
  side?: TooltipSide
  showTooltip?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)

  return (
    <Tooltip open={showTooltip && open} onOpenChange={(next) => { if (showTooltip) setOpen(next) }}>
      <TabsTrigger {...props} asChild aria-label={label}>
        <TooltipTrigger describe={false}>{children}</TooltipTrigger>
      </TabsTrigger>
      <TooltipContent side={side} sideOffset={8}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}
