/**
 * meddle route show - Show rules in a file
 */

const output = require('../../lib/output')
const { isProxyRunning } = require('../../lib/proxy-detect')
const { apiGet } = require('../../lib/api-client')
const { getRuleFileContent, parseEprcWithExclusions } = require('../../lib/file-access')

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
  let excludeMap = {}

  if (running) {
    try {
      content = await apiGet(`/api/rule-files/${encodeURIComponent(fileName)}/content`)
      const parsed = parseEprcWithExclusions(typeof content === 'string' ? content : String(content))
      ruleMap = parsed.ruleMap
      excludeMap = parsed.excludeMap
    } catch (e) {
      // Fallback to file mode
      content = getRuleFileContent(fileName)
      if (!content) {
        output.error(`Route file not found: ${fileName}`)
        process.exit(1)
      }
      const parsed = parseEprcWithExclusions(content)
      ruleMap = parsed.ruleMap
      excludeMap = parsed.excludeMap
    }
  } else {
    content = getRuleFileContent(fileName)
    if (!content) {
      output.error(`Route file not found: ${fileName}`)
      process.exit(1)
    }
    const parsed = parseEprcWithExclusions(content)
    ruleMap = parsed.ruleMap
    excludeMap = parsed.excludeMap
  }

  // Build display rules (handle [marker] syntax)
  const displayRules = {}
  for (const [pat, tgt] of Object.entries(ruleMap)) {
    const bm = tgt.match(/\[([^\]]+)\]/)
    const displayPat = bm ? pat.replace(bm[1], bm[0]) : pat
    const displayTgt = bm ? tgt.replace(bm[0], '') : tgt
    const exclusions = excludeMap[pat] || []
    displayRules[displayPat] = exclusions.length > 0
      ? { target: displayTgt, exclusions }
      : displayTgt
  }

  // Calculate total exclusions
  let totalExclusions = 0
  for (const exclusions of Object.values(excludeMap)) {
    totalExclusions += exclusions.length
  }

  if (jsonFlag) {
    output.jsonRaw({
      file: fileName,
      rules: displayRules,
      ruleCount: Object.keys(displayRules).length,
      exclusionCount: totalExclusions
    })
    return
  }

  output.header(`Route File: ${fileName}`)
  output.kv('Rules', Object.keys(displayRules).length)
  if (totalExclusions > 0) {
    output.kv('Exclusions', totalExclusions)
  }

  if (Object.keys(displayRules).length === 0) {
    output.info('No rules in this file')
    return
  }

  output.section('Rules')
  for (const [pattern, rule] of Object.entries(displayRules)) {
    if (typeof rule === 'string') {
      output.kv(pattern, rule)
    } else {
      const exclStr = rule.exclusions.map(e => `!${e}`).join(' ')
      output.kv(pattern, `${rule.target} ${exclStr}`)
    }
  }
}

run().catch(e => {
  output.error(e.message)
  process.exit(1)
})