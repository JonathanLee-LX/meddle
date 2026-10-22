/**
 * meddle route delete - Delete a rule from a route file
 */

const output = require('../../lib/output')
const { isProxyRunning } = require('../../lib/proxy-detect')
const { apiGet, apiPut } = require('../../lib/api-client')
const { getRuleFileContent, saveRuleFileContent } = require('../../lib/file-access')
const { deleteRouteRule } = require('../../lib/rule-file-edit')
const { isRulesetReadonlyError, exitRulesetReadonly } = require('../../lib/ruleset-readonly')
const { parseRouteWriteArgs, parsePatternArg } = require('../../lib/route-write-args')

const DELETE_HELP = `
meddle route delete <file> <pattern> [--json]

Delete a rule. This command does not take --exclusions.
`

const args = process.argv.slice(4)

function fail(message, jsonFlag) {
  if (jsonFlag) {
    console.log(JSON.stringify({ success: false, error: { message } }))
    console.error(message)
  } else {
    output.setJsonMode(false)
    output.error(message)
  }
  process.exit(1)
}

let parsed
try {
  parsed = parseRouteWriteArgs(args, { allowExclusions: false })
} catch (e) {
  fail(e.message, args.includes('--json'))
}

if (parsed.help) {
  console.log(DELETE_HELP.trim())
  process.exit(0)
}

const jsonFlag = parsed.json
output.setJsonMode(jsonFlag)

const fileName = parsed.positional[0]
const pattern = parsed.positional[1]

/**
 * Issue #145: remove only this pattern; every other line (comments, blank
 * lines, other rules and their `!exclusions`) keeps its exact bytes.
 */
function applyDelete(text) {
  const { patterns } = parsePatternArg(pattern)
  if (patterns.length === 0) {
    fail('Missing required argument: <pattern>', jsonFlag)
  }
  let next = text
  for (const p of patterns) {
    const result = deleteRouteRule(next, { pattern: p })
    if (!result.found) {
      fail(`Pattern not found: ${pattern.trim()}`, jsonFlag)
    }
    next = result.content
  }
  return next
}

async function run() {
  if (!fileName) fail('Missing required argument: <file>', jsonFlag)
  if (!pattern) fail('Missing required argument: <pattern>', jsonFlag)
  if (parsed.positional.length > 2) fail(`Unexpected argument: ${parsed.positional[2]}`, jsonFlag)
  try {
    parsePatternArg(pattern)
  } catch (e) {
    fail(e.message, jsonFlag)
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
        fail(`Route file not found: ${fileName}`, jsonFlag)
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
      fail(`Route file not found: ${fileName}`, jsonFlag)
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
  fail(e.message, jsonFlag)
})