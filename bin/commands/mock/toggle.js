/**
 * meddle mock enable/disable - Toggle mock rule enabled status
 */

const output = require('../../lib/output')
const { isProxyRunning } = require('../../lib/proxy-detect')
const { apiPut } = require('../../lib/api-client')
const { updateMockRule } = require('../../lib/file-access')

// Parse arguments
const args = process.argv.slice(2) // Full args: ['mock', 'enable'/'disable', '<id>']
const subcommand = args[1] // 'enable' or 'disable' (at index 1)
const jsonFlag = args.includes('--json')
output.setJsonMode(jsonFlag)

// Get id from positional argument
const idArg = args.find(a => !a.startsWith('--') && a !== 'mock' && a !== 'enable' && a !== 'disable')
const id = idArg ? parseInt(idArg, 10) : null

async function run() {
  if (id === null) {
    output.error('Missing required argument: <id>')
    process.exit(1)
  }

  const enabled = subcommand === 'enable'

  const running = await isProxyRunning()

  let result
  if (running) {
    try {
      result = await apiPut(`/api/mocks/${id}`, { enabled })
      result = result.rule || result
    } catch (e) {
      // Fallback to file mode
      result = updateMockRule(id, { enabled })
      if (!result) {
        output.error(`Mock rule not found: id=${id}`)
        process.exit(1)
      }
    }
  } else {
    result = updateMockRule(id, { enabled })
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
  output.kv('Enabled', enabled ? 'Yes' : 'No')
}

run().catch(e => {
  output.error(e.message)
  process.exit(1)
})