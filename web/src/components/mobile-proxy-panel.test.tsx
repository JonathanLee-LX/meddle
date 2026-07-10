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

  it('copies the selected setup URL and confirms the action', async () => {
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
