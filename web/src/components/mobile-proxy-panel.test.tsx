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
    expect(screen.getByRole('button', { name: '复制手机配置地址' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '复制地址' })).not.toBeInTheDocument()
    expect(screen.queryByText('手机配置地址')).not.toBeInTheDocument()
    expect(screen.queryByText('http://192.168.1.10:8989/')).not.toBeInTheDocument()
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

  it('shows a recoverable error when the server does not expose remote access info', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<!DOCTYPE html>Not Found', {
      headers: { 'Content-Type': 'text/html' },
      status: 404,
    })))

    render(<MobileProxyPanel />)

    expect(await screen.findByText('加载失败')).toBeInTheDocument()
    expect(screen.getByText('手机代理接口不可用，请重启 Easy Proxy 服务后重试')).toBeInTheDocument()
  })
})
