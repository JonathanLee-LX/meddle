/**
 * Direct file operations for when proxy is not running
 */

const fs = require('fs')
const path = require('path')
const { meddleDir } = require('./proxy-detect')

const routeRulesDir = path.join(meddleDir, 'route-rules')
const settingsPath = path.join(meddleDir, 'settings.json')
const defaultMocksPath = path.join(meddleDir, 'mocks.json')

// ========== Settings ==========

/**
 * Load settings.json
 */
function loadSettings() {
  try {
    if (fs.existsSync(settingsPath)) {
      return JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
    }
  } catch (_) {}
  return {}
}

/**
 * Save settings.json
 */
function saveSettings(settings) {
  const dir = path.dirname(settingsPath)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8')
}

/**
 * Get active rule file names
 */
function getActiveRuleFileNames() {
  const settings = loadSettings()
  const arr = settings.activeRuleFiles
  return Array.isArray(arr) ? arr : []
}

/**
 * Set active rule file names
 */
function setActiveRuleFileNames(names) {
  const settings = loadSettings()
  settings.activeRuleFiles = names
  saveSettings(settings)
}

// ========== Mocks ==========

/**
 * Get mocks file path (supports custom path in settings)
 */
function getMocksPath() {
  const settings = loadSettings()
  return settings.mocksFilePath || defaultMocksPath
}

/**
 * Load mock rules from file
 */
function loadMockRules() {
  const mocksPath = getMocksPath()
  try {
    if (fs.existsSync(mocksPath)) {
      const data = JSON.parse(fs.readFileSync(mocksPath, 'utf8'))
      return data.rules || []
    }
  } catch (_) {}
  return []
}

function readMocksFileMeta(mocksPath) {
  try {
    if (fs.existsSync(mocksPath)) {
      const data = JSON.parse(fs.readFileSync(mocksPath, 'utf8'))
      return { nextId: Number(data.nextId) || 0, lastId: Number(data.lastId) || 0 }
    }
  } catch (_) {}
  return { nextId: 0, lastId: 0 }
}

function maxRuleId(rules) {
  let maxId = 0
  rules.forEach(r => {
    if (r && Number.isInteger(r.id) && r.id > maxId) maxId = r.id
  })
  return maxId
}

/**
 * Next id to hand out. Shares the server's `nextId` field so ids stay
 * monotonic across CLI file-mode and the running proxy (issue #115); also
 * honours the legacy CLI `lastId` field.
 */
function nextMockId(rules, meta) {
  return Math.max(1, meta.nextId || 0, (meta.lastId || 0) + 1, maxRuleId(rules) + 1)
}

/**
 * Save mock rules to file
 */
function saveMockRules(rules, nextId) {
  const mocksPath = getMocksPath()
  const dir = path.dirname(mocksPath)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

  const meta = readMocksFileMeta(mocksPath)
  const seq = Math.max(nextId || 0, nextMockId(rules, meta))
  const data = {
    // `nextId` is what the proxy reads; keep it so deleting the newest rule
    // does not make its id reusable (issue #115). `lastId` kept for older CLIs.
    nextId: seq,
    rules,
    lastId: seq - 1
  }
  fs.writeFileSync(mocksPath, JSON.stringify(data, null, 2), 'utf8')
}

/**
 * Add mock rule
 */
function addMockRule(rule) {
  const rules = loadMockRules()
  const mocksPath = getMocksPath()

  // Issue #115: never reuse an existing (or previously handed-out) id, and
  // ignore any id the caller put on the rule — add never overwrites.
  const nextId = nextMockId(rules, readMocksFileMeta(mocksPath))

  const created = { ...rule, id: nextId }
  rules.push(created)
  saveMockRules(rules, nextId + 1)
  return created
}

/**
 * Update mock rule by id
 */
function updateMockRule(id, updates) {
  const rules = loadMockRules()
  const idx = rules.findIndex(r => r.id === id)
  if (idx === -1) return null
  rules[idx] = { ...rules[idx], ...updates, id }
  saveMockRules(rules)
  return rules[idx]
}

/**
 * Delete mock rule by id
 */
function deleteMockRule(id) {
  const rules = loadMockRules()
  const idx = rules.findIndex(r => r.id === id)
  if (idx === -1) return false
  rules.splice(idx, 1)
  saveMockRules(rules)
  return true
}

// ========== Route Rules ==========

/**
 * Ensure route-rules directory exists
 */
function ensureRouteRulesDir() {
  if (!fs.existsSync(routeRulesDir)) {
    fs.mkdirSync(routeRulesDir, { recursive: true })
  }
}

/**
 * Get rule file path
 */
function getRuleFilePath(name) {
  return path.join(routeRulesDir, `${name}.txt`)
}

/**
 * List all rule files
 */
function getRuleFileOrderNames() {
  const settings = loadSettings()
  const arr = settings.ruleFileOrder
  return Array.isArray(arr) ? arr.filter((name) => typeof name === 'string') : []
}

