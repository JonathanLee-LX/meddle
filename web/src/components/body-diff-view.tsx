import { useMemo } from 'react'
import { diffLines, type Change } from 'diff'

export type DiffViewMode = 'inline' | 'split'

interface BodyDiffViewProps {
  original: string
  modified: string
  className?: string
  maxHeight?: string
  mode?: DiffViewMode
}

interface SplitDiffRow {
  status: 'unchanged' | 'changed' | 'added' | 'removed'
  original: string
  modified: string
}

function getSplitCellClassName(status: SplitDiffRow['status'], column: 'original' | 'modified'): string {
  const base = 'rounded-md border px-2 py-1.5'
  if (status === 'unchanged') return `${base} border-transparent`
  if (status === 'changed') return `${base} border-orange-300 bg-orange-500/10`
  if (status === 'added') return column === 'modified'
    ? `${base} border-green-300 bg-green-500/10`
    : `${base} border-transparent opacity-50`
  if (status === 'removed') return column === 'original'
    ? `${base} border-red-300 bg-red-500/10`
    : `${base} border-transparent opacity-50`
  return base
}

function buildSplitRows(changes: Change[]): SplitDiffRow[] {
  const rows: SplitDiffRow[] = []

  for (let index = 0; index < changes.length; index += 1) {
    const current = changes[index]
    const next = changes[index + 1]

    if (current.removed && next?.added) {
      rows.push({
        status: 'changed',
        original: current.value,
        modified: next.value,
      })
      index += 1
      continue
    }

    if (current.added && next?.removed) {
      rows.push({
        status: 'changed',
        original: next.value,
        modified: current.value,
      })
      index += 1
      continue
    }

    if (current.added) {
      rows.push({
        status: 'added',
        original: '',
        modified: current.value,
      })
      continue
    }

    if (current.removed) {
      rows.push({
        status: 'removed',
        original: current.value,
        modified: '',
      })
      continue
    }

    rows.push({
      status: 'unchanged',
      original: current.value,
      modified: current.value,
    })
  }

  return rows
}

/**
 * 按行 Diff 展示两段文本的差异，用于 Response Body 对比。使用 diffLines 控制行数，保证性能。
 */
export function BodyDiffView({
  original,
  modified,
  className = '',
  maxHeight = '320px',
  mode = 'inline',
}: BodyDiffViewProps) {
  const changes = useMemo(() => {
    return diffLines(original || '', modified || '')
  }, [original, modified])

  const splitRows = useMemo(() => buildSplitRows(changes), [changes])

  if (mode === 'split') {
    return (
      <div
        className={`overflow-auto rounded-md border bg-muted/30 p-2 ${className}`}
        style={{ maxHeight }}
      >
        <div className="grid grid-cols-2 gap-2 text-xs font-mono">
          <div className="text-[10px] text-muted-foreground mb-0.5">原始</div>
          <div className="text-[10px] text-muted-foreground mb-0.5">修改后</div>
          {splitRows.map((row, index) => (
            <div key={index} className="contents">
              <div className={getSplitCellClassName(row.status, 'original')}>
                <div className="whitespace-pre-wrap break-all">{row.original || <span className="text-muted-foreground italic">(无)</span>}</div>
              </div>
              <div className={getSplitCellClassName(row.status, 'modified')}>
                <div className="whitespace-pre-wrap break-all">{row.modified || <span className="text-muted-foreground italic">(无)</span>}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <pre
      className={`text-xs font-mono overflow-auto whitespace-pre-wrap break-all rounded-md border bg-muted/30 ${className}`}
      style={{ maxHeight }}
    >
      {changes.map((part: Change, i: number) => {
        if (part.added) {
          return (
            <span key={i} className="block bg-green-500/20 text-green-800 dark:text-green-200 border-l-2 border-green-500 pl-2">
              {part.value}
            </span>
          )
        }
        if (part.removed) {
          return (
            <span key={i} className="block bg-red-500/20 text-red-800 dark:text-red-200 border-l-2 border-red-500 pl-2">
              {part.value}
            </span>
          )
        }
        return <span key={i}>{part.value}</span>
      })}
    </pre>
  )
}
