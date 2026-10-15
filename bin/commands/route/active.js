/**
 * meddle route active - Show or set active route files
 */

const output = require('../../lib/output')
const { isProxyRunning } = require('../../lib/proxy-detect')
const { apiGet, apiPut } = require('../../lib/api-client')
const { listRuleFiles, getActiveRuleFileNames, setRuleFileEnabled } = require('../../lib/file-access')
const { isRulesetReadonlyError, exitRulesetReadonly, assertListedFilesWritable } = require('../../lib/ruleset-readonly')

/** Names whose enabled state `active set <file>` would change. */
function pendingToggles(files, target) {
  return files.filter((f) => !!f.enabled !== (f.name === target)).map((f) => f.name)
}

// Parse arguments (skip 'route' and 'active' from argv)
const args = process.argv.slice(4)
const jsonFlag = args.includes('--json')
output.setJsonMode(jsonFlag)

// Check for 'set' subcommand - now 'set' would be at args[0] if present
const isSet = args[0] === 'set'
const targetFile = isSet ? args[1] : null

async function run() {
  const running = await isProxyRunning()

  if (isSet) {
    if (!targetFile) {
      output.error('Missing required argument: <file>')
      process.exit(1)
    }

    // Set active route file (disable others, enable this one)
    if (running) {
      try {
        const files = await apiGet('/api/rule-files')
        if (!Array.isArray(files)) {
          throw new Error('规则文件列表返回格式错误')
        }

        const target = files.find(f => f && f.name === targetFile)
        if (!target) {
          output.error(`Route file not found: ${targetFile}`)
          process.exit(1)
        }

        // Issue #137: refuse up front so a locked ruleset never leaves a half-applied switch.
        assertListedFilesWritable(files, pendingToggles(files, targetFile))

        for (const f of files) {
          const nextEnabled = f.name === targetFile
          if (!!f.enabled === nextEnabled) continue
          await apiPut(`/api/rule-files/${encodeURIComponent(f.name)}`, { enabled: nextEnabled })
        }

        if (jsonFlag) {
          output.jsonRaw({ success: true, activeFile: targetFile })
          return
        }

        output.header('Active Route File Set')
        output.success(targetFile)
      } catch (e) {
        if (isRulesetReadonlyError(e)) exitRulesetReadonly(e, { json: jsonFlag, ruleFile: targetFile })
        // Fallback to file mode
        const files = listRuleFiles()
        const target = files.find(f => f.name === targetFile)
        if (!target) {
          output.error(`Route file not found: ${targetFile}`)
          process.exit(1)
        }

        assertListedFilesWritable(files, pendingToggles(files, targetFile))
        // Disable all, then enable target
        files.forEach(f => setRuleFileEnabled(f.name, f.name === targetFile))

        output.warnFileOnlyMode()

        if (jsonFlag) {
          output.jsonRaw({ success: true, activeFile: targetFile, fileOnly: true, warning: output.FILE_ONLY_WARNING })
          return
        }

        output.header('Active Route File Set')
        output.success(targetFile)
      }
    } else {
      // File mode
      const files = listRuleFiles()
      const target = files.find(f => f.name === targetFile)
      if (!target) {
        output.error(`Route file not found: ${targetFile}`)
        process.exit(1)
      }

      assertListedFilesWritable(files, pendingToggles(files, targetFile))
      files.forEach(f => setRuleFileEnabled(f.name, f.name === targetFile))

      output.warnFileOnlyMode()

      if (jsonFlag) {
        output.jsonRaw({ success: true, activeFile: targetFile, fileOnly: true, warning: output.FILE_ONLY_WARNING })
        return
      }

      output.header('Active Route File Set')
      output.success(targetFile)
    }
    return
  }

  // Show active route files
  let files = []
  let activeFiles = []

  if (running) {
    try {
      files = await apiGet('/api/rule-files')
      activeFiles = Array.isArray(files) ? files.filter(f => f && f.enabled).map(f => f.name) : []
    } catch (e) {
      activeFiles = getActiveRuleFileNames()
    }
  } else {
    activeFiles = getActiveRuleFileNames()
  }

  const currentRuleFile = activeFiles.length === 1 ? activeFiles[0] : null

  if (jsonFlag) {
    output.jsonRaw({
      currentRuleFile,
      activeRuleFiles: activeFiles,
      count: activeFiles.length
    })
    return
  }

  output.header('Active Route Files')

  if (activeFiles.length === 0) {
    output.info('No active route files')
    return
  }

  if (currentRuleFile) {
    output.kv('Current', currentRuleFile)
  } else {
    output.kv('Active Files', activeFiles.length)
    activeFiles.forEach(f => output.bullet(f, true))
  }
}

run().catch(e => {
  if (isRulesetReadonlyError(e)) exitRulesetReadonly(e, { json: jsonFlag, ruleFile: targetFile })
  output.error(e.message)
  process.exit(1)
})