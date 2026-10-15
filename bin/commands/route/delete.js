/**
 * meddle route delete - Delete a rule from a route file
 */

const output = require('../../lib/output')
const { isProxyRunning } = require('../../lib/proxy-detect')
const { apiGet, apiPut } = require('../../lib/api-client')
const { getRuleFileContent, saveRuleFileContent } = require('../../lib/file-access')
const { deleteRouteRule, splitPatternArg } = require('../../lib/rule-file-edit')
const { isRulesetReadonlyError, exitRulesetReadonly } = require('../../lib/ruleset-readonly')

// Parse arguments (skip 'route' and 'delete' from argv)
const args = process.argv.slice(4)
const jsonFlag = args.includes('--json')
output.setJsonMode(jsonFlag)

// Get positional arguments: file, pattern
const positionalArgs = args.filter(a => !a.startsWith('--'))
const fileName = positionalArgs[0]
const pattern = positionalArgs[1]

/**
 * Issue #145: remove only this pattern; every other line (comments, blank
 * lines, other rules and their `!exclusions`) keeps its exact bytes.
 */
function applyDelete(text) {
  const { patterns } = splitPatternArg(pattern)
  if (patterns.length === 0) {
    output.error('Missing required argument: <pattern>')
    process.exit(1)
  }
  let next = text
  for (const p of patterns) {
    const result = deleteRouteRule(next, { pattern: p })
    if (!result.found) {
      output.error(`Pattern not found: ${pattern.trim()}`)
      process.exit(1)
    }
    next = result.content
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

  const running = await isProxyRunning()

  const pat = pattern.trim()

  if (running) {
    try {
      let content = await apiGet(`/api/rule-files/${encodeURIComponent(fileName)}/content`)
      const text = typeof content === 'string' ? content : String(content)
      const newContent = applyDelete(text)
      await apiPut(`/api/rule-files/${encodeURIComponent(fileName)}/content`, { content: newContent })

      if (jsonFlag) {
        output.jsonRaw({ success: true, file: fileName, pattern: pat })
        return
      }

      output.header('Route Rule Deleted')
      output.success(pat)
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

      const newContent = applyDelete(content)
      saveRuleFileContent(fileName, newContent)
      output.warnFileOnlyMode()

      if (jsonFlag) {
        output.jsonRaw({ success: true, file: fileName, pattern: pat,
        fileOnly: true,
        warning: output.FILE_ONLY_WARNING
      })
        return
      }


      output.header('Route Rule Deleted')
      output.success(pat)
      output.kv('File', fileName)
    }
  } else {
    // File mode
    const content = getRuleFileContent(fileName)
    if (!content) {
      output.error(`Route file not found: ${fileName}`)
      process.exit(1)
    }

    const newContent = applyDelete(content)
    saveRuleFileContent(fileName, newContent)
    output.warnFileOnlyMode()

    if (jsonFlag) {
      output.jsonRaw({ success: true, file: fileName, pattern: pat,
      fileOnly: true,
      warning: output.FILE_ONLY_WARNING
    })
      return
    }


    output.header('Route Rule Deleted')
    output.success(pat)
    output.kv('File', fileName)
  }
}

run().catch(e => {
  if (isRulesetReadonlyError(e)) exitRulesetReadonly(e, { json: jsonFlag, ruleFile: fileName })
  output.error(e.message)
  process.exit(1)
})