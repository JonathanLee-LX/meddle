import { useRef, useState, type ReactNode } from 'react'
import { CircleHelp } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

type Side = 'top' | 'right' | 'bottom' | 'left'

/**
 * "?" control for a long explanation.
 * Hover and keyboard focus show it. A touch tap toggles it, because a
 * touch pointer never hovers. Escape, blur, and pointer leave close it.
 * The accessible name stays short; the explanation is the description
 * while the hint is open.
 */
export function HelpHint({
  label,
  children,
  side = 'bottom',
  className,
}: {
  label: string
  children: ReactNode
  side?: Side
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const touchToggle = useRef(false)

  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger
        type="button"
        aria-label={label}
        aria-expanded={open}
        data-slot="help-hint"
        className={cn(
          'inline-flex size-6 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
          className,
        )}
        onPointerDown={(event) => {
          if (event.pointerType !== 'touch') return
          // No hover on touch. Toggle, and cancel the click so Radix does not
          // close the hint on the same tap that opened it.
          event.preventDefault()
          touchToggle.current = true
          setOpen((value) => !value)
        }}
        onClick={(event) => {
          if (touchToggle.current) {
            event.preventDefault()
            touchToggle.current = false
            return
          }
          // Focus and hover already show the hint. A click from the keyboard
          // or mouse should not dismiss it; Escape, blur, and pointer leave do.
          event.preventDefault()
        }}
      >
        <CircleHelp aria-hidden="true" className="size-4" />
      </TooltipTrigger>
      <TooltipContent side={side} sideOffset={6} className="max-w-64 text-pretty text-left">
        {children}
      </TooltipContent>
    </Tooltip>
  )
}
