#!/usr/bin/env node

/**
 * Meddle Doctor - 配置文件健康检查工具
 */

const fs = require('fs')
const path = require('path')
const chalk = require('chalk')
const { resolveMeddleHome } = require('./lib/meddle-home')

const meddleDir = resolveMeddleHome()
const settingsPath = path.resolve(meddleDir, 'settings.json')
const routeRulesDir = path.resolve(meddleDir, 'route-rules')
const defaultMocksPath = path.resolve(meddleDir, 'mocks.json')
const certDir = path.resolve(meddleDir, 'ca')
const rootCACrt = path.resolve(certDir, 'rootCA.crt')
const rootCAKey = path.resolve(certDir, 'rootCA.key')

let hasErrors = false
let hasWarnings = false

function printHeader() {
  console.log('')
  console.log(chalk.bold.cyan('════════════════════════════════════════'))
  console.log(chalk.bold.cyan('   Meddle 配置文件健康检查'))
  console.log(chalk.bold.cyan('════════════════════════════════════════'))
  console.log('')
}

function printSection(title) {
  console.log(chalk.bold.yellow(`\n▶ ${title}`))
  console.log(chalk.gray('─'.repeat(40)))
}

function printSuccess(message) {
  console.log(chalk.green('  ✓'), message)
}

function printWarning(message) {
  console.log(chalk.yellow('  ⚠'), message)
  hasWarnings = true
}

function printError(message) {
  console.log(chalk.red('  ✗'), message)
  hasErrors = true
}

function printInfo(message) {
  console.log(chalk.gray('    →'), message)
}

/**
 * 检查目录是否存在
 */
function checkDirectory() {
  printSection('1. 配置目录检查')
  
  if (fs.existsSync(meddleDir)) {
    printSuccess(`配置目录存在: ${meddleDir}`)
    const stats = fs.statSync(meddleDir)
    printInfo(`创建时间: ${stats.birthtime.toLocaleString()}`)
  } else {
    printError(`配置目录不存在: ${meddleDir}`)
    printInfo('运行 meddle 命令将自动创建')
  }
  
  if (fs.existsSync(certDir)) {
    printSuccess(`证书目录存在: ${certDir}`)
  } else {
    printWarning('证书目录不存在，HTTPS 代理将无法使用')
    printInfo('首次启动时会自动创建')
  }
}

/**
 * 检查系统设置文件
 */
function checkSettings() {
  printSection('2. 系统设置检查')
  
  if (!fs.existsSync(settingsPath)) {
    printWarning('系统设置文件不存在')
    printInfo('首次打开设置面板时会自动创建')
    return null
  }
  
  try {
    const content = fs.readFileSync(settingsPath, 'utf8')
    const settings = JSON.parse(content)
    
    printSuccess(`系统设置文件: ${settingsPath}`)
    printInfo(`文件大小: ${content.length} bytes`)
    
    // 检查必要字段
    if (settings.theme) {
      printSuccess(`主题设置: ${settings.theme}`)
    } else {
      printWarning('未设置主题')
    }
    
    if (settings.fontSize) {
      printSuccess(`字体大小: ${settings.fontSize}`)
    }
    
    if (settings.aiConfig) {
      const ai = settings.aiConfig
      if (ai.enabled) {
        printSuccess(`AI 功能: 已启用 (${ai.provider})`)
        printInfo(`模型: ${ai.model}`)
        if (!ai.apiKey) {
          printWarning('AI 已启用但未配置 API Key')
        }
      } else {
        printInfo('AI 功能: 未启用')
      }
      
      if (ai.models && ai.models.length > 0) {
        printSuccess(`多模型配置: ${ai.models.length} 个模型`)
      }
    }
    
    return settings
    
  } catch (error) {
    printError(`系统设置文件格式错误: ${error.message}`)
    return null
  }
}

/**
 * 检查路由规则目录
 */
function checkRulesFile(settings) {
  printSection('3. 路由规则文件检查')

  printInfo(`规则目录: ${routeRulesDir}`)

  if (!fs.existsSync(routeRulesDir)) {
    printWarning('路由规则目录不存在')
    printInfo('首次启动时会自动创建，并生成默认规则文件')
    return
  }

  const txtFiles = fs.readdirSync(routeRulesDir).filter(f => f.endsWith('.txt'))
  printSuccess(`规则目录存在，包含 ${txtFiles.length} 个规则文件`)

  // 检查 settings 中的 activeRuleFiles
  const activeNames = (settings && Array.isArray(settings.activeRuleFiles)) ? settings.activeRuleFiles : []
  printInfo(`已启用: ${activeNames.length} 个文件`)

  let totalRules = 0
  txtFiles.forEach(file => {
    const filePath = path.join(routeRulesDir, file)
    const name = file.replace(/\.txt$/, '')
    const isActive = activeNames.includes(name)

    try {
      const content = fs.readFileSync(filePath, 'utf8')
      const lines = content.split('\n').filter(line => {
        const trimmed = line.trim()
        return trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('//')
      })
      const validRules = lines.filter(line => line.trim().split(/\s+/).length >= 2).length
      totalRules += validRules
      printSuccess(`  ${isActive ? '●' : '○'} ${name} (${validRules} 条规则)`)
    } catch (error) {
      printError(`  读取 ${file} 失败: ${error.message}`)
    }
  })

  if (totalRules > 0) {
    printSuccess(`有效规则总数: ${totalRules} 条`)
  }
}

