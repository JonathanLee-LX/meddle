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
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'meddle-overview-'))
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

    // 默认规则（服务端自动创建并启用）
    const defaultContent = [
      'example.com !sub.example.com 127.0.0.1:3000',
      'api.test.com !sub.api.test.com localhost:8080',
    ].join('\n')
    const defaultUpdate = await request(`${baseUrl}/api/rule-files/${encodeURIComponent('默认规则')}/content`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: defaultContent }),
    })
    assert.equal(defaultUpdate.status, 200, '默认规则应成功写入')

    // 开发规则（启用，追加在默认规则之后 → 同名规则向后覆盖）
    const devCreate = await request(`${baseUrl}/api/rule-files`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: '开发规则',
        enabled: true,
        content: [
          'example.com 10.0.0.9:80',
          '//disabled.test.com 127.0.0.1:4000',
        ].join('\n'),
      }),
    })
    assert.equal(devCreate.status, 200, '开发规则应成功创建并启用')

    // 直接断言后端总览语义，作为前端 UI 断言的地基
    const overviewRes = await request(`${baseUrl}/api/rule-files/overview`)
    assert.equal(overviewRes.status, 200)
    const overview = JSON.parse(overviewRes.body)
    assert.equal(overview.mergedRules.length, 2, '合并视图应为 2 条生效规则')
    const exampleWinner = overview.mergedRules.find((r) => r.pattern === 'example.com')
    assert.equal(exampleWinner.file, '开发规则', '同名规则 winner 应为后定义的开发规则')
    assert.equal(exampleWinner.target, '10.0.0.9:80')
    const conflict = overview.conflicts.find((c) => c.pattern === 'example.com')
    assert.equal(conflict.shadowed.length, 1)
    assert.equal(conflict.shadowed[0].file, '默认规则')

    browser = await puppeteer.launch({
      executablePath: findChrome(),
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    })
    const page = await browser.newPage()
    await page.setViewport({ width: 1280, height: 900 })
    const pageErrors = []
    page.on('pageerror', (error) => pageErrors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') pageErrors.push(message.text())
    })

    await page.goto(`${baseUrl}/config`, { waitUntil: 'networkidle0' })
    await page.waitForSelector('button[aria-label="查看所有规则"]')

    // 1) 打开全局规则总览面板，默认生效视图
    await page.click('button[aria-label="查看所有规则"]')
    await page.waitForFunction(() => document.body.textContent.includes('全局规则总览'))
    await page.waitForFunction(() => document.body.textContent.includes('example.com'))

    // example.com 组：winner(开发规则) + 被覆盖(默认规则) 两行，加上 api.test.com 共 3 行
    assert.equal(
      await page.$$eval('.global-panel-content tbody tr', (rows) => rows.length),
      3,
      '生效视图应渲染 2 条规则共 3 行（example.com 组 2 行 + api.test.com 1 行）',
    )
    const mergedText = await page.$eval('.global-panel-content', (node) => node.textContent)
    assert.ok(mergedText.includes('开发规则'), 'example.com winner 应来自开发规则')
    assert.ok(mergedText.includes('127.0.0.1:3000'), '被覆盖行应显示默认规则目标')
    assert.ok(mergedText.includes('10.0.0.9:80'), 'winner 应显示开发规则目标')
    assert.ok(mergedText.includes('api.test.com'))
    assert.ok(mergedText.includes('!sub.api.test.com'), 'api.test.com 目标的排除项应显示在生效视图')
    assert.ok(mergedText.includes('生效'))
    assert.ok(mergedText.includes('已被覆盖'))
    assert.ok(mergedText.includes('按代理实际生效顺序排列'))
    assert.ok(mergedText.includes('3 / 3 条'))

    // 2) 搜索过滤：输入「api」只留 api.test.com，example.com 行消失
    await page.type('.global-panel-content input[aria-label="搜索规则"]', 'api')
    await page.waitForFunction(() => !document.body.textContent.includes('example.com'))
    assert.equal(
      await page.$$eval('.global-panel-content tbody tr', (rows) => rows.length),
      1,
      '搜索 api 后应只剩 api.test.com 一行',
    )
    assert.ok((await page.$eval('.global-panel-content', (n) => n.textContent)).includes('api.test.com'))

    // 3) 清空筛选（直接置空搜索框），切到按文件视图；禁用行与计数、启用/禁用徽标
    await page.$eval('.global-panel-content input[aria-label="搜索规则"]', (input) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(input, '')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await page.waitForFunction(() => document.body.textContent.includes('example.com'), { timeout: 10_000 })
    const fileToggle = (await page.$$('.global-panel-content button'))
    for (const button of fileToggle) {
      const label = await button.evaluate((node) => node.textContent)
      if (label.trim() === '按文件') { await button.click(); break }
    }
    await page.waitForFunction(() => document.body.textContent.includes('disabled.test.com'))
    const filesText = await page.$eval('.global-panel-content', (node) => node.textContent)
    assert.ok(filesText.includes('默认规则'))
    assert.ok(filesText.includes('开发规则'))
    assert.ok(filesText.includes('disabled.test.com'), '按文件视图应包含禁用规则')
    assert.ok(filesText.includes('启用'))
    assert.ok(filesText.includes('禁用'))
    assert.ok(filesText.includes('127.0.0.1:4000'), '禁用规则目标应显示')

    // 4) 点击开发规则中的 example.com 行 → 面板关闭、切回 /config，命中行高亮 bg-primary/10
    //（按文件视图的规则行不含文件名，用该行独有的目标 10.0.0.9:80 唯一标识开发规则的 example.com 行）
    const rowElements = await page.$$('.global-panel-content tbody tr')
    let targetRow = null
    for (const row of rowElements) {
      const text = await row.evaluate((node) => node.textContent)
      if (text.includes('10.0.0.9:80')) { targetRow = row; break }
    }
    assert.notEqual(targetRow, null, '应找到开发规则的 example.com 行')
    await targetRow.click()
    await page.waitForFunction(() => !document.body.textContent.includes('全局规则总览'))
    await page.waitForSelector('tr.bg-primary\\/10')
    // 规则区表格用 input 承载规则/目标，需读取 input 值断言
    const highlightVals = await page.$eval('tr.bg-primary\\/10', (row) => {
      const inputs = Array.from(row.querySelectorAll('input'))
      return inputs.map((input) => input.value)
    })
    assert.ok(highlightVals.includes('example.com'), `高亮行应包含 example.com，实为 ${JSON.stringify(highlightVals)}`)
    assert.ok(highlightVals.includes('10.0.0.9:80'), `高亮行应包含目标 10.0.0.9:80，实为 ${JSON.stringify(highlightVals)}`)

    assert.deepEqual(pageErrors, [], `总览交互期间不应出现页面异常:\n${pageErrors.join('\n')}`)
    console.log('✓ 全局规则总览生效视图 / 搜索 / 按文件 / 定位高亮均通过')
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
