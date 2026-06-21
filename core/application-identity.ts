import { execFile } from 'child_process'
import * as path from 'path'
import { isLoopbackAddress, normalizeIpAddress } from './remote-access'

export type ApplicationIdentitySource = 'local-process' | 'user-agent' | 'client-reported'
export type ApplicationIdentityConfidence = 'high' | 'medium' | 'low'

export interface ApplicationIdentity {
    applicationName: string
    applicationProcess?: string
    applicationPid?: number
    applicationPath?: string
    applicationBundleId?: string
    applicationIdentitySource: ApplicationIdentitySource
    applicationIdentityConfidence: ApplicationIdentityConfidence
}

export interface ConnectionSocket {
    remoteAddress?: string
    remotePort?: number
    localAddress?: string
    localPort?: number
}

export type ApplicationRequestHeaders = Record<string, string | string[] | undefined>

export interface ApplicationIdentityResolveContext {
    clientType?: 'local' | 'remote' | 'plugin'
    socket?: ConnectionSocket
    headers?: ApplicationRequestHeaders
    existingIdentity?: Partial<ApplicationIdentity>
}

interface ProcessMatch {
    pid: number
    command: string
}

type CommandRunner = (command: string, args: string[]) => Promise<string>

export interface ApplicationIdentityResolverOptions {
    platform?: NodeJS.Platform
    proxyPid?: number
    runCommand?: CommandRunner
}

interface ApplicationMetadata {
    name?: string
    bundleId?: string
}

export interface ApplicationIdentityResolver {
    resolve(context: ApplicationIdentityResolveContext): Promise<ApplicationIdentity | undefined>
}

export interface ApplicationIdentityStrategy {
    id: ApplicationIdentitySource
    resolve(
        context: ApplicationIdentityResolveContext,
    ): ApplicationIdentity | undefined | Promise<ApplicationIdentity | undefined>
}

function runCommand(command: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
        execFile(command, args, {
            encoding: 'utf8',
            maxBuffer: 1024 * 1024,
            timeout: 1500,
        }, (error, stdout) => {
            if (error) {
                reject(error)
                return
            }
            resolve(stdout)
        })
    })
}

interface NetworkEndpoint {
    address: string
    port: number
}

function parseNetworkEndpoint(endpoint: string): NetworkEndpoint | undefined {
    const match = endpoint.trim().match(/^(.*):(\d+)$/)
    if (!match) return undefined

    const port = Number(match[2])
    if (!Number.isInteger(port)) return undefined

    const rawAddress = match[1].replace(/^\[|\]$/g, '')
    return {
        address: normalizeIpAddress(rawAddress).toLowerCase(),
        port,
    }
}

function endpointMatches(
    endpoint: NetworkEndpoint | undefined,
    port: number,
    address?: string,
): boolean {
    if (!endpoint || endpoint.port !== port) return false
    if (!address) return true
    return endpoint.address === normalizeIpAddress(address).toLowerCase()
}

export function parseLsofProcess(
    output: string,
    remotePort: number,
    localPort: number,
    proxyPid: number,
    remoteAddress?: string,
    localAddress?: string,
): ProcessMatch | undefined {
    const processes: Array<ProcessMatch & { endpoints: string[] }> = []
    let current: (ProcessMatch & { endpoints: string[] }) | undefined

    for (const line of output.split(/\r?\n/)) {
        if (!line) continue
        const field = line[0]
        const value = line.slice(1)
        if (field === 'p') {
            const pid = Number(value)
            if (!Number.isInteger(pid)) {
                current = undefined
                continue
            }
            current = { pid, command: '', endpoints: [] }
            processes.push(current)
        } else if (field === 'c' && current) {
            current.command = value.trim()
        } else if (field === 'n' && current) {
            current.endpoints.push(value.trim())
        }
    }

    for (const processInfo of processes) {
        if (processInfo.pid === proxyPid) continue
        const ownsClientEndpoint = processInfo.endpoints.some((endpoint) => {
            const [clientEndpoint, proxyEndpoint] = endpoint.split('->')
            return endpointMatches(
                parseNetworkEndpoint(clientEndpoint || ''),
                remotePort,
                remoteAddress,
            ) && endpointMatches(
                parseNetworkEndpoint(proxyEndpoint || ''),
                localPort,
                localAddress,
            )
        })
        if (ownsClientEndpoint) {
            return {
                pid: processInfo.pid,
                command: processInfo.command || `PID ${processInfo.pid}`,
            }
        }
    }

    return undefined
}

