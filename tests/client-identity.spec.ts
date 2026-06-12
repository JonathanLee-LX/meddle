import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import {
    createClientIdentityResolver,
    createMitmClientIdentityRegistry,
    getRequestClientIdentity,
    pluginClientIdentity,
} from '../core/client-identity'

const tempDirs: string[] = []

afterEach(() => {
    for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('client identity', () => {
    it('distinguishes loopback and remote clients', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'easy-proxy-client-'))
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
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'easy-proxy-client-'))
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
})
