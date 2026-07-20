/**
 * meddle session list - List all sessions with liveness check.
 */

const chalk = require('chalk')
const { listSessions } = require('../../lib/sessions')

const args = process.argv.slice(4)
const jsonFlag = args.includes('--json')

const sessions = listSessions()

if (jsonFlag) {
    console.log(JSON.stringify(sessions, null, 2))
    process.exit(0)
}

if (sessions.length === 0) {
    console.log(chalk.gray('No sessions registered.'))
    console.log(chalk.gray('Create one with: meddle session create --name <label>'))
    process.exit(0)
}

console.log(chalk.bold.cyan(`Sessions (${sessions.length})`))
console.log(chalk.gray('─'.repeat(80)))
for (const s of sessions) {
    const status = s.alive ? chalk.green('● running') : chalk.red('○ orphaned')
    const id = chalk.cyan(s.id)
    console.log(`  ${status}  ${id}`)
    console.log(`    ${chalk.gray('port:')}    ${s.port}`)
    console.log(`    ${chalk.gray('pid:')}     ${s.pid}`)
    console.log(`    ${chalk.gray('meddleHome:')}  ${s.meddleHome}`)
    console.log(`    ${chalk.gray('created:')} ${s.createdAt}`)
    if (s.label) console.log(`    ${chalk.gray('label:')}   ${s.label}`)
    console.log('')
}

const orphaned = sessions.filter((s) => !s.alive)
if (orphaned.length > 0) {
    console.log(chalk.yellow(`${orphaned.length} orphaned session(s) detected.`))
    console.log(chalk.gray(`Run 'meddle session prune' to clean up registry entries.`))
}
