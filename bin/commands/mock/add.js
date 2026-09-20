/**
 * meddle mock add - Add a mock rule
 */

const output = require('../../lib/output')
const { isProxyRunning } = require('../../lib/proxy-detect')
const { apiPost } = require('../../lib/api-client')
const { addMockRule } = require('../../lib/file-access')

// Parse arguments
const args = process.argv.slice(3)
const jsonFlag = args.includes('--json')
output.setJsonMode(jsonFlag)

function parseCorsFlag(options) {
  if (!options.cors) return
  const corsHeaders = {
    'Access-Control-Allow-Origin': '{origin}',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': '*',
    'Access-Control-Allow-Headers': '*',
  }
  options.headers = { ...corsHeaders, ...(options.headers || {}) }
  delete options.cors
}

function parseArgs(args) {
  const options = {}
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--name') options.name = args[++i]
    else if (args[i] === '--pattern') options.urlPattern = args[++i]
    else if (args[i] === '--query') options.query = args[++i]
    else if (args[i] === '--method') options.method = args[++i]
    else if (args[i] === '--status') options.statusCode = parseInt(args[++i], 10)
    else if (args[i] === '--body') options.body = args[++i]
    else if (args[i] === '--delay') options.delay = parseInt(args[++i], 10)
    else if (args[i] === '--cors') options.cors = true
    else if (args[i] === '--headers') {
      const raw = args[++i]
      try {
        options.headers = JSON.parse(raw)
      } catch (_) {
        output.error('Invalid --headers JSON: ' + raw)
        process.exit(1)
      }
    }
  }
  parseCorsFlag(options)
  return options
}

async function run() {
  const options = parseArgs(args)

  // Validate required fields
  if (!options.name) {
    output.error('Missing required option: --name')
    process.exit(1)
  }
  if (!options.urlPattern) {
    output.error('Missing required option: --pattern')
    process.exit(1)
  }

  // Set defaults
  const rule = {
    name: options.name,
    urlPattern: options.urlPattern,
    query: options.query || '',
    method: options.method || '*',
    statusCode: options.statusCode || 200,
    delay: options.delay || 0,
    bodyType: 'inline',
    headers: options.headers || {},
    body: options.body || '',
    enabled: true
  }

  const running = await isProxyRunning()

  let result
  if (running) {
    try {
      result = await apiPost('/api/mocks', rule)
      result = result.rule || result
    } catch (e) {
      // Fallback to file mode
      result = addMockRule(rule)
    }
  } else {
    result = addMockRule(rule)
  }

  if (jsonFlag) {
    output.jsonRaw(result)
    return
  }

  output.header('Mock Rule Added')
  output.success(`#${result.id}: ${result.name}`)
  output.kv('Pattern', result.urlPattern)
  if (result.query) output.kv('Query', result.query)
  output.kv('Method', result.method)
  output.kv('Status', result.statusCode)
  output.kv('Delay', `${result.delay}ms`)
  if (result.headers && Object.keys(result.headers).length > 0) {
    output.kv('Headers', JSON.stringify(result.headers))
  }
}

run().catch(e => {
  output.error(e.message)
  process.exit(1)
})
