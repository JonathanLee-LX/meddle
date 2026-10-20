/**
 * meddle route add - Add a rule to a route file
 */

const output = require('../../lib/output')
const { isProxyRunning } = require('../../lib/proxy-detect')
const { apiGet, apiPut } = require('../../lib/api-client')
const { getRuleFileContent, saveRuleFileContent } = require('../../lib/file-access')
const { addRouteRule } = require('../../lib/rule-file-edit')
const { isRulesetReadonlyError, exitRulesetReadonly } = require('../../lib/ruleset-readonly')
const { parseRouteWriteArgs, parsePatternArg, resolveExclusions } = require('../../lib/route-write-args')

const ADD_HELP = `
meddle route add <file> <pattern> <target> [--exclusions=<list>] [--json]

Add a rule. If the pattern already exists, its target is overwritten in place.
--exclusions= clears that rule's exclusions; --exclusions=/a,/b replaces them.
Omit --exclusions and any !path in the pattern to keep existing exclusions.
See: meddle route update --help
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
  parsed = parseRouteWriteArgs(args)
} catch (e) {
  fail(e.message, args.includes('--json'))
}

if (parsed.help) {
  console.log(ADD_HELP.trim())
  process.exit(0)
}

const jsonFlag = parsed.json
output.setJsonMode(jsonFlag)

const fileName = parsed.positional[0]
const pattern = parsed.positional[1]
const target = parsed.positional[2]

let explicitExclusions = false
let appliedExclusions = []

function planAdd() {
  const { patterns, exclusions: patternExclusions } = parsePatternArg(pattern)
  if (patterns.length === 0) fail('Missing required argument: <pattern>', jsonFlag)
  const resolved = resolveExclusions(patternExclusions, parsed.exclusions)
  explicitExclusions = resolved.explicit
  appliedExclusions = resolved.exclusions || []
  return { patterns, exclusions: resolved.explicit ? resolved.exclusions : undefined }
}

/**
 * Issue #145: edit only the line(s) holding this pattern; comments, blank
 * lines and other rules (with their `!exclusions`) keep their exact bytes.
 * Exclusions may be given inside the pattern argument ("app.example.com !/api")
 * or with --exclusions. `--exclusions=` clears them (issue #149).
 */
function applyAdd(text, plan) {
  let next = text
  for (const p of plan.patterns) {
    next = addRouteRule(next, { pattern: p, target: target.trim(), exclusions: plan.exclusions }).content
  }
  return next
}

function emitAdded({ fileOnly }) {
  const payload = { success: true, file: fileName, pattern: pattern.trim(), target: target.trim() }
  if (explicitExclusions) payload.exclusions = appliedExclusions
  if (fileOnly) {
    payload.fileOnly = true
    payload.warning = output.FILE_ONLY_WARNING
  }
  if (jsonFlag) {
    output.jsonRaw(payload)
    return
  }
  output.header('Route Rule Added')
  output.success(`${pattern.trim()} -> ${target.trim()}`)
  if (explicitExclusions) {
    output.kv('Exclusions', appliedExclusions.length ? appliedExclusions.map((e) => `!${e}`).join(' ') : 'cleared')
  }
  output.kv('File', fileName)
}

async function run() {
  if (!fileName) fail('Missing required argument: <file>', jsonFlag)
  if (!pattern) fail('Missing required argument: <pattern>', jsonFlag)
  if (!target) fail('Missing required argument: <target>', jsonFlag)
  if (parsed.positional.length > 3) fail(`Unexpected argument: ${parsed.positional[3]}`, jsonFlag)

  let plan
  try {
    plan = planAdd()
  } catch (e) {
    fail(e.message, jsonFlag)
  }

  const running = await isProxyRunning()

  if (running) {
    try {
      let content = await apiGet(`/api/rule-files/${encodeURIComponent(fileName)}/content`)
      const text = typeof content === 'string' ? content : String(content)
      const newContent = applyAdd(text, plan)
      await apiPut(`/api/rule-files/${encodeURIComponent(fileName)}/content`, { content: newContent })
      emitAdded({ fileOnly: false })
      return
    } catch (e) {
      // Issue #137: a locked ruleset is a final answer, never a cue to write the file directly.
      if (isRulesetReadonlyError(e)) exitRulesetReadonly(e, { json: jsonFlag, ruleFile: fileName })
      const content = getRuleFileContent(fileName)
      if (!content) fail(`Route file not found: ${fileName}`, jsonFlag)
      const newContent = applyAdd(content, plan)
      saveRuleFileContent(fileName, newContent)
      output.warnFileOnlyMode()
      emitAdded({ fileOnly: true })
      return
    }
  }

  const content = getRuleFileContent(fileName)
  if (!content) fail(`Route file not found: ${fileName}`, jsonFlag)
  const newContent = applyAdd(content, plan)
  saveRuleFileContent(fileName, newContent)
  output.warnFileOnlyMode()
  emitAdded({ fileOnly: true })
}

run().catch(e => {
  if (isRulesetReadonlyError(e)) exitRulesetReadonly(e, { json: jsonFlag, ruleFile: fileName })
  fail(e.message, jsonFlag)
})