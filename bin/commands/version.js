/**
 * meddle version - Print version information
 */

const os = require('os')
const path = require('path')
const output = require('../lib/output')

const args = process.argv.slice(2)
const jsonFlag = args.includes('--json')
output.setJsonMode(jsonFlag)

function getVersionInfo() {
    const pkg = require(path.join(__dirname, '../../package.json'))
    return {
        name: pkg.name,
        version: pkg.version,
        node: process.version,
        platform: `${os.platform()} ${os.arch()}`,
        homepage: pkg.homepage,
    }
}

function run() {
    const info = getVersionInfo()

    if (output.isJsonMode()) {
        output.jsonRaw(info)
        return
    }

    output.header('Meddle Version')
    output.kv('Package', info.name)
    output.kv('Version', info.version)
    output.kv('Node.js', info.node)
    output.kv('Platform', info.platform)
    output.kv('Homepage', info.homepage)
}

run()
