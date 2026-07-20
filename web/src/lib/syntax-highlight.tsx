import type React from 'react'

// 性能配置 - 支持通过环境变量自定义
const MAX_HIGHLIGHT_SIZE = parseInt(import.meta.env.VITE_MAX_HIGHLIGHT_SIZE || '2097152') // 默认2MB (2*1024*1024)
const MAX_HIGHLIGHT_LINES = parseInt(import.meta.env.VITE_MAX_HIGHLIGHT_LINES || '10000') // 默认10000行
const MAX_JSON_MATCHES = parseInt(import.meta.env.VITE_MAX_JSON_MATCHES || '50000') // 默认50000
const MAX_HTML_MATCHES = parseInt(import.meta.env.VITE_MAX_HTML_MATCHES || '30000') // 默认30000
const MAX_JS_MATCHES = parseInt(import.meta.env.VITE_MAX_JS_MATCHES || '30000') // 默认30000

/**
 * 检查内容是否适合进行语法高亮
 */
export function shouldHighlight(code: string): boolean {
  if (!code) return false
  
  // 检查大小限制
  if (code.length > MAX_HIGHLIGHT_SIZE) {
    return false
  }
  
  // 检查行数限制
  const lineCount = code.split('\n').length
  if (lineCount > MAX_HIGHLIGHT_LINES) {
    return false
  }
  
  return true
}

/**
 * 检测代码类型
 */
