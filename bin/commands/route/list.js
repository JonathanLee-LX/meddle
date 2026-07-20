/**
 * meddle route list - List all route files
 */

const output = require('../../lib/output')
const { isProxyRunning } = require('../../lib/proxy-detect')
const { apiGet } = require('../../lib/api-client')
const { listRuleFiles } = require('../../lib/file-access')

// Check for --json flag
const args = process.argv.slice(3)
const jsonFlag = args.includes('--json')
output.setJsonMode(jsonFlag)

async function run() {
  const running = await isProxyRunning()

  let files = []

  if (running) {
    try {
      files = await apiGet('/api/rule-files')
    } catch (e) {
      // Fallback to file mode
      files = listRuleFiles()
    }
  } else {
    files = listRuleFiles()
  }

  if (jsonFlag) {
    output.jsonRaw(files)
    return
  }

  output.header(`Route Files (${files.length} total)`)

  if (files.length === 0) {
    output.info('No route files found')
    return
  }

  // Separate active and inactive
  const active = files.filter(f => f.enabled)
  const inactive = files.filter(f => !f.enabled)

  if (active.length > 0) {
    output.section('Active Files')
    active.forEach(f => {
      const excludeInfo = f.excludeCount > 0 ? `, ${f.excludeCount} exclusions` : ''
      output.success(`${f.name} (${f.ruleCount} rules${excludeInfo})`)
    })
  }

  if (inactive.length > 0) {
    output.section('Inactive Files')
    inactive.forEach(f => {
      const excludeInfo = f.excludeCount > 0 ? `, ${f.excludeCount} exclusions` : ''
      output.bullet(`${f.name} (${f.ruleCount} rules${excludeInfo})`, false)
    })
  }
}

run().catch(e => {
  output.error(e.message)
  process.exit(1)
})