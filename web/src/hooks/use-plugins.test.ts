import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { usePlugins } from './use-plugins'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('usePlugins', () => {
  it('treats a non-JSON third-party endpoint response as unsupported', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<!DOCTYPE html>', {
      headers: { 'Content-Type': 'text/html' },
    })))

    const { result } = renderHook(() => usePlugins())

    await act(async () => {
      await result.current.fetchThirdPartyPlugins()
    })

    await waitFor(() => {
      expect(result.current.thirdPartyPlugins).toEqual([])
      expect(result.current.thirdPartySecurity).toEqual({ allowAll: false, trusted: [] })
    })
    expect(consoleError).not.toHaveBeenCalled()
  })
})
