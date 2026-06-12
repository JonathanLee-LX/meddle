import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MobileProxyPanel } from './mobile-proxy-panel'

vi.mock('qrcode', () => ({
  default: {
    toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,qr-code'),
  },
}))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('MobileProxyPanel', () => {
  it('renders the QR code and remote proxy links', async () => {
    const response = {
      enabled: true,
      interceptHttps: true,
      authenticationRequired: false,
      proxyPort: 8989,
      localSetupPath: '/_easy-proxy/setup',
      targets: [{
        address: '192.168.1.10',
        proxyUrl: 'http://192.168.1.10:8989',
        setupUrl: 'http://192.168.1.10:8989/',
        certificateUrl: 'http://192.168.1.10:8989/_easy-proxy/ca.crt',
      }],
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(response), {
      headers: { 'Content-Type': 'application/json' },
    })))

    render(<MobileProxyPanel />)

    expect(await screen.findByText('192.168.1.10:8989')).toBeInTheDocument()
    expect(await screen.findByRole('img', {
      name: '打开 http://192.168.1.10:8989/ 的二维码',
    })).toHaveAttribute('src', 'data:image/png;base64,qr-code')
    expect(screen.getByRole('link', { name: '浏览器打开' }))
      .toHaveAttribute('href', 'http://192.168.1.10:8989/')
    expect(screen.getByRole('link', { name: '下载根证书' }))
      .toHaveAttribute('href', 'http://192.168.1.10:8989/_easy-proxy/ca.crt')
  })

  it('shows the startup command when remote mode is disabled', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      enabled: false,
      interceptHttps: false,
      authenticationRequired: false,
      proxyPort: 8989,
      localSetupPath: '/_easy-proxy/setup',
      targets: [],
    }), {
      headers: { 'Content-Type': 'application/json' },
    })))

    render(<MobileProxyPanel />)

    expect(await screen.findByText('远程代理尚未开启')).toBeInTheDocument()
    expect(screen.getByText('ep --remote')).toBeInTheDocument()
  })
})
