import { useRef, useCallback, useMemo } from 'react'
import { highlightCode, detectLanguage, shouldHighlight as shouldHighlightContent } from '@/lib/syntax-highlight'

interface JsonTextareaProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
  minHeight?: string
}

/**
 * 带多语言语法高亮的 textarea（性能优化版）。
 * 支持 JSON、HTML、CSS、JavaScript 等语法高亮。
 * 使用 useMemo 缓存高亮结果，避免不必要的重新计算。
 * 原理：在透明文字的 textarea 下叠加一个带高亮的 <pre>，
 * 两者共享相同的字体/间距/换行规则以保持对齐。
 */
export function JsonTextarea({
  value,
  onChange,
  placeholder,
  className,
  minHeight = '240px',
}: JsonTextareaProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const preRef = useRef<HTMLPreElement>(null)

  const handleScroll = useCallback(() => {
    if (textareaRef.current && preRef.current) {
      preRef.current.scrollTop = textareaRef.current.scrollTop
      preRef.current.scrollLeft = textareaRef.current.scrollLeft
    }
  }, [])

  // 使用 useMemo 缓存语言检测和高亮结果
  const highlightedContent = useMemo(() => {
    const trimmed = value.trim()
    if (!trimmed || !shouldHighlightContent(value)) {
      return null
    }
    
    const language = detectLanguage(value)
    if (language === 'text') {
      return null
    }
    
    return highlightCode(value, language)
  }, [value])
  
  const shouldHighlight = highlightedContent !== null

  // 共享的文本样式类名（textarea 和 pre 必须完全一致）
  const sharedTextStyle =
    'px-3 py-2 text-sm leading-[1.625] font-mono whitespace-pre-wrap break-words'

  return (
    <div className={`relative ${className || ''}`}>
      {/* 高亮渲染层 —— 放在 textarea 下方，pointer-events: none 使其不拦截点击 */}
      <pre
        ref={preRef}
        className={`absolute inset-0 ${sharedTextStyle} m-0 overflow-hidden border border-transparent rounded-md pointer-events-none select-none`}
        aria-hidden="true"
      >
        {shouldHighlight ? highlightedContent : <span className="invisible">{value || ' '}</span>}
        {/* 末尾换行保证 pre 高度与 textarea 一致 */}
        {'\n'}
      </pre>

      {/* 可编辑的 textarea —— 有语法高亮时文字透明，仅显示光标 */}
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onScroll={handleScroll}
        placeholder={placeholder}
        spellCheck={false}
        className={`relative w-full ${sharedTextStyle} rounded-md border border-input bg-transparent shadow-sm resize-y focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring selection:bg-blue-300/30 ${
          shouldHighlight ? 'text-transparent caret-foreground' : ''
        }`}
        style={{ minHeight }}
      />
    </div>
  )
}
