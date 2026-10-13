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

/**
 * Unparseable mocks file — Mock list error state (issue #120). Same centered
 * 360px block as the missing-file state: destructive icon + 「文件格式错误」,
 * the full path in monospace, then the parse location in muted monospace.
 * Replaces the 「暂无 Mock 规则」 text: the list is not empty, it is unreadable.
 */
export function MocksFileInvalidEmptyState({ path, location }: { path: string; location: string }) {
  return (
    <div className="mx-auto flex max-w-[360px] flex-col items-center text-center">
      <div data-testid="mock-config-file-invalid" role="alert" className="flex flex-col items-center gap-0.5 text-xs">
        <span className="inline-flex items-center gap-1 text-destructive">
          <TriangleAlert aria-hidden="true" className="size-3.5 shrink-0" />
          文件格式错误
        </span>
        <span data-testid="mock-config-file-invalid-path" className="font-mono wrap-anywhere text-foreground">
          <BreakablePath path={path} />
        </span>
        <span data-testid="mock-config-file-invalid-location" className="font-mono wrap-anywhere text-muted-foreground">
          {location}
        </span>
      </div>
    </div>
  )
}

/** Unparseable mocks file — inline note under the settings input (no path; it is in the input). */
export function MocksFileInvalidNote({ location, className, testId = 'mocks-file-invalid-note' }: {
  location: string
  className?: string
  testId?: string
}) {
  return (
    <p
      data-testid={testId}
      role="alert"
      className={cn('flex items-start gap-1 text-xs text-destructive', className)}
    >
      <TriangleAlert aria-hidden="true" className="mt-px size-3.5 shrink-0" />
      <span className="min-w-0">文件格式错误，修复前不会写入：<span className="font-mono">{location}</span></span>
    </p>
  )
}

/**
 * Issue #121 migration notice (below the settings path input, above the help
 * text). Relative paths used to resolve against the proxy's start directory;
 * shows both absolute paths. 「改用此路径」 only fills the input — the user
 * still has to click 「应用」. Collapses (≤150ms) once the input is no longer a
 * relative path.
 */
export function MocksFileLegacyPathNote({ oldPath, newPath, visible, onUseOldPath }: {
  oldPath: string
  newPath: string
  visible: boolean
  onUseOldPath: () => void
}) {
  return (
    <div
      data-testid="settings-mocks-file-legacy-wrap"
      data-visible={visible ? 'true' : 'false'}
      aria-hidden={!visible}
      className={cn(
        // The parent's flex gap is pulled into the collapsing wrapper (negative
        // margin + matching padding inside), so a collapsed notice leaves no gap.
        '-mt-[var(--ui-field-gap)] grid transition-[grid-template-rows,opacity] duration-150 ease-out motion-reduce:transition-none',
        visible ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
      )}
    >
      {/* Content stays mounted so the collapse animates instead of jumping. */}
      <div className="min-h-0 overflow-hidden" inert={!visible || undefined}>
        <div data-testid="settings-mocks-file-legacy-gap" className="pt-[var(--ui-field-gap)]">
          <div
            data-testid="settings-mocks-file-legacy"
            role={visible ? 'status' : undefined}
            className="flex items-start gap-1.5 border-l-2 border-amber-500 py-0.5 pl-2 text-xs dark:border-amber-400"
          >
            <TriangleAlert aria-hidden="true" className="mt-px size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
            <div className="min-w-0 space-y-1">
              <p className="text-foreground">相对路径的解析规则已变更，当前可能读不到原来的 Mock 文件</p>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span data-testid="settings-mocks-file-legacy-old" className="min-w-0 font-mono wrap-anywhere text-muted-foreground">
                  原来读取：<BreakablePath path={oldPath} />
                </span>
                <button
                  type="button"
                  data-testid="settings-mocks-file-legacy-use"
                  onClick={onUseOldPath}
                  className="shrink-0 rounded-sm text-foreground underline underline-offset-2 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  改用此路径
                </button>
              </div>
              <p data-testid="settings-mocks-file-legacy-new" className="font-mono wrap-anywhere text-muted-foreground">
                现在读取：<BreakablePath path={newPath} />（文件不存在）
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
