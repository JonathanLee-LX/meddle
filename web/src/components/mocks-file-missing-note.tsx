import { TriangleAlert } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Inline note for a configured mocks file that does not exist yet (issue #118).
 * Same muted text + TriangleAlert treatment as the plugin "文件已删除" label (#113);
 * the path is monospace and breaks anywhere so long paths wrap instead of overflowing.
 */
export function MocksFileMissingNote({ path, className, testId = 'mocks-file-missing-note' }: {
  path: string
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
      <span className="min-w-0">
        文件不存在：<span className="font-mono break-all">{path}</span>，保存第一条规则时会创建
      </span>
    </p>
  )
}
