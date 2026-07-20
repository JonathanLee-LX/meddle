import type React from 'react'

/** 将格式化后的 JSON 字符串拆分为带颜色的 token */
export function highlightJson(json: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = []
  // 匹配: 字符串 / 数字 / 布尔 / null / 标点
  const tokenRe = /("(?:[^"\\]|\\.)*")\s*:|("(?:[^"\\]|\\.)*")|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\b|\b(true|false)\b|\b(null)\b|([{}[\]:,])/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = tokenRe.exec(json)) !== null) {
    // 非匹配区间（空白等）
    if (match.index > lastIndex) {
      nodes.push(json.slice(lastIndex, match.index))
    }
    const [, key, str, num, bool, nil, punct] = match
    if (key !== undefined) {
      // 对象 key（含冒号前的引号串）
      nodes.push(<span key={match.index} className="text-purple-600 dark:text-purple-400">{key}</span>)
      nodes.push(':')
    } else if (str !== undefined) {
      nodes.push(<span key={match.index} className="text-emerald-600 dark:text-emerald-400">{str}</span>)
    } else if (num !== undefined) {
      nodes.push(<span key={match.index} className="text-blue-600 dark:text-blue-400">{num}</span>)
    } else if (bool !== undefined) {
      nodes.push(<span key={match.index} className="text-amber-600 dark:text-amber-400">{bool}</span>)
    } else if (nil !== undefined) {
      nodes.push(<span key={match.index} className="text-red-400">{nil}</span>)
    } else if (punct !== undefined) {
      nodes.push(<span key={match.index} className="text-muted-foreground">{punct}</span>)
    }
    lastIndex = match.index + match[0].length
  }
  // 尾部剩余
  if (lastIndex < json.length) {
    nodes.push(json.slice(lastIndex))
  }
  return nodes
}

/** 判断字符串是否为合法 JSON */
export function isValidJson(str: string): boolean {
  try {
    JSON.parse(str)
    return true
  } catch {
    return false
  }
}
