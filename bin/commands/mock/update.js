/**
 * ep mock update - Update a mock rule
 */

const output = require('../../lib/output')
const { isProxyRunning } = require('../../lib/proxy-detect')
const { apiPut } = require('../../lib/api-client')
const { updateMockRule, loadMockRules, saveMockRules } = require('../../lib/file-access')

// Parse arguments (skip 'mock' and 'update' from argv)
const args = process.argv.slice(4)
const jsonFlag = args.includes('--json')
output.setJsonMode(jsonFlag)

function parseArgs(args) {
  // First positional arg is id
  let id = null
  const options = {}

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--name') options.name = args[++i]
    else if (args[i] === '--pattern') options.urlPattern = args[++i]
    else if (args[i] === '--method') options.method = args[++i]
    else if (args[i] === '--status') options.statusCode = parseInt(args[++i], 10)
    else if (args[i] === '--body') options.body = args[++i]
    else if (args[i] === '--delay') options.delay = parseInt(args[++i], 10)
    else if (args[i] === '--headers') {
      try {
        options.headers = JSON.parse(args[++i])
      } catch (_) {
        options.headers = {}
      }
    }
    else if (!args[i].startsWith('--') && id === null) {
      id = parseInt(args[i], 10)
    }
  }

  return { id, options }
}

async function run() {
  const { id, options } = parseArgs(args)

  if (id === null) {
    output.error('Missing required argument: <id>')
    process.exit(1)
  }

  if (Object.keys(options).length === 0) {
    output.error('No update options provided')
    process.exit(1)
  }

  const running = await isProxyRunning()

  let result
  if (running) {
    try {
      result = await apiPut(`/api/mocks/${id}`, options)
      result = result.rule || result
    } catch (e) {
      // Fallback to file mode
      result = updateMockRule(id, options)
      if (!result) {
        output.error(`Mock rule not found: id=${id}`)
        process.exit(1)
      }
    }
  } else {
    result = updateMockRule(id, options)
    if (!result) {
      output.error(`Mock rule not found: id=${id}`)
      process.exit(1)
    }
  }

  if (jsonFlag) {
    output.jsonRaw(result)
    return
  }

  output.header('Mock Rule Updated')
  output.success(`#${result.id}: ${result.name}`)
  if (options.urlPattern) output.kv('Pattern', result.urlPattern)
  if (options.method) output.kv('Method', result.method)
  if (options.statusCode) output.kv('Status', result.statusCode)
  if (options.delay) output.kv('Delay', `${result.delay}ms`)
}

run().catch(e => {
  output.error(e.message)
  process.exit(1)
})