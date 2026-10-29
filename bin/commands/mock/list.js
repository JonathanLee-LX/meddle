/**
 * meddle mock list - List all mock rules
 */

const output = require('../../lib/output')
const { apiGet } = require('../../lib/api-client')
const { loadMockRules } = require('../../lib/file-access')
const { withProxyOrFile, failCommand } = require('../../lib/proxy-or-file')

// Check for --json flag
const args = process.argv.slice(3)
const jsonFlag = args.includes('--json')
output.setJsonMode(jsonFlag)

function listFromFile() {
  try {
    return loadMockRules()
  } catch (err) {
    if (err && err.code === 'MOCKS_FILE_INVALID' && err.listMessage) {
      const listed = new Error(err.listMessage)
      listed.rawStderr = true
      throw listed
    }
    throw err
  }
}

async function run() {
  const { value: rules } = await withProxyOrFile({
    api: async () => {
      const listed = await apiGet('/api/mocks')
      // GET /api/mocks stays a bare array and is [] when the file failed to
      // parse. The status endpoint is the signal that the file is corrupt.
      let fileStatus = null
      try {
        fileStatus = await apiGet('/api/mocks-file')
      } catch (err) {
        if (!err || !Number.isInteger(err.status)) throw err
      }
      if (fileStatus && fileStatus.valid === false) {
        const err = new Error(fileStatus.error || 'Mock 文件格式错误')
        err.rawStderr = true
        throw err
      }
      return listed
    },
    file: listFromFile,
  })

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
      if (rule.query) output.kv('Query', rule.query, 4)
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

run().catch((e) => failCommand(e))