import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from '@/components/ui/toast'
import { copyText } from '@/utils/clipboard'
import { MobileProxyPanel } from './mobile-proxy-panel'

vi.mock('qrcode', () => ({
  default: {
    toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,qr-code'),
  },
}))

vi.mock('@/components/ui/toast', () => ({
  toast: {
    success: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('@/utils/clipboard', () => ({
  copyText: vi.fn().mockResolvedValue(undefined),
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('MobileProxyPanel', () => {
  it('renders the QR code and remote proxy links', async () => {
    const response = {
      enabled: true,
      interceptHttps: true,
      authenticationRequired: false,
      proxyPort: 8989,
      localSetupPath: '/_meddle/setup',
      targets: [{
        address: '192.168.1.10',
        proxyUrl: 'http://192.168.1.10:8989',
        setupUrl: 'http://192.168.1.10:8989/',
        certificateUrl: 'http://192.168.1.10:8989/_meddle/ca.crt',
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
      .toHaveAttribute('href', 'http://192.168.1.10:8989/_meddle/ca.crt')
    expect(screen.getByRole('button', { name: '复制手机配置地址' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '复制地址' })).not.toBeInTheDocument()
    expect(screen.queryByText('手机配置地址')).not.toBeInTheDocument()
    expect(screen.queryByText('http://192.168.1.10:8989/')).not.toBeInTheDocument()
  })

  it('copies the selected setup URL and confirms the action', async () => {
    const response = {
      enabled: true,
      interceptHttps: true,
      authenticationRequired: false,
      proxyPort: 8989,
      localSetupPath: '/_meddle/setup',
      targets: [{
        address: '192.168.1.10',
        proxyUrl: 'http://192.168.1.10:8989',
        setupUrl: 'http://192.168.1.10:8989/',
        certificateUrl: 'http://192.168.1.10:8989/_meddle/ca.crt',
      }],
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(response), {
      headers: { 'Content-Type': 'application/json' },
    })))

    render(<MobileProxyPanel />)
    const copyButton = await screen.findByRole('button', { name: '复制手机配置地址' })
    await userEvent.click(copyButton)

    expect(copyText).toHaveBeenCalledWith('http://192.168.1.10:8989/')
    expect(await screen.findByRole('button', { name: '地址已复制' })).toBeInTheDocument()
    expect(toast.success).toHaveBeenCalledWith('手机配置地址已复制')
  })

  it('shows a selected manual-copy field when browser clipboard access is denied', async () => {
    vi.mocked(copyText).mockRejectedValueOnce(new Error('clipboard denied'))
    const response = {
      enabled: true,
      interceptHttps: true,
      authenticationRequired: false,
      proxyPort: 8989,
      localSetupPath: '/_meddle/setup',
      targets: [{
        address: '192.168.1.10',
        proxyUrl: 'http://192.168.1.10:8989',
        setupUrl: 'http://192.168.1.10:8989/',
        certificateUrl: 'http://192.168.1.10:8989/_meddle/ca.crt',
      }],
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(response), {
      headers: { 'Content-Type': 'application/json' },
    })))

    render(<MobileProxyPanel />)
    await userEvent.click(await screen.findByRole('button', { name: '复制手机配置地址' }))

    const manualCopyInput = await screen.findByRole('textbox', { name: '手动复制手机配置地址' })
    expect(manualCopyInput).toHaveValue('http://192.168.1.10:8989/')
    expect(manualCopyInput).toHaveFocus()
    expect(manualCopyInput).toHaveProperty('selectionStart', 0)
    expect(manualCopyInput).toHaveProperty('selectionEnd', 'http://192.168.1.10:8989/'.length)
    expect(toast.info).toHaveBeenCalledWith('浏览器禁止自动复制，地址已选中')
  })

  it('shows the startup command when remote mode is disabled', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      enabled: false,
      interceptHttps: false,
      authenticationRequired: false,
      proxyPort: 8989,
      localSetupPath: '/_meddle/setup',
      targets: [],
    }), {
      headers: { 'Content-Type': 'application/json' },
    })))

    render(<MobileProxyPanel />)

    expect(await screen.findByText('远程代理尚未开启')).toBeInTheDocument()
    expect(screen.getByText('meddle --remote')).toBeInTheDocument()
  })

  it('renders the public entry target without LAN labels', async () => {
    const response = {
      enabled: true,
      interceptHttps: true,
      authenticationRequired: false,
      proxyPort: 8284,
      localSetupPath: '/_meddle/setup',
      targets: [{
        address: 'meddle.livs.top',
        proxyUrl: 'https://meddle.livs.top',
        setupUrl: 'https://meddle.livs.top/',
        certificateUrl: 'https://meddle.livs.top/_meddle/ca.crt',
      }],
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(response), {
      headers: { 'Content-Type': 'application/json' },
    })))

    render(<MobileProxyPanel />)

    expect(await screen.findByRole('img', {
      name: '打开 https://meddle.livs.top/ 的二维码',
    })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '下载根证书' }))
      .toHaveAttribute('href', 'https://meddle.livs.top/_meddle/ca.crt')
    expect(screen.getByRole('link', { name: '浏览器打开' }))
      .toHaveAttribute('href', 'https://meddle.livs.top/')
    expect(screen.getByText('公网入口')).toBeInTheDocument()
    expect(screen.queryByText('局域网')).not.toBeInTheDocument()
    expect(screen.queryByText('meddle.livs.top:8284')).not.toBeInTheDocument()
  })

  it('infers the public entry from window.location when the UI is served on a public domain', async () => {
    const originalLocation = window.location
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: new URL('https://meddle.livs.top/'),
    })
    try {
      const response = {
        enabled: true,
        interceptHttps: true,
        authenticationRequired: false,
        proxyPort: 8284,
        localSetupPath: '/_meddle/setup',
        targets: [{
          address: '192.168.1.10',
          proxyUrl: 'http://192.168.1.10:8284',
          setupUrl: 'http://192.168.1.10:8284/',
          certificateUrl: 'http://192.168.1.10:8284/_meddle/ca.crt',
        }],
      }
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(response), {
        headers: { 'Content-Type': 'application/json' },
      })))

      render(<MobileProxyPanel />)

      expect(await screen.findByRole('img', {
        name: '打开 https://meddle.livs.top/ 的二维码',
      })).toBeInTheDocument()
      expect(screen.getByRole('link', { name: '下载根证书' }))
        .toHaveAttribute('href', 'https://meddle.livs.top/_meddle/ca.crt')
      expect(screen.getByText('公网入口')).toBeInTheDocument()
    } finally {
      Object.defineProperty(window, 'location', {
        configurable: true,
        value: originalLocation,
      })
    }
  })

  it('does not infer a public entry when the UI is served from localhost', async () => {
    const response = {
      enabled: true,
      interceptHttps: true,
      authenticationRequired: false,
      proxyPort: 8284,
      localSetupPath: '/_meddle/setup',
      targets: [{
        address: '192.168.1.10',
        proxyUrl: 'http://192.168.1.10:8284',
        setupUrl: 'http://192.168.1.10:8284/',
        certificateUrl: 'http://192.168.1.10:8284/_meddle/ca.crt',
      }],
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(response), {
      headers: { 'Content-Type': 'application/json' },
    })))

    render(<MobileProxyPanel />)

    expect(await screen.findByRole('img', {
      name: '打开 http://192.168.1.10:8284/ 的二维码',
    })).toBeInTheDocument()
    expect(screen.getByText('局域网')).toBeInTheDocument()
    expect(screen.queryByText('公网入口')).not.toBeInTheDocument()
  })

  it('shows a recoverable error when the server does not expose remote access info', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<!DOCTYPE html>Not Found', {
      headers: { 'Content-Type': 'text/html' },
      status: 404,
    })))

    render(<MobileProxyPanel />)

    expect(await screen.findByText('加载失败')).toBeInTheDocument()
    expect(screen.getByText('手机代理接口不可用，请重启 Meddle 服务后重试')).toBeInTheDocument()
  })
})
