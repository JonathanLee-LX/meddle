import type { ComponentProps, ReactNode } from 'react'
import { Save } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SaveButton } from '@/components/save-shortcut/save-button'

/**
 * Issue #111: one shell for the rules / Mock / plugin split panes. Every list
 * header and editor title bar uses the same height, padding and title type;
 * titles are sentence case (no `uppercase`), user names shown verbatim.
 */
export function PaneBar({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="pane-bar"
      className={cn(
        'app-pane-bar relative z-10 flex min-h-[50px] shrink-0 items-center justify-between gap-2 border-b bg-card',
        className,
      )}
      {...props}
    />
  )
}

/** Pane heading. An h2 for the document outline; browser heading defaults are reset. */
export function PaneTitle({ className, ...props }: ComponentProps<'h2'>) {
  return <h2 data-slot="pane-title" className={cn('m-0 min-w-0 truncate text-xs font-medium text-muted-foreground', className)} {...props} />
}

/**
 * Editor title bar: opaque, 1px bottom border; once the form scrolls past 4px
 * a light shadow (light mode) or a darker border (dark mode) lifts it.
 * 150ms transition, instant with prefers-reduced-motion.
 */
export function EditorTitleBar({
  title,
  actions,
  scrolled = false,
  className,
  ...props
}: Omit<ComponentProps<'div'>, 'title'> & { title: ReactNode; actions?: ReactNode; scrolled?: boolean }) {
  return (
    <PaneBar
      data-slot="editor-title-bar"
      data-scrolled={scrolled ? 'true' : 'false'}
      className={cn(
        'flex-wrap gap-x-3 gap-y-2 transition-[box-shadow,border-color] duration-150 ease-out motion-reduce:transition-none',
        'data-[scrolled=true]:shadow-[0_1px_3px_rgb(0_0_0/0.06)] dark:data-[scrolled=true]:border-black dark:data-[scrolled=true]:shadow-none',
        className,
      )}
      {...props}
    >
      <PaneTitle>{title}</PaneTitle>
      <div className="ml-auto flex min-w-0 max-w-full flex-wrap items-center justify-end gap-2">{actions}</div>
    </PaneBar>
  )
}

/**
 * Issue #111: the one primary action of an editor. Always the solid primary
 * button; while saving it reads 「保存中…」 (no spinner over the form).
 * Issue #138: other verbs reuse it via `label` / `savingLabel` (e.g. 「应用」/「应用中…」);
 * its width is the same in both states (see the sizing copy below).
 */
export function EditorSaveButton({
  saving = false,
  label = '保存',
  savingLabel = '保存中…',
  disabled,
  ...props
}: Omit<ComponentProps<typeof SaveButton>, 'variant' | 'children'> & { saving?: boolean; label?: string; savingLabel?: string }) {
  return (
    <SaveButton size="sm" {...props} disabled={disabled || saving} aria-busy={saving || undefined} data-slot="editor-save">
      <Save data-icon="inline-start" />
      {/* #138: the visible label and an invisible, aria-hidden copy of the other
          label share one grid cell, so the button is always as wide as the wider
          label and pressing it never shifts neighbouring fields. No min-width. */}
      <span data-slot="editor-save-label" className="inline-grid">
        <span className="[grid-area:1/1]">{saving ? savingLabel : label}</span>
        <span data-slot="editor-save-sizer" aria-hidden="true" className="invisible [grid-area:1/1]">
          {saving ? label : savingLabel}
        </span>
      </span>
    </SaveButton>
  )
}

/** Idle editor placeholder shared by the three split pages (issue #111). */
export function EditorEmptyState({ title, hint, className, ...props }: Omit<ComponentProps<'div'>, 'title'> & { title: ReactNode; hint?: ReactNode }) {
  return (
    <div
      data-slot="editor-empty-state"
      className={cn('flex h-full min-h-[240px] flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground', className)}
      {...props}
    >
      <p>{title}</p>
      {hint ? <p className="text-xs">{hint}</p> : null}
    </div>
  )
}
