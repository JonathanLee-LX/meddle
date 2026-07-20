const fs = require('fs')
const http = require('http')
const https = require('https')
const os = require('os')
const path = require('path')
const { execFile, spawn } = require('child_process')
const certGenerator = require('node-easy-cert/src/certGenerator')

const chromeUserAgent = 'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Mobile Safari/537.36'
const unknownUserAgent = 'okhttp/4.12.0'

function getFreePort(host = '127.0.0.1') {
  return new Promise((resolve, reject) => {
    const server = http.createServer()
    server.once('error', reject)
    server.listen(0, host, () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(error => error ? reject(error) : resolve(port))
    })
  })
}

function getPrivateLanAddress() {
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family !== 'IPv4' || entry.internal) continue
      if (
        entry.address.startsWith('10.')
        || entry.address.startsWith('192.168.')
        || /^172\.(1[6-9]|2\d|3[01])\./.test(entry.address)
      ) {
        return entry.address
      }
    }
  }
  return undefined
}

async function waitFor(predicate, description, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs
  let lastError
  while (Date.now() < deadline) {
    try {
      const value = await predicate()
      if (value) return value
    } catch (error) {
      lastError = error
    }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`${description} timed out${lastError ? `: ${lastError.message}` : ''}`)
}

function proxyRequest(proxyHost, proxyPort, targetUrl, userAgent, options = {}) {
  const args = [
    '--silent',
    '--show-error',
    '--fail',
    '--noproxy',
    '',
    '--proxy',
    `http://${proxyHost}:${proxyPort}`,
    '--user-agent',
    userAgent,
  ]
  if (options.insecure) args.push('--insecure')
  args.push(targetUrl)

  return new Promise((resolve, reject) => {
    execFile('/usr/bin/curl', args, { encoding: 'utf8', timeout: 10000 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr.trim() || error.message))
        return
      }
      resolve(stdout)
    })
  })
}