/**
 * 检查 Mock 规则文件
 */
function checkMocksFile(settings) {
  printSection('4. Mock 规则文件检查')
  
  let mocksPath = defaultMocksPath
  
  // 检查自定义路径
  if (settings && settings.mocksFilePath) {
    mocksPath = settings.mocksFilePath
    printInfo(`使用自定义路径: ${mocksPath}`)
  } else {
    printInfo(`使用默认路径: ${mocksPath}`)
  }
  
  if (!fs.existsSync(mocksPath)) {
    printWarning('Mock 规则文件不存在')
    printInfo('可以通过 Web 界面创建 Mock 规则')
    return
  }
  
  try {
    const content = fs.readFileSync(mocksPath, 'utf8')
    const data = JSON.parse(content)
    
    printSuccess(`Mock 规则文件: ${mocksPath}`)
    printInfo(`文件大小: ${content.length} bytes`)
    
    if (!data.rules || !Array.isArray(data.rules)) {
      printError('Mock 文件格式错误：缺少 rules 数组')
      return
    }
    
    printSuccess(`Mock 规则数量: ${data.rules.length} 条`)
    
    // 检查每条规则
    let enabledCount = 0
    data.rules.forEach((rule, index) => {
      if (rule.enabled) {
        enabledCount++
      }
      
      // 检查必要字段
      if (!rule.urlPattern) {
        printWarning(`规则 #${rule.id || index}: 缺少 urlPattern`)
      }
      if (rule.bodyType === 'file' && rule.body && !fs.existsSync(rule.body)) {
        printWarning(`规则 #${rule.id || index}: 文件不存在 ${rule.body}`)
      }
    })
    
    printSuccess(`已启用规则: ${enabledCount} 条`)
    
  } catch (error) {
    printError(`Mock 规则文件格式错误: ${error.message}`)
  }
}

/**
 * 检查证书文件
 */
function checkCertificates() {
  printSection('5. SSL 证书检查')
  
  if (!fs.existsSync(certDir)) {
    printWarning('证书目录不存在')
    printInfo('首次启动时会自动创建')
    return
  }
  
  printSuccess(`证书目录: ${certDir}`)
  
  if (fs.existsSync(rootCACrt)) {
    printSuccess('根证书文件存在: rootCA.crt')
    const stats = fs.statSync(rootCACrt)
    printInfo(`文件大小: ${stats.size} bytes`)
  } else {
    printWarning('根证书文件不存在')
    printInfo('首次启动时会自动生成')
  }
  
  if (fs.existsSync(rootCAKey)) {
    printSuccess('根证书私钥存在: rootCA.key')
  } else {
    printWarning('根证书私钥不存在')
  }
  
  // 检查其他证书文件
  try {
    const files = fs.readdirSync(certDir)
    const certFiles = files.filter(f => f.endsWith('.crt') && f !== 'rootCA.crt')
    if (certFiles.length > 0) {
      printSuccess(`域名证书: ${certFiles.length} 个`)
      certFiles.slice(0, 5).forEach(file => {
        printInfo(`  - ${file}`)
      })
      if (certFiles.length > 5) {
        printInfo(`  ... 还有 ${certFiles.length - 5} 个`)
      }
    }
  } catch (error) {
    // ignore
  }
}

/**
 * 检查文件权限
 */
function checkPermissions() {
  printSection('6. 文件权限检查')
  
  const checkPaths = [
    { path: meddleDir, name: '配置目录' },
    { path: settingsPath, name: '系统设置文件' },
    { path: routeRulesDir, name: '路由规则目录' },
    { path: defaultMocksPath, name: 'Mock 规则文件' },
  ]
  
  checkPaths.forEach(({ path: filePath, name }) => {
    if (fs.existsSync(filePath)) {
      try {
        fs.accessSync(filePath, fs.constants.R_OK | fs.constants.W_OK)
        printSuccess(`${name}: 可读写`)
      } catch (error) {
        printError(`${name}: 权限不足`)
      }
    }
  })
}

/**
 * 生成诊断报告
 */
function generateReport() {
  printSection('诊断报告')
  
  console.log('')
  
  if (!hasErrors && !hasWarnings) {
    console.log(chalk.green.bold('  ✓ 所有检查通过！配置正常。'))
  } else {
    if (hasErrors) {
      console.log(chalk.red.bold(`  ✗ 发现 ${hasErrors ? '错误' : '问题'}`))
      console.log(chalk.gray('    请根据上述提示修复错误'))
    }
    if (hasWarnings) {
      console.log(chalk.yellow.bold('  ⚠ 发现警告'))
      console.log(chalk.gray('    建议检查上述警告项'))
    }
  }
  
  console.log('')
  console.log(chalk.gray('提示:'))
  console.log(chalk.gray('  - 运行 meddle 启动代理服务器'))
  console.log(chalk.gray('  - 访问 http://localhost:8899 打开管理界面'))
  console.log(chalk.gray('  - 查看 CONFIG_STRUCTURE.md 了解配置文件详情'))
  console.log('')
}

/**
 * 主函数
 */
function main() {
  printHeader()
  
  checkDirectory()
  const settings = checkSettings()
  checkRulesFile(settings)
  checkMocksFile(settings)
  checkCertificates()
  checkPermissions()
  
  generateReport()
  
  process.exit(hasErrors ? 1 : 0)
}

main()
