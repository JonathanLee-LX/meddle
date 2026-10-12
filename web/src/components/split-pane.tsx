import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { useResizablePane } from '@/hooks/use-resizable-pane'
import type { PaneSplit } from '@/lib/pane-split'

interface SplitPaneProps {
  testId: string
  layout: string
  /** Suffix for the width attribute, e.g. "rule-list-width" → data-rule-list-width. */
  widthAttr: string
  split: PaneSplit
  listTestId: string
  listSlot?: string
  panelTestId: string
  panelSlot?: string
  separatorTestId: string
  separatorLabel: string
  list: ReactNode
  children: ReactNode
}

/**
 * List | editor split used by the rules, mock, and plugin pages.
 * >= 768px (md): fixed pixel list with a draggable separator, side by side even
 * when the shell sidebar is collapsed on a narrow window (#109). < 768px: list
 * stacks above the editor.
 */
export function SplitPane({
  testId,
  layout,
  widthAttr,
  split,
  listTestId,
  listSlot,
  panelTestId,
  panelSlot,
  separatorTestId,
  separatorLabel,
  list,
  children,
}: SplitPaneProps) {
  const { layoutRef, paneWidth, resizing, isWide, onResizeStart } = useResizablePane({
    load: split.load,
    save: split.save,
    clamp: split.clamp,
    widthFromPointer: split.widthFromPointer,
  })

  return (
    <div
      ref={layoutRef}
      className="app-page-stack flex min-h-0 flex-1 flex-col gap-0 overflow-hidden md:flex-row"
      data-testid={testId}
      data-layout={layout}
      {...{ [`data-${widthAttr}`]: paneWidth }}
    >
      <aside
        data-testid={listTestId}
        data-slot={listSlot}
        className="flex max-h-[46%] min-h-0 w-full shrink-0 flex-col md:max-h-none"
        style={isWide ? { width: paneWidth, flex: `0 0 ${paneWidth}px` } : undefined}
      >
        {list}
      </aside>

      <div
        role="separator"
        aria-orientation="horizontal"
        className="relative h-px w-full shrink-0 bg-border md:hidden"
      />
      <div
        role="separator"
        aria-orientation="vertical"
        aria-valuenow={paneWidth}
        aria-valuemin={split.minPx}
        aria-valuemax={split.maxPx}
        aria-label={separatorLabel}
        data-testid={separatorTestId}
        data-resizing={resizing ? 'true' : 'false'}
        className="group relative z-10 hidden w-px shrink-0 cursor-col-resize self-stretch md:block"
        onMouseDown={onResizeStart}
      >
        <div
          aria-hidden
          className={cn(
            'pointer-events-none absolute inset-0 bg-border transition-colors',
            resizing ? 'bg-primary' : 'group-hover:bg-transparent',
          )}
        />
        <div
          aria-hidden
          className={cn(
            'pointer-events-none absolute inset-y-0 left-1/2 w-1 -translate-x-1/2 opacity-0 transition-opacity',
            resizing ? 'bg-primary opacity-100' : 'bg-primary/60 group-hover:opacity-100',
          )}
        />
        <div className="absolute inset-y-0 -left-1.5 -right-1.5" />
      </div>

      <div
        data-testid={panelTestId}
        data-slot={panelSlot}
        className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-card"
      >
        {children}
      </div>
    </div>
  )
}
