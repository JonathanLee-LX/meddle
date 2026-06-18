import type { ReactNode } from 'react'
import { shouldHighlight } from '@/lib/syntax-highlight'

// EPRC 行内 token 的配色（沿用项目 tailwind 既有色板）
const CLASS_COMMENT = 'text-muted-foreground italic'
const CLASS_DISABLED = 'text-amber-600 dark:text-amber-400'
const CLASS_EXCLUSION = 'text-red-500 dark:text-red-400'
const CLASS_TARGET = 'text-emerald-600 dark:text-emerald-400'
const CLASS_MARKER = 'text-purple-600 dark:text-purple-400'
const CLASS_RULE = 'text-foreground'

interface EprcToken {
  text: string
  className: string
}

/**
 * 对单行 EPRC 文本做分词着色。
 * 仅做语法层着色，语义校验（未识别行）由 getEprcTextDiagnostics 负责。
 */
function tokenizeLine(rawLine: string): EprcToken[] {
  const line = rawLine.replace(/\r$/, '')
  if (line.length === 0) return [{ text: '', className: CLASS_RULE }]

  // 整行注释：以 # 开头
  if (/^\s*#/.test(line)) {
    return [{ text: line, className: CLASS_COMMENT }]
  }

  const tokens: EprcToken[] = []
  let working = line

  // 禁用前缀 //（仅在行首出现时视为禁用标记）
  const disabledMatch = working.match(/^(\s*)(\/\/)/)
  if (disabledMatch) {
    if (disabledMatch[1]) tokens.push({ text: disabledMatch[1], className: CLASS_RULE })
    tokens.push({ text: disabledMatch[2], className: CLASS_DISABLED })
    working = working.slice(disabledMatch[0].length)
  }

  // 剩余部分按空白拆分（保留分隔的空白）
  // 目标 token = 最后一个非 ! 开头的普通 token
  const parts = working.split(/(\s+)/)
  // 先定位最后一个"普通 token"（非空白、非 ! 开头）的索引，用于着色为 target
  let lastRegularPartIndex = -1
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i]
    if (p === '' || /^\s+$/.test(p)) continue
    if (p.startsWith('!')) continue
    lastRegularPartIndex = i
    break
  }

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    if (part === '') continue
    if (/^\s+$/.test(part)) {
      tokens.push({ text: part, className: CLASS_RULE })
      continue
    }
    if (part.startsWith('!')) {
      tokens.push({ text: part, className: CLASS_EXCLUSION })
      continue
    }
    if (i === lastRegularPartIndex) {
      // 目标 token：若内部含 [marker]，单独着色 marker 段
      pushTokenWithMarker(tokens, part, CLASS_TARGET)
      continue
    }
    // 规则 token：内部 [marker] 单独着色
    pushTokenWithMarker(tokens, part, CLASS_RULE)
  }

  return tokens
}

/** 将一个 token 文本按 [marker] 拆分，marker 段用紫色高亮，其余用 baseClass。 */
function pushTokenWithMarker(tokens: EprcToken[], text: string, baseClass: string): void {
  // 用局部正则 matchAll，避免模块级 g 正则的 lastIndex 状态污染
  const matches = [...text.matchAll(/\[[^\]]+\]/g)]
  if (matches.length === 0) {
    tokens.push({ text, className: baseClass })
    return
  }
  let lastIndex = 0
  for (const match of matches) {
    const matchText = match[0]
    const start = match.index!
    if (start > lastIndex) {
      tokens.push({ text: text.slice(lastIndex, start), className: baseClass })
    }
    tokens.push({ text: matchText, className: CLASS_MARKER })
    lastIndex = start + matchText.length
  }
  if (lastIndex < text.length) {
    tokens.push({ text: text.slice(lastIndex), className: baseClass })
  }
}

/**
 * EPRC 语法高亮：返回 ReactNode[] 供 <pre> 渲染。
 * 性能守卫复用 syntax-highlight.shouldHighlight，超限直接返回原文。
 */
export function highlightEprc(text: string): ReactNode[] {
  if (!shouldHighlight(text)) {
    return [text]
  }

  const nodes: ReactNode[] = []
  const segments = text.split('\n')
  segments.forEach((line, lineIndex) => {
    const tokens = tokenizeLine(line)
    tokens.forEach((token, tokenIndex) => {
      if (token.text.length === 0) return
      nodes.push(
        <span key={`${lineIndex}-${tokenIndex}`} className={token.className}>
          {token.text}
        </span>,
      )
    })
    if (lineIndex < segments.length - 1) {
      nodes.push('\n')
    }
  })
  return nodes
}
