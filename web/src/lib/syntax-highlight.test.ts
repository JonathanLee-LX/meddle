import { describe, it, expect } from 'vitest'
import {
  detectLanguage,
  isValidJson,
  validateHtml,
  validateCss,
  validateJavaScript,
  validateContent,
} from './syntax-highlight'

describe('detectLanguage', () => {
  describe('JSON detection', () => {
    it('should detect valid JSON object', () => {
      expect(detectLanguage('{"name": "test"}')).toBe('json')
    })

    it('should detect valid JSON array', () => {
      expect(detectLanguage('[1, 2, 3]')).toBe('json')
    })

    it('should detect nested JSON', () => {
      expect(detectLanguage('{"user": {"name": "test", "age": 30}}')).toBe('json')
    })

    it('should not detect invalid JSON as JSON', () => {
      expect(detectLanguage('{name: "test"}')).not.toBe('json')
    })
  })

  describe('HTML detection', () => {
    it('should detect DOCTYPE declaration', () => {
      expect(detectLanguage('<!DOCTYPE html>')).toBe('html')
    })

    it('should detect html tag', () => {
      expect(detectLanguage('<html><body></body></html>')).toBe('html')
    })

    it('should detect div tag', () => {
      expect(detectLanguage('<div>content</div>')).toBe('html')
    })

    it('should detect common HTML tags', () => {
      expect(detectLanguage('<h1>Title</h1>')).toBe('html')
      expect(detectLanguage('<p>Paragraph</p>')).toBe('html')
      expect(detectLanguage('<a href="#">Link</a>')).toBe('html')
    })

    it('should detect HTML with attributes', () => {
      expect(detectLanguage('<div class="container">content</div>')).toBe('html')
    })

    it('should detect self-closing HTML tags', () => {
      expect(detectLanguage('<img src="image.jpg" />')).toBe('html')
      expect(detectLanguage('<br />')).toBe('html')
    })
  })

  describe('CSS detection', () => {
    it('should detect CSS rules', () => {
      expect(detectLanguage('.class { color: red; }')).toBe('css')
    })

    it('should detect CSS with @ rules', () => {
      expect(detectLanguage('@media screen { .class { } }')).toBe('css')
    })

    it('should detect keyframes', () => {
      expect(detectLanguage('@keyframes slide { from { } to { } }')).toBe('css')
    })

    it('should detect multiple CSS rules', () => {
      expect(detectLanguage('body { margin: 0; } .class { color: blue; }')).toBe('css')
    })
  })

  describe('JavaScript detection', () => {
    it('should detect function declaration', () => {
      expect(detectLanguage('function test() { return true; }')).toBe('javascript')
    })

    it('should detect const declaration', () => {
      expect(detectLanguage('const x = 10;')).toBe('javascript')
    })

    it('should detect arrow function', () => {
      expect(detectLanguage('const fn = () => {}')).toBe('javascript')
    })

    it('should detect import/export', () => {
      expect(detectLanguage('import React from "react"')).toBe('javascript')
      expect(detectLanguage('export default App')).toBe('javascript')
    })

    it('should detect class declaration', () => {
      expect(detectLanguage('class MyClass { }')).toBe('javascript')
    })
  })

  describe('Text detection', () => {
    it('should detect plain text', () => {
      expect(detectLanguage('just plain text')).toBe('text')
    })

    it('should detect empty string', () => {
      expect(detectLanguage('')).toBe('text')
    })
  })
})

describe('isValidJson', () => {
  it('should validate correct JSON object', () => {
    expect(isValidJson('{"name": "test"}')).toBe(true)
  })

  it('should validate correct JSON array', () => {
    expect(isValidJson('[1, 2, 3]')).toBe(true)
  })

  it('should validate nested JSON', () => {
    expect(isValidJson('{"user": {"name": "test", "items": [1, 2, 3]}}')).toBe(true)
  })

  it('should reject invalid JSON', () => {
    expect(isValidJson('{name: "test"}')).toBe(false)
  })

  it('should reject incomplete JSON', () => {
    expect(isValidJson('{"name": "test"')).toBe(false)
  })

  it('should reject plain text', () => {
    expect(isValidJson('hello world')).toBe(false)
  })
})

describe('validateHtml', () => {
  it('should validate correct HTML', () => {
    const result = validateHtml('<div>content</div>')
    expect(result.valid).toBe(true)
  })

  it('should validate nested HTML', () => {
    const result = validateHtml('<div><p>text</p></div>')
    expect(result.valid).toBe(true)
  })

  it('should validate self-closing tags', () => {
    const result = validateHtml('<img src="test.jpg" />')
    expect(result.valid).toBe(true)
  })

  it('should validate HTML with DOCTYPE', () => {
    const result = validateHtml('<!DOCTYPE html><html><body></body></html>')
    expect(result.valid).toBe(true)
  })

  it('should validate HTML comments', () => {
    const result = validateHtml('<!-- comment --><div></div>')
    expect(result.valid).toBe(true)
  })

  it('should detect unclosed tags', () => {
    const result = validateHtml('<div>content')
    expect(result.valid).toBe(false)
    expect(result.error).toContain('未闭合')
  })

  it('should detect mismatched tags', () => {
    const result = validateHtml('<div></span>')
    expect(result.valid).toBe(false)
    expect(result.error).toContain('不匹配')
  })

  it('should detect extra closing tag', () => {
    const result = validateHtml('</div>')
    expect(result.valid).toBe(false)
    expect(result.error).toContain('未找到')
  })

  it('should allow empty string', () => {
    const result = validateHtml('')
    expect(result.valid).toBe(true)
  })
})

