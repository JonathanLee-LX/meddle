import { describe, it, expect } from 'vitest'
import { createMockFromLog } from './mock-factory'

describe('mock-factory', () => {
  describe('createMockFromLog', () => {
    it('should create basic mock from log data', () => {
      const logData = {
        source: 'https://api.example.com/users',
        responseBody: '{"users": []}',
        statusCode: 200,
      }

      const result = createMockFromLog(logData)

      expect(result).toEqual({
        urlPattern: 'https://api\\.example\\.com/users',
        body: '{"users": []}',
        statusCode: 200,
        headers: {},
        name: '从日志创建',
        method: '*',
        enabled: true,
      })
    })

    it('should escape special regex characters in URL', () => {
      const logData = {
        source: 'https://api.example.com/users?id=123&name=test',
        responseBody: '{}',
        statusCode: 200,
      }

      const result = createMockFromLog(logData)

      expect(result.urlPattern).toBe('https://api\\.example\\.com/users\\?id=123&name=test')
    })

    it('should filter out default headers', () => {
      const logData = {
        source: 'https://api.example.com/users',
        responseBody: '{}',
        statusCode: 200,
        responseHeaders: {
          'content-type': 'application/json',
          'content-length': '123',
          'content-encoding': 'gzip',
          'connection': 'keep-alive',
          'date': 'Mon, 01 Jan 2024 00:00:00 GMT',
          'etag': '"abc123"',
          'server': 'nginx',
          'x-custom-header': 'custom-value',
        },
      }

      const result = createMockFromLog(logData)

      // Should only keep x-custom-header, filter out default headers
      expect(result.headers).toEqual({
        'content-type': 'application/json',
        'x-custom-header': 'custom-value',
      })
    })

    it('should remove truncation prefix from response body', () => {
      const logData = {
        source: 'https://api.example.com/users',
        responseBody: '(truncated, 5000 bytes)\n{"users": []}',
        statusCode: 200,
      }

      const result = createMockFromLog(logData)

      expect(result.body).toBe('{"users": []}')
      expect(result.body).not.toContain('truncated')
    })

    it('should handle response body without truncation', () => {
      const logData = {
        source: 'https://api.example.com/users',
        responseBody: '{"users": []}',
        statusCode: 200,
      }

      const result = createMockFromLog(logData)

      expect(result.body).toBe('{"users": []}')
    })

    it('should handle missing responseHeaders', () => {
      const logData = {
        source: 'https://api.example.com/users',
        responseBody: '{}',
        statusCode: 404,
      }

      const result = createMockFromLog(logData)

      expect(result.headers).toEqual({})
      expect(result.statusCode).toBe(404)
    })

    it('should preserve status codes', () => {
      const statusCodes = [200, 201, 404, 500]

      statusCodes.forEach((code) => {
        const result = createMockFromLog({
          source: 'https://api.example.com/test',
          responseBody: '{}',
          statusCode: code,
        })

        expect(result.statusCode).toBe(code)
      })
    })
  })
})
