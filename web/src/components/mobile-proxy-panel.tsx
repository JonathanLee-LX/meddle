import { useEffect, useMemo, useState } from 'react'
import QRCode from 'qrcode'
import { Check, Copy, Download, ExternalLink, Loader2, QrCode, RefreshCw, ShieldCheck, ShieldOff, Smartphone, Wifi } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { apiGet } from '@/utils/api-client'

interface RemoteAccessTarget {
  address: string
  proxyUrl: string
  setupUrl: string
  certificateUrl: string
}

interface RemoteAccessInfo {
  enabled: boolean
  interceptHttps: boolean
  authenticationRequired: boolean
  proxyPort: number | null
  localSetupPath: string
  targets: RemoteAccessTarget[]
}

export function MobileProxyPanel() {
  const [info, setInfo] = useState<RemoteAccessInfo | null>(null)
  const [selectedAddress, setSelectedAddress] = useState('')
  const [qrCodeUrl, setQrCodeUrl] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  const loadInfo = async () => {
    setLoading(true)
    setError('')
    try {
      const result = await apiGet<RemoteAccessInfo>('/api/remote-access')
      setInfo(result)
      setSelectedAddress((current) => (result.targets.some((target) => target.address === current) ? current : result.targets[0]?.address || ''))
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '无法读取远程代理状态')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadInfo()
  }, [])

  const selectedTarget = useMemo(() => info?.targets.find((target) => target.address === selectedAddress) || info?.targets[0] || null, [info, selectedAddress])

  useEffect(() => {
    let cancelled = false
    if (!selectedTarget) {
      setQrCodeUrl('')
      return
    }

    QRCode.toDataURL(selectedTarget.setupUrl, {
      width: 320,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: {
        dark: '#111827',
        light: '#ffffff',
      },
    })
      .then((dataUrl) => {
        if (!cancelled) setQrCodeUrl(dataUrl)
      })
      .catch((qrError) => {
        if (!cancelled) setError(qrError instanceof Error ? qrError.message : '二维码生成失败')
      })

    return () => {
      cancelled = true
    }
  }, [selectedTarget])

  const copySetupUrl = async () => {
    if (!selectedTarget) return
    await navigator.clipboard.writeText(selectedTarget.setupUrl)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  if (loading) {
    return (
      <div className="grid h-full gap-6 p-6 md:grid-cols-[340px_1fr]" aria-label="正在读取手机代理状态">
        <Skeleton className="min-h-[420px] w-full" />
        <div className="flex flex-col gap-4">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      </div>
    )
  }

  if (error && !info) {
    return (
      <div className="p-6">
        <Alert variant="destructive">
          <AlertTitle>加载失败</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </div>
    )
  }

  if (!info?.enabled) {
    return (
      <div className="flex flex-col gap-4 p-6">
        <Alert>
          <ShieldOff />
          <AlertTitle>远程代理尚未开启</AlertTitle>
          <AlertDescription>
            使用 <code className="rounded bg-muted px-1.5 py-0.5">ep --remote</code> 重启代理后，即可显示手机扫码入口。
          </AlertDescription>
        </Alert>
        <Button variant="outline" size="sm" onClick={() => void loadInfo()}>
          <RefreshCw data-icon="inline-start" />
          重新检测
        </Button>
      </div>
    )
  }

  if (!selectedTarget) {
    return (
      <div className="flex flex-col gap-4 p-6">
        <Alert variant="destructive">
          <Wifi />
          <AlertTitle>未发现局域网地址</AlertTitle>
          <AlertDescription>请确认电脑已连接 Wi-Fi 或有线局域网，然后重新检测。</AlertDescription>
        </Alert>
        <Button variant="outline" size="sm" onClick={() => void loadInfo()}>
          <RefreshCw data-icon="inline-start" />
          重新检测
        </Button>
      </div>
    )
  }

  return (
    <div className="h-full overflow-auto p-6">
      <div className="mx-auto grid max-w-3xl gap-6 md:grid-cols-[340px_1fr]">
        <Card className="gap-0 overflow-hidden py-0">
          <CardHeader className="border-b py-4">
            <CardTitle className="flex items-center gap-2">
              <QrCode />
              扫码打开配置页
            </CardTitle>
            <CardDescription>使用手机相机或 Safari 扫描。</CardDescription>
            <CardAction>
              <Badge variant="secondary">局域网</Badge>
            </CardAction>
          </CardHeader>
          <CardContent className="flex min-h-[340px] items-center justify-center bg-background p-4">
            {qrCodeUrl ? (
              <img src={qrCodeUrl} alt={`打开 ${selectedTarget.setupUrl} 的二维码`} className="size-[300px] rounded-lg" />
            ) : (
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            )}
          </CardContent>
        </Card>

        <Card className="gap-0 py-0">
          <CardHeader className="border-b py-4">
            <CardTitle className="flex items-center gap-2">
              <Smartphone />
              手机代理配置
            </CardTitle>
            <CardDescription>手机与电脑连接同一局域网后，扫描二维码打开配置页并安装 HTTPS 根证书。</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5 p-5">
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline" className="gap-1.5">
                <Wifi />
                {selectedTarget.address}:{info.proxyPort}
              </Badge>
              <Badge variant={info.interceptHttps ? 'default' : 'secondary'} className="gap-1.5">
                {info.interceptHttps ? <ShieldCheck /> : <ShieldOff />}
                HTTPS {info.interceptHttps ? '解密开启' : '解密关闭'}
              </Badge>
              {info.authenticationRequired && <Badge variant="secondary">需要代理认证</Badge>}
            </div>

            {info.targets.length > 1 && (
              <div className="flex flex-col gap-2">
                <div className="text-xs font-medium text-muted-foreground">选择局域网地址</div>
                <ToggleGroup
                  type="single"
                  value={selectedTarget.address}
                  onValueChange={(value) => {
                    if (value) setSelectedAddress(value)
                  }}
                  variant="outline"
                  size="sm"
                  spacing={1}
                  className="flex-wrap justify-start"
                  aria-label="局域网地址"
                >
                  {info.targets.map((target) => (
                    <ToggleGroupItem key={target.address} value={target.address}>
                      {target.address}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </div>
            )}

            <div className="rounded-lg border bg-muted/50 p-3">
              <div className="mb-1 text-xs text-muted-foreground">手机配置地址</div>
              <code className="break-all text-sm">{selectedTarget.setupUrl}</code>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => void copySetupUrl()}>
                {copied ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
                {copied ? '已复制' : '复制地址'}
              </Button>
              <Button variant="outline" size="sm" asChild>
                <a href={selectedTarget.setupUrl} target="_blank" rel="noreferrer">
                  <ExternalLink data-icon="inline-start" />
                  浏览器打开
                </a>
              </Button>
              {info.interceptHttps && (
                <Button variant="outline" size="sm" asChild>
                  <a href={selectedTarget.certificateUrl}>
                    <Download data-icon="inline-start" />
                    下载根证书
                  </a>
                </Button>
              )}
            </div>

            <ol className="flex flex-col gap-2 text-sm leading-6 text-muted-foreground">
              <li>1. 扫码打开手机配置页。</li>
              <li>2. 在手机 Wi-Fi 设置中填写页面显示的代理地址。</li>
              <li>3. 安装并完全信任根证书后，即可查看 HTTPS 请求。</li>
            </ol>

            {error && (
              <Alert variant="destructive">
                <AlertTitle>操作失败</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
