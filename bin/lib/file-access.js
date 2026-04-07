/**
 * Direct file operations for when proxy is not running
 */

const fs = require('fs')
const path = require('path')
const { epDir } = require('./proxy-detect')

const routeRulesDir = path.join(epDir, 'route-rules')
const settingsPath = path.join(epDir, 'settings.json')
const defaultMocksPath = path.join(epDir, 'mocks.json')

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

/**
 * Save mock rules to file
 */
function saveMockRules(rules) {
  const mocksPath = getMocksPath()
  const dir = path.dirname(mocksPath)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

  // Find max id for sequence
  let maxId = 0
  rules.forEach(r => {
    if (r.id > maxId) maxId = r.id
  })

  const data = {
    rules,
    lastId: maxId
  }
  fs.writeFileSync(mocksPath, JSON.stringify(data, null, 2), 'utf8')
}

/**
 * Add mock rule
 */
function addMockRule(rule) {
  const rules = loadMockRules()
  const mocksPath = getMocksPath()

  // Get next id
  let nextId = 1
  try {
    if (fs.existsSync(mocksPath)) {
      const data = JSON.parse(fs.readFileSync(mocksPath, 'utf8'))
      nextId = (data.lastId || 0) + 1
    }
  } catch (_) {}
  if (rules.length > 0) {
    const maxId = Math.max(...rules.map(r => r.id))
    if (maxId >= nextId) nextId = maxId + 1
  }

  rule.id = nextId
  rules.push(rule)
  saveMockRules(rules)
  return rule
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
function listRuleFiles() {
  ensureRouteRulesDir()
  const activeNames = getActiveRuleFileNames()

  const files = fs.readdirSync(routeRulesDir)
    .filter(f => f.endsWith('.txt'))
    .map(f => f.replace(/\.txt$/, ''))

  return files.map(name => {
    const filePath = getRuleFilePath(name)
    let ruleCount = 0
    try {
      const content = fs.readFileSync(filePath, 'utf8')
      ruleCount = Object.keys(parseEprc(content)).length
    } catch (_) {}
    return {
      name,
      enabled: activeNames.includes(name),
      ruleCount
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

// ========== Parser (imported) ==========

const { parseEprc, ruleMapToEprcText } = require('./parsers')

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
  saveRuleFileContent,
  createRuleFile,
  deleteRuleFile,
  setRuleFileEnabled,

  // Parser (re-exported)
  parseEprc,
  ruleMapToEprcText
}