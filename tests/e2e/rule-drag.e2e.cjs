const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')
const puppeteer = require('puppeteer-core')

const projectRoot = path.resolve(__dirname, '../..')
const chromeCandidates = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean)

function findChrome() {
  const executablePath = chromeCandidates.find((candidate) => fs.existsSync(candidate))
  if (!executablePath) {
    throw new Error('未找到 Chrome/Chromium，请通过 CHROME_PATH 指定浏览器路径')
  }
  return executablePath
}

async function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close((error) => error ? reject(error) : resolve(port))
    })
  })
}

function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, options, (response) => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => { body += chunk })
      response.on('end', () => resolve({ status: response.statusCode, body }))
    })
    req.on('error', reject)
    if (options.body) req.write(options.body)
    req.end()
  })
}

async function waitForServer(baseUrl, child, output) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Meddle 提前退出 (${child.exitCode})\n${output.join('')}`)
    }
    try {
      const response = await request(`${baseUrl}/api/rule-files`)
      if (response.status === 200) return
    } catch {
      // Certificate and plugin bootstrap may still be running.
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`等待 Meddle 启动超时\n${output.join('')}`)
}

async function main() {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'meddle-rule-drag-'))
  const port = await findFreePort()
  const baseUrl = `http://127.0.0.1:${port}`
  const output = []
  const server = spawn(process.execPath, ['index.js'], {
    cwd: projectRoot,
    env: {
      ...process.env,
      HOME: tempHome,
      PORT: String(port),
      MEDDLE_HEADLESS: '1',
      MEDDLE_PLUGIN_MODE: 'off',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  server.stdout.on('data', (chunk) => output.push(chunk.toString()))
  server.stderr.on('data', (chunk) => output.push(chunk.toString()))

  let browser
  try {
    await waitForServer(baseUrl, server, output)
    const content = [
      'alpha.test 127.0.0.1:3001',
      'beta.test 127.0.0.1:3002',
      'gamma.test 127.0.0.1:3003',
      'delta.test 127.0.0.1:3004',
      'epsilon.test 127.0.0.1:3005',
    ].join('\n')
    const update = await request(`${baseUrl}/api/rule-files/${encodeURIComponent('默认规则')}/content`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    })
    assert.equal(update.status, 200, '测试规则应成功写入')

    browser = await puppeteer.launch({
      executablePath: findChrome(),
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    })
    const page = await browser.newPage()
    const pageErrors = []
    page.on('pageerror', (error) => pageErrors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') pageErrors.push(message.text())
    })

    await page.goto(`${baseUrl}/config`, { waitUntil: 'networkidle0' })
    const handleSelector = 'tbody td[role="button"][aria-roledescription="sortable"]'
    await page.waitForSelector(handleSelector)
    await page.waitForFunction(
      (selector) => document.querySelectorAll(selector).length === 5,
      {},
      handleSelector,
    )

    const handles = await page.$$(handleSelector)
    const sourceBox = await handles[0].boundingBox()
    const targetBox = await handles[3].boundingBox()
    assert.ok(sourceBox && targetBox, '拖拽手柄必须可见')

    await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2)
    await page.mouse.down()
    await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 16 })
    await page.mouse.up()
    await new Promise((resolve) => setTimeout(resolve, 300))

    const order = await page.$$eval(
      'tbody input[placeholder="example.com"]',
      (inputs) => inputs.map((input) => input.value),
    )
    assert.deepEqual(order, [
      'beta.test',
      'gamma.test',
      'delta.test',
      'alpha.test',
      'epsilon.test',
    ])
    assert.deepEqual(pageErrors, [], `拖拽期间不应出现页面异常:\n${pageErrors.join('\n')}`)
    assert.notEqual(await page.$('main'), null, '拖拽后主界面应保持可见')
    console.log('✓ 规则拖拽排序完成且页面未白屏')
  } finally {
    if (browser) await browser.close()
    server.kill('SIGTERM')
    await new Promise((resolve) => {
      if (server.exitCode !== null) return resolve()
      server.once('exit', resolve)
      setTimeout(resolve, 2_000)
    })
    fs.rmSync(tempHome, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
