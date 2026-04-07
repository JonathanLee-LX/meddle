/**
 * ep mock delete - Delete a mock rule
 */

const output = require('../../lib/output')
const { isProxyRunning } = require('../../lib/proxy-detect')
const { apiDelete } = require('../../lib/api-client')
const { deleteMockRule } = require('../../lib/file-access')

// Parse arguments (skip 'mock' and 'delete' from argv)
const args = process.argv.slice(4)
const jsonFlag = args.includes('--json')
output.setJsonMode(jsonFlag)

// Get id from positional argument
const idArg = args.find(a => !a.startsWith('--'))
const id = idArg ? parseInt(idArg, 10) : null

async function run() {
  if (id === null) {
    output.error('Missing required argument: <id>')
    process.exit(1)
  }

  const running = await isProxyRunning()

  if (running) {
    try {
      await apiDelete(`/api/mocks/${id}`)
    } catch (e) {
      // Fallback to file mode
      const deleted = deleteMockRule(id)
      if (!deleted) {
        output.error(`Mock rule not found: id=${id}`)
        process.exit(1)
      }
    }
  } else {
    const deleted = deleteMockRule(id)
    if (!deleted) {
      output.error(`Mock rule not found: id=${id}`)
      process.exit(1)
    }
  }

  if (jsonFlag) {
    output.jsonRaw({ success: true, id })
    return
  }

  output.header('Mock Rule Deleted')
  output.success(`id=${id}`)
}

run().catch(e => {
  output.error(e.message)
  process.exit(1)
})