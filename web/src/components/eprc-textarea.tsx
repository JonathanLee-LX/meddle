import { useRef, useCallback, useMemo, type ReactNode } from 'react'
import { highlightEprc } from '@/lib/eprc-highlight'
import { shouldHighlight } from '@/lib/syntax-highlight'

interface EprcTextareaProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  /** 应用到外层容器（控制尺寸/布局） */
  className?: string
  disabled?: boolean
  /** textarea 的 aria-label */
  ariaLabel?: string
}

/**
 * 带 EPRC 语法高亮的可编辑文本区。
 * 原理：在透明文字的 textarea 下叠加一个带高亮的 <pre>，
 * 两者共享相同的字体/间距/换行规则以保持对齐。
 * 当内容超限或为空时，textarea 文字保持可见（不高亮）。
 */
export function EprcTextarea({
  value,
  onChange,
  placeholder,
  className,
  disabled,
  ariaLabel,
}: EprcTextareaProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const preRef = useRef<HTMLPreElement>(null)

  const handleScroll = useCallback(() => {
    if (textareaRef.current && preRef.current) {
      preRef.current.scrollTop = textareaRef.current.scrollTop
      preRef.current.scrollLeft = textareaRef.current.scrollLeft
    }
  }, [])

  const canHighlight = value.trim().length > 0 && shouldHighlight(value)
  const highlighted: ReactNode[] = useMemo(() => (canHighlight ? highlightEprc(value) : []), [canHighlight, value])
  const showHighlight = highlighted.length > 0

  // 共享文本样式（textarea 与 pre 必须完全一致以保证对齐）
  const sharedTextStyle = 'font-mono text-sm leading-6 whitespace-pre-wrap break-words'

  return (
    <div className={`relative flex min-h-0 flex-1 flex-col overflow-hidden ${className || ''}`}>
      {/* 高亮渲染层：透明 textarea 下方，pointer-events:none 不拦截交互 */}
      <pre
        ref={preRef}
        aria-hidden="true"
        className={`absolute inset-0 m-0 overflow-auto px-4 py-3 ${sharedTextStyle} pointer-events-none select-none`}
      >
        {showHighlight ? (
          highlighted
        ) : (
          <span className={disabled ? 'text-muted-foreground' : 'text-foreground'}>{value || ' '}</span>
        )}
        {/* 末尾换行保证 pre 高度与 textarea 一致 */}
        {'\n'}
      </pre>

      {/* 可编辑 textarea：高亮时文字透明仅显示光标，否则正常显示 */}
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onScroll={handleScroll}
        placeholder={placeholder}
        spellCheck={false}
        disabled={disabled}
        aria-label={ariaLabel}
        className={`absolute inset-0 resize-none overflow-auto rounded-none border-0 bg-transparent px-4 py-3 ${sharedTextStyle} shadow-none outline-none ring-0 focus-visible:ring-0 ${
          showHighlight && !disabled ? 'text-transparent caret-foreground' : ''
        }`}
      />
    </div>
  )
}
