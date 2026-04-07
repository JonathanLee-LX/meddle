/**
 * ep route show - Show rules in a file
 */

const output = require('../../lib/output')
const { isProxyRunning } = require('../../lib/proxy-detect')
const { apiGet } = require('../../lib/api-client')
const { getRuleFileContent, parseEprc } = require('../../lib/file-access')

// Parse arguments (skip 'route' and 'show' from argv)
const args = process.argv.slice(4)
const jsonFlag = args.includes('--json')
output.setJsonMode(jsonFlag)

// Get file name from positional argument
const fileName = args.find(a => !a.startsWith('--'))

async function run() {
  if (!fileName) {
    output.error('Missing required argument: <file>')
    process.exit(1)
  }

  const running = await isProxyRunning()

  let content = null
  let ruleMap = {}

  if (running) {
    try {
      content = await apiGet(`/api/rule-files/${encodeURIComponent(fileName)}/content`)
      ruleMap = parseEprc(typeof content === 'string' ? content : String(content))
    } catch (e) {
      // Fallback to file mode
      content = getRuleFileContent(fileName)
      if (!content) {
        output.error(`Route file not found: ${fileName}`)
        process.exit(1)
      }
      ruleMap = parseEprc(content)
    }
  } else {
    content = getRuleFileContent(fileName)
    if (!content) {
      output.error(`Route file not found: ${fileName}`)
      process.exit(1)
    }
    ruleMap = parseEprc(content)
  }

  // Build display rules (handle [marker] syntax)
  const displayRules = {}
  for (const [pat, tgt] of Object.entries(ruleMap)) {
    const bm = tgt.match(/\[([^\]]+)\]/)
    if (bm) {
      displayRules[pat.replace(bm[1], bm[0])] = tgt.replace(bm[0], '')
    } else {
      displayRules[pat] = tgt
    }
  }

  if (jsonFlag) {
    output.jsonRaw({
      file: fileName,
      rules: displayRules,
      count: Object.keys(displayRules).length
    })
    return
  }

  output.header(`Route File: ${fileName}`)
  output.kv('Rules', Object.keys(displayRules).length)

  if (Object.keys(displayRules).length === 0) {
    output.info('No rules in this file')
    return
  }

  output.section('Rules')
  for (const [pattern, target] of Object.entries(displayRules)) {
    output.kv(pattern, target)
  }
}

run().catch(e => {
  output.error(e.message)
  process.exit(1)
})