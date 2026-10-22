/**
 * meddle route update - Update a rule in a route file
 *
 * Issue #149: `--exclusions=` clears a rule's exclusions. Omitting the flag
 * (and any !path in the pattern) still keeps them.
 */

const output = require('../../lib/output')
const { isProxyRunning } = require('../../lib/proxy-detect')
const { apiGet, apiPut } = require('../../lib/api-client')
const { getRuleFileContent, saveRuleFileContent } = require('../../lib/file-access')
const { updateRouteRule, patternKey, parseRuleLine } = require('../../lib/rule-file-edit')
const { isRulesetReadonlyError, exitRulesetReadonly } = require('../../lib/ruleset-readonly')
const {
  parseRouteWriteArgs,
  parsePatternArg,
  resolveExclusions,
  UPDATE_HELP,
} = require('../../lib/route-write-args')

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
  console.log(UPDATE_HELP.trim())
  process.exit(0)
}

const jsonFlag = parsed.json
output.setJsonMode(jsonFlag)

const fileName = parsed.positional[0]
const pattern = parsed.positional[1]
const newTarget = parsed.positional[2]

/** Set once arguments are valid. `explicit` means the user asked to set exclusions, including clear. */
let explicitExclusions = false
let appliedExclusions = []

function planUpdate() {
  const { patterns, exclusions: patternExclusions } = parsePatternArg(pattern)
  if (patterns.length === 0) {
    fail('Missing required argument: <pattern>', jsonFlag)
  }
  const resolved = resolveExclusions(patternExclusions, parsed.exclusions)
  explicitExclusions = resolved.explicit
  appliedExclusions = resolved.exclusions || []
  return { patterns, exclusions: resolved.explicit ? resolved.exclusions : undefined }
}

/**
 * Issue #145: rewrite only the line(s) holding this pattern. The rule keeps its
 * own `!exclusions` unless new ones are given. Issue #149: `--exclusions=` passes
 * `[]`, which removes `!path` from that line. Every other line keeps its bytes.
 */
function applyUpdate(text, plan) {
  const target = newTarget ? newTarget.trim() : undefined
  let next = text
  for (const p of plan.patterns) {
    const result = updateRouteRule(next, { pattern: p, target, exclusions: plan.exclusions })
    if (!result.found) {
      fail(`Pattern not found: ${pattern.trim()}`, jsonFlag)
    }
    next = result.content
  }
  return next
}

/** Target token actually written, for feedback when the user did not pass one. */
function targetOnDisk(content, patternToken) {
  const key = patternKey(patternToken)
  const lines = content.split(/\r?\n/)
  for (const line of lines) {
    const parsedLine = parseRuleLine(line)
    if (parsedLine && parsedLine.patterns.some((p) => patternKey(p) === key)) return parsedLine.target
  }
  return ''
}

function emitUpdated({ fileOnly, target }) {
  const payload = { success: true, file: fileName, pattern: pattern.trim(), newTarget: target }
  if (explicitExclusions) payload.exclusions = appliedExclusions
  if (fileOnly) {
    payload.fileOnly = true
    payload.warning = output.FILE_ONLY_WARNING
  }
  if (jsonFlag) {
    output.jsonRaw(payload)
    return
  }
  output.header('Route Rule Updated')
  output.success(`${pattern.trim()} -> ${target}`)
  if (explicitExclusions) {
    output.kv('Exclusions', appliedExclusions.length ? appliedExclusions.map((e) => `!${e}`).join(' ') : 'cleared')
  }
  output.kv('File', fileName)
}

async function run() {
  if (!fileName) fail('Missing required argument: <file>', jsonFlag)
  if (!pattern) fail('Missing required argument: <pattern>', jsonFlag)
  if (parsed.positional.length > 3) fail(`Unexpected argument: ${parsed.positional[3]}`, jsonFlag)

  let plan
  try {
    plan = planUpdate()
  } catch (e) {
    fail(e.message, jsonFlag)
  }
  if (!newTarget && !explicitExclusions) fail('Missing required argument: <target>', jsonFlag)

  const running = await isProxyRunning()

  const finish = (content, fileOnly) => {
    const target = newTarget ? newTarget.trim() : targetOnDisk(content, plan.patterns[0])
    emitUpdated({ fileOnly, target })
  }

  if (running) {
    try {
      let content = await apiGet(`/api/rule-files/${encodeURIComponent(fileName)}/content`)
      const text = typeof content === 'string' ? content : String(content)
      const newContent = applyUpdate(text, plan)
      await apiPut(`/api/rule-files/${encodeURIComponent(fileName)}/content`, { content: newContent })
      finish(newContent, false)
      return
    } catch (e) {
      // Issue #137: a locked ruleset is a final answer, never a cue to write the file directly.
      if (isRulesetReadonlyError(e)) exitRulesetReadonly(e, { json: jsonFlag, ruleFile: fileName })
      // Fallback to file mode
      const content = getRuleFileContent(fileName)
      if (!content) fail(`Route file not found: ${fileName}`, jsonFlag)
      const newContent = applyUpdate(content, plan)
      saveRuleFileContent(fileName, newContent)
      output.warnFileOnlyMode()
      finish(newContent, true)
      return
    }
  }

  const content = getRuleFileContent(fileName)
  if (!content) fail(`Route file not found: ${fileName}`, jsonFlag)
  const newContent = applyUpdate(content, plan)
  saveRuleFileContent(fileName, newContent)
  output.warnFileOnlyMode()
  finish(newContent, true)
}

run().catch(e => {
  if (isRulesetReadonlyError(e)) exitRulesetReadonly(e, { json: jsonFlag, ruleFile: fileName })
  fail(e.message, jsonFlag)
})
