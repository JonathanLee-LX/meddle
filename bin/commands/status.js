/**
 * ep status - Get proxy status
 */

const { getProxyUrl, isProxyRunning } = require('../lib/proxy-detect')
const { apiGet } = require('../lib/api-client')
const { loadMockRules, listRuleFiles, getActiveRuleFileNames } = require('../lib/file-access')
const output = require('../lib/output')

// Check for --json flag
const args = process.argv.slice(2)
const jsonFlag = args.includes('--json')
output.setJsonMode(jsonFlag)

async function run() {
  const url = getProxyUrl()
  const running = await isProxyRunning()

  let mockCount = 0
  let activeMocks = 0
  let routeFiles = []
  let activeRoutes = 0

  if (running) {
    try {
      // Get mock rules from API
      const mocks = await apiGet('/api/mocks')
      mockCount = mocks.length
      activeMocks = mocks.filter(m => m.enabled).length

      // Get route files from API
      routeFiles = await apiGet('/api/rule-files')
      activeRoutes = routeFiles.filter(f => f.enabled).length
    } catch (_) {
      // Fallback to file access
      const mocks = loadMockRules()
      mockCount = mocks.length
      activeMocks = mocks.filter(m => m.enabled).length

      routeFiles = listRuleFiles()
      activeRoutes = routeFiles.filter(f => f.enabled).length
    }
  } else {
    // File mode
    const mocks = loadMockRules()
    mockCount = mocks.length
    activeMocks = mocks.filter(m => m.enabled).length

    routeFiles = listRuleFiles()
    activeRoutes = routeFiles.filter(f => f.enabled).length
  }

  const totalRouteRules = routeFiles.reduce((sum, f) => sum + f.ruleCount, 0)

  if (output.isJsonMode()) {
    output.jsonRaw({
      proxyUrl: url,
      running,
      mocks: { total: mockCount, active: activeMocks },
      routes: { files: routeFiles.length, activeFiles: activeRoutes, totalRules: totalRouteRules }
    })
    return
  }

  output.header('Proxy Status')
  output.kv('Proxy URL', url)
  output.kv('Status', running ? 'Running' : 'Not Running')

  output.section('Mock Rules')
  output.kv('Total', mockCount)
  output.kv('Active', activeMocks)

  output.section('Route Rules')
  output.kv('Files', routeFiles.length)
  output.kv('Active Files', activeRoutes)
  output.kv('Total Rules', totalRouteRules)

  if (routeFiles.length > 0) {
    output.plain('')
    routeFiles.forEach(f => {
      output.bullet(`${f.name} (${f.ruleCount} rules)`, f.enabled)
    })
  }
}

run().catch(e => {
  output.error(e.message)
  process.exit(1)
})