function resolveRuleFileOrder(diskNames, storedOrder, activeNames) {
  const diskSet = new Set(diskNames)
  const ordered = []
  const seen = new Set()
  const pushUnique = (name) => {
    if (!diskSet.has(name) || seen.has(name)) return
    ordered.push(name)
    seen.add(name)
  }
  if (storedOrder.length > 0) {
    for (const name of storedOrder) pushUnique(name)
  } else {
    for (const name of activeNames) pushUnique(name)
  }
  for (const name of diskNames) pushUnique(name)
  return ordered
}

function listRuleFiles() {
  ensureRouteRulesDir()
  const activeNames = getActiveRuleFileNames()

  const files = fs.readdirSync(routeRulesDir)
    .filter(f => f.endsWith('.txt'))
    .map(f => f.replace(/\.txt$/, ''))

  const ordered = resolveRuleFileOrder(files, getRuleFileOrderNames(), activeNames)

  return ordered.map(name => {
    const filePath = getRuleFilePath(name)
    let ruleCount = 0
    let excludeCount = 0
    try {
      const content = fs.readFileSync(filePath, 'utf8')
      const { ruleMap, excludeMap } = parseEprcWithExclusions(content)
      ruleCount = Object.keys(ruleMap).length
      // Count total exclusions across all rules
      for (const exclusions of Object.values(excludeMap)) {
        excludeCount += exclusions.length
      }
    } catch (_) {}
    return {
      name,
      enabled: activeNames.includes(name),
      ruleCount,
      excludeCount
    }
  })
}

/**
 * Get rule file content
 */
function getRuleFileContent(name) {
  const filePath = getRuleFilePath(name)
  try {
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, 'utf8')
    }
  } catch (_) {}
  return null
}

/**
 * Save rule file content
 */
function saveRuleFileContent(name, content) {
  ensureRouteRulesDir()
  const filePath = getRuleFilePath(name)
  fs.writeFileSync(filePath, content, 'utf8')
}

/**
 * Create rule file
 */
function createRuleFile(name, content = '', enabled = true) {
  ensureRouteRulesDir()
  const safeName = name.trim().replace(/[/\\:*?"<>|]/g, '_')
  const filePath = getRuleFilePath(safeName)

  if (fs.existsSync(filePath)) {
    throw new Error(`规则文件 "${safeName}" 已存在`)
  }

  fs.writeFileSync(filePath, content, 'utf8')

  if (enabled) {
    const activeNames = getActiveRuleFileNames()
    if (!activeNames.includes(safeName)) {
      activeNames.push(safeName)
      setActiveRuleFileNames(activeNames)
    }
  }

  const ruleCount = content.trim() ? Object.keys(parseEprc(content)).length : 0
  return { name: safeName, enabled, ruleCount }
}

/**
 * Delete rule file
 */
function deleteRuleFile(name) {
  const filePath = getRuleFilePath(name)
  if (!fs.existsSync(filePath)) {
    throw new Error('规则文件不存在')
  }
  fs.unlinkSync(filePath)

  const activeNames = getActiveRuleFileNames()
  const idx = activeNames.indexOf(name)
  if (idx !== -1) {
    activeNames.splice(idx, 1)
    setActiveRuleFileNames(activeNames)
  }
}

/**
 * Enable/disable rule file
 */
function setRuleFileEnabled(name, enabled) {
  const filePath = getRuleFilePath(name)
  if (!fs.existsSync(filePath)) {
    throw new Error('规则文件不存在')
  }

  const activeNames = getActiveRuleFileNames()
  const idx = activeNames.indexOf(name)

  if (enabled && idx === -1) {
    activeNames.push(name)
  } else if (!enabled && idx !== -1) {
    activeNames.splice(idx, 1)
  }

  setActiveRuleFileNames(activeNames)
}

/**
 * Get content of all active rule files merged
 */
function getActiveRuleFilesContent() {
  const activeNames = getActiveRuleFileNames()
  const contents = []
  for (const name of activeNames) {
    const content = getRuleFileContent(name)
    if (content) {
      contents.push(content)
    }
  }
  return contents.join('\n')
}

// ========== Parser (imported) ==========

const { parseEprc, parseEprcWithExclusions, ruleMapToEprcText } = require('./parsers')

module.exports = {
  // Settings
  loadSettings,
  saveSettings,
  getActiveRuleFileNames,
  setActiveRuleFileNames,

  // Mocks
  getMocksPath,
  loadMockRules,
  saveMockRules,
  addMockRule,
  updateMockRule,
  deleteMockRule,

  // Route Rules
  routeRulesDir,
  ensureRouteRulesDir,
  getRuleFilePath,
  listRuleFiles,
  getRuleFileContent,
  getActiveRuleFilesContent,
  saveRuleFileContent,
  createRuleFile,
  deleteRuleFile,
  setRuleFileEnabled,

  // Parser (re-exported)
  parseEprc,
  parseEprcWithExclusions,
  ruleMapToEprcText
}