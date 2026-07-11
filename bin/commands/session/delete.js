/**
 * ep session delete <id> - Stop a session and remove from registry.
 *
 * --clean also deletes the session's EP_HOME data directory.
 */

const fs = require('fs')
const path = require('path')
const chalk = require('chalk')
const { getSession, deleteSession, isPidAlive } = require('../../lib/sessions')

const args = process.argv.slice(4)
const id = args.find((a) => !a.startsWith('--'))
const cleanFlag = args.includes('--clean')
const jsonFlag = args.includes('--json')

if (!id) {
    console.error(chalk.red('error:'), 'session id required')
    console.error(chalk.gray('usage: ep session delete <id> [--clean]'))
    process.exit(1)
}

const record = getSession(id)
if (!record) {
    console.error(chalk.red('error:'), `session not found: ${id}`)
    process.exit(1)
}

// 1. kill process if alive
let killed = false
if (isPidAlive(record.pid)) {
    try {
        process.kill(record.pid, 'SIGTERM')
        killed = true
    } catch (err) {
        console.error(chalk.yellow('warning:'), `could not kill pid ${record.pid}: ${err.message}`)
    }
}

// 2. remove from registry
deleteSession(id)

// 3. optionally clean data dir
let cleaned = false
if (cleanFlag) {
    try {
        if (fs.existsSync(record.epHome)) {
            // only delete if inside ~/.ep/sessions/ — safety guard
            const sessionsRoot = path.dirname(record.epHome)
            const expectedRoot = path.join(require('../../lib/ep-home').resolveEpHome(), 'sessions')
            if (path.resolve(sessionsRoot) === path.resolve(expectedRoot)) {
                fs.rmSync(record.epHome, { recursive: true, force: true })
                cleaned = true
            } else {
                console.error(chalk.yellow('warning:'), `refusing to delete ${record.epHome} (outside sessions dir)`)
            }
        }
    } catch (err) {
        console.error(chalk.yellow('warning:'), `could not clean data dir: ${err.message}`)
    }
}

if (jsonFlag) {
    console.log(JSON.stringify({ id, killed, cleaned, epHome: record.epHome }))
} else {
    console.log(chalk.green('Deleted session:'), chalk.cyan(id))
    if (killed) console.log(chalk.gray(`  stopped pid ${record.pid}`))
    if (cleaned) console.log(chalk.gray(`  removed ${record.epHome}`))
}
