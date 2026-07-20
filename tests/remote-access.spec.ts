import { describe, expect, it } from 'vitest'
import {
    authorizeProxyClient,
    buildRemoteAccessConfig,
    buildRemoteSetupHtml,
    createRemoteAccessInfo,
    isLoopbackAddress,
    isPrivateNetworkAddress,
    isProxyHost,
    parseConnectAuthority,
    stripProxyHeaders,
    getLanIPv4Addresses,
} from '../core/remote-access'

describe('remote access config', () => {
    it('keeps the proxy local by default', () => {
        expect(buildRemoteAccessConfig({}, [])).toEqual({
            enabled: false,
            bindHost: '127.0.0.1',
            interceptHttps: false,
            token: null,
        })
    })

    it('enables LAN binding and HTTPS interception in remote mode', () => {
        expect(buildRemoteAccessConfig({}, ['--remote'])).toMatchObject({
            enabled: true,
            bindHost: '0.0.0.0',
            interceptHttps: true,
        })
    })

    it('supports disabling interception and setting a token', () => {
        expect(buildRemoteAccessConfig(
            { MEDDLE_REMOTE: '1', MEDDLE_REMOTE_TOKEN: 'secret' },
            ['--no-intercept-https'],
        )).toMatchObject({
            enabled: true,
            interceptHttps: false,
            token: 'secret',
        })
    })
})

describe('remote client authorization', () => {
    const remoteConfig = {
        enabled: true,
        bindHost: '0.0.0.0',
        interceptHttps: true,
        token: null,
    }

    it('recognizes loopback and private network addresses', () => {
        expect(isLoopbackAddress('::ffff:127.0.0.1')).toBe(true)
        expect(isPrivateNetworkAddress('192.168.1.20')).toBe(true)
        expect(isPrivateNetworkAddress('172.20.10.2')).toBe(true)
        expect(isPrivateNetworkAddress('8.8.8.8')).toBe(false)
    })

    it('allows private LAN clients only when remote mode is enabled', () => {
        expect(authorizeProxyClient('192.168.1.20', {}, remoteConfig).allowed).toBe(true)
        expect(authorizeProxyClient('192.168.1.20', {}, { ...remoteConfig, enabled: false }))
            .toMatchObject({ allowed: false, statusCode: 403 })
        expect(authorizeProxyClient('8.8.8.8', {}, remoteConfig))
            .toMatchObject({ allowed: false, statusCode: 403 })
    })

    it('validates Basic proxy credentials', () => {
        const authorization = `Basic ${Buffer.from('meddle:secret').toString('base64')}`
        const config = { ...remoteConfig, token: 'secret' }
        expect(authorizeProxyClient('192.168.1.20', { 'proxy-authorization': authorization }, config).allowed)
            .toBe(true)
        expect(authorizeProxyClient('192.168.1.20', {}, config))
            .toMatchObject({ allowed: false, statusCode: 407 })
    })
})

describe('remote access helpers', () => {
    it('returns LAN addresses as an array', () => {
        expect(Array.isArray(getLanIPv4Addresses())).toBe(true)
    })

    it('builds management UI setup targets', () => {
        expect(createRemoteAccessInfo({
            enabled: true,
            bindHost: '0.0.0.0',
            interceptHttps: true,
            token: 'secret',
        }, ['192.168.1.10'], 8989)).toEqual({
            enabled: true,
            interceptHttps: true,
            authenticationRequired: true,
            proxyPort: 8989,
            localSetupPath: '/_meddle/setup',
            targets: [{
                address: '192.168.1.10',
                proxyUrl: 'http://192.168.1.10:8989',
                setupUrl: 'http://192.168.1.10:8989/',
                certificateUrl: 'http://192.168.1.10:8989/_meddle/ca.crt',
            }],
        })
    })

    it('removes proxy credentials before forwarding', () => {
        expect(stripProxyHeaders({
            host: 'example.com',
            'Proxy-Authorization': 'Basic secret',
            'proxy-connection': 'keep-alive',
        })).toEqual({ host: 'example.com' })
    })

    it('matches local proxy hosts with the active port', () => {
        expect(isProxyHost('192.168.1.10:8989', 8989, ['192.168.1.10'])).toBe(true)
        expect(isProxyHost('192.168.1.10:8990', 8989, ['192.168.1.10'])).toBe(false)
        expect(isProxyHost('example.com:8989', 8989, ['192.168.1.10'])).toBe(false)
    })

    it('parses IPv4, hostnames, and bracketed IPv6 CONNECT targets', () => {
        expect(parseConnectAuthority('example.com:443')).toEqual({ host: 'example.com', port: 443 })
        expect(parseConnectAuthority('example.com')).toEqual({ host: 'example.com', port: 443 })
        expect(parseConnectAuthority('[::1]:8443')).toEqual({ host: '::1', port: 8443 })
    })

    it('renders a setup page without exposing management APIs', () => {
        const html = buildRemoteSetupHtml('192.168.1.10', 8989, true, true)
        expect(html).toContain('192.168.1.10')
        expect(html).toContain('/_meddle/ca.crt')
        expect(html).toContain('meddle')
        expect(html).not.toContain('/api/')
    })
})
