/**
 * ep route create - Create a route file
 */

const output = require('../../lib/output')
const { isProxyRunning } = require('../../lib/proxy-detect')
const { apiPost } = require('../../lib/api-client')
const { createRuleFile } = require('../../lib/file-access')

// Parse arguments (skip 'route' and 'create' from argv)
const args = process.argv.slice(4)
const jsonFlag = args.includes('--json')
output.setJsonMode(jsonFlag)

// Get file name from positional argument
const positionalArgs = args.filter(a => !a.startsWith('--'))
const fileName = positionalArgs[0]

// Get content from --content option
let content = ''
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--content') {
    content = args[++i] || ''
    break
  }
}

async function run() {
  if (!fileName) {
    output.error('Missing required argument: <name>')
    process.exit(1)
  }

  const running = await isProxyRunning()

  let result
  if (running) {
    try {
      result = await apiPost('/api/rule-files', {
        name: fileName.trim(),
        content: content.trim(),
        enabled: true
      })
      result = result.ruleFile || result
    } catch (e) {
      // Fallback to file mode
      try {
        result = createRuleFile(fileName, content, true)
      } catch (err) {
        output.error(err.message)
        process.exit(1)
      }
    }
  } else {
    try {
      result = createRuleFile(fileName, content, true)
    } catch (err) {
      output.error(err.message)
      process.exit(1)
    }
  }

  if (jsonFlag) {
    output.jsonRaw(result)
    return
  }

  output.header('Route File Created')
  output.success(result.name)
  output.kv('Enabled', result.enabled ? 'Yes' : 'No')
  output.kv('Rules', result.ruleCount)
}

run().catch(e => {
  output.error(e.message)
  process.exit(1)
})