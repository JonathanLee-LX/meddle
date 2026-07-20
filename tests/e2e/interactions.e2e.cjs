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

function requestJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request(url, options, (response) => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => { body += chunk })
      response.on('end', () => {
        try {
          resolve({ status: response.statusCode, data: JSON.parse(body) })
        } catch (error) {
          reject(new Error(`无法解析 ${url} 的响应: ${error.message}`))
        }
      })
    })
    request.on('error', reject)
    if (options.body) request.write(options.body)
    request.end()
  })
}

async function waitForServer(baseUrl, child, output) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Meddle 提前退出 (${child.exitCode})\n${output.join('')}`)
    }
    try {
      const response = await requestJson(`${baseUrl}/api/remote-access`)
      if (response.status === 200) return
    } catch {
      // The certificate and plugin bootstrap may still be running.
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`等待 Meddle 启动超时\n${output.join('')}`)
}

async function waitForText(page, text) {
  await page.waitForFunction(
    (expected) => document.body.innerText.includes(expected),
    { timeout: 10_000 },
    text,
  )
}

async function clickButton(page, name) {
  await page.waitForFunction(
    (label) => [...document.querySelectorAll('button')].some((button) => button.textContent.trim().includes(label)),
    { timeout: 10_000 },
    name,
  )
  await page.evaluate((label) => {
    const button = [...document.querySelectorAll('button')]
      .find((candidate) => candidate.textContent.trim().includes(label))
    if (!button) throw new Error(`找不到按钮: ${label}`)
    button.click()
  }, name)
}

async function openMobileProxyPanel(page) {
  await clickButton(page, '手机代理')
  await waitForText(page, '扫码打开配置页')
  assert.equal(await page.$('text/面板加载失败'), null, '手机代理动态面板不应加载失败')
}

async function testMobileProxyPanel(page) {
  await page.goto(`${page.baseUrl}/logs`, { waitUntil: 'networkidle0' })
  await openMobileProxyPanel(page)

  const panelState = await page.evaluate(() => {
    const copyButton = document.querySelector('button[aria-label="复制手机配置地址"]')
    const addressBadge = copyButton?.parentElement?.querySelector('[data-slot="badge"]')
    const setupAddressBlocks = [...document.querySelectorAll('*')]
      .filter((element) => element.children.length === 0 && element.textContent?.trim() === '手机配置地址')
    return {
      copyButtonVisible: Boolean(copyButton),
      copyNextToAddress: Boolean(addressBadge && copyButton?.parentElement === addressBadge.parentElement),
      setupAddressBlockCount: setupAddressBlocks.length,
      hasQrCode: Boolean(document.querySelector('img[alt*="的二维码"]')),
    }
  })

  assert.equal(panelState.copyButtonVisible, true, '复制地址图标应存在')
  assert.equal(panelState.copyNextToAddress, true, '复制地址图标应紧邻代理地址')
  assert.equal(panelState.setupAddressBlockCount, 0, '不应重复展示手机配置地址块')
  assert.equal(panelState.hasQrCode, true, '手机代理面板应显示二维码')

  await page.click('button[aria-label="复制手机配置地址"]')
  await page.waitForSelector('button[aria-label="地址已复制"]')
}

async function testRuleCreateAndRename(page) {
  await page.goto(`${page.baseUrl}/config`, { waitUntil: 'networkidle0' })
  await page.waitForSelector('button[aria-label="创建规则文件"]')
  await page.click('button[aria-label="创建规则文件"]')

  const createInput = 'input[aria-label="新规则文件名称"]'
  await page.waitForSelector(createInput)
  const inlineState = await page.evaluate((selector) => {
    const input = document.querySelector(selector)
    return {
      insideTabList: Boolean(input?.closest('[role="tablist"]')),
      hasStandalonePanel: [...document.querySelectorAll('p')]
        .some((element) => element.textContent?.trim() === '创建新规则文件'),
    }
  }, createInput)
  assert.equal(inlineState.insideTabList, true, '创建输入框应位于名称 Tab 条内')
  assert.equal(inlineState.hasStandalonePanel, false, '不应显示独立创建面板')

  const createdName = `e2e-${Date.now()}`
  await page.click(createInput, { clickCount: 3 })
  await page.keyboard.type(createdName)
  await page.keyboard.press('Enter')
  await page.waitForFunction(
    (name) => [...document.querySelectorAll('[title="双击重命名"]')]
      .some((element) => element.textContent?.trim() === name),
    { timeout: 10_000 },
    createdName,
  )
  const createdFiles = await requestJson(`${page.baseUrl}/api/rule-files`)
  assert.equal(createdFiles.data.some((file) => file.name === createdName), true, '创建结果应写入服务端')

  const renamedName = `${createdName}-renamed`
  await page.evaluate((name) => {
    const label = [...document.querySelectorAll('[title="双击重命名"]')]
      .find((element) => element.textContent?.trim() === name)
    if (!label) throw new Error(`找不到规则 Tab: ${name}`)
    label.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
  }, createdName)

  const renameInput = `input[aria-label="重命名规则文件 ${createdName}"]`
  await page.waitForSelector(renameInput)
  await page.click(renameInput, { clickCount: 3 })
  await page.keyboard.type(renamedName)
  await page.keyboard.press('Enter')
  await page.waitForFunction(
    (name) => [...document.querySelectorAll('[title="双击重命名"]')]
      .some((element) => element.textContent?.trim() === name),
    { timeout: 10_000 },
    renamedName,
  )

  const files = await requestJson(`${page.baseUrl}/api/rule-files`)
  assert.equal(files.data.some((file) => file.name === renamedName), true, '重命名结果应写入服务端')
  assert.equal(files.data.some((file) => file.name === createdName), false, '旧规则名称不应残留')
}

async function main() {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'meddle-e2e-'))
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
      MEDDLE_REMOTE: '1',
      MEDDLE_PLUGIN_MODE: 'off',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  server.stdout.on('data', (chunk) => output.push(chunk.toString()))
  server.stderr.on('data', (chunk) => output.push(chunk.toString()))

  let browser
  try {
    await waitForServer(baseUrl, server, output)
    browser = await puppeteer.launch({
      executablePath: findChrome(),
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    })
    const page = await browser.newPage()
    page.baseUrl = baseUrl
    page.on('console', (message) => {
      if (message.type() === 'error') output.push(`[browser] ${message.text()}\n`)
    })
    page.on('pageerror', (error) => output.push(`[pageerror] ${error.message}\n`))

    await testMobileProxyPanel(page)
    console.log('✓ 手机代理面板加载、复制按钮与去重')
    await testRuleCreateAndRename(page)
    console.log('✓ 规则文件内联创建与双击重命名')

    const browserErrors = output.filter((line) => line.startsWith('[pageerror]'))
    assert.deepEqual(browserErrors, [], `页面运行错误:\n${browserErrors.join('')}`)
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
