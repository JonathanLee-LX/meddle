import * as fs from 'fs'
import { isLoopbackAddress, normalizeIpAddress } from './remote-access'
import type {
    ApplicationIdentity,
    ApplicationIdentityResolver,
    ApplicationRequestHeaders,
    ConnectionSocket,
} from './application-identity'

export type ClientType = 'local' | 'remote' | 'plugin'

export interface ClientIdentity extends Partial<ApplicationIdentity> {
    clientType: ClientType
    clientIp?: string
    clientName?: string
}

export interface ClientIdentityResolver {
    resolve(remoteAddress: string | undefined | null): ClientIdentity
    refresh(): void
}

export interface MitmClientIdentityRegistry {
    register(remotePort: number | undefined, identity: ClientIdentity): void
    attach(socket: { remotePort?: number; _epClientIdentity?: ClientIdentity }): ClientIdentity | undefined
}

function normalizeClientAliases(value: unknown): Record<string, string> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}

    const aliases: Record<string, string> = {}
    for (const [address, name] of Object.entries(value)) {
        if (typeof name !== 'string') continue
        const normalizedAddress = normalizeIpAddress(address.trim())
        const normalizedName = name.trim()
        if (normalizedAddress && normalizedName) aliases[normalizedAddress] = normalizedName
    }
    return aliases
}

export function createClientIdentityResolver(settingsPath: string): ClientIdentityResolver {
    let aliases: Record<string, string> = {}

    const refresh = (): void => {
        try {
            if (!fs.existsSync(settingsPath)) {
                aliases = {}
                return
            }
            const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8')) as { clientAliases?: unknown }
            aliases = normalizeClientAliases(settings.clientAliases)
        } catch (_) {
            aliases = {}
        }
    }

    const resolve = (remoteAddress: string | undefined | null): ClientIdentity => {
        const clientIp = normalizeIpAddress(remoteAddress)
        if (isLoopbackAddress(clientIp)) {
            return { clientType: 'local', clientIp, clientName: '本机' }
        }
        return {
            clientType: 'remote',
            clientIp: clientIp || undefined,
            clientName: aliases[clientIp] || undefined,
        }
    }

    refresh()
    return { resolve, refresh }
}

export function getRequestClientIdentity(req: any): ClientIdentity {
    const identity = req?._epClientIdentity || req?.socket?._epClientIdentity
    if (identity?.clientType) return identity

    const clientIp = normalizeIpAddress(req?.socket?.remoteAddress)
    if (isLoopbackAddress(clientIp) || !clientIp) {
        return { clientType: 'local', clientIp: clientIp || undefined, clientName: '本机' }
    }
    return { clientType: 'remote', clientIp }
}

export async function enrichClientIdentityWithApplication(
    identity: ClientIdentity,
    resolver: ApplicationIdentityResolver,
    context: {
        socket?: ConnectionSocket
        headers?: ApplicationRequestHeaders
    },
): Promise<ClientIdentity> {
    const applicationIdentity = await resolver.resolve({
        clientType: identity.clientType,
        socket: context.socket,
        headers: context.headers,
        existingIdentity: identity,
    })
    return {
        ...identity,
        ...applicationIdentity,
    }
}

export function pluginClientIdentity(): ClientIdentity {
    return { clientType: 'plugin', clientName: '插件测试' }
}

export function createMitmClientIdentityRegistry(
    timeoutMs: number = 30000,
): MitmClientIdentityRegistry {
    const pending = new Map<number, ClientIdentity>()

    return {
        register(remotePort, identity) {
            if (!remotePort) return
            pending.set(remotePort, identity)
            const timer = setTimeout(() => {
                if (pending.get(remotePort) === identity) pending.delete(remotePort)
            }, timeoutMs)
            timer.unref()
        },
        attach(socket) {
            if (!socket.remotePort) return undefined
            const identity = pending.get(socket.remotePort)
            if (!identity) return undefined
            socket._epClientIdentity = identity
            pending.delete(socket.remotePort)
            return identity
        },
    }
}