export function detectLanguage(code: string): 'json' | 'html' | 'css' | 'javascript' | 'text' {
  const trimmed = code.trim()
  
  if (!trimmed) return 'text'
  
  // 检测 JSON（优先级最高，因为JSON格式最严格）
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || 
      (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try {
      JSON.parse(trimmed)
      return 'json'
    } catch {
      // 可能是JavaScript对象字面量，继续检测
    }
  }
  
  // 检测 HTML（更全面的检测）
  // 1. DOCTYPE声明
  if (/^<!DOCTYPE\s+html/i.test(trimmed)) {
    return 'html'
  }
  
  // 2. HTML标签（包括常见的HTML标签）
  if (trimmed.startsWith('<html') || trimmed.startsWith('<!DOCTYPE')) {
    return 'html'
  }
  
  // 3. 检测常见HTML标签
  const htmlTags = /^<(!DOCTYPE|html|head|body|div|span|p|a|img|ul|ol|li|table|tr|td|th|form|input|button|h[1-6]|nav|header|footer|section|article|main|aside)\b/i
  if (htmlTags.test(trimmed)) {
    return 'html'
  }
  
  // 4. 检测是否包含HTML标签结构（开始和结束标签）
  if (/<[a-z][\w-]*(\s+[^>]*)?>\s*[\s\S]*<\/[a-z][\w-]*>/i.test(trimmed)) {
    return 'html'
  }
  
  // 5. 检测单个HTML标签（包括自闭合标签）
  if (/<[a-z][\w-]*(\s+[^>]*)?\/?>/i.test(trimmed) && !trimmed.includes('{')) {
    return 'html'
  }
  
  // 检测 CSS
  // 1. CSS规则（选择器 + 大括号）
  if (/^[.#]?[a-z][\w-]*\s*\{/i.test(trimmed)) {
    return 'css'
  }
  
  // 2. CSS @ 规则
  if (/^@(media|keyframes|import|font-face|charset|supports|page|namespace)/i.test(trimmed)) {
    return 'css'
  }
  
  // 3. 包含CSS属性的模式
  if (/[a-z-]+\s*:\s*[^;]+;/i.test(trimmed) && trimmed.includes('{')) {
    return 'css'
  }
  
  // 检测 JavaScript
  // 1. 严格模式声明
  if (trimmed.startsWith('"use strict"') || trimmed.startsWith("'use strict'")) {
    return 'javascript'
  }
  
  // 2. ES6+ 导入导出
  if (/^(import|export)\s+/m.test(trimmed)) {
    return 'javascript'
  }
  
  // 3. 函数声明
  if (/^(function\s+\w+|const\s+\w+\s*=\s*\(|let\s+\w+\s*=\s*\(|var\s+\w+\s*=\s*\()/m.test(trimmed)) {
    return 'javascript'
  }
  
  // 4. 箭头函数
  if (/=>\s*\{?/.test(trimmed)) {
    return 'javascript'
  }
  
  // 5. JavaScript关键字
  if (/(^|\s)(class|function|const|let|var|if|else|for|while|return|try|catch|finally|throw|new|async|await)\s+/i.test(trimmed)) {
    return 'javascript'
  }
  
  return 'text'
}

/**
 * JSON 语法高亮（优化版本）
 */
function highlightJson(json: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = []
  // 简化的正则，避免复杂回溯
  const tokenRe = /("(?:[^"\\]|\\.)+")\s*:|("(?:[^"\\]|\\.)+")|(-?\d+\.?\d*(?:[eE][+-]?\d+)?)|true|false|null|[{}[\]:,]/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  let matchCount = 0

  while ((match = tokenRe.exec(json)) !== null && matchCount++ < MAX_JSON_MATCHES) {
    if (match.index > lastIndex) {
      nodes.push(json.slice(lastIndex, match.index))
    }
    
    const token = match[0]
    
    if (match[1]) {
      // 对象键
      nodes.push(<span key={match.index} className="text-purple-600 dark:text-purple-400">{match[1]}</span>)
      nodes.push(':')
    } else if (match[2]) {
      // 字符串值
      nodes.push(<span key={match.index} className="text-emerald-600 dark:text-emerald-400">{match[2]}</span>)
    } else if (match[3]) {
      // 数字
      nodes.push(<span key={match.index} className="text-blue-600 dark:text-blue-400">{match[3]}</span>)
    } else if (token === 'true' || token === 'false') {
      // 布尔值
      nodes.push(<span key={match.index} className="text-amber-600 dark:text-amber-400">{token}</span>)
    } else if (token === 'null') {
      // null
      nodes.push(<span key={match.index} className="text-red-400">{token}</span>)
    } else {
      // 标点符号
      nodes.push(<span key={match.index} className="text-muted-foreground">{token}</span>)
    }
    
    lastIndex = match.index + match[0].length
  }
  
  if (lastIndex < json.length) {
    nodes.push(json.slice(lastIndex))
  }
  return nodes
}

/**
 * HTML 语法高亮（优化版本）
 */
function highlightHtml(html: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = []
  
  // 简化的正则，避免贪婪匹配导致的性能问题
  const tagRe = /<!--[\s\S]{0,500}?-->|<\/?([a-z][\w-]*)\b([^>]{0,500})>/gi
  let match: RegExpExecArray | null
  let currentIndex = 0
  let matchCount = 0
  
  while ((match = tagRe.exec(html)) !== null && matchCount++ < MAX_HTML_MATCHES) {
    // 添加标签前的文本
    if (match.index > currentIndex) {
      const text = html.slice(currentIndex, match.index)
      if (text) {
        nodes.push(<span key={`text-${currentIndex}`} className="text-foreground">{text}</span>)
      }
    }
    
    const fullMatch = match[0]
    
    // HTML 注释
    if (fullMatch.startsWith('<!--')) {
      nodes.push(<span key={match.index} className="text-gray-500 dark:text-gray-400 italic">{fullMatch}</span>)
    } else {
      // 标签
      const tagName = match[1]
      const attrs = match[2]
      
      if (fullMatch.startsWith('</')) {
        // 闭合标签
        nodes.push(<span key={match.index} className="text-blue-600 dark:text-blue-400">{fullMatch}</span>)
      } else {
        // 开始标签
        nodes.push(<span key={match.index} className="text-blue-600 dark:text-blue-400">{'<'}</span>)
        nodes.push(<span key={`tag-${match.index}`} className="text-blue-600 dark:text-blue-400 font-semibold">{tagName}</span>)
        
        // 高亮属性
        if (attrs) {
          const attrNodes = highlightAttributes(attrs, match.index)
          nodes.push(...attrNodes)
        }
        
        nodes.push(<span key={`close-${match.index}`} className="text-blue-600 dark:text-blue-400">{'>'}</span>)
      }
    }
    
    currentIndex = match.index + fullMatch.length
  }
  
  // 添加剩余文本
  if (currentIndex < html.length) {
    const text = html.slice(currentIndex)
    if (text) {
      nodes.push(<span key={`text-${currentIndex}`} className="text-foreground">{text}</span>)
    }
  }
  
  return nodes
}

/**
 * 高亮 HTML 属性
 */
function highlightAttributes(attrs: string, baseIndex: number): React.ReactNode[] {
  const nodes: React.ReactNode[] = []
  const attrRe = /([a-z-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/gi
  let match: RegExpExecArray | null
  let lastIndex = 0
  
  while ((match = attrRe.exec(attrs)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(attrs.slice(lastIndex, match.index))
    }
    
    const attrName = match[1]
    const attrValue = match[2] || match[3] || match[4]
    
    nodes.push(<span key={`attr-name-${baseIndex}-${match.index}`} className="text-amber-600 dark:text-amber-400">{attrName}</span>)
    
    if (attrValue !== undefined) {
      nodes.push('=')
      if (match[2] !== undefined) {
        nodes.push(<span key={`attr-val-${baseIndex}-${match.index}`} className="text-emerald-600 dark:text-emerald-400">{`"${match[2]}"`}</span>)
      } else if (match[3] !== undefined) {
        nodes.push(<span key={`attr-val-${baseIndex}-${match.index}`} className="text-emerald-600 dark:text-emerald-400">{`'${match[3]}'`}</span>)
      } else {
        nodes.push(<span key={`attr-val-${baseIndex}-${match.index}`} className="text-emerald-600 dark:text-emerald-400">{match[4]}</span>)
      }
    }
    
    lastIndex = match.index + match[0].length
  }
  
  if (lastIndex < attrs.length) {
    nodes.push(attrs.slice(lastIndex))
  }
  
  return nodes
}

/**
 * CSS 语法高亮（优化版本）
 */
function highlightCss(css: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = []
  
  // 限制行数
  const lines = css.split('\n').slice(0, MAX_HIGHLIGHT_LINES)
  
  lines.forEach((line, lineIndex) => {
    if (lineIndex > 0) {
      nodes.push('\n')
    }
    
    // CSS 注释
    if (line.trim().startsWith('/*')) {
      nodes.push(<span key={`comment-${lineIndex}`} className="text-gray-500 dark:text-gray-400 italic">{line}</span>)
      return
    }
    
    // 选择器行（不包含冒号或只在 {} 外）
    if (!line.includes(':') || line.includes('{')) {
      // 选择器
      const parts = line.split('{')
      if (parts.length > 1) {
        nodes.push(<span key={`selector-${lineIndex}`} className="text-purple-600 dark:text-purple-400 font-semibold">{parts[0]}</span>)
        nodes.push(<span key={`brace-${lineIndex}`} className="text-foreground">{' {'}</span>)
        if (parts[1]) {
          nodes.push(parts[1])
        }
      } else {
        nodes.push(<span key={`selector-${lineIndex}`} className="text-purple-600 dark:text-purple-400 font-semibold">{line}</span>)
      }
    } else if (line.includes(':')) {
      // 属性:值对
      const colonIndex = line.indexOf(':')
      const property = line.slice(0, colonIndex)
      const value = line.slice(colonIndex + 1)
      
      nodes.push(<span key={`prop-${lineIndex}`} className="text-blue-600 dark:text-blue-400">{property}</span>)
      nodes.push(<span key={`colon-${lineIndex}`} className="text-foreground">:</span>)
      
      // 值可能包含颜色、数字等
      const valueNodes = highlightCssValue(value, lineIndex)
      nodes.push(...valueNodes)
    } else {
      nodes.push(line)
    }
  })
  
  return nodes
}

/**
 * 高亮 CSS 值
 */
function highlightCssValue(value: string, lineIndex: number): React.ReactNode[] {
  const nodes: React.ReactNode[] = []
  
  // 匹配颜色值、数字、关键字
  const valueRe = /(#[0-9a-fA-F]{3,8})|(\d+(?:\.\d+)?(?:px|em|rem|%|vh|vw|deg|s|ms)?)|([a-z-]+)/gi
  let lastIndex = 0
  let match: RegExpExecArray | null
  
  while ((match = valueRe.exec(value)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(value.slice(lastIndex, match.index))
    }
    
    if (match[1]) {
      // 颜色值
      nodes.push(<span key={`color-${lineIndex}-${match.index}`} className="text-pink-600 dark:text-pink-400">{match[1]}</span>)
    } else if (match[2]) {
      // 数字
      nodes.push(<span key={`num-${lineIndex}-${match.index}`} className="text-amber-600 dark:text-amber-400">{match[2]}</span>)
    } else if (match[3]) {
      // 关键字
      nodes.push(<span key={`keyword-${lineIndex}-${match.index}`} className="text-emerald-600 dark:text-emerald-400">{match[3]}</span>)
    }
    
    lastIndex = match.index + match[0].length
  }
  
  if (lastIndex < value.length) {
    nodes.push(value.slice(lastIndex))
  }
  
  return nodes
}

/**
 * JavaScript 语法高亮（优化版本）
 */
function highlightJavaScript(js: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = []
  
  // 简化的正则，限制字符串和注释的长度
  const combinedRe = /(["'`])(?:[^"'`\\]|\\.){0,200}?\1|\/\/[^\n]{0,200}|\/\*[\s\S]{0,500}?\*\/|\b(function|const|let|var|if|else|for|while|return|class|import|export|from|default|async|await|try|catch|finally|throw|new|this|super|extends|static|get|set|typeof|instanceof|in|of|void|delete|yield|switch|case|break|continue|do)\b|(\d+\.?\d*(?:[eE][+-]?\d+)?)/gm
  
  let lastIndex = 0
  let match: RegExpExecArray | null
  let matchCount = 0
  
  while ((match = combinedRe.exec(js)) !== null && matchCount++ < MAX_JS_MATCHES) {
    if (match.index > lastIndex) {
      nodes.push(js.slice(lastIndex, match.index))
    }
    
    const fullMatch = match[0]
    
    if (fullMatch.startsWith('"') || fullMatch.startsWith("'") || fullMatch.startsWith('`')) {
      // 字符串
      nodes.push(<span key={match.index} className="text-emerald-600 dark:text-emerald-400">{fullMatch}</span>)
    } else if (fullMatch.startsWith('//') || fullMatch.startsWith('/*')) {
      // 注释
      nodes.push(<span key={match.index} className="text-gray-500 dark:text-gray-400 italic">{fullMatch}</span>)
    } else if (match[2]) {
      // 关键字
      nodes.push(<span key={match.index} className="text-purple-600 dark:text-purple-400 font-semibold">{match[2]}</span>)
    } else if (match[3]) {
      // 数字
      nodes.push(<span key={match.index} className="text-amber-600 dark:text-amber-400">{match[3]}</span>)
    } else {
      nodes.push(fullMatch)
    }
    
    lastIndex = match.index + fullMatch.length
  }
  
  if (lastIndex < js.length) {
    nodes.push(js.slice(lastIndex))
  }
  
  return nodes
}

/**
 * 根据语言类型进行语法高亮（带性能优化）
 */
export function highlightCode(code: string, language?: 'json' | 'html' | 'css' | 'javascript' | 'text'): React.ReactNode[] {
  // 性能检查：内容过大或过长则不高亮
  if (!shouldHighlight(code)) {
    return [code]
  }
  
  const lang = language || detectLanguage(code)
  
  try {
    const startTime = performance.now()
    let result: React.ReactNode[]
    
    switch (lang) {
      case 'json':
        result = highlightJson(code)
        break
      case 'html':
        result = highlightHtml(code)
        break
      case 'css':
        result = highlightCss(code)
        break
      case 'javascript':
        result = highlightJavaScript(code)
        break
      default:
        return [code]
    }
    
    const duration = performance.now() - startTime
    // 如果高亮耗时超过 100ms，输出警告
    if (duration > 100) {
      console.warn(`Syntax highlighting took ${duration.toFixed(2)}ms for ${code.length} chars`)
    }
    
    return result
  } catch (error) {
    // 如果高亮失败，返回原始代码
    console.error('Syntax highlighting error:', error)
    return [code]
  }
}

/**
 * 判断字符串是否为合法 JSON
 */
export function isValidJson(str: string): boolean {
  try {
    JSON.parse(str)
    return true
  } catch {
    return false
  }
}

/**
 * 验证 HTML 内容的基本结构
 * 使用轻量标签栈，避免 DOMParser 自动修复导致误判
 */
export function validateHtml(html: string): { valid: boolean; error?: string } {
  const trimmed = html.trim()
  if (!trimmed) {
    return { valid: true }
  }

  try {
    if (!trimmed.includes('<')) {
      return { valid: false, error: '内容不像是有效的HTML' }
    }

    const voidTags = new Set([
      'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
      'link', 'meta', 'param', 'source', 'track', 'wbr',
    ])
    const tagStack: string[] = []
    const tagRe = /<!--[\s\S]*?-->|<!DOCTYPE[^>]*>|<\/?([a-z][\w-]*)\b[^>]*?>/gi
    let match: RegExpExecArray | null

    while ((match = tagRe.exec(trimmed)) !== null) {
      const fullMatch = match[0]
      const tagName = match[1]?.toLowerCase()

      if (!tagName || fullMatch.startsWith('<!--') || /^<!doctype/i.test(fullMatch)) {
        continue
      }

      if (fullMatch.startsWith('</')) {
        if (tagStack.length === 0) {
          return { valid: false, error: `HTML语法错误：未找到标签 <${tagName}> 的开始标签` }
        }
        const lastTag = tagStack.pop()
        if (lastTag !== tagName) {
          return { valid: false, error: `HTML语法错误：标签不匹配，期望 </${lastTag}>，实际 </${tagName}>` }
        }
        continue
      }

      const selfClosing = fullMatch.endsWith('/>') || voidTags.has(tagName)
      if (!selfClosing) {
        tagStack.push(tagName)
      }
    }

    if (tagStack.length > 0) {
      const unclosedTag = tagStack[tagStack.length - 1]
      return { valid: false, error: `HTML语法错误：标签 <${unclosedTag}> 未闭合` }
    }

    return { valid: true }
  } catch (error) {
    return { valid: false, error: `HTML解析错误：${error instanceof Error ? error.message : '未知错误'}` }
  }
}

/**
 * 验证CSS内容的基本语法
 */
export function validateCss(css: string): { valid: boolean; error?: string } {
  const trimmed = css.trim()
  if (!trimmed) {
    return { valid: true }
  }

  try {
    // 检查大括号是否匹配
    let braceCount = 0
    let inString = false
    let stringChar = ''
    
    for (let i = 0; i < trimmed.length; i++) {
      const char = trimmed[i]
      const prevChar = i > 0 ? trimmed[i - 1] : ''
      
      // 处理字符串
      if ((char === '"' || char === "'") && prevChar !== '\\') {
        if (!inString) {
          inString = true
          stringChar = char
        } else if (char === stringChar) {
          inString = false
        }
      }
      
      if (!inString) {
        if (char === '{') {
          braceCount++
        } else if (char === '}') {
          braceCount--
          if (braceCount < 0) {
            return { valid: false, error: 'CSS语法错误：多余的闭合大括号 }' }
          }
        }
      }
    }
    
    if (braceCount !== 0) {
      return { valid: false, error: braceCount > 0 ? 'CSS语法错误：缺少闭合大括号 }' : 'CSS语法错误：多余的闭合大括号 }' }
    }
    
    if (inString) {
      return { valid: false, error: 'CSS语法错误：未闭合的字符串' }
    }
    
    return { valid: true }
  } catch (error) {
    return { valid: false, error: `CSS解析错误：${error instanceof Error ? error.message : '未知错误'}` }
  }
}

/**
 * 验证JavaScript内容的基本语法
 */
export function validateJavaScript(js: string): { valid: boolean; error?: string } {
  const trimmed = js.trim()
  if (!trimmed) {
    return { valid: true }
  }

  try {
    // 检查大括号、中括号、小括号是否匹配
    const stack: string[] = []
    let inString = false
    let stringChar = ''
    let inRegex = false
    let inComment = false
    let inMultiLineComment = false
    
    for (let i = 0; i < trimmed.length; i++) {
      const char = trimmed[i]
      const prevChar = i > 0 ? trimmed[i - 1] : ''
      const nextChar = i + 1 < trimmed.length ? trimmed[i + 1] : ''
      
      // 处理多行注释
      if (!inString && !inRegex && !inComment) {
        if (char === '/' && nextChar === '*') {
          inMultiLineComment = true
          i++
          continue
        }
      }
      
      if (inMultiLineComment) {
        if (char === '*' && nextChar === '/') {
          inMultiLineComment = false
          i++
        }
        continue
      }
      
      // 处理单行注释
      if (!inString && !inRegex && !inMultiLineComment) {
        if (char === '/' && nextChar === '/') {
          inComment = true
          continue
        }
      }
      
      if (inComment) {
        if (char === '\n') {
          inComment = false
        }
        continue
      }
      
      // 处理字符串
      if ((char === '"' || char === "'" || char === '`') && prevChar !== '\\' && !inRegex) {
        if (!inString) {
          inString = true
          stringChar = char
        } else if (char === stringChar) {
          inString = false
          stringChar = ''
        }
      }
      
      if (inString) {
        continue
      }
      
      // 处理正则表达式（简化版）
      if (char === '/' && !inString && prevChar !== '\\') {
        const prevNonSpace = trimmed.slice(0, i).trimEnd().slice(-1)
        if (prevNonSpace === '=' || prevNonSpace === '(' || prevNonSpace === '[' || prevNonSpace === ',' || prevNonSpace === ':') {
          inRegex = true
          continue
        }
      }
      
      if (inRegex) {
        if (char === '/' && prevChar !== '\\') {
          inRegex = false
        }
        continue
      }
      
      // 检查括号匹配
      if (char === '{' || char === '[' || char === '(') {
        stack.push(char)
      } else if (char === '}' || char === ']' || char === ')') {
        const expected = char === '}' ? '{' : char === ']' ? '[' : '('
        const last = stack.pop()
        if (last !== expected) {
          const charName = char === '}' ? '大括号' : char === ']' ? '中括号' : '小括号'
          return { valid: false, error: `JavaScript语法错误：${charName}不匹配` }
        }
      }
    }
    
    if (stack.length > 0) {
      const unclosed = stack[stack.length - 1]
      const name = unclosed === '{' ? '大括号' : unclosed === '[' ? '中括号' : '小括号'
      return { valid: false, error: `JavaScript语法错误：未闭合的${name} ${unclosed}` }
    }
    
    if (inString) {
      return { valid: false, error: 'JavaScript语法错误：未闭合的字符串' }
    }
    
    if (inMultiLineComment) {
      return { valid: false, error: 'JavaScript语法错误：未闭合的多行注释' }
    }
    
    return { valid: true }
  } catch (error) {
    return { valid: false, error: `JavaScript解析错误：${error instanceof Error ? error.message : '未知错误'}` }
  }
}

/**
 * 验证内容的语法
 * 根据内容类型自动选择验证方式
 */
export function validateContent(content: string): { valid: boolean; error?: string; type?: string } {
  const trimmed = content.trim()
  if (!trimmed) {
    return { valid: true }
  }

  const type = detectLanguage(content)
  
  switch (type) {
    case 'json':
      if (!isValidJson(content)) {
        return { valid: false, error: 'JSON格式错误：请检查语法', type: 'JSON' }
      }
      return { valid: true, type: 'JSON' }
    
    case 'html': {
      const result = validateHtml(content)
      return { ...result, type: 'HTML' }
    }
    
    case 'css': {
      const result = validateCss(content)
      return { ...result, type: 'CSS' }
    }
    
    case 'javascript': {
      const result = validateJavaScript(content)
      return { ...result, type: 'JavaScript' }
    }
    
    default:
      return { valid: true, type: 'Text' }
  }
}