describe('validateCss', () => {
  it('should validate correct CSS', () => {
    const result = validateCss('.class { color: red; }')
    expect(result.valid).toBe(true)
  })

  it('should validate nested CSS', () => {
    const result = validateCss('.class { color: red; } .another { margin: 0; }')
    expect(result.valid).toBe(true)
  })

  it('should validate CSS with strings', () => {
    const result = validateCss('.class { content: "text"; }')
    expect(result.valid).toBe(true)
  })

  it('should detect missing closing brace', () => {
    const result = validateCss('.class { color: red;')
    expect(result.valid).toBe(false)
    expect(result.error).toContain('缺少闭合大括号')
  })

  it('should detect extra closing brace', () => {
    const result = validateCss('.class { color: red; } }')
    expect(result.valid).toBe(false)
    expect(result.error).toContain('多余的闭合大括号')
  })

  it('should detect unclosed string', () => {
    const result = validateCss('.class { content: "text; }')
    expect(result.valid).toBe(false)
    // 可能会检测到未闭合字符串或缺少大括号，两者都是正确的错误
    expect(result.error).toBeTruthy()
  })

  it('should allow empty string', () => {
    const result = validateCss('')
    expect(result.valid).toBe(true)
  })
})

describe('validateJavaScript', () => {
  it('should validate correct JavaScript', () => {
    const result = validateJavaScript('const x = 10;')
    expect(result.valid).toBe(true)
  })

  it('should validate function with braces', () => {
    const result = validateJavaScript('function test() { return true; }')
    expect(result.valid).toBe(true)
  })

  it('should validate nested structures', () => {
    const result = validateJavaScript('const obj = { key: [1, 2, 3] };')
    expect(result.valid).toBe(true)
  })

  it('should validate strings', () => {
    const result = validateJavaScript('const str = "hello (world)";')
    expect(result.valid).toBe(true)
  })

  it('should validate comments', () => {
    const result = validateJavaScript('// comment\nconst x = 1;')
    expect(result.valid).toBe(true)
  })

  it('should validate multi-line comments', () => {
    const result = validateJavaScript('/* comment */ const x = 1;')
    expect(result.valid).toBe(true)
  })

  it('should detect unclosed braces', () => {
    const result = validateJavaScript('function test() { return true;')
    expect(result.valid).toBe(false)
    expect(result.error).toContain('大括号')
  })

  it('should detect unclosed brackets', () => {
    const result = validateJavaScript('const arr = [1, 2, 3;')
    expect(result.valid).toBe(false)
    expect(result.error).toContain('中括号')
  })

  it('should detect unclosed parentheses', () => {
    const result = validateJavaScript('const result = (1 + 2;')
    expect(result.valid).toBe(false)
    expect(result.error).toContain('小括号')
  })

  it('should detect mismatched brackets', () => {
    const result = validateJavaScript('const obj = { key: [1, 2, 3} ];')
    expect(result.valid).toBe(false)
  })

  it('should detect unclosed string', () => {
    const result = validateJavaScript('const str = "hello;')
    expect(result.valid).toBe(false)
    expect(result.error).toContain('未闭合的字符串')
  })

  it('should detect unclosed multi-line comment', () => {
    const result = validateJavaScript('/* comment')
    expect(result.valid).toBe(false)
    expect(result.error).toContain('未闭合的多行注释')
  })

  it('should allow empty string', () => {
    const result = validateJavaScript('')
    expect(result.valid).toBe(true)
  })
})

describe('validateContent', () => {
  it('should validate and detect JSON', () => {
    const result = validateContent('{"name": "test"}')
    expect(result.valid).toBe(true)
    expect(result.type).toBe('JSON')
  })

  it('should validate and detect HTML', () => {
    const result = validateContent('<div>content</div>')
    expect(result.valid).toBe(true)
    expect(result.type).toBe('HTML')
  })

  it('should validate and detect CSS', () => {
    const result = validateContent('.class { color: red; }')
    expect(result.valid).toBe(true)
    expect(result.type).toBe('CSS')
  })

  it('should validate and detect JavaScript', () => {
    const result = validateContent('const x = 10;')
    expect(result.valid).toBe(true)
    expect(result.type).toBe('JavaScript')
  })

  it('should detect invalid HTML', () => {
    const result = validateContent('<div>unclosed')
    expect(result.valid).toBe(false)
    expect(result.type).toBe('HTML')
  })

  it('should detect invalid CSS', () => {
    const result = validateContent('.class { color: red;')
    expect(result.valid).toBe(false)
    expect(result.type).toBe('CSS')
  })

  it('should detect invalid JavaScript', () => {
    const result = validateContent('function test() {')
    expect(result.valid).toBe(false)
    expect(result.type).toBe('JavaScript')
  })

  it('should allow empty string', () => {
    const result = validateContent('')
    expect(result.valid).toBe(true)
  })

  it('should allow plain text', () => {
    const result = validateContent('just some text')
    expect(result.valid).toBe(true)
    expect(result.type).toBe('Text')
  })
})
