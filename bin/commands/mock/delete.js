/**
 * meddle mock delete - Delete a mock rule
 */

const output = require('../../lib/output')
const { apiDelete } = require('../../lib/api-client')
const { deleteMockRule } = require('../../lib/file-access')
const { withProxyOrFile, failCommand } = require('../../lib/proxy-or-file')

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

  const { fileOnly } = await withProxyOrFile({
    api: async () => {
      await apiDelete(`/api/mocks/${id}`)
      return true
    },
    file: () => {
      const deleted = deleteMockRule(id)
      if (!deleted) throw new Error(`Mock rule not found: id=${id}`)
      return true
    },
  })

  if (fileOnly) output.warnFileOnlyMode()

  if (jsonFlag) {
    output.jsonRaw(fileOnly
      ? { success: true, id, fileOnly: true, warning: output.FILE_ONLY_WARNING }
      : { success: true, id })
    return
  }

  output.header('Mock Rule Deleted')
  output.success(`id=${id}`)
}

run().catch((e) => failCommand(e))