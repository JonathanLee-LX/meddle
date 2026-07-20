import { describe, it, expect } from 'vitest'
import { getResourceType } from './resource-type'
import type { ProxyRecord } from '@/types'

describe('getResourceType', () => {
  const createRecord = (source: string, method: string = 'GET'): ProxyRecord => ({
    id: 1,
    method,
    source,
    target: 'example.com',
    time: '12:00:00',
  })

  describe('WebSocket', () => {
    it('should identify ws:// URLs as websocket', () => {
      const record = createRecord('ws://example.com/socket')
      expect(getResourceType(record)).toBe('websocket')
    })

    it('should identify wss:// URLs as websocket', () => {
      const record = createRecord('wss://example.com/socket')
      expect(getResourceType(record)).toBe('websocket')
    })
  })

  describe('Fetch/XHR', () => {
    it('should identify POST requests as fetch', () => {
      const record = createRecord('http://example.com/data', 'POST')
      expect(getResourceType(record)).toBe('fetch')
    })

    it('should identify PUT requests as fetch', () => {
      const record = createRecord('http://example.com/data', 'PUT')
      expect(getResourceType(record)).toBe('fetch')
    })

    it('should identify DELETE requests as fetch', () => {
      const record = createRecord('http://example.com/data', 'DELETE')
      expect(getResourceType(record)).toBe('fetch')
    })

    it('should identify /api/ URLs as fetch', () => {
      const record = createRecord('http://example.com/api/users')
      expect(getResourceType(record)).toBe('fetch')
    })

    it('should identify .json files as fetch', () => {
      const record = createRecord('http://example.com/data.json')
      expect(getResourceType(record)).toBe('fetch')
    })
  })

  describe('Documents', () => {
    it('should identify .html files as doc', () => {
      const record = createRecord('http://example.com/page.html')
      expect(getResourceType(record)).toBe('doc')
    })

    it('should identify .htm files as doc', () => {
      const record = createRecord('http://example.com/page.htm')
      expect(getResourceType(record)).toBe('doc')
    })

    it('should identify .php files as doc', () => {
      const record = createRecord('http://example.com/index.php')
      expect(getResourceType(record)).toBe('doc')
    })

    it('should identify URLs without extension as doc', () => {
      const record = createRecord('http://example.com/page')
      expect(getResourceType(record)).toBe('doc')
    })

    it('should identify root URLs as doc', () => {
      const record = createRecord('http://example.com/')
      expect(getResourceType(record)).toBe('doc')
    })
  })

  describe('CSS', () => {
    it('should identify .css files', () => {
      const record = createRecord('http://example.com/style.css')
      expect(getResourceType(record)).toBe('css')
    })

    it('should handle query parameters', () => {
      const record = createRecord('http://example.com/style.css?v=123')
      expect(getResourceType(record)).toBe('css')
    })
  })

  describe('JavaScript', () => {
    it('should identify .js files', () => {
      const record = createRecord('http://example.com/app.js')
      expect(getResourceType(record)).toBe('js')
    })

    it('should identify .mjs files', () => {
      const record = createRecord('http://example.com/module.mjs')
      expect(getResourceType(record)).toBe('js')
    })

    it('should identify .ts files', () => {
      const record = createRecord('http://example.com/app.ts')
      expect(getResourceType(record)).toBe('js')
    })

    it('should identify .tsx files', () => {
      const record = createRecord('http://example.com/component.tsx')
      expect(getResourceType(record)).toBe('js')
    })
  })

  describe('Fonts', () => {
    it('should identify .woff files', () => {
      const record = createRecord('http://example.com/font.woff')
      expect(getResourceType(record)).toBe('font')
    })

    it('should identify .woff2 files', () => {
      const record = createRecord('http://example.com/font.woff2')
      expect(getResourceType(record)).toBe('font')
    })

    it('should identify .ttf files', () => {
      const record = createRecord('http://example.com/font.ttf')
      expect(getResourceType(record)).toBe('font')
    })

    it('should identify .otf files', () => {
      const record = createRecord('http://example.com/font.otf')
      expect(getResourceType(record)).toBe('font')
    })
  })

  describe('Images', () => {
    it('should identify .png files', () => {
      const record = createRecord('http://example.com/image.png')
      expect(getResourceType(record)).toBe('img')
    })

    it('should identify .jpg files', () => {
      const record = createRecord('http://example.com/image.jpg')
      expect(getResourceType(record)).toBe('img')
    })

    it('should identify .jpeg files', () => {
      const record = createRecord('http://example.com/image.jpeg')
      expect(getResourceType(record)).toBe('img')
    })

    it('should identify .gif files', () => {
      const record = createRecord('http://example.com/image.gif')
      expect(getResourceType(record)).toBe('img')
    })

    it('should identify .svg files', () => {
      const record = createRecord('http://example.com/icon.svg')
      expect(getResourceType(record)).toBe('img')
    })

    it('should identify .webp files', () => {
      const record = createRecord('http://example.com/image.webp')
      expect(getResourceType(record)).toBe('img')
    })

    it('should identify .ico files', () => {
      const record = createRecord('http://example.com/favicon.ico')
      expect(getResourceType(record)).toBe('img')
    })
  })

  describe('Media', () => {
    it('should identify .mp4 files', () => {
      const record = createRecord('http://example.com/video.mp4')
      expect(getResourceType(record)).toBe('media')
    })

    it('should identify .webm files', () => {
      const record = createRecord('http://example.com/video.webm')
      expect(getResourceType(record)).toBe('media')
    })

    it('should identify .mp3 files', () => {
      const record = createRecord('http://example.com/audio.mp3')
      expect(getResourceType(record)).toBe('media')
    })

    it('should identify .wav files', () => {
      const record = createRecord('http://example.com/audio.wav')
      expect(getResourceType(record)).toBe('media')
    })
  })

  describe('Manifest', () => {
    it('should identify .manifest files', () => {
      const record = createRecord('http://example.com/app.manifest')
      expect(getResourceType(record)).toBe('manifest')
    })

    it('should identify .webmanifest files', () => {
      const record = createRecord('http://example.com/manifest.webmanifest')
      expect(getResourceType(record)).toBe('manifest')
    })
  })

  describe('WASM', () => {
    it('should identify .wasm files', () => {
      const record = createRecord('http://example.com/module.wasm')
      expect(getResourceType(record)).toBe('wasm')
    })
  })

  describe('Other', () => {
    it('should identify unknown extensions as other', () => {
      const record = createRecord('http://example.com/file.xyz')
      expect(getResourceType(record)).toBe('other')
    })

    it('should identify .pdf files as other', () => {
      const record = createRecord('http://example.com/document.pdf')
      expect(getResourceType(record)).toBe('other')
    })
  })

  describe('Edge cases', () => {
    it('should handle uppercase extensions', () => {
      const record = createRecord('http://example.com/STYLE.CSS')
      expect(getResourceType(record)).toBe('css')
    })

    it('should handle mixed case URLs', () => {
      const record = createRecord('HTTP://EXAMPLE.COM/API/DATA')
      expect(getResourceType(record)).toBe('fetch')
    })

    it('should handle URLs with multiple query parameters', () => {
      const record = createRecord('http://example.com/app.js?v=1.0&t=12345')
      expect(getResourceType(record)).toBe('js')
    })

    it('should handle URLs with hash fragments', () => {
      const record = createRecord('http://example.com/page.html#section1')
      expect(getResourceType(record)).toBe('doc')
    })

    it('should tolerate malformed records', () => {
      const record = {
        id: 1,
        method: undefined,
        source: undefined,
        target: 'example.com',
        time: '12:00:00',
      } as unknown as ProxyRecord
      expect(getResourceType(record)).toBe('other')
    })
  })
})
