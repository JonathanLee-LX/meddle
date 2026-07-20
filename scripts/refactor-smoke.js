#!/usr/bin/env node

const baseUrl = process.env.MEDDLE_SMOKE_BASE_URL || 'http://127.0.0.1:8989'
const endpoints = [
  '/api/pipeline/config',
  '/api/pipeline/shadow-stats',
  '/api/pipeline/readiness',
  '/api/refactor/status',
  '/api/plugins',
  '/api/plugins/health',
  '/api/plugins/logger',
  '/api/plugins/mock',
]

async function run() {
  let hasError = false
  for (const path of endpoints) {
    const url = baseUrl + path
    try {
      const res = await fetch(url)
      const text = await res.text()
      let data
      try {
        data = JSON.parse(text)
      } catch (_) {
        throw new Error(`non-json response (${text.slice(0, 80)})`)
      }
      const keys = Object.keys(data).slice(0, 8)
      console.log(`[OK] ${path} status=${res.status} keys=${keys.join(',')}`)
    } catch (err) {
      hasError = true
      console.error(`[FAIL] ${path} ${err.message}`)
    }
  }

  if (hasError) process.exit(1)
}

run()

