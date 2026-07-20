/**
 * meddle route add - Add a rule to a route file
 */

const output = require('../../lib/output')
const { isProxyRunning } = require('../../lib/proxy-detect')
const { apiGet, apiPut } = require('../../lib/api-client')
const { getRuleFileContent, saveRuleFileContent, parseEprc, ruleMapToEprcText } = require('../../lib/file-access')

// Parse arguments (skip 'route' and 'add' from argv)
const args = process.argv.slice(4)
const jsonFlag = args.includes('--json')
output.setJsonMode(jsonFlag)

// Get positional arguments: file, pattern, target
const positionalArgs = args.filter(a => !a.startsWith('--'))
const fileName = positionalArgs[0]
const pattern = positionalArgs[1]
const target = positionalArgs[2]

async function run() {
  if (!fileName) {
    output.error('Missing required argument: <file>')
    process.exit(1)
  }
  if (!pattern) {
    output.error('Missing required argument: <pattern>')
    process.exit(1)
  }
  if (!target) {
    output.error('Missing required argument: <target>')
    process.exit(1)
  }

  const running = await isProxyRunning()

  const pat = pattern.trim()
  const tgt = target.trim()

  if (running) {
    try {
      // Get current content
      let content = await apiGet(`/api/rule-files/${encodeURIComponent(fileName)}/content`)
      const text = typeof content === 'string' ? content : String(content)
      const ruleMap = parseEprc(text)

      // Handle [marker] syntax
      const bm = pat.match(/\[([^\]]+)\]/)
      if (bm) {
        ruleMap[pat.replace(bm[0], bm[1])] = tgt + bm[0]
      } else {
        ruleMap[pat] = tgt
      }

      const newContent = ruleMapToEprcText(ruleMap)
      await apiPut(`/api/rule-files/${encodeURIComponent(fileName)}/content`, { content: newContent })

      if (jsonFlag) {
        output.jsonRaw({ success: true, file: fileName, pattern: pat, target: tgt })
        return
      }

      output.header('Route Rule Added')
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
      const bm = pat.match(/\[([^\]]+)\]/)
      if (bm) {
        ruleMap[pat.replace(bm[0], bm[1])] = tgt + bm[0]
      } else {
        ruleMap[pat] = tgt
      }

      const newContent = ruleMapToEprcText(ruleMap)
      saveRuleFileContent(fileName, newContent)

      if (jsonFlag) {
        output.jsonRaw({ success: true, file: fileName, pattern: pat, target: tgt })
        return
      }

      output.header('Route Rule Added')
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
    const bm = pat.match(/\[([^\]]+)\]/)
    if (bm) {
      ruleMap[pat.replace(bm[0], bm[1])] = tgt + bm[0]
    } else {
      ruleMap[pat] = tgt
    }

    const newContent = ruleMapToEprcText(ruleMap)
    saveRuleFileContent(fileName, newContent)

    if (jsonFlag) {
      output.jsonRaw({ success: true, file: fileName, pattern: pat, target: tgt })
      return
    }

    output.header('Route Rule Added')
    output.success(`${pat} -> ${tgt}`)
    output.kv('File', fileName)
  }
}

run().catch(e => {
  output.error(e.message)
  process.exit(1)
})