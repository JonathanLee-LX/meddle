/**
 * meddle route preview - Preview route target for a given URL
 */

const output = require('../../lib/output')
const { isProxyRunning, getProxyUrl } = require('../../lib/proxy-detect')
const { apiPost } = require('../../lib/api-client')
const { getActiveRuleFileNames, getRuleFileContent, parseEprcWithExclusions } = require('../../lib/file-access')

// Parse arguments (skip 'route' and 'preview' from argv)
const args = process.argv.slice(4)
const jsonFlag = args.includes('--json')
output.setJsonMode(jsonFlag)

// Parse --file argument
let ruleFileArg = null
const fileEqIndex = args.findIndex(a => a.startsWith('--file='))
if (fileEqIndex !== -1) {
  ruleFileArg = args[fileEqIndex].split('=')[1]
} else {
  const fileIndex = args.indexOf('--file')
  if (fileIndex !== -1 && fileIndex + 1 < args.length) {
    ruleFileArg = args[fileIndex + 1]
  }
}

// Get URL from positional argument (not --file value, not --json, not --file)
const urlArg = args.find(a => !a.startsWith('--') && a !== ruleFileArg)

async function run() {
  if (!urlArg) {
    output.error('Missing required argument: <url>')
    output.info('Usage: meddle route preview <url> [--file <rule-file>] [--json]')
    process.exit(1)
  }

  // Validate URL format
  try {
    new URL(urlArg)
  } catch {
    output.error('Invalid URL format')
    process.exit(1)
  }

  const running = await isProxyRunning()
  let result

  if (running) {
    // Use API when proxy is running
    try {
      const baseUrl = getProxyUrl()

      // Get rules text from specified file or all active files
      let rulesText = ''
      if (ruleFileArg) {
        // Use specified rule file
        const content = await fetch(`${baseUrl}/api/rule-files/${encodeURIComponent(ruleFileArg)}/content`)
          .then(r => r.ok ? r.text() : null)
          .catch(() => null)
        if (!content) {
          output.error(`Rule file not found: ${ruleFileArg}`)
          process.exit(1)
        }
        rulesText = content
      } else {
        // Use all active rule files
        const filesRes = await fetch(`${baseUrl}/api/rule-files`).then(r => r.json())
        const activeFiles = filesRes.filter(f => f.enabled)

        for (const file of activeFiles) {
          const content = await fetch(`${baseUrl}/api/rule-files/${encodeURIComponent(file.name)}/content`)
            .then(r => r.text())
            .catch(() => '')
          if (content) {
            rulesText += content + '\n'
          }
        }
      }

      // Call preview API
      result = await apiPost('/api/rules/preview', { url: urlArg, rulesText })
    } catch (e) {
      output.error(e.message)
      process.exit(1)
    }
  } else {
    // Use local file access when proxy is not running
    try {
      let rulesText = ''

      if (ruleFileArg) {
        // Use specified rule file
        const content = getRuleFileContent(ruleFileArg)
        if (!content) {
          output.error(`Rule file not found: ${ruleFileArg}`)
          process.exit(1)
        }
        rulesText = content
      } else {
        // Use all active rule files
        const activeNames = getActiveRuleFileNames()

        for (const name of activeNames) {
          const content = getRuleFileContent(name)
          if (content) {
            rulesText += content + '\n'
          }
        }
      }

      if (!rulesText.trim()) {
        output.error('No active rule files found')
        output.info('Use --file <name> to specify a rule file, or activate one with: meddle route active set <file>')
        process.exit(1)
      }

      // Use local preview logic (same as core/route-preview.ts)
      const { previewRouteTargetLocal } = require('../../lib/route-preview')
      result = previewRouteTargetLocal(urlArg, rulesText)
    } catch (e) {
      output.error(e.message)
      process.exit(1)
    }
  }

  // Output result
  if (jsonFlag) {
    output.jsonRaw(result)
    return
  }

  output.header('Route Preview')
  output.kv('Input URL', result.inputUrl)

  if (result.matched) {
    output.success('Matched rule found')
    output.section('Match Details')
    output.kv('Pattern', result.matchedRule.pattern)
    output.kv('Target', result.matchedRule.target)
    output.kv('Kind', result.matchedRule.kind)
    output.kv('Resolved URL', result.resolvedUrl)

    if (result.notes.length > 0) {
      output.section('Notes')
      for (const note of result.notes) {
        output.info(note)
      }
    }
  } else {
    output.warning('No matching rule found')
    output.kv('Resolved URL', result.resolvedUrl)
    output.info('Request will pass through unchanged')
  }
}

run().catch(e => {
  output.error(e.message)
  process.exit(1)
})