async function main() {
  const lanAddress = process.env.MEDDLE_IDENTITY_SMOKE_HOST || getPrivateLanAddress()
  if (!lanAddress) {
    throw new Error('No private LAN IPv4 address found; set MEDDLE_IDENTITY_SMOKE_HOST to run the remote-device smoke test')
  }

  const proxyPort = await getFreePort()
  const originPort = await getFreePort()
  const secureOriginPort = await getFreePort()
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'meddle-identity-smoke-'))
  const stdout = []
  const stderr = []

  const origin = http.createServer((req, res) => {
    const body = Buffer.from('application-identity-smoke-ok')
    res.writeHead(200, {
      'content-type': 'text/plain',
      'content-length': body.length,
      connection: 'close',
    })
    res.end(body)
  })
  await new Promise((resolve, reject) => {
    origin.once('error', reject)
    origin.listen(originPort, '127.0.0.1', resolve)
  })

  const secureCert = certGenerator.generateRootCA('127.0.0.1')
  const secureOrigin = https.createServer({
    key: secureCert.privateKey,
    cert: secureCert.certificate,
  }, (req, res) => {
    const body = Buffer.from('application-identity-https-smoke-ok')
    res.writeHead(200, {
      'content-type': 'text/plain',
      'content-length': body.length,
      connection: 'close',
    })
    res.end(body)
  })
  await new Promise((resolve, reject) => {
    secureOrigin.once('error', reject)
    secureOrigin.listen(secureOriginPort, '127.0.0.1', resolve)
  })

  const proxy = spawn(process.execPath, ['index.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      HOME: tempHome,
      PORT: String(proxyPort),
      MEDDLE_REMOTE: '1',
      MEDDLE_HEADLESS: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  proxy.stdout.on('data', chunk => stdout.push(chunk.toString()))
  proxy.stderr.on('data', chunk => stderr.push(chunk.toString()))

  try {
    await waitFor(async () => {
      const response = await fetch(`http://127.0.0.1:${proxyPort}/api/logs`)
      return response.ok
    }, 'proxy startup')

    const localPath = `/identity-local-${Date.now()}`
    const remotePath = `/identity-remote-${Date.now()}`
    const remoteHttpsPath = `/identity-remote-https-${Date.now()}`
    const unknownPath = `/identity-unknown-${Date.now()}`
    const originUrl = `http://127.0.0.1:${originPort}`

    await proxyRequest('127.0.0.1', proxyPort, `${originUrl}${localPath}`, 'curl-smoke')
    await proxyRequest(lanAddress, proxyPort, `${originUrl}${remotePath}`, chromeUserAgent)
    await proxyRequest(
      lanAddress,
      proxyPort,
      `https://127.0.0.1:${secureOriginPort}${remoteHttpsPath}`,
      chromeUserAgent,
      { insecure: true },
    )
    await proxyRequest(lanAddress, proxyPort, `${originUrl}${unknownPath}`, unknownUserAgent)

    const records = await waitFor(async () => {
      const response = await fetch(`http://127.0.0.1:${proxyPort}/api/logs`)
      const rows = await response.json()
      const selected = rows.filter(record => (
        record.source.includes(localPath)
        || record.source.includes(remotePath)
        || record.source.includes(remoteHttpsPath)
        || record.source.includes(unknownPath)
      ))
      return selected.length === 4 ? selected : undefined
    }, 'identity records')

    const local = records.find(record => record.source.includes(localPath))
    const remote = records.find(record => record.source.includes(remotePath))
    const remoteHttps = records.find(record => record.source.includes(remoteHttpsPath))
    const unknown = records.find(record => record.source.includes(unknownPath))

    if (process.platform === 'darwin') {
      if (
        local.applicationName !== 'curl'
        || local.applicationIdentitySource !== 'local-process'
        || local.applicationIdentityConfidence !== 'high'
        || !local.applicationPid
      ) {
        throw new Error(`local process identity mismatch: ${JSON.stringify(local)}`)
      }
    }

    if (
      remote.clientType !== 'remote'
      || remote.applicationName !== 'Google Chrome'
      || remote.applicationIdentitySource !== 'user-agent'
      || remote.applicationIdentityConfidence !== 'medium'
      || remote.applicationPid !== undefined
    ) {
      throw new Error(`remote User-Agent identity mismatch: ${JSON.stringify(remote)}`)
    }

    if (
      remoteHttps.clientType !== 'remote'
      || remoteHttps.applicationName !== 'Google Chrome'
      || remoteHttps.applicationIdentitySource !== 'user-agent'
      || remoteHttps.applicationIdentityConfidence !== 'medium'
    ) {
      throw new Error(`remote HTTPS User-Agent identity mismatch: ${JSON.stringify(remoteHttps)}`)
    }

    if (
      unknown.clientType !== 'remote'
      || unknown.applicationName !== undefined
      || unknown.applicationIdentitySource !== undefined
    ) {
      throw new Error(`unknown User-Agent should remain unidentified: ${JSON.stringify(unknown)}`)
    }

    console.log(JSON.stringify({
      proxyPort,
      lanAddress,
      local: process.platform === 'darwin' ? {
        applicationName: local.applicationName,
        source: local.applicationIdentitySource,
        confidence: local.applicationIdentityConfidence,
      } : 'process lookup skipped on non-macOS',
      remote: {
        applicationName: remote.applicationName,
        source: remote.applicationIdentitySource,
        confidence: remote.applicationIdentityConfidence,
      },
      remoteHttps: {
        applicationName: remoteHttps.applicationName,
        source: remoteHttps.applicationIdentitySource,
        confidence: remoteHttps.applicationIdentityConfidence,
      },
      unknown: {
        applicationName: unknown.applicationName || null,
      },
    }, null, 2))
  } catch (error) {
    const diagnostics = [...stdout, ...stderr].join('').trim()
    if (diagnostics) console.error(diagnostics)
    throw error
  } finally {
    proxy.kill('SIGTERM')
    origin.close()
    secureOrigin.close()
    fs.rmSync(tempHome, { recursive: true, force: true })
  }
}

main().catch(error => {
  console.error(error.stack || error.message)
  process.exit(1)
})
