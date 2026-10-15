/**
 * meddle route add - Add a rule to a route file
 */

const output = require('../../lib/output')
const { isProxyRunning } = require('../../lib/proxy-detect')
const { apiGet, apiPut } = require('../../lib/api-client')
const { getRuleFileContent, saveRuleFileContent } = require('../../lib/file-access')
const { addRouteRule, splitPatternArg } = require('../../lib/rule-file-edit')
const { isRulesetReadonlyError, exitRulesetReadonly } = require('../../lib/ruleset-readonly')

// Parse arguments (skip 'route' and 'add' from argv)
const args = process.argv.slice(4)
const jsonFlag = args.includes('--json')
output.setJsonMode(jsonFlag)

// Get positional arguments: file, pattern, target
const positionalArgs = args.filter(a => !a.startsWith('--'))
const fileName = positionalArgs[0]
const pattern = positionalArgs[1]
const target = positionalArgs[2]

/**
 * Issue #145: edit only the line(s) holding this pattern; comments, blank
 * lines and other rules (with their `!exclusions`) keep their exact bytes.
 * Exclusions may be given inside the pattern argument ("app.example.com !/api").
 */
function applyAdd(text) {
  const { patterns, exclusions } = splitPatternArg(pattern)
  if (patterns.length === 0) {
    output.error('Missing required argument: <pattern>')
    process.exit(1)
  }
  let next = text
  for (const p of patterns) {
    next = addRouteRule(next, { pattern: p, target: target.trim(), exclusions: exclusions.length ? exclusions : undefined }).content
  }
  return next
}

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
      const newContent = applyAdd(text)
      await apiPut(`/api/rule-files/${encodeURIComponent(fileName)}/content`, { content: newContent })

      if (jsonFlag) {
        output.jsonRaw({ success: true, file: fileName, pattern: pat, target: tgt })
        return
      }

      output.header('Route Rule Added')
      output.success(`${pat} -> ${tgt}`)
      output.kv('File', fileName)
    } catch (e) {
      // Issue #137: a locked ruleset is a final answer, never a cue to write the file directly.
      if (isRulesetReadonlyError(e)) exitRulesetReadonly(e, { json: jsonFlag, ruleFile: fileName })
      // Fallback to file mode
      const content = getRuleFileContent(fileName)
      if (!content) {
        output.error(`Route file not found: ${fileName}`)
        process.exit(1)
      }

      const newContent = applyAdd(content)
      saveRuleFileContent(fileName, newContent)
      output.warnFileOnlyMode()

      if (jsonFlag) {
        output.jsonRaw({ success: true, file: fileName, pattern: pat, target: tgt,
        fileOnly: true,
        warning: output.FILE_ONLY_WARNING
      })
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

    const newContent = applyAdd(content)
    saveRuleFileContent(fileName, newContent)
    output.warnFileOnlyMode()

    if (jsonFlag) {
      output.jsonRaw({ success: true, file: fileName, pattern: pat, target: tgt,
      fileOnly: true,
      warning: output.FILE_ONLY_WARNING
    })
      return
    }


    output.header('Route Rule Added')
    output.success(`${pat} -> ${tgt}`)
    output.kv('File', fileName)
  }
}

run().catch(e => {
  if (isRulesetReadonlyError(e)) exitRulesetReadonly(e, { json: jsonFlag, ruleFile: fileName })
  output.error(e.message)
  process.exit(1)
})