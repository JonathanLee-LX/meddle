import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as thirdPartyPluginsFlag from '@/lib/third-party-plugins'
import { usePlugins } from './use-plugins'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('usePlugins', () => {
  it('does not call third-party endpoints while the loader is hidden', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => usePlugins())

    await act(async () => {
      await result.current.fetchThirdPartyPlugins()
      await result.current.loadThirdPartyPlugin('/tmp/vendor-plugin')
      await result.current.unloadThirdPartyPlugin('vendor.audit')
    })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.current.thirdPartyPlugins).toEqual([])
    expect(result.current.thirdPartySecurity).toEqual({ allowAll: false, trusted: [] })
  })

  it('treats a non-JSON third-party endpoint response as unsupported when the loader is enabled', async () => {
    vi.spyOn(thirdPartyPluginsFlag, 'isThirdPartyPluginsEnabled').mockReturnValue(true)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const fetchMock = vi.fn().mockResolvedValue(new Response('<!DOCTYPE html>', {
      headers: { 'Content-Type': 'text/html' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => usePlugins())

    await act(async () => {
      await result.current.fetchThirdPartyPlugins()
    })

    await waitFor(() => {
      expect(result.current.thirdPartyPlugins).toEqual([])
      expect(result.current.thirdPartySecurity).toEqual({ allowAll: false, trusted: [] })
    })
    expect(fetchMock).toHaveBeenCalledWith('/api/plugins/third-party')
    expect(consoleError).not.toHaveBeenCalled()
  })
})
