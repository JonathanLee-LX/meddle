import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useFuzzyFilter } from './use-fuzzy-filter'
import type { ProxyRecord } from '@/types'

describe('useFuzzyFilter', () => {
  const mockRecords: ProxyRecord[] = [
    { id: 1, method: 'GET', source: 'http://example.com/api/users', target: 'localhost:3000', time: '12:00:00' },
    { id: 2, method: 'POST', source: 'http://example.com/api/login', target: 'localhost:3000', time: '12:00:01' },
    { id: 3, method: 'GET', source: 'http://example.com/style.css', target: 'localhost:3000', time: '12:00:02' },
    { id: 4, method: 'GET', source: 'http://example.com/app.js', target: 'localhost:3000', time: '12:00:03' },
    { id: 5, method: 'GET', source: 'http://example.com/logo.png', target: 'localhost:3000', time: '12:00:04' },
    { id: 6, method: 'GET', source: 'http://example.com/index.html', target: 'localhost:3000', time: '12:00:05' },
    { id: 7, method: 'GET', source: 'http://test.com/data', target: 'localhost:4000', time: '12:00:06', statusCode: 200 },
    { id: 8, method: 'GET', source: 'http://test.com/error', target: 'localhost:4000', time: '12:00:07', statusCode: 404 },
    { id: 9, method: 'DELETE', source: 'http://api.test.com/users/1', target: 'localhost:3000', time: '12:00:08' },
  ]
  const malformedRecord = {
    id: 10,
    method: undefined,
    source: undefined,
    target: undefined,
    time: undefined,
  } as unknown as ProxyRecord

  describe('Resource Type Filtering', () => {
    it('should return all records when filter is "all"', () => {
      const { result } = renderHook(() => useFuzzyFilter(mockRecords))
      expect(result.current.filteredRecords).toHaveLength(mockRecords.length)
    })

    it('should filter by "fetch" resource type', () => {
      const { result } = renderHook(() => useFuzzyFilter(mockRecords))
      
      act(() => {
        result.current.setResourceTypeFilter('fetch')
      })

      // Should include: /api/users, /api/login, DELETE request
      expect(result.current.filteredRecords.length).toBeGreaterThan(0)
      const sources = result.current.filteredRecords.map(r => r.source)
      expect(sources).toContain('http://example.com/api/users')
      expect(sources).toContain('http://example.com/api/login')
      expect(sources).toContain('http://api.test.com/users/1')
    })

    it('should filter by "css" resource type', () => {
      const { result } = renderHook(() => useFuzzyFilter(mockRecords))
      
      act(() => {
        result.current.setResourceTypeFilter('css')
      })

      expect(result.current.filteredRecords).toHaveLength(1)
      expect(result.current.filteredRecords[0].source).toBe('http://example.com/style.css')
    })

    it('should filter by "js" resource type', () => {
      const { result } = renderHook(() => useFuzzyFilter(mockRecords))
      
      act(() => {
        result.current.setResourceTypeFilter('js')
      })

      expect(result.current.filteredRecords).toHaveLength(1)
      expect(result.current.filteredRecords[0].source).toBe('http://example.com/app.js')
    })

    it('should filter by "img" resource type', () => {
      const { result } = renderHook(() => useFuzzyFilter(mockRecords))
      
      act(() => {
        result.current.setResourceTypeFilter('img')
      })

      expect(result.current.filteredRecords).toHaveLength(1)
      expect(result.current.filteredRecords[0].source).toBe('http://example.com/logo.png')
    })

    it('should filter by "doc" resource type', () => {
      const { result } = renderHook(() => useFuzzyFilter(mockRecords))
      
      act(() => {
        result.current.setResourceTypeFilter('doc')
      })

      // Should include .html files and URLs without extensions
      expect(result.current.filteredRecords.length).toBeGreaterThan(0)
      const sources = result.current.filteredRecords.map(r => r.source)
      expect(sources).toContain('http://example.com/index.html')
    })
  })

  describe('Text Filtering', () => {
    it('should filter by plain text', () => {
      const { result } = renderHook(() => useFuzzyFilter(mockRecords))
      
      act(() => {
        result.current.setFilterText('users')
      })

      // Should filter to only records containing 'users'
      expect(result.current.filteredRecords.length).toBeGreaterThan(0)
      expect(result.current.filteredRecords.length).toBeLessThan(mockRecords.length)
      const sources = result.current.filteredRecords.map(r => r.source.toLowerCase())
      expect(sources.every(s => s.includes('users'))).toBe(true)
    })

    it('should filter by method:GET', () => {
      const { result } = renderHook(() => useFuzzyFilter(mockRecords))
      
      act(() => {
        result.current.setFilterText('method:GET')
      })

      expect(result.current.filteredRecords.every(r => r.method === 'GET')).toBe(true)
    })

    it('should filter by method:POST', () => {
      const { result } = renderHook(() => useFuzzyFilter(mockRecords))
      
      act(() => {
        result.current.setFilterText('method:POST')
      })

      expect(result.current.filteredRecords).toHaveLength(1)
      expect(result.current.filteredRecords[0].method).toBe('POST')
    })

    it('should filter by status:404', () => {
      const { result } = renderHook(() => useFuzzyFilter(mockRecords))
      
      act(() => {
        result.current.setFilterText('status:404')
      })

      expect(result.current.filteredRecords).toHaveLength(1)
      expect(result.current.filteredRecords[0].statusCode).toBe(404)
    })

    it('should filter by status:2xx pattern', () => {
      const { result } = renderHook(() => useFuzzyFilter(mockRecords))
      
      act(() => {
        result.current.setFilterText('status:2xx')
      })

      expect(result.current.filteredRecords.every(r => r.statusCode && r.statusCode >= 200 && r.statusCode < 300)).toBe(true)
    })

    it('should filter by status:4xx pattern', () => {
      const { result } = renderHook(() => useFuzzyFilter(mockRecords))
      
      act(() => {
        result.current.setFilterText('status:4xx')
      })

      expect(result.current.filteredRecords).toHaveLength(1)
      expect(result.current.filteredRecords[0].statusCode).toBe(404)
    })

    it('should filter by domain:test.com', () => {
      const { result } = renderHook(() => useFuzzyFilter(mockRecords))
      
      act(() => {
        result.current.setFilterText('domain:test.com')
      })

      const sources = result.current.filteredRecords.map(r => r.source)
      expect(sources.every(s => s.includes('test.com'))).toBe(true)
    })

    it('should support negative filters with -keyword', () => {
      const { result } = renderHook(() => useFuzzyFilter(mockRecords))
      
      act(() => {
        result.current.setFilterText('-api')
      })

      const sources = result.current.filteredRecords.map(r => r.source)
      expect(sources.every(s => !s.includes('api'))).toBe(true)
    })

    it('should support multiple filters with AND logic', () => {
      const { result } = renderHook(() => useFuzzyFilter(mockRecords))
      
      act(() => {
        result.current.setFilterText('method:GET domain:example.com')
      })

      expect(result.current.filteredRecords.every(r => 
        r.method === 'GET' && r.source.includes('example.com')
      )).toBe(true)
    })

    it('should support fuzzy matching', () => {
      const { result } = renderHook(() => useFuzzyFilter(mockRecords))
      
      act(() => {
        result.current.setFilterText('exmpl')
      })

      // Fuzzy match should find "example"
      expect(result.current.filteredRecords.length).toBeGreaterThan(0)
    })
  })

  describe('Combined Filtering', () => {
    it('should apply both resource type and text filters', () => {
      const { result } = renderHook(() => useFuzzyFilter(mockRecords))
      
      act(() => {
        result.current.setResourceTypeFilter('fetch')
        result.current.setFilterText('example.com')
      })

      // Should only include fetch requests from example.com
      expect(result.current.filteredRecords.every(r => 
        r.source.includes('example.com')
      )).toBe(true)
    })

    it('should clear filters when switching to "all"', () => {
      const { result } = renderHook(() => useFuzzyFilter(mockRecords))
      
      act(() => {
        result.current.setResourceTypeFilter('css')
      })
      expect(result.current.filteredRecords).toHaveLength(1)

      act(() => {
        result.current.setResourceTypeFilter('all')
      })
      expect(result.current.filteredRecords).toHaveLength(mockRecords.length)
    })

    it('should update filters independently', () => {
      const { result } = renderHook(() => useFuzzyFilter(mockRecords))
      
      act(() => {
        result.current.setResourceTypeFilter('js')
      })
      expect(result.current.filteredRecords).toHaveLength(1)

      act(() => {
        result.current.setFilterText('style')
      })
      // JS filter still active, no results for "style" in JS files
      expect(result.current.filteredRecords).toHaveLength(0)

      act(() => {
        result.current.setResourceTypeFilter('all')
      })
      // Now with "all", should find style.css
      expect(result.current.filteredRecords.length).toBeGreaterThan(0)
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty records array', () => {
      const { result } = renderHook(() => useFuzzyFilter([]))
      expect(result.current.filteredRecords).toHaveLength(0)
    })

    it('should tolerate malformed records during filtering', () => {
      const { result } = renderHook(() => useFuzzyFilter([...mockRecords, malformedRecord]))

      act(() => {
        result.current.setResourceTypeFilter('fetch')
        result.current.setFilterText('users')
      })

      expect(result.current.filteredRecords.length).toBeGreaterThan(0)
    })

    it('should handle empty filter text', () => {
      const { result } = renderHook(() => useFuzzyFilter(mockRecords))
      
      act(() => {
        result.current.setFilterText('')
      })

      expect(result.current.filteredRecords).toHaveLength(mockRecords.length)
    })

    it('should handle whitespace-only filter text', () => {
      const { result } = renderHook(() => useFuzzyFilter(mockRecords))
      
      act(() => {
        result.current.setFilterText('   ')
      })

      expect(result.current.filteredRecords).toHaveLength(mockRecords.length)
    })

    it('should be case-insensitive for text filters', () => {
      const { result } = renderHook(() => useFuzzyFilter(mockRecords))
      
      act(() => {
        result.current.setFilterText('EXAMPLE')
      })

      expect(result.current.filteredRecords.length).toBeGreaterThan(0)
    })
  })
})
