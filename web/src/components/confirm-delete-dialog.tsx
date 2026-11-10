import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { XIcon } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { buttonVariants } from '@/components/ui/button'

export interface ConfirmDeleteDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  /** Visible label of the confirming button. Destructive actions use 删除 or 清空. */
  confirmLabel: '删除' | '清空'
  onConfirm: () => void | Promise<void>
}

function confirmErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message
  if (typeof error === 'string' && error.trim()) return error
  return '操作失败'
}

/**
 * Modal confirm for a destructive UI action.
 * Close, 取消, and Escape do not call `onConfirm`.
 * A rejection leaves the dialog open and shows the error.
 */
export function ConfirmDeleteDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
}: ConfirmDeleteDialogProps) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pendingRef = useRef(false)
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (open) return
    pendingRef.current = false
    setPending(false)
    setError(null)
  }, [open])

  const requestClose = (next: boolean) => {
    if (!next && pendingRef.current) return
    onOpenChange(next)
  }

  const confirm = async (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    if (pendingRef.current) return
    pendingRef.current = true
    setPending(true)
    setError(null)
    try {
      await onConfirm()
      pendingRef.current = false
      setPending(false)
      onOpenChange(false)
    } catch (caught) {
      pendingRef.current = false
      setPending(false)
      setError(confirmErrorMessage(caught))
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={requestClose}>
      <AlertDialogContent
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          cancelRef.current?.focus()
        }}
        onEscapeKeyDown={(event) => {
          if (pendingRef.current) event.preventDefault()
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel ref={cancelRef} disabled={pending}>
            取消
          </AlertDialogCancel>
          <AlertDialogAction
            className={buttonVariants({ variant: 'destructive' })}
            disabled={pending}
            aria-busy={pending || undefined}
            onClick={(event) => {
              void confirm(event)
            }}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
        <AlertDialogCancel
          aria-label="关闭"
          disabled={pending}
          className="absolute top-4 right-4 size-8 rounded-xs border-0 bg-transparent p-0 opacity-70 shadow-none hover:bg-transparent hover:opacity-100"
        >
          <XIcon className="size-4" aria-hidden />
        </AlertDialogCancel>
      </AlertDialogContent>
    </AlertDialog>
  )
}