export function extractMacApplicationPath(commandLine: string): string | undefined {
    const match = commandLine.match(/^(.+?\.app)(?:\/|\s|$)/)
    return match?.[1]
}

function readHeader(headers: ApplicationRequestHeaders | undefined, name: string): string {
    if (!headers) return ''
    const direct = headers[name] ?? headers[name.toLowerCase()]
    if (Array.isArray(direct)) return direct[0] || ''
    if (typeof direct === 'string') return direct

    const entry = Object.entries(headers)
        .find(([headerName]) => headerName.toLowerCase() === name.toLowerCase())
    const value = entry?.[1]
    return Array.isArray(value) ? value[0] || '' : typeof value === 'string' ? value : ''
}

function inferredApplication(
    applicationName: string,
    confidence: ApplicationIdentityConfidence = 'medium',
): ApplicationIdentity {
    return {
        applicationName,
        applicationIdentitySource: 'user-agent',
        applicationIdentityConfidence: confidence,
    }
}

/**
 * Infer the browser or embedded web runtime represented by a User-Agent string.
 * The result describes the HTTP client signature, not a verified remote process.
 */
export function inferApplicationIdentityFromUserAgent(
    userAgent: string | undefined | null,
): ApplicationIdentity | undefined {
    const value = userAgent?.trim()
    if (!value) return undefined

    if (/\bEdgiOS\//i.test(value) || /\bEdgA?\//i.test(value)) {
        return inferredApplication('Microsoft Edge')
    }
    if (/\bOP(?:R|iOS)\//i.test(value)) {
        return inferredApplication('Opera')
    }
    if (/\bSamsungBrowser\//i.test(value)) {
        return inferredApplication('Samsung Internet')
    }
    if (/\bDuckDuckGo\//i.test(value)) {
        return inferredApplication('DuckDuckGo Browser')
    }
    if (/\bFxiOS\//i.test(value) || /\bFirefox\//i.test(value)) {
        return inferredApplication('Mozilla Firefox')
    }
    if (/\bCriOS\//i.test(value) || /\bChrome\//i.test(value) || /\bChromium\//i.test(value)) {
        const isAndroidWebView = /;\s*wv\)/i.test(value)
            || (/\bVersion\/4\.0\b/i.test(value) && /\bMobile Safari\//i.test(value))
        if (isAndroidWebView) return inferredApplication('Android WebView', 'low')
        return inferredApplication('Google Chrome')
    }
    if (/\bAppleWebKit\//i.test(value) && /\bMobile\//i.test(value) && !/\bSafari\//i.test(value)) {
        return inferredApplication('iOS WebView', 'low')
    }
    if (/\bVersion\//i.test(value) && /\bSafari\//i.test(value) && /\bAppleWebKit\//i.test(value)) {
        return inferredApplication('Safari')
    }

    return undefined
}

export function inferApplicationIdentityFromHeaders(
    headers: ApplicationRequestHeaders | undefined,
): ApplicationIdentity | undefined {
    return inferApplicationIdentityFromUserAgent(readHeader(headers, 'user-agent'))
}

async function readApplicationMetadata(
    appPath: string,
    runner: CommandRunner,
): Promise<ApplicationMetadata> {
    try {
        const plistPath = path.join(appPath, 'Contents', 'Info.plist')
        const output = await runner('/usr/bin/plutil', ['-convert', 'json', '-o', '-', plistPath])
        const plist = JSON.parse(output) as Record<string, unknown>
        const name = [plist.CFBundleDisplayName, plist.CFBundleName]
            .find((value): value is string => typeof value === 'string' && value.trim().length > 0)
        const bundleId = typeof plist.CFBundleIdentifier === 'string'
            ? plist.CFBundleIdentifier.trim()
            : undefined
        return {
            name: name?.trim(),
            bundleId: bundleId || undefined,
        }
    } catch (_) {
        return {}
    }
}

