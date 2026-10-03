import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

type EditorPaneActionsContextValue = {
  host: HTMLElement | null
  registerDismiss?: (dismiss: (() => void) | null) => void
}

const EditorPaneActionsContext = createContext<EditorPaneActionsContextValue | null>(null)

/**
 * Page editors render their actions into the pane title bar.
 * Sheets omit the provider and keep the actions in the footer.
 */
export function EditorPaneActionsProvider({
  host,
  registerDismiss,
  children,
}: {
  host: HTMLElement | null
  registerDismiss?: (dismiss: (() => void) | null) => void
  children: ReactNode
}) {
  return (
    <EditorPaneActionsContext.Provider value={{ host, registerDismiss }}>
      {children}
    </EditorPaneActionsContext.Provider>
  )
}

export function useInEditorPane() {
  return useContext(EditorPaneActionsContext) !== null
}

/** Lets the pane「取消」run the editor's own close handler, including unsaved checks. */
export function useEditorPaneDismiss(dismiss: () => void) {
  const registerDismiss = useContext(EditorPaneActionsContext)?.registerDismiss
  const dismissRef = useRef(dismiss)
  dismissRef.current = dismiss

  useEffect(() => {
    if (!registerDismiss) return
    registerDismiss(() => dismissRef.current())
    return () => registerDismiss(null)
  }, [registerDismiss])
}

export function EditorPaneActions({
  children,
  className,
}: {
  children: ReactNode
  className: string
}) {
  const ctx = useContext(EditorPaneActionsContext)
  if (ctx) {
    if (!ctx.host) return null
    return createPortal(<>{children}</>, ctx.host)
  }

  return <div className={className}>{children}</div>
}
