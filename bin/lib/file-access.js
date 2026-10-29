/**
 * Direct file operations for when proxy is not running
 */

const fs = require('fs')
const path = require('path')
const { meddleDir } = require('./proxy-detect')
const { RulesetReadonlyError } = require('./ruleset-readonly')

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

/**
 * Issue #137: locked rule files (settings.json `readonlyRuleFiles`). Entries
 * whose file no longer exists are dropped silently. A missing field = none locked.
 */
function getReadonlyRuleFileNames() {
  const settings = loadSettings()
  if (!Object.prototype.hasOwnProperty.call(settings, 'readonlyRuleFiles')) return []
  const raw = settings.readonlyRuleFiles
  const names = Array.isArray(raw) ? raw.filter((n, i, arr) => typeof n === 'string' && n && arr.indexOf(n) === i) : []
  const live = names.filter((name) => fs.existsSync(path.join(routeRulesDir, `${name}.txt`)))
  if (!Array.isArray(raw) || live.length !== raw.length) {
    settings.readonlyRuleFiles = live
    saveSettings(settings)
  }
  return live
}

function isRuleFileReadonly(name) {
  const fold = (n) => (process.platform === 'darwin' || process.platform === 'win32' ? n.toLowerCase() : n)
  return getReadonlyRuleFileNames().some((item) => fold(item) === fold(name))
}

/** Throws RulesetReadonlyError (code RULESET_READONLY) for a locked rule file. */
function assertRuleFileWritable(name) {
  if (isRuleFileReadonly(name)) throw new RulesetReadonlyError(name)
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
 * Offset of the first JSON syntax error. Kept in sync with
 * core/mock-handler.ts findJsonErrorOffset (V8 often omits a position).
 */
function findJsonErrorOffset(t) {
  let i = 0
  const ws = () => { while (i < t.length && ' \t\n\r'.includes(t[i])) i++ }
  const fail = () => { throw i }
  const str = () => {
    i++
    while (i < t.length && t[i] !== '"') {
      if (t[i] === '\\') i++
      else if (t.charCodeAt(i) < 0x20) fail()
      i++
    }
    if (i >= t.length) fail()
    i++
  }
  const value = () => {
    ws()
    const c = t[i]
    if (c === '{') {
      i++; ws()
      if (t[i] === '}') { i++; return }
      for (;;) {
        ws(); if (t[i] !== '"') fail(); str(); ws()
        if (t[i] !== ':') fail(); i++; value(); ws()
        if (t[i] === ',') { i++; continue }
        if (t[i] === '}') { i++; return }
        fail()
      }
    } else if (c === '[') {
      i++; ws()
      if (t[i] === ']') { i++; return }
      for (;;) {
        value(); ws()
        if (t[i] === ',') { i++; continue }
        if (t[i] === ']') { i++; return }
        fail()
      }
    } else if (c === '"') str()
    else if (/[-0-9]/.test(c || '')) {
      const m = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(t.slice(i))
      if (!m) fail(); i += m[0].length
    } else {
      for (const w of ['true', 'false', 'null']) if (t.startsWith(w, i)) { i += w.length; return }
      fail()
    }
  }
  try {
    value(); ws()
    return i < t.length ? i : t.length
  } catch (at) {
    return typeof at === 'number' ? Math.min(at, t.length) : t.length
  }
}

/** `第 <line> 行第 <column> 列：<short message>`, same rules as core/mock-handler.ts. */
function describeMocksParseFailure(text, err) {
  const message = String((err && err.message) || err)
  const body = text.replace(/^\uFEFF/, '')
  let line = null
  let column = null
  const lc = /\(line (\d+) column (\d+)\)/.exec(message)
  const pos = /at position (\d+)/.exec(message)
  const offset = lc ? null : pos ? Number(pos[1]) : findJsonErrorOffset(body)
  if (lc) {
    line = Number(lc[1]); column = Number(lc[2])
  } else {
    const before = body.slice(0, offset == null ? body.length : offset).split('\n')
    line = before.length
    column = before[before.length - 1].length + 1
  }
  const short = message.replace(/\s*\(line \d+ column \d+\)/, '').split(/,\s*(?:\.\.\.)?"/s)[0].replace(/\s+in JSON at position \d+/, '').trim()
  const loc = line != null ? `第 ${line} 行第 ${column} 列：` : ''
  return `${loc}${short}`
}

/**
 * Read mocks.json. Missing file → null. Empty / whitespace → {}.
 * Invalid JSON throws MOCKS_FILE_INVALID and must not be treated as [].
 * `message` refuses a write; `listMessage` is what `mock list` prints.
 */
function readMocksDocument(mocksPath) {
  if (!fs.existsSync(mocksPath)) return null
  const text = fs.readFileSync(mocksPath, 'utf8').replace(/^\uFEFF/, '')
  if (text.trim() === '') return {}
  try {
    return JSON.parse(text)
  } catch (err) {
    const detail = describeMocksParseFailure(text, err)
    const error = new Error(`Mock 文件格式错误，已禁止写入以免覆盖: ${mocksPath} ${detail}`)
    error.code = 'MOCKS_FILE_INVALID'
    error.filePath = mocksPath
    error.detail = detail
    error.listMessage = `Mock 文件格式错误: ${mocksPath} ${detail}`
    throw error
  }
}

function rulesFromDocument(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return []
  return Array.isArray(data.rules) ? data.rules : []
}

function metaFromDocument(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { nextId: 0, lastId: 0 }
  return { nextId: Number(data.nextId) || 0, lastId: Number(data.lastId) || 0 }
}

/**
 * Load mock rules from file. A corrupt file throws; it is not an empty list.
 */
function loadMockRules() {
  const data = readMocksDocument(getMocksPath())
  if (data == null) return []
  return rulesFromDocument(data)
}

function readMocksFileMeta(mocksPath) {
  const data = readMocksDocument(mocksPath)
  if (data == null) return { nextId: 0, lastId: 0 }
  return metaFromDocument(data)
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
  const readonlyNames = new Set(getReadonlyRuleFileNames())

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
      readonly: readonlyNames.has(name),
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
  assertRuleFileWritable(name)
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

  // Drop stale lock entries so a new file never inherits an old lock.
  getReadonlyRuleFileNames()
  fs.writeFileSync(filePath, content, 'utf8')

  if (enabled) {
    const activeNames = getActiveRuleFileNames()
    if (!activeNames.includes(safeName)) {
      activeNames.push(safeName)
      setActiveRuleFileNames(activeNames)
    }
  }

  const ruleCount = content.trim() ? Object.keys(parseEprc(content)).length : 0
  return { name: safeName, enabled, readonly: false, ruleCount }
}

/**
 * Delete rule file
 */
function deleteRuleFile(name) {
  const filePath = getRuleFilePath(name)
  if (!fs.existsSync(filePath)) {
    throw new Error('规则文件不存在')
  }
  assertRuleFileWritable(name)
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
  if ((enabled && idx === -1) || (!enabled && idx !== -1)) assertRuleFileWritable(name)

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
  getReadonlyRuleFileNames,
  isRuleFileReadonly,
  assertRuleFileWritable,

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