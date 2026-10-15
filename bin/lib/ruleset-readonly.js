/**
 * Issue #137: read-only rulesets (rule files).
 *
 * The lock lives in settings.json (`readonlyRuleFiles`) and can only be set or
 * cleared from the Meddle web UI. The CLI has no lock / unlock command; it only
 * reports the state (`readonly` in --json output) and refuses writes.
 */

const chalk = require('chalk')

const RULESET_READONLY = 'RULESET_READONLY'
const RULESET_READONLY_MESSAGE = '该规则集已设为只读，只能在 Meddle 界面中解锁'
/** Dedicated CLI exit code for a write rejected because the ruleset is read-only. */
const EXIT_RULESET_READONLY = 3

class RulesetReadonlyError extends Error {
  constructor(ruleFile) {
    super(RULESET_READONLY_MESSAGE)
    this.name = 'RulesetReadonlyError'
    this.code = RULESET_READONLY
    this.ruleFile = ruleFile
  }
}

function isRulesetReadonlyError(err) {
  return Boolean(err) && err.code === RULESET_READONLY
}

/**
 * Print the rejection and exit with EXIT_RULESET_READONLY.
 * --json: one JSON line on stdout; the human message always goes to stderr.
 */
function exitRulesetReadonly(err, { json = false, ruleFile } = {}) {
  const file = (err && err.ruleFile) || ruleFile || null
  if (json) {
    console.log(JSON.stringify({
      success: false,
      error: { code: RULESET_READONLY, message: RULESET_READONLY_MESSAGE, ruleFile: file },
    }))
  }
  console.error(chalk.red('  ✗'), `${RULESET_READONLY_MESSAGE} (${RULESET_READONLY}${file ? `: ${file}` : ''})`)
  process.exit(EXIT_RULESET_READONLY)
}

/** Throw if any of `names` is in the given rule-file list with readonly: true. */
function assertListedFilesWritable(files, names) {
  const locked = new Set((Array.isArray(files) ? files : []).filter((f) => f && f.readonly).map((f) => f.name))
  for (const name of names) {
    if (locked.has(name)) throw new RulesetReadonlyError(name)
  }
}

module.exports = {
  RULESET_READONLY,
  RULESET_READONLY_MESSAGE,
  EXIT_RULESET_READONLY,
  RulesetReadonlyError,
  isRulesetReadonlyError,
  exitRulesetReadonly,
  assertListedFilesWritable,
}
