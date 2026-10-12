import { Fragment } from 'react'
import { TriangleAlert } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Render a filesystem path with a <wbr> after every "/" so long paths break at
 * segment boundaries. textContent stays the exact path (screen readers / copy).
 * `wrap-anywhere` on the container is only a fallback for very long segments.
 */
export function BreakablePath({ path }: { path: string }) {
  const parts = path.split('/')
  return (
    <>
      {parts.map((part, index) => (
        <Fragment key={index}>
          {part}
          {index < parts.length - 1 ? (
            <>
              /
              <wbr />
            </>
          ) : null}
        </Fragment>
      ))}
    </>
  )
}

/**
 * Missing custom mocks file — Mock list empty state (issue #118).
 * One centered block (max 360px): icon + 「文件不存在」, the full path alone in
 * monospace, 「保存第一条规则时会创建」, then (8px gap) the regular empty-state text.
 * Muted text + TriangleAlert, same treatment as the plugin "文件已删除" label (#113).
 */
export function MocksFileMissingEmptyState({ path, children }: { path: string; children?: React.ReactNode }) {
  return (
    <div className="mx-auto flex max-w-[360px] flex-col items-center text-center text-muted-foreground">
      <div data-testid="mock-config-file-missing" role="status" className="flex flex-col items-center gap-0.5 text-xs">
        <span className="inline-flex items-center gap-1">
          <TriangleAlert aria-hidden="true" className="size-3.5 shrink-0" />
          文件不存在
        </span>
        <span data-testid="mock-config-file-missing-path" className="font-mono wrap-anywhere">
          <BreakablePath path={path} />
        </span>
        <span>保存第一条规则时会创建</span>
      </div>
      {children ? <div className="mt-2">{children}</div> : null}
    </div>
  )
}

/** Missing custom mocks file — inline note under the settings input (no path; it is in the input). */
export function MocksFileMissingNote({ className, testId = 'mocks-file-missing-note' }: {
  className?: string
  testId?: string
}) {
  return (
    <p
      data-testid={testId}
      role="status"
      className={cn('flex items-start gap-1 text-xs text-muted-foreground', className)}
    >
      <TriangleAlert aria-hidden="true" className="mt-px size-3.5 shrink-0" />
      <span className="min-w-0">文件不存在，保存第一条规则时会创建</span>
    </p>
  )
}
