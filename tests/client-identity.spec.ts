import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
    createClientIdentityResolver,
    createMitmClientIdentityRegistry,
    enrichClientIdentityWithApplication,
    getRequestClientIdentity,
    pluginClientIdentity,
} from '../core/client-identity'

const tempDirs: string[] = []

afterEach(() => {
    for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('client identity', () => {
    it('distinguishes loopback and remote clients', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meddle-client-'))
        tempDirs.push(dir)
        const settingsPath = path.join(dir, 'settings.json')
        fs.writeFileSync(settingsPath, JSON.stringify({
            clientAliases: { '192.168.1.20': 'iPhone' },
        }))

        const resolver = createClientIdentityResolver(settingsPath)
        expect(resolver.resolve('::ffff:127.0.0.1')).toEqual({
            clientType: 'local',
            clientIp: '127.0.0.1',
            clientName: '本机',
        })
        expect(resolver.resolve('::ffff:192.168.1.20')).toEqual({
            clientType: 'remote',
            clientIp: '192.168.1.20',
            clientName: 'iPhone',
        })
    })

    it('reloads aliases without restarting', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meddle-client-'))
        tempDirs.push(dir)
        const settingsPath = path.join(dir, 'settings.json')
        fs.writeFileSync(settingsPath, JSON.stringify({ clientAliases: {} }))

        const resolver = createClientIdentityResolver(settingsPath)
        expect(resolver.resolve('10.0.0.8').clientName).toBeUndefined()

        fs.writeFileSync(settingsPath, JSON.stringify({
            clientAliases: { '10.0.0.8': '测试手机' },
        }))
        resolver.refresh()
        expect(resolver.resolve('10.0.0.8').clientName).toBe('测试手机')
    })

    it('reads identities attached to MITM requests', () => {
        const identity = { clientType: 'remote' as const, clientIp: '10.0.0.9', clientName: 'iPhone' }
        expect(getRequestClientIdentity({
            socket: { _epClientIdentity: identity },
        })).toEqual(identity)
        expect(pluginClientIdentity()).toEqual({
            clientType: 'plugin',
            clientName: '插件测试',
        })
    })

    it('passes the outer CONNECT identity to the matching MITM socket', () => {
        const registry = createMitmClientIdentityRegistry()
        const identity = { clientType: 'remote' as const, clientIp: '10.0.0.9', clientName: 'iPhone' }
        const socket: { remotePort?: number; _epClientIdentity?: typeof identity } = { remotePort: 52100 }

        registry.register(52100, identity)
        expect(registry.attach(socket)).toEqual(identity)
        expect(socket._epClientIdentity).toEqual(identity)
        expect(registry.attach({ remotePort: 52100 })).toBeUndefined()
    })

    it('enriches remote identities from request headers', async () => {
        const identity = { clientType: 'remote' as const, clientIp: '192.168.1.20' }
        const resolver = {
            resolve: vi.fn(async () => ({
                applicationName: 'Safari',
                applicationIdentitySource: 'user-agent' as const,
                applicationIdentityConfidence: 'medium' as const,
            })),
        }

        await expect(enrichClientIdentityWithApplication(identity, resolver, {
            headers: { 'user-agent': 'Safari test UA' },
        })).resolves.toEqual({
            ...identity,
            applicationName: 'Safari',
            applicationIdentitySource: 'user-agent',
            applicationIdentityConfidence: 'medium',
        })
        expect(resolver.resolve).toHaveBeenCalledWith({
            clientType: 'remote',
            socket: undefined,
            headers: { 'user-agent': 'Safari test UA' },
            existingIdentity: identity,
        })
    })

    it('preserves inherited process identity for decrypted HTTPS requests', async () => {
        const identity = {
            clientType: 'local' as const,
            applicationName: 'Google Chrome',
            applicationProcess: 'Google Chrome Helper',
            applicationPid: 2642,
            applicationIdentitySource: 'local-process' as const,
            applicationIdentityConfidence: 'high' as const,
        }
        const resolver = {
            resolve: vi.fn(async ({ existingIdentity }: any) => existingIdentity),
        }

        await expect(enrichClientIdentityWithApplication(identity, resolver, {
            headers: { 'user-agent': 'Mozilla/5.0 Safari/605.1.15' },
        })).resolves.toEqual(identity)
    })
})
