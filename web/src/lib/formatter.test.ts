import { describe, expect, it } from 'vitest'
import { detectContentType, formatContent } from './formatter'

describe('formatter', () => {
  it('detects supported content types', () => {
    expect(detectContentType('{"name":"meddle"}')).toBe('json')
    expect(detectContentType('<div>content</div>')).toBe('html')
    expect(detectContentType('body{color:red}')).toBe('css')
    expect(detectContentType('const value={enabled:true}')).toBe('javascript')
  })

  it('loads the JSON parser and formats content', async () => {
    await expect(formatContent('{"name":"meddle","enabled":true}')).resolves.toEqual({
      formatted: '{\n  "name": "meddle",\n  "enabled": true\n}',
      type: 'JSON',
    })
  })

  it('loads the Babel parser and formats JavaScript', async () => {
    const result = await formatContent('const value={enabled:true}')

    expect(result.type).toBe('JavaScript')
    expect(result.formatted).toBe("const value = { enabled: true };")
  })
})