export function createApplicationIdentityPipeline(
    strategies: ApplicationIdentityStrategy[],
): ApplicationIdentityResolver {
    return {
        async resolve(context) {
            if (context.existingIdentity?.applicationName) {
                return context.existingIdentity as ApplicationIdentity
            }

            for (const strategy of strategies) {
                const identity = await strategy.resolve(context)
                if (identity) return identity
            }
            return undefined
        },
    }
}

export function createLocalProcessApplicationIdentityStrategy(
    options: ApplicationIdentityResolverOptions = {},
): ApplicationIdentityStrategy {
    const platform = options.platform || process.platform
    const proxyPid = options.proxyPid || process.pid
    const runner = options.runCommand || runCommand
    const socketCache = new WeakMap<object, Promise<ApplicationIdentity | undefined>>()
    const metadataCache = new Map<string, Promise<ApplicationMetadata>>()

    const resolveUncached = async (socket: ConnectionSocket): Promise<ApplicationIdentity | undefined> => {
        if (platform !== 'darwin') return undefined
        if (!isLoopbackAddress(socket.remoteAddress)) return undefined
        if (!socket.remotePort || !socket.localPort) return undefined

        try {
            const lsofOutput = await runner('/usr/sbin/lsof', [
                '-nP',
                '-a',
                `-iTCP:${socket.remotePort}`,
                '-sTCP:ESTABLISHED',
                '-Fpcn',
            ])
            const processInfo = parseLsofProcess(
                lsofOutput,
                socket.remotePort,
                socket.localPort,
                proxyPid,
                socket.remoteAddress,
                socket.localAddress,
            )
            if (!processInfo) return undefined

            let commandLine = ''
            try {
                commandLine = (await runner('/bin/ps', [
                    '-p',
                    String(processInfo.pid),
                    '-o',
                    'command=',
                ])).trim()
            } catch (_) {
                commandLine = ''
            }

            const applicationPath = extractMacApplicationPath(commandLine)
            let metadata: ApplicationMetadata = {}
            if (applicationPath) {
                let pending = metadataCache.get(applicationPath)
                if (!pending) {
                    pending = readApplicationMetadata(applicationPath, runner)
                    metadataCache.set(applicationPath, pending)
                }
                metadata = await pending
            }

            return {
                applicationName: metadata.name || processInfo.command,
                applicationProcess: processInfo.command,
                applicationPid: processInfo.pid,
                applicationPath,
                applicationBundleId: metadata.bundleId,
                applicationIdentitySource: 'local-process',
                applicationIdentityConfidence: 'high',
            }
        } catch (_) {
            return undefined
        }
    }

    return {
        id: 'local-process',
        resolve(context) {
            if (context.clientType && context.clientType !== 'local') {
                return Promise.resolve(undefined)
            }
            const socket = context.socket
            if (!socket || typeof socket !== 'object') return Promise.resolve(undefined)
            const cacheKey = socket as object
            let pending = socketCache.get(cacheKey)
            if (!pending) {
                pending = resolveUncached(socket)
                socketCache.set(cacheKey, pending)
                void pending.then((identity) => {
                    if (!identity && socketCache.get(cacheKey) === pending) {
                        socketCache.delete(cacheKey)
                    }
                })
            }
            return pending
        },
    }
}

export function createUserAgentApplicationIdentityStrategy(): ApplicationIdentityStrategy {
    return {
        id: 'user-agent',
        resolve(context) {
            if (context.clientType !== 'remote') return undefined
            return inferApplicationIdentityFromHeaders(context.headers)
        },
    }
}

export function createApplicationIdentityResolver(
    options: ApplicationIdentityResolverOptions = {},
): ApplicationIdentityResolver {
    return createApplicationIdentityPipeline([
        createLocalProcessApplicationIdentityStrategy(options),
        createUserAgentApplicationIdentityStrategy(),
    ])
}
