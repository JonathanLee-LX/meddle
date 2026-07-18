/**
 * ep session prune - Remove registry entries whose process is gone.
 *
 * Keeps the data directories intact (use `ep session delete <id> --clean`
 * for full cleanup of a specific session).
 */

const chalk = require('chalk')
const { pruneOrphaned } = require('../../lib/sessions')

const args = process.argv.slice(4)
const jsonFlag = args.includes('--json')

const removed = pruneOrphaned()

if (jsonFlag) {
    console.log(JSON.stringify({ pruned: removed }))
    process.exit(0)
}

if (removed.length === 0) {
    console.log(chalk.gray('No orphaned sessions.'))
    process.exit(0)
}

console.log(chalk.green(`Pruned ${removed.length} orphaned session(s):`))
for (const s of removed) {
    console.log(`  ${chalk.cyan(s.id)} ${chalk.gray(`(pid ${s.pid}, port ${s.port})`)}`)
    console.log(chalk.gray(`    data dir kept: ${s.epHome}`))
}
console.log(chalk.gray('\nTo also delete data directories, run: ep session delete <id> --clean'))
