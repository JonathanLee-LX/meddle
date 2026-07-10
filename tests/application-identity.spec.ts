import { describe, expect, it, vi } from 'vitest'
import {
    createApplicationIdentityPipeline,
    createApplicationIdentityResolver,
    extractMacApplicationPath,
    inferApplicationIdentityFromHeaders,
    inferApplicationIdentityFromUserAgent,
    parseLsofProcess,
} from '../core/application-identity'

const lsofOutput = [
    'p2642',
    'cGoogle Chrome Helper',
    'f38',
    'n127.0.0.1:54254->127.0.0.1:8989',
    'p11803',
    'cnode',
    'f13',
    'n127.0.0.1:8989->127.0.0.1:54254',
].join('\n')

describe('application identity', () => {
    it('finds the process that owns the client side of a proxy connection', () => {
        expect(parseLsofProcess(
            lsofOutput,
            54254,
            8989,
            11803,
            '127.0.0.1',
            '127.0.0.1',
        )).toEqual({
            pid: 2642,
            command: 'Google Chrome Helper',
        })
    })

    it('requires both socket addresses when they are available', () => {
        const output = [
            'p2642',
            'cGoogle Chrome Helper',
            'n127.0.0.2:54254->127.0.0.1:8989',
            'p3000',
            'ccurl',
            'n127.0.0.1:54254->127.0.0.1:8989',
        ].join('\n')

        expect(parseLsofProcess(
            output,
            54254,
            8989,
            11803,
            '127.0.0.1',
            '127.0.0.1',
        )).toEqual({
            pid: 3000,
            command: 'curl',
        })
    })

    it('matches bracketed IPv6 loopback endpoints', () => {
        const output = [
            'p3000',
            'ccurl',
            'n[::1]:54254->[::1]:8989',
        ].join('\n')

        expect(parseLsofProcess(
            output,
            54254,
            8989,
            11803,
            '::1',
            '::1',
        )).toEqual({
            pid: 3000,
            command: 'curl',
        })
    })

    it('extracts the outer macOS application bundle from a helper command', () => {
        expect(extractMacApplicationPath(
            '/Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Helpers/Google Chrome Helper.app/Contents/MacOS/Google Chrome Helper --type=utility',
        )).toBe('/Applications/Google Chrome.app')
        expect(extractMacApplicationPath('/usr/bin/curl https://example.com')).toBeUndefined()
    })

    it('resolves and caches macOS application metadata per socket', async () => {
        const runCommand = vi.fn(async (command: string) => {
            if (command === '/usr/sbin/lsof') return lsofOutput
            if (command === '/bin/ps') {
                return '/Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Helpers/Google Chrome Helper.app/Contents/MacOS/Google Chrome Helper --type=utility'
            }
            if (command === '/usr/bin/plutil') {
                return JSON.stringify({
                    CFBundleDisplayName: 'Google Chrome',
                    CFBundleIdentifier: 'com.google.Chrome',
                })
            }
            throw new Error(`Unexpected command: ${command}`)
        })
        const resolver = createApplicationIdentityResolver({
            platform: 'darwin',
            proxyPid: 11803,
            runCommand,
        })
        const socket = {
            remoteAddress: '127.0.0.1',
            remotePort: 54254,
            localAddress: '127.0.0.1',
            localPort: 8989,
        }

        await expect(resolver.resolve({
            clientType: 'local',
            socket,
        })).resolves.toEqual({
            applicationName: 'Google Chrome',
            applicationProcess: 'Google Chrome Helper',
            applicationPid: 2642,
            applicationPath: '/Applications/Google Chrome.app',
            applicationBundleId: 'com.google.Chrome',
            applicationIdentitySource: 'local-process',
            applicationIdentityConfidence: 'high',
        })
        await resolver.resolve({
            clientType: 'local',
            socket,
        })

        expect(runCommand).toHaveBeenCalledTimes(3)
    })

    it('retries process lookup after a transient miss', async () => {
        let lsofCalls = 0
        const runCommand = vi.fn(async (command: string) => {
            if (command === '/usr/sbin/lsof') {
                lsofCalls += 1
                return lsofCalls === 1 ? '' : lsofOutput
            }
            if (command === '/bin/ps') {
                return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome Helper'
            }
            if (command === '/usr/bin/plutil') {
                return JSON.stringify({ CFBundleDisplayName: 'Google Chrome' })
            }
            throw new Error(`Unexpected command: ${command}`)
        })
        const resolver = createApplicationIdentityResolver({
            platform: 'darwin',
            proxyPid: 11803,
            runCommand,
        })
        const context = {
            clientType: 'local' as const,
            socket: {
                remoteAddress: '127.0.0.1',
                remotePort: 54254,
                localAddress: '127.0.0.1',
                localPort: 8989,
            },
        }

        await expect(resolver.resolve(context)).resolves.toBeUndefined()
        await expect(resolver.resolve(context)).resolves.toMatchObject({
            applicationName: 'Google Chrome',
            applicationIdentitySource: 'local-process',
        })
        expect(lsofCalls).toBe(2)
    })

    it('does not inspect remote clients or unsupported platforms', async () => {
        const runCommand = vi.fn()
        const resolver = createApplicationIdentityResolver({
            platform: 'linux',
            runCommand,
        })

        await expect(resolver.resolve({
            clientType: 'local',
            socket: {
                remoteAddress: '127.0.0.1',
                remotePort: 51000,
                localPort: 8989,
            },
        })).resolves.toBeUndefined()
        expect(runCommand).not.toHaveBeenCalled()
    })

    it.each([
        [
            'Chrome on Android',
            'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Mobile Safari/537.36',
            'Google Chrome',
            'medium',
        ],
        [
            'Chrome on iOS',
            'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/149.0.0.0 Mobile/15E148 Safari/604.1',
            'Google Chrome',
            'medium',
        ],
        [
            'Safari on iOS',
            'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
            'Safari',
            'medium',
        ],
        [
            'Edge on Android',
            'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/149.0.0.0 Mobile Safari/537.36 EdgA/149.0.0.0',
            'Microsoft Edge',
            'medium',
        ],
        [
            'Firefox',
            'Mozilla/5.0 (Android 15; Mobile; rv:147.0) Gecko/147.0 Firefox/147.0',
            'Mozilla Firefox',
            'medium',
        ],
        [
            'Samsung Internet',
            'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36 SamsungBrowser/28.0',
            'Samsung Internet',
            'medium',
        ],
        [
            'Android WebView',
            'Mozilla/5.0 (Linux; Android 15; Pixel 9 Build/AP3A; wv) AppleWebKit/537.36 Version/4.0 Chrome/149.0.0.0 Mobile Safari/537.36',
            'Android WebView',
            'low',
        ],
        [
            'iOS WebView',
            'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
            'iOS WebView',
            'low',
        ],
    ])('infers %s from User-Agent', (_label, userAgent, applicationName, confidence) => {
        expect(inferApplicationIdentityFromUserAgent(userAgent)).toEqual({
            applicationName,
            applicationIdentitySource: 'user-agent',
            applicationIdentityConfidence: confidence,
        })
    })

    it('reads User-Agent headers case-insensitively and ignores unknown clients', () => {
        expect(inferApplicationIdentityFromHeaders({
            'User-Agent': 'Mozilla/5.0 AppleWebKit/605.1.15 Version/18.5 Safari/605.1.15',
        })).toMatchObject({
            applicationName: 'Safari',
        })
        expect(inferApplicationIdentityFromUserAgent('okhttp/4.12.0')).toBeUndefined()
        expect(inferApplicationIdentityFromUserAgent('')).toBeUndefined()
    })

    it('uses User-Agent inference only for remote clients', async () => {
        const resolver = createApplicationIdentityResolver({
            platform: 'linux',
            runCommand: vi.fn(),
        })
        const headers = {
            'user-agent': 'Mozilla/5.0 AppleWebKit/537.36 Chrome/149.0.0.0 Safari/537.36',
        }

        await expect(resolver.resolve({
            clientType: 'remote',
            headers,
        })).resolves.toEqual({
            applicationName: 'Google Chrome',
            applicationIdentitySource: 'user-agent',
            applicationIdentityConfidence: 'medium',
        })
        await expect(resolver.resolve({
            clientType: 'local',
            headers,
        })).resolves.toBeUndefined()
    })

    it('keeps verified process identity ahead of inferred User-Agent identity', async () => {
        const processResolver = vi.fn(async () => ({
            applicationName: 'Google Chrome',
            applicationIdentitySource: 'local-process' as const,
            applicationIdentityConfidence: 'high' as const,
        }))
        const userAgentResolver = vi.fn(async () => ({
            applicationName: 'Safari',
            applicationIdentitySource: 'user-agent' as const,
            applicationIdentityConfidence: 'medium' as const,
        }))
        const pipeline = createApplicationIdentityPipeline([
            { id: 'local-process', resolve: processResolver },
            { id: 'user-agent', resolve: userAgentResolver },
        ])

        await expect(pipeline.resolve({ clientType: 'local' })).resolves.toMatchObject({
            applicationName: 'Google Chrome',
            applicationIdentitySource: 'local-process',
        })
        expect(userAgentResolver).not.toHaveBeenCalled()
    })
})
