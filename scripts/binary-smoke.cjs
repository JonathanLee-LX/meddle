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

        const proxyRes = await fetch('http://httpbin.org/get', {
            headers: { Host: 'httpbin.org' },
            agent: new http.Agent(),
        })
        assert('proxy forwards HTTP requests', () => {
            if (proxyRes.status !== 200) throw new Error(`status ${proxyRes.status}`)
        })
    } finally {
        child.kill('SIGTERM')
        await new Promise((r) => setTimeout(r, 500))
        if (child.exitCode === null) child.kill('SIGKILL')
    }

    console.log(`\n${passed} passed, ${failed} failed`)
    process.exit(failed > 0 ? 1 : 0)
}

main().catch((e) => {
    console.error(e)
    process.exit(1)
})
