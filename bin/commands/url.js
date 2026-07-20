/**
 * meddle url - Get proxy URL
 */

const { getProxyUrl, isProxyRunning } = require('../lib/proxy-detect')
const output = require('../lib/output')

// Check for --json flag
const args = process.argv.slice(2)
const jsonFlag = args.includes('--json')
output.setJsonMode(jsonFlag)

async function run() {
  const url = getProxyUrl()
  const running = await isProxyRunning()

  if (output.isJsonMode()) {
    output.jsonRaw({ url, running })
    return
  }

  output.header('Proxy URL')
  output.kv('URL', url)
  output.kv('Status', running ? 'Running' : 'Not Running')
}

run().catch(e => {
  output.error(e.message)
  process.exit(1)
})