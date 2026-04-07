/**
 * Output formatter for CLI commands
 * Supports both human-readable and JSON output
 */

const chalk = require('chalk')

let jsonMode = false

/**
 * Set JSON output mode
 */
function setJsonMode(mode) {
  jsonMode = mode
}

/**
 * Check if JSON mode is enabled
 */
function isJsonMode() {
  return jsonMode
}

/**
 * Print header with title
 */
function header(title) {
  if (jsonMode) return
  console.log('')
  console.log(chalk.bold.cyan('════════════════════════════════════════'))
  console.log(chalk.bold.cyan(`   ${title}`))
  console.log(chalk.bold.cyan('════════════════════════════════════════'))
  console.log('')
}

/**
 * Print section header
 */
function section(title) {
  if (jsonMode) return
  console.log(chalk.bold.yellow(`\n▶ ${title}`))
  console.log(chalk.gray('─'.repeat(40)))
}

/**
 * Print success message
 */
function success(message) {
  if (jsonMode) return
  console.log(chalk.green('  ✓'), message)
}

/**
 * Print error message
 */
function error(message) {
  if (jsonMode) return
  console.log(chalk.red('  ✗'), message)
}

/**
 * Print warning message
 */
function warning(message) {
  if (jsonMode) return
  console.log(chalk.yellow('  ⚠'), message)
}

/**
 * Print info message
 */
function info(message) {
  if (jsonMode) return
  console.log(chalk.gray('    →'), message)
}

/**
 * Print JSON output (only in JSON mode)
 */
function json(data) {
  if (!jsonMode) return
  console.log(JSON.stringify(data, null, 2))
}

/**
 * Print raw JSON (without formatting, for --json output)
 */
function jsonRaw(data) {
  console.log(JSON.stringify(data))
}

/**
 * Print plain text message
 */
function plain(message) {
  if (jsonMode) return
  console.log(message)
}

/**
 * Print key-value pair
 */
function kv(key, value, indent = 2) {
  if (jsonMode) return
  const spaces = ' '.repeat(indent)
  console.log(spaces + chalk.gray(key + ':'), value)
}

/**
 * Print bullet item
 */
function bullet(message, active = false, indent = 2) {
  if (jsonMode) return
  const spaces = ' '.repeat(indent)
  const marker = active ? chalk.green('●') : chalk.gray('○')
  console.log(spaces + marker, message)
}

/**
 * Print table row
 */
function tableRow(columns, widths) {
  if (jsonMode) return
  const row = columns.map((col, i) => {
    const width = widths[i] || 10
    return String(col).padEnd(width)
  }).join('  ')
  console.log('  ' + row)
}

module.exports = {
  setJsonMode,
  isJsonMode,
  header,
  section,
  success,
  error,
  warning,
  info,
  json,
  jsonRaw,
  plain,
  kv,
  bullet,
  tableRow
}