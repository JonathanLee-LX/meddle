/**
 * meddle mock enable/disable - Toggle mock rule enabled status
 */

const output = require('../../lib/output')
const { apiPut } = require('../../lib/api-client')
const { updateMockRule } = require('../../lib/file-access')
const { withProxyOrFile, failCommand } = require('../../lib/proxy-or-file')

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

  const { value: result, fileOnly } = await withProxyOrFile({
    api: async () => {
      const updated = await apiPut(`/api/mocks/${id}`, { enabled })
      return updated.rule || updated
    },
    file: () => {
      const updated = updateMockRule(id, { enabled })
      if (!updated) throw new Error(`Mock rule not found: id=${id}`)
      return updated
    },
  })

  if (fileOnly) output.warnFileOnlyMode()

  if (jsonFlag) {
    output.jsonRaw(fileOnly
      ? { ...result, fileOnly: true, warning: output.FILE_ONLY_WARNING }
      : result)
    return
  }

  output.header('Mock Rule Updated')
  output.success(`#${result.id}: ${result.name}`)
  output.kv('Enabled', enabled ? 'Yes' : 'No')
}

run().catch((e) => failCommand(e))