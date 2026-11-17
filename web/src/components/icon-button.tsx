import { useRef, useState, type ComponentProps, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

type TooltipSide = ComponentProps<typeof TooltipContent>['side']

export interface IconButtonProps extends Omit<ComponentProps<typeof Button>, 'aria-label' | 'children'> {
  /** Accessible name. Also the tooltip unless `tooltip` is set. */
  label: string
  /** Hover and focus tooltip. Defaults to `label`. */
  tooltip?: string
  tooltipSide?: TooltipSide
  /**
   * Control the tooltip. Pass a boolean for the whole lifetime of the button
   * (for example `false` while its menu is open). Omit it to let hover and
   * focus open the tooltip.
   */
  tooltipOpen?: boolean
  onTooltipOpenChange?: (open: boolean) => void
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
  tooltipOpen,
  onTooltipOpenChange,
  children,
  type = 'button',
  size = 'icon-sm',
  variant = 'outline',
  ...props
}: IconButtonProps) {
  const tip = tooltip ?? label
  return (
    <Tooltip {...(tooltipOpen === undefined ? {} : { open: tooltipOpen, onOpenChange: onTooltipOpenChange })}>
      <TooltipTrigger asChild describe={tip !== label}>
        <Button type={type} size={size} variant={variant} aria-label={label} {...props}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side={tooltipSide}>{tip}</TooltipContent>
    </Tooltip>
  )
}

/**
 * Tooltip state for an icon button that opens a menu.
 * The tip stays closed while the menu is open, and the focus Radix restores
 * to the trigger on close does not reopen it (that tip would sit above a
 * confirm dialog). A later hover or a fresh focus still opens it.
 */
export function useMenuTriggerTooltip() {
  const menuOpenRef = useRef(false)
  const suppressTipRef = useRef(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [tipOpen, setTipOpen] = useState(false)

  const onMenuOpenChange = (next: boolean) => {
    menuOpenRef.current = next
    setMenuOpen(next)
    if (!next) {
      suppressTipRef.current = true
      setTipOpen(false)
    }
  }

  const onTooltipOpenChange = (next: boolean) => {
    if (menuOpenRef.current || (next && suppressTipRef.current)) {
      if (next) suppressTipRef.current = false
      setTipOpen(false)
      return
    }
    setTipOpen(next)
  }

  return {
    menuOpen,
    tooltipOpen: menuOpen ? false : tipOpen,
    onMenuOpenChange,
    onTooltipOpenChange,
  }
}
