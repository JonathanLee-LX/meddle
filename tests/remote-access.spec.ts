import { describe, expect, it } from 'vitest'
import {
    authorizeProxyClient,
    authorizeManagementRequest,
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
            publicUrl: null,
        })
    })

    it('reads MEDDLE_PUBLIC_URL as the public entry point', () => {
        expect(buildRemoteAccessConfig({ MEDDLE_PUBLIC_URL: 'https://meddle.livs.top' }, []))
            .toMatchObject({ publicUrl: 'https://meddle.livs.top' })
    })

    it('ignores an invalid MEDDLE_PUBLIC_URL value', () => {
        expect(buildRemoteAccessConfig({ MEDDLE_PUBLIC_URL: 'not a url' }, []))
            .toMatchObject({ publicUrl: null })
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

    it('builds management UI setup targets with a public entry and LAN addresses', () => {
        expect(createRemoteAccessInfo({
            enabled: true,
            bindHost: '0.0.0.0',
            interceptHttps: true,
            token: null,
            publicUrl: 'https://meddle.livs.top',
        }, ['192.168.1.10'], 8284)).toEqual({
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
            }, {
                address: '192.168.1.10',
                proxyUrl: 'http://192.168.1.10:8284',
                setupUrl: 'http://192.168.1.10:8284/',
                certificateUrl: 'http://192.168.1.10:8284/_meddle/ca.crt',
            }],
        })
    })

    it('builds management UI setup targets with only the public entry when port is null', () => {
        expect(createRemoteAccessInfo({
            enabled: true,
            bindHost: '0.0.0.0',
            interceptHttps: true,
            token: null,
            publicUrl: 'https://meddle.livs.top/',
        }, ['192.168.1.10'], null)).toMatchObject({
            targets: [{ address: 'meddle.livs.top', setupUrl: 'https://meddle.livs.top/' }],
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

describe('management interface authorization (Web UI / API / WS)', () => {
    const remoteConfig = {
        enabled: true,
        bindHost: '0.0.0.0',
        interceptHttps: true,
        token: null,
    }

    it('allows loopback without any token', () => {
        const config = { ...remoteConfig, token: 'secret' }
        expect(authorizeManagementRequest('127.0.0.1', {}, config).allowed).toBe(true)
        expect(authorizeManagementRequest('::ffff:127.0.0.1', {}, config).allowed).toBe(true)
    })

    it('blocks remote management when remote mode is disabled', () => {
        const config = { ...remoteConfig, enabled: false }
        expect(authorizeManagementRequest('192.168.1.20', {}, config))
            .toMatchObject({ allowed: false, statusCode: 403 })
    })

    it('allows private-network management without a token when remote is on', () => {
        expect(authorizeManagementRequest('192.168.1.20', {}, remoteConfig).allowed).toBe(true)
    })

    it('requires a token for remote management when one is configured', () => {
        const config = { ...remoteConfig, token: 'secret' }
        expect(authorizeManagementRequest('192.168.1.20', {}, config))
            .toMatchObject({ allowed: false, statusCode: 401 })
        expect(authorizeManagementRequest('192.168.1.20', { authorization: 'Bearer secret' }, config).allowed).toBe(true)
        expect(authorizeManagementRequest('192.168.1.20', { authorization: 'Bearer wrong' }, config))
            .toMatchObject({ allowed: false, statusCode: 401 })
    })

    it('accepts Basic credentials with username meddle for management', () => {
        const config = { ...remoteConfig, token: 'secret' }
        const basic = `Basic ${Buffer.from('meddle:secret').toString('base64')}`
        expect(authorizeManagementRequest('192.168.1.20', { authorization: basic }, config).allowed).toBe(true)
    })

    it('blocks public-internet management clients', () => {
        const config = { ...remoteConfig, token: null }
        expect(authorizeManagementRequest('8.8.8.8', {}, config))
            .toMatchObject({ allowed: false, statusCode: 403 })
    })
})
