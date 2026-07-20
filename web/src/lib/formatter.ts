/**
 * 格式化工具
 * 按需加载 Prettier 及对应解析器进行代码格式化
 */

/**
 * 检测内容类型
 */
export function detectContentType(content: string): 'json' | 'html' | 'css' | 'javascript' | 'unknown' {
  const trimmed = content.trim()
  
  // 检测 JSON
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || 
      (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try {
      JSON.parse(trimmed)
      return 'json'
    } catch {
      // 继续检测其他类型
    }
  }
  
  // 检测 HTML
  if (trimmed.startsWith('<!DOCTYPE') || 
      trimmed.startsWith('<html') ||
      /<[a-z][\s\S]*>/i.test(trimmed)) {
    return 'html'
  }
  
  // 检测 CSS
  if (/[a-z-]+\s*\{[\s\S]*\}/i.test(trimmed) || 
      /@(media|keyframes|import|font-face)/i.test(trimmed)) {
    return 'css'
  }
  
  // 检测 JavaScript
  if (/(function|const|let|var|class|import|export|=>)/i.test(trimmed)) {
    return 'javascript'
  }
  
  return 'unknown'
}

/**
 * 简单的 HTML 格式化（当 Prettier 插件不可用时使用）
 */
function simpleHtmlFormat(content: string): string {
  let indent = 0
  const lines = content.replace(/><>/g, '>\n<').split('\n')
  const result: string[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    // 减少缩进的结束标签
    if (trimmed.startsWith('</')) {
      indent = Math.max(0, indent - 1)
    }

    result.push('  '.repeat(indent) + trimmed)

    // 增加缩进的开始标签（非自闭合）
    if (trimmed.startsWith('<') && !trimmed.startsWith('</') && !trimmed.startsWith('<?') && !trimmed.endsWith('/>')) {
      const isVoidElement = /<(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)\b/i.test(trimmed)
      if (!isVoidElement) {
        indent++
      }
    }
  }

  return result.join('\n')
}

/**
 * 简单的 CSS 格式化
 */
function simpleCssFormat(content: string): string {
  return content
    .replace(/\s*{\s*/g, ' {\n  ')
    .replace(/\s*}\s*/g, '\n}\n\n')
    .replace(/\s*;\s*/g, ';\n  ')
    .trim()
}

/**
 * 简单的 JavaScript 格式化
 */
function simpleJsFormat(content: string): string {
  let indent = 0
  const result: string[] = []
  let i = 0

  while (i < content.length) {
    const char = content[i]
    const nextChar = content[i + 1]

    // 处理注释
    if (char === '/' && nextChar === '/') {
      const end = content.indexOf('\n', i)
      if (end === -1) break
      result.push('  '.repeat(indent) + content.slice(i, end).trim())
      i = end + 1
      continue
    }

    if (char === '/' && nextChar === '*') {
      const end = content.indexOf('*/', i)
      if (end === -1) break
      const comment = content.slice(i, end + 2)
      result.push('  '.repeat(indent) + comment)
      i = end + 2
      continue
    }

    // 处理字符串（跳过）
    if (char === '"' || char === "'" || char === '`') {
      const quote = char
      let str = quote
      i++
      while (i < content.length) {
        if (content[i] === '\\' && i + 1 < content.length) {
          str += content[i] + content[i + 1]
          i += 2
        } else if (content[i] === quote) {
          str += quote
          i++
          break
        } else {
          str += content[i]
          i++
        }
      }
      result.push('  '.repeat(indent) + str)
      continue
    }

    // 处理花括号
    if (char === '{') {
      result.push('  '.repeat(indent) + '{')
      indent++
      i++
      continue
    }

    if (char === '}') {
      indent = Math.max(0, indent - 1)
      result.push('  '.repeat(indent) + '}')
      i++
      continue
    }

    // 收集普通代码
    let code = ''
    const specialChars = '{}'
    while (i < content.length && content[i] !== '\n' && !specialChars.includes(content[i])) {
      code += content[i]
      i++
    }

    if (code.trim()) {
      result.push('  '.repeat(indent) + code.trim())
    }

    if (content[i] === '\n') {
      i++
    }
  }

  return result.join('\n')
}

/**
 * 使用 Prettier 格式化代码
 */
async function formatWithPrettier(content: string, parser: 'json' | 'html' | 'css' | 'babel'): Promise<string> {
  try {
    const prettierPromise = import('prettier/standalone')
    const pluginPromises = parser === 'css'
      ? [import('prettier/plugins/postcss')]
      : parser === 'html'
        ? [
            import('prettier/plugins/html'),
            import('prettier/plugins/babel'),
            import('prettier/plugins/estree'),
            import('prettier/plugins/postcss'),
          ]
        : [
            import('prettier/plugins/babel'),
            import('prettier/plugins/estree'),
          ]
    const [prettier, ...pluginModules] = await Promise.all([
      prettierPromise,
      ...pluginPromises,
    ])
    const formatted = await prettier.format(content, {
      parser: parser === 'json' ? 'json-stringify' : parser,
      plugins: pluginModules.map(plugin => plugin.default),
      printWidth: 80,
      tabWidth: 2,
      useTabs: false,
      semi: true,
      singleQuote: true,
      trailingComma: 'es5',
      bracketSpacing: true,
      arrowParens: 'always',
    })
    return formatted.trim()
  } catch (error) {
    // 解析器缺失时，使用简单格式化作为后备
    if (parser === 'json') {
      try {
        const parsed = JSON.parse(content)
        return JSON.stringify(parsed, null, 2)
      } catch {
        throw new Error('JSON格式错误，无法解析')
      }
    } else if (parser === 'html') {
      return simpleHtmlFormat(content)
    } else if (parser === 'css') {
      return simpleCssFormat(content)
    } else if (parser === 'babel') {
      return simpleJsFormat(content)
    }
    // 其他情况直接抛出错误
    const errorMsg = error instanceof Error ? error.message : '未知错误'
    throw new Error(`格式化失败: ${errorMsg}`)
  }
}

/**
 * 自动格式化内容
 * 根据内容类型自动选择合适的格式化方式,使用 Prettier 进行专业格式化
 */
export async function formatContent(content: string): Promise<{ formatted: string; type: string }> {
  const type = detectContentType(content)
  
  try {
    let formatted: string
    let typeName: string
    
    switch (type) {
      case 'json':
        formatted = await formatWithPrettier(content, 'json')
        typeName = 'JSON'
        break
      case 'html':
        formatted = await formatWithPrettier(content, 'html')
        typeName = 'HTML'
        break
      case 'css':
        formatted = await formatWithPrettier(content, 'css')
        typeName = 'CSS'
        break
      case 'javascript':
        formatted = await formatWithPrettier(content, 'babel')
        typeName = 'JavaScript'
        break
      default:
        formatted = content
        typeName = 'Unknown'
    }
    
    return { formatted, type: typeName }
  } catch (error) {
    throw new Error(`格式化失败: ${error instanceof Error ? error.message : '未知错误'}`)
  }
}
