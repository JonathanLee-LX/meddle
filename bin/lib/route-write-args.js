/**
 * Argument parsing for `meddle route add|update|delete` (issue #149).
 *
 * `--exclusions=` clears a rule's exclusions. `--exclusions=/a,/b` replaces
 * them. A bare `--exclusions`, an unknown flag, or an empty `!` token used to
 * be ignored and the command still exited 0 without changing exclusions.
 */

const { splitPatternArg } = require('./rule-file-edit')

class RouteArgError extends Error {
  constructor(message) {
    super(message)
    this.name = 'RouteArgError'
  }
}

const CLEAR_HINT = 'To clear exclusions, pass --exclusions= (empty). To replace them, pass --exclusions=/a,/b.'

/**
 * @param {string} raw value after `=`
 * @returns {string[]}
 */
function parseExclusionList(raw) {
  const value = String(raw).trim()
  if (value === '') return []
  const pieces = value.includes(',') ? value.split(',') : value.split(/\s+/)
  const out = []
  for (const piece of pieces) {
    const token = piece.trim()
    if (!token) {
      throw new RouteArgError(`Invalid --exclusions: empty entry. ${CLEAR_HINT}`)
    }
    const body = token.startsWith('!') ? token.slice(1).trim() : token
    if (!body) {
      throw new RouteArgError(`Invalid --exclusions: "!" needs a path, for example --exclusions=/health. ${CLEAR_HINT}`)
    }
    out.push(body)
  }
  return out
}

/**
 * @param {string[]} args argv after the subcommand
 * @param {{ allowExclusions?: boolean }} [options]
 * @returns {{ help: boolean, json: boolean, positional: string[], exclusions: string[] | undefined }}
 * `exclusions` is undefined when the flag was not passed. `[]` means clear.
 */
function parseRouteWriteArgs(args, { allowExclusions = true } = {}) {
  let help = false
  let json = false
  /** @type {string[] | undefined} */
  let exclusions
  let sawExclusions = false
  const positional = []

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--help' || arg === '-h') {
      help = true
      continue
    }
    if (arg === '--json') {
      json = true
      continue
    }
    if (arg === '--exclusions' || arg.startsWith('--exclusions=')) {
      if (!allowExclusions) {
        throw new RouteArgError(`Unsupported option: ${arg === '--exclusions' ? '--exclusions' : '--exclusions='}. route delete does not change exclusions.`)
      }
      if (arg === '--exclusions') {
        throw new RouteArgError(`Unsupported option: --exclusions. ${CLEAR_HINT}`)
      }
      if (sawExclusions) throw new RouteArgError('--exclusions was given more than once.')
      sawExclusions = true
      exclusions = parseExclusionList(arg.slice('--exclusions='.length))
      continue
    }
    if (arg.startsWith('-')) {
      throw new RouteArgError(`Unsupported option: ${arg}.`)
    }
    positional.push(arg)
  }

  return { help, json, positional, exclusions: sawExclusions ? exclusions : undefined }
}

/**
 * Split a pattern argument the way the CLI always has (`"host !/api"`), but
 * refuse a bare `!` — that used to be dropped and looked like a successful clear.
 * @returns {{ patterns: string[], exclusions: string[] }}
 */
function parsePatternArg(raw) {
  const parts = String(raw).trim().split(/\s+/).filter(Boolean)
  for (const part of parts) {
    if (part.startsWith('!') && part.slice(1).trim() === '') {
      throw new RouteArgError('Invalid exclusion "!": a "!" token needs a path such as "!/api". To clear exclusions, pass --exclusions=.')
    }
  }
  return splitPatternArg(raw)
}

/**
 * @param {string[]} patternExclusions exclusions parsed from !path tokens
 * @param {string[] | undefined} flagExclusions undefined when --exclusions was omitted
 * @returns {{ explicit: boolean, exclusions: string[] | undefined }}
 */
function resolveExclusions(patternExclusions, flagExclusions) {
  if (flagExclusions !== undefined && patternExclusions.length > 0) {
    throw new RouteArgError('Pass exclusions either as !path tokens in the pattern or with --exclusions, not both.')
  }
  if (flagExclusions !== undefined) return { explicit: true, exclusions: flagExclusions }
  if (patternExclusions.length > 0) return { explicit: true, exclusions: patternExclusions }
  return { explicit: false, exclusions: undefined }
}

const UPDATE_HELP = `
meddle route update <file> <pattern> [<target>] [--exclusions=<list>] [--json]

Update a rule. Edits only the line(s) that hold the pattern; every other line
stays byte-for-byte, including comments, blank lines and other rules' !path.

  --exclusions=            Clear this rule's exclusions (the line loses !path).
  --exclusions=/a,/b       Replace exclusions. Spaces work inside quotes
                           (--exclusions="/a /b"). A leading ! is optional.
  "pattern !/a !/b"        Replace exclusions (same as before). Omit both
                           --exclusions and !path to keep existing exclusions.

The <target> may be omitted when --exclusions is set; the current target stays.
A bare --exclusions, an empty "!" token, an unknown flag, or both exclusion
forms at once exits 1 and does not change the file.

A "#" comments out a whole line only when it is the first non-space character.
A "#" later on a rule line is a pattern token, not a trailing comment.

Examples:
  meddle route update dev "api.example.com" "localhost:4000"
  meddle route update dev "api.example.com" --exclusions=
  meddle route update dev "api.example.com" "localhost:4000" --exclusions=/health
`

module.exports = {
  CLEAR_HINT,
  RouteArgError,
  UPDATE_HELP,
  parseExclusionList,
  parsePatternArg,
  parseRouteWriteArgs,
  resolveExclusions,
}
