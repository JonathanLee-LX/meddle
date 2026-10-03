import type { ReactNode } from 'react'
import { SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'

/**
 * Sheet titles throw outside a Dialog. The in-page editor uses a plain heading;
 * the global panel keeps the dialog title.
 */
export function PanelHeading({
  plain = false,
  className,
  title,
  description,
}: {
  plain?: boolean
  className?: string
  title: ReactNode
  description?: ReactNode
}) {
  if (plain) {
    return (
      <div className={className}>
        <h2 className="flex items-center gap-2 text-base font-semibold leading-none">{title}</h2>
        {description ? <p className="mt-1.5 text-sm text-muted-foreground">{description}</p> : null}
      </div>
    )
  }

  return (
    <SheetHeader className={className}>
      <SheetTitle className="flex items-center gap-2">{title}</SheetTitle>
      {description ? <SheetDescription>{description}</SheetDescription> : null}
    </SheetHeader>
  )
}
