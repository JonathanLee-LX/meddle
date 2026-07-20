#!/usr/bin/env node

/**
 * 测试环境变量配置
 * 此脚本用于验证.env文件中的配置是否正确
 */

const fs = require('fs')
const path = require('path')

console.log('🔍 检查环境变量配置...\n')

// 检查.env.example文件
const examplePath = path.join(__dirname, '.env.example')
if (fs.existsSync(examplePath)) {
  console.log('✅ .env.example 文件存在')
} else {
  console.log('❌ .env.example 文件不存在')
}

// 检查.env文件
const envPath = path.join(__dirname, '.env')
if (fs.existsSync(envPath)) {
  console.log('✅ .env 文件存在')
  
  // 读取并显示配置
  const envContent = fs.readFileSync(envPath, 'utf-8')
  const lines = envContent.split('\n')
  const config = {}
  
  lines.forEach(line => {
    const match = line.match(/^(VITE_\w+)=(.+)$/)
    if (match) {
      config[match[1]] = match[2]
    }
  })
  
  console.log('\n📋 当前配置:')
  Object.entries(config).forEach(([key, value]) => {
    console.log(`   ${key} = ${value}`)
  })
} else {
  console.log('⚠️  .env 文件不存在（将使用默认配置）')
}

// 默认配置
console.log('\n📋 默认配置:')
const defaults = {
  'VITE_MAX_HIGHLIGHT_SIZE': '2097152 (2MB)',
  'VITE_MAX_HIGHLIGHT_LINES': '10000',
  'VITE_MAX_JSON_MATCHES': '50000',
  'VITE_MAX_HTML_MATCHES': '30000',
  'VITE_MAX_JS_MATCHES': '30000'
}

Object.entries(defaults).forEach(([key, value]) => {
  console.log(`   ${key} = ${value}`)
})

console.log('\n💡 提示:')
console.log('   1. 复制 .env.example 为 .env 来自定义配置')
console.log('   2. 修改配置后需要重新构建: pnpm run build')
console.log('   3. 详细配置说明见: ENV_CONFIG.md\n')
