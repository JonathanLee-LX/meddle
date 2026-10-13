import { afterAll, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import * as crypto from 'node:crypto'
import * as https from 'node:https'
import type { AddressInfo } from 'node:net'

/**
 * Issue #116: per-host MITM certificates used node-forge's synchronous
 * pure-JS RSA keygen (seconds, blocking the proxy). cert.ts routes it through
 * Node's native keygen; the generated pair must still be valid and usable.
 */
const home = mkdtempSync(join(tmpdir(), 'meddle-116-cert-'))
afterAll(() => {
    vi.unstubAllEnvs()
    rmSync(home, { recursive: true, force: true })
})

describe('MITM certificate generation (issue #116)', () => {
    it('uses native RSA keygen and produces a matching, servable key/cert pair', async () => {
        vi.stubEnv('HOME', home)
        vi.stubEnv('USERPROFILE', home)
        vi.stubEnv('MEDDLE_HEADLESS', '1')
        vi.resetModules()
        const { crtMgr, ensureRootCA } = await import('../cert')
        const forge = require(require.resolve('node-forge', { paths: [dirname(require.resolve('node-easy-cert'))] }))
        expect(forge.pki.rsa.__meddleNative).toBe(true)

        await ensureRootCA({ trustCheckAsync: true })
        const { key, crt } = await new Promise<{ key: string; crt: string }>((resolve, reject) => {
            crtMgr.getCertificate('127.0.0.1', (err: unknown, k: string | Buffer, c: string | Buffer) => {
                if (err) reject(err)
                else resolve({ key: String(k), crt: String(c) })
            })
        })
        const x509 = new crypto.X509Certificate(crt)
        expect(x509.checkPrivateKey(crypto.createPrivateKey(key))).toBe(true)
        expect(x509.subjectAltName).toContain('127.0.0.1')
        expect((x509.publicKey.asymmetricKeyDetails?.modulusLength)).toBe(2048)

        // a TLS server can actually use it
        const server = https.createServer({ key, cert: crt }, (_req, res) => res.end('ok'))
        await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
        const port = (server.address() as AddressInfo).port
        const body = await new Promise<string>((resolve, reject) => {
            https.get({ host: '127.0.0.1', port, path: '/', rejectUnauthorized: false }, (res) => {
                let d = ''
                res.on('data', (c) => { d += c })
                res.on('end', () => resolve(d))
            }).on('error', reject)
        })
        server.close()
        expect(body).toBe('ok')
    }, 30_000)
})
