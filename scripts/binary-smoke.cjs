#!/usr/bin/env node
'use strict'

const { execSync, spawn } = require('child_process')
const http = require('http')
const path = require('path')

const bin = path.resolve(process.argv[2] || 'dist-bin/meddle-linux-x64')
let passed = 0
let failed = 0

function assert(name, fn) {
    try {
        fn()
        passed++
        console.log(`  ✓ ${name}`)
    } catch (e) {
        failed++
        console.error(`  ✗ ${name}: ${e.message}`)
    }
}

function fetch(url, opts = {}) {
    return new Promise((resolve, reject) => {
        const req = http.get(url, opts, (res) => {
            let body = ''
            res.on('data', (c) => (body += c))
            res.on('end', () => resolve({ status: res.statusCode, body }))
        })
        req.on('error', reject)
        req.setTimeout(5000, () => { req.destroy(); reject(new Error('timeout')) })
    })
}

function fetchViaProxy(proxyPort, targetUrl) {
    return new Promise((resolve, reject) => {
        const req = http.get({
            host: '127.0.0.1',
            port: proxyPort,
            path: targetUrl,
            headers: { Host: new URL(targetUrl).host },
        }, (res) => {
            let body = ''
            res.on('data', (c) => (body += c))
            res.on('end', () => resolve({ status: res.statusCode, body }))
        })
        req.on('error', reject)
        req.setTimeout(5000, () => { req.destroy(); reject(new Error('timeout')) })
    })
}

async function main() {
    console.log(`Smoke test: ${bin}\n`)

    assert('binary exists and is executable', () => {
        execSync(`test -x "${bin}"`)
    })

    assert('meddle version outputs version', () => {
        const out = execSync(`"${bin}" version`, { encoding: 'utf8', timeout: 10000 })
        if (!out.includes('Version:')) throw new Error('missing Version: in output')
        if (!out.includes('@jonathanleelx/meddle')) throw new Error('missing package name')
    })

    assert('meddle --help exits 0', () => {
        execSync(`"${bin}" --help`, { encoding: 'utf8', timeout: 10000 })
    })

    const origin = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, path: req.url }))
    })
    await new Promise((r) => origin.listen(0, '127.0.0.1', r))
    const originPort = origin.address().port

    const port = 19876 + Math.floor(Math.random() * 100)
    const child = spawn(bin, ['start'], {
        env: { ...process.env, PORT: String(port), MEDDLE_HEADLESS: '1' },
        stdio: 'pipe',
    })

    let serverOutput = ''
    child.stdout.on('data', (d) => (serverOutput += d))
    child.stderr.on('data', (d) => (serverOutput += d))

    await new Promise((r) => setTimeout(r, 3000))

    try {
        assert('proxy server starts', () => {
            if (child.exitCode !== null) throw new Error(`exited with ${child.exitCode}: ${serverOutput}`)
        })

        const dashRes = await fetch(`http://127.0.0.1:${port}/__meddle__/`)
        assert('web dashboard serves HTML', () => {
            if (dashRes.status !== 200) throw new Error(`status ${dashRes.status}`)
            if (!dashRes.body.includes('<!doctype html>')) throw new Error('not HTML')
        })

        const proxyRes = await fetchViaProxy(port, `http://127.0.0.1:${originPort}/smoke-test`)
        assert('proxy forwards HTTP requests', () => {
            if (proxyRes.status !== 200) throw new Error(`status ${proxyRes.status}`)
            const data = JSON.parse(proxyRes.body)
            if (!data.ok) throw new Error('unexpected response body')
        })
    } finally {
        child.kill('SIGTERM')
        await new Promise((r) => setTimeout(r, 500))
        if (child.exitCode === null) child.kill('SIGKILL')
        origin.close()
    }

    console.log(`\n${passed} passed, ${failed} failed`)
    process.exit(failed > 0 ? 1 : 0)
}

main().catch((e) => {
    console.error(e)
    process.exit(1)
})
