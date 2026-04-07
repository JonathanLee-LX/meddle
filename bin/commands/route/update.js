/**
 * ep route update - Update a rule in a route file
 */

const output = require('../../lib/output')
const { isProxyRunning } = require('../../lib/proxy-detect')
const { apiGet, apiPut } = require('../../lib/api-client')
const { getRuleFileContent, saveRuleFileContent, parseEprc, ruleMapToEprcText } = require('../../lib/file-access')

// Parse arguments (skip 'route' and 'update' from argv)
const args = process.argv.slice(4)
const jsonFlag = args.includes('--json')
output.setJsonMode(jsonFlag)

// Get positional arguments: file, pattern, newTarget
const positionalArgs = args.filter(a => !a.startsWith('--'))
const fileName = positionalArgs[0]
const pattern = positionalArgs[1]
const newTarget = positionalArgs[2]

async function run() {
  if (!fileName) {
    output.error('Missing required argument: <file>')
    process.exit(1)
  }
  if (!pattern) {
    output.error('Missing required argument: <pattern>')
    process.exit(1)
  }
  if (!newTarget) {
    output.error('Missing required argument: <target>')
    process.exit(1)
  }

  const running = await isProxyRunning()

  const pat = pattern.trim()
  const tgt = newTarget.trim()

  // Handle [marker] syntax for lookup
  const bm = pat.match(/\[([^\]]+)\]/)
  const internalKey = bm ? pat.replace(bm[0], bm[1]) : pat

  if (running) {
    try {
      let content = await apiGet(`/api/rule-files/${encodeURIComponent(fileName)}/content`)
      const text = typeof content === 'string' ? content : String(content)
      const ruleMap = parseEprc(text)

      if (!Object.prototype.hasOwnProperty.call(ruleMap, internalKey)) {
        output.error(`Pattern not found: ${pat}`)
        process.exit(1)
      }

      ruleMap[internalKey] = bm ? tgt + bm[0] : tgt
      const newContent = ruleMapToEprcText(ruleMap)
      await apiPut(`/api/rule-files/${encodeURIComponent(fileName)}/content`, { content: newContent })

      if (jsonFlag) {
        output.jsonRaw({ success: true, file: fileName, pattern: pat, newTarget: tgt })
        return
      }

      output.header('Route Rule Updated')
      output.success(`${pat} -> ${tgt}`)
      output.kv('File', fileName)
    } catch (e) {
      // Fallback to file mode
      const content = getRuleFileContent(fileName)
      if (!content) {
        output.error(`Route file not found: ${fileName}`)
        process.exit(1)
      }

      const ruleMap = parseEprc(content)
      if (!Object.prototype.hasOwnProperty.call(ruleMap, internalKey)) {
        output.error(`Pattern not found: ${pat}`)
        process.exit(1)
      }

      ruleMap[internalKey] = bm ? tgt + bm[0] : tgt
      const newContent = ruleMapToEprcText(ruleMap)
      saveRuleFileContent(fileName, newContent)

      if (jsonFlag) {
        output.jsonRaw({ success: true, file: fileName, pattern: pat, newTarget: tgt })
        return
      }

      output.header('Route Rule Updated')
      output.success(`${pat} -> ${tgt}`)
      output.kv('File', fileName)
    }
  } else {
    // File mode
    const content = getRuleFileContent(fileName)
    if (!content) {
      output.error(`Route file not found: ${fileName}`)
      process.exit(1)
    }

    const ruleMap = parseEprc(content)
    if (!Object.prototype.hasOwnProperty.call(ruleMap, internalKey)) {
      output.error(`Pattern not found: ${pat}`)
      process.exit(1)
    }

    ruleMap[internalKey] = bm ? tgt + bm[0] : tgt
    const newContent = ruleMapToEprcText(ruleMap)
    saveRuleFileContent(fileName, newContent)

    if (jsonFlag) {
      output.jsonRaw({ success: true, file: fileName, pattern: pat, newTarget: tgt })
      return
    }

    output.header('Route Rule Updated')
    output.success(`${pat} -> ${tgt}`)
    output.kv('File', fileName)
  }
}

run().catch(e => {
  output.error(e.message)
  process.exit(1)
})