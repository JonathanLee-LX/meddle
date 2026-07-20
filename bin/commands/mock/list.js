/**
 * meddle mock list - List all mock rules
 */

const output = require('../../lib/output')
const { isProxyRunning } = require('../../lib/proxy-detect')
const { apiGet } = require('../../lib/api-client')
const { loadMockRules } = require('../../lib/file-access')

// Check for --json flag
const args = process.argv.slice(3)
const jsonFlag = args.includes('--json')
output.setJsonMode(jsonFlag)

async function run() {
  const running = await isProxyRunning()

  let rules = []

  if (running) {
    try {
      rules = await apiGet('/api/mocks')
    } catch (e) {
      // Fallback to file mode
      rules = loadMockRules()
    }
  } else {
    rules = loadMockRules()
  }

  if (jsonFlag) {
    output.jsonRaw(rules)
    return
  }

  output.header(`Mock Rules (${rules.length} total)`)

  if (rules.length === 0) {
    output.info('No mock rules found')
    return
  }

  // Separate active and inactive
  const active = rules.filter(r => r.enabled)
  const inactive = rules.filter(r => !r.enabled)

  if (active.length > 0) {
    output.section('Active Rules')
    active.forEach(rule => {
      output.success(`#${rule.id}: ${rule.name} (${rule.urlPattern})`)
      output.kv('Status', rule.statusCode, 4)
      output.kv('Method', rule.method || '*', 4)
      output.kv('Delay', `${rule.delay || 0}ms`, 4)
    })
  }

  if (inactive.length > 0) {
    output.section('Inactive Rules')
    inactive.forEach(rule => {
      output.bullet(`#${rule.id}: ${rule.name} (${rule.urlPattern})`, false)
    })
  }
}

run().catch(e => {
  output.error(e.message)
  process.exit(1)
})