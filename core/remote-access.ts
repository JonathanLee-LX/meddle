import * as crypto from 'crypto'
import * as net from 'net'
import * as os from 'os'

export interface RemoteAccessConfig {
    enabled: boolean;
    bindHost: string;
    interceptHttps: boolean;
    token: string | null;
}

export interface ProxyAccessDecision {
    allowed: boolean;
    statusCode?: 403 | 407;
    message?: string;
}

export interface RemoteAccessSetupTarget {
    address: string;
    proxyUrl: string;
    setupUrl: string;
    certificateUrl: string;
}

export interface RemoteAccessInfo {
    enabled: boolean;
    interceptHttps: boolean;
    authenticationRequired: boolean;
    proxyPort: number | null;
    localSetupPath: string;
    targets: RemoteAccessSetupTarget[];
}

function parseBoolean(value: string | undefined): boolean | undefined {
    if (value === undefined) return undefined
    if (['1', 'true', 'yes', 'on'].includes(value.toLowerCase())) return true
    if (['0', 'false', 'no', 'off'].includes(value.toLowerCase())) return false
    return undefined
}

function readOption(argv: string[], name: string): string | undefined {
    const prefix = `${name}=`
    const inline = argv.find(arg => arg.startsWith(prefix))
    if (inline) return inline.slice(prefix.length)

    const index = argv.indexOf(name)
    if (index >= 0 && index + 1 < argv.length) return argv[index + 1]
    return undefined
}

export function buildRemoteAccessConfig(
    env: NodeJS.ProcessEnv = process.env,
    argv: string[] = process.argv.slice(2),
): RemoteAccessConfig {
    const enabled = argv.includes('--remote') || parseBoolean(env.EP_REMOTE) === true
    const interceptArg = argv.includes('--intercept-https')
        ? true
        : argv.includes('--no-intercept-https')
            ? false
            : undefined
    const interceptEnv = parseBoolean(env.EP_INTERCEPT_HTTPS)
    const token = readOption(argv, '--remote-token') ?? env.EP_REMOTE_TOKEN

    return {
        enabled,
        bindHost: env.EP_BIND_HOST || (enabled ? '0.0.0.0' : '127.0.0.1'),
        interceptHttps: interceptArg ?? interceptEnv ?? enabled,
        token: token?.trim() || null,
    }
}

export function normalizeIpAddress(address: string | undefined | null): string {
    if (!address) return ''
    const withoutZone = address.split('%')[0]
    return withoutZone.startsWith('::ffff:') ? withoutZone.slice(7) : withoutZone
}

export function isLoopbackAddress(address: string | undefined | null): boolean {
    const normalized = normalizeIpAddress(address)
    if (normalized === '::1') return true
    if (net.isIP(normalized) !== 4) return false
    return normalized.split('.')[0] === '127'
}

export function isPrivateNetworkAddress(address: string | undefined | null): boolean {
    const normalized = normalizeIpAddress(address)
    if (isLoopbackAddress(normalized)) return true

    const family = net.isIP(normalized)
    if (family === 4) {
        const octets = normalized.split('.').map(Number)
        return octets[0] === 10
            || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
            || (octets[0] === 192 && octets[1] === 168)
            || (octets[0] === 169 && octets[1] === 254)
    }
    if (family === 6) {
        const lower = normalized.toLowerCase()
        return lower.startsWith('fc')
            || lower.startsWith('fd')
            || lower.startsWith('fe8')
            || lower.startsWith('fe9')
            || lower.startsWith('fea')
            || lower.startsWith('feb')
    }
    return false
}

function timingSafeEqual(left: string, right: string): boolean {
    const leftBuffer = Buffer.from(left)
    const rightBuffer = Buffer.from(right)
    return leftBuffer.length === rightBuffer.length
        && crypto.timingSafeEqual(leftBuffer, rightBuffer)
}

function hasValidProxyAuthorization(header: string | string[] | undefined, token: string): boolean {
    const value = Array.isArray(header) ? header[0] : header
    if (!value) return false

    if (value.startsWith('Bearer ')) {
        return timingSafeEqual(value.slice(7), token)
    }
    if (!value.startsWith('Basic ')) return false

    try {
        const decoded = Buffer.from(value.slice(6), 'base64').toString('utf8')
        const separator = decoded.indexOf(':')
        if (separator < 0) return false
        const username = decoded.slice(0, separator)
        const password = decoded.slice(separator + 1)
        return username === 'easy-proxy' && timingSafeEqual(password, token)
    } catch (_) {
        return false
    }
}

export function authorizeProxyClient(
    remoteAddress: string | undefined | null,
    headers: Record<string, string | string[] | undefined>,
    config: RemoteAccessConfig,
): ProxyAccessDecision {
    if (isLoopbackAddress(remoteAddress)) return { allowed: true }
    if (!config.enabled) {
        return { allowed: false, statusCode: 403, message: 'Remote proxy access is disabled' }
    }
    if (!isPrivateNetworkAddress(remoteAddress)) {
        return { allowed: false, statusCode: 403, message: 'Only private network clients are allowed' }
    }
    if (config.token && !hasValidProxyAuthorization(headers['proxy-authorization'], config.token)) {
        return { allowed: false, statusCode: 407, message: 'Proxy authentication required' }
    }
    return { allowed: true }
}

export function stripProxyHeaders<T>(
    headers: Record<string, T>,
): Record<string, T> {
    const result: Record<string, T> = {}
    for (const [key, value] of Object.entries(headers)) {
        const normalized = key.toLowerCase()
        if (normalized !== 'proxy-authorization' && normalized !== 'proxy-connection') {
            result[key] = value
        }
    }
    return result
}

export function getLanIPv4Addresses(): string[] {
    const addresses = new Set<string>()
    for (const [name, entries] of Object.entries(os.networkInterfaces())) {
        if (/^(utun|tun|tap|wg|tailscale|docker|veth|bridge|lo)/i.test(name)) continue
        for (const entry of entries || []) {
            if (entry.family === 'IPv4' && !entry.internal) addresses.add(entry.address)
        }
    }
    return Array.from(addresses)
}

export function createRemoteAccessInfo(
    config: RemoteAccessConfig,
    addresses: string[],
    port: number | null,
): RemoteAccessInfo {
    const targets = port === null
        ? []
        : addresses.map(address => ({
            address,
            proxyUrl: `http://${address}:${port}`,
            setupUrl: `http://${address}:${port}/`,
            certificateUrl: `http://${address}:${port}/_easy-proxy/ca.crt`,
        }))

    return {
        enabled: config.enabled,
        interceptHttps: config.interceptHttps,
        authenticationRequired: !!config.token,
        proxyPort: port,
        localSetupPath: '/_easy-proxy/setup',
        targets,
    }
}

function parseAuthority(authority: string): { hostname: string; port: number | null } | null {
    try {
        const url = new URL(`http://${authority}`)
        return {
            hostname: normalizeIpAddress(url.hostname.replace(/^\[|\]$/g, '')).toLowerCase(),
            port: url.port ? Number(url.port) : null,
        }
    } catch (_) {
        return null
    }
}

export function isProxyHost(
    hostHeader: string | undefined,
    serverPort: number,
    lanAddresses: string[],
): boolean {
    if (!hostHeader) return false
    const parsed = parseAuthority(hostHeader)
    if (!parsed || parsed.port !== serverPort) return false

    const localHosts = new Set([
        'localhost',
        '127.0.0.1',
        '::1',
        os.hostname().toLowerCase(),
        ...lanAddresses.map(address => normalizeIpAddress(address).toLowerCase()),
    ])
    return localHosts.has(parsed.hostname)
}

export function parseConnectAuthority(authority: string): { host: string; port: number } | null {
    const parsed = parseAuthority(authority)
    if (!parsed || !parsed.hostname) return null
    return { host: parsed.hostname, port: parsed.port || 443 }
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
}

export function buildRemoteSetupHtml(
    host: string,
    port: number,
    interceptHttps: boolean,
    requiresAuth: boolean,
): string {
    const proxyAddress = `${host}:${port}`
    const auth = requiresAuth
        ? '<li>代理认证用户名填写 <code>easy-proxy</code>，密码填写启动时配置的口令。</li>'
        : '<li>当前未启用代理口令，仅允许局域网私有地址访问。请只在可信网络中使用。</li>'
    const https = interceptHttps
        ? '<li>访问 <a href="/_easy-proxy/ca.crt">下载根证书</a>，在手机系统中安装并完全信任，才能查看 HTTPS 请求内容。</li>'
        : '<li>当前未启用 HTTPS 解密，只能查看 HTTP 请求内容，HTTPS 请求内容不可见。</li>'

    return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Easy Proxy 手机代理设置</title>
  <style>
    body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;max-width:720px;margin:40px auto;padding:0 20px;line-height:1.65;color:#18212f}
    code{background:#eef2f7;padding:2px 6px;border-radius:4px} a{color:#1769aa}
    .box{background:#f7f9fc;border:1px solid #dbe3ee;border-radius:10px;padding:18px 22px}
  </style>
</head>
<body>
  <h1>Easy Proxy 手机代理设置</h1>
  <div class="box">
    <ol>
      <li>确保手机与电脑处于同一局域网。</li>
      <li>在手机 Wi-Fi 代理设置中选择“手动”，服务器填写 <code>${escapeHtml(host)}</code>，端口填写 <code>${port}</code>。</li>
      ${auth}
      ${https}
      <li>在电脑上打开 <code>http://127.0.0.1:${port}</code> 查看抓包记录。</li>
    </ol>
  </div>
  <p>代理地址：<code>${escapeHtml(proxyAddress)}</code></p>
  <p>部分 App 使用证书锁定或不信任用户证书，其 HTTPS 流量无法解密。</p>
</body>
</html>`
}
