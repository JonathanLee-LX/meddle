import type { ComponentProps } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { getSaveShortcutLabel } from './save-shortcut-label'

function SaveShortcutHint({ className }: { className?: string }) {
  return (
    <kbd
      aria-hidden="true"
      data-slot="save-shortcut"
      className={cn(
        'pointer-events-none ml-1 rounded border border-current/20 px-1 py-0.5 font-mono text-[10px] font-normal leading-none opacity-70',
        className,
      )}
    >
      {getSaveShortcutLabel()}
    </kbd>
  )
}

export function SaveButton({ children, ...props }: ComponentProps<typeof Button>) {
  return (
    <Button aria-keyshortcuts="Meta+S Control+S" {...props}>
      {children}
      <SaveShortcutHint />
    </Button>
  )
}
