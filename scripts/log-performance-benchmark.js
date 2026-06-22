'use strict'

const { performance } = require('perf_hooks')

const MESSAGE_COUNT = 500
const BATCH_SIZE = 25
const SAMPLE_COUNT = 7

function makeRecord(id) {
  return {
    id,
    method: id % 7 === 0 ? 'POST' : 'GET',
    source: `https://example.com/api/items/${id}?query=${'x'.repeat(40)}`,
    target: `http://localhost:3000/api/items/${id}`,
    time: '10:00:00',
    statusCode: id % 13 === 0 ? 404 : 200,
    duration: id % 500,
    clientType: 'local',
    clientIp: '127.0.0.1',
    clientName: '本机',
    applicationName: 'Google Chrome',
    applicationProcess: 'Google Chrome Helper',
    applicationBundleId: 'com.google.Chrome',
  }
}

function createRecords(count) {
  return Array.from({ length: count }, (_, index) => makeRecord(count - index))
}

function deriveBefore(records, query = 'items') {
  const lowerQuery = query.toLowerCase()
  const filtered = records.filter((record) => (
    `${record.method} ${record.source} ${record.target} ${record.time} ${record.clientType} ${record.clientIp} ${record.clientName} ${record.applicationName} ${record.applicationProcess} ${record.applicationBundleId}`
      .toLowerCase()
      .includes(lowerQuery)
  ))
  return [...filtered].sort((left, right) => right.id - left.id)
}

function runBefore(capacity) {
  let records = createRecords(capacity)
  const startedAt = performance.now()
  for (let index = 0; index < MESSAGE_COUNT; index++) {
    records = [makeRecord(capacity + index + 1), ...records].slice(0, capacity)
    deriveBefore(records)
  }
  return performance.now() - startedAt
}

function createSearchIndex(record) {
  let domain = record.source
  try {
    domain = new URL(record.source).hostname
  } catch {
    // Match the production fallback for invalid or relative URLs.
  }
  return {
    domain: domain.toLowerCase(),
    haystack: `${record.method} ${record.source} ${record.target} ${record.time} ${record.clientType} ${record.clientIp} ${record.clientName} ${record.applicationName} ${record.applicationProcess} ${record.applicationBundleId}`
      .toLowerCase(),
  }
}

function prependBatch(current, pending, capacity) {
  const pendingCount = Math.min(pending.length, capacity)
  const currentCount = Math.min(current.length, capacity - pendingCount)
  const next = new Array(pendingCount + currentCount)
  for (let index = 0; index < pendingCount; index++) {
    next[index] = pending[pending.length - 1 - index]
  }
  for (let index = 0; index < currentCount; index++) {
    next[pendingCount + index] = current[index]
  }
  return next
}

function runAfter(capacity) {
  let records = createRecords(capacity)
  const searchIndex = new WeakMap()
  for (const record of records) searchIndex.set(record, createSearchIndex(record))

  const startedAt = performance.now()
  for (let offset = 0; offset < MESSAGE_COUNT; offset += BATCH_SIZE) {
    const pending = []
    for (let index = 0; index < BATCH_SIZE && offset + index < MESSAGE_COUNT; index++) {
      const record = makeRecord(capacity + offset + index + 1)
      searchIndex.set(record, createSearchIndex(record))
      pending.push(record)
    }
    records = prependBatch(records, pending, capacity)
    records.filter((record) => searchIndex.get(record).haystack.includes('items'))
    // Descending order uses the newest-first storage order directly.
  }
  return performance.now() - startedAt
}

function runColdSearch(capacity) {
  const records = createRecords(capacity)
  const searchIndex = new WeakMap()
  const startedAt = performance.now()
  records.filter((record) => {
    let indexed = searchIndex.get(record)
    if (!indexed) {
      indexed = createSearchIndex(record)
      searchIndex.set(record, indexed)
    }
    return indexed.haystack.includes('items')
  })
  return performance.now() - startedAt
}

function runWarmSearch(capacity) {
  const records = createRecords(capacity)
  const searchIndex = new WeakMap()
  for (const record of records) searchIndex.set(record, createSearchIndex(record))
  const startedAt = performance.now()
  records.filter((record) => searchIndex.get(record).haystack.includes('items'))
  return performance.now() - startedAt
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.floor(sorted.length / 2)]
}

function measure(name, implementation, capacity, run) {
  run(capacity)
  const samples = Array.from({ length: SAMPLE_COUNT }, () => run(capacity))
  return {
    name,
    implementation,
    capacity,
    messages: MESSAGE_COUNT,
    batchSize: implementation === 'after' ? BATCH_SIZE : 1,
    medianMs: Number(median(samples).toFixed(2)),
    samplesMs: samples.map((sample) => Number(sample.toFixed(2))),
  }
}

const results = [
  measure('current-1k', 'before', 1_000, runBefore),
  measure('cap-only-10k', 'before', 10_000, runBefore),
  measure('optimized-10k', 'after', 10_000, runAfter),
]
const searchResults = {
  coldIndexAndFilter10kMedianMs: Number(median(
    Array.from({ length: SAMPLE_COUNT }, () => runColdSearch(10_000)),
  ).toFixed(2)),
  warmFilter10kMedianMs: Number(median(
    Array.from({ length: 50 }, () => runWarmSearch(10_000)),
  ).toFixed(2)),
}
const summaryPayloadMiB = Number((
  Buffer.byteLength(JSON.stringify(createRecords(10_000))) / 1024 / 1024
).toFixed(2))

if (process.argv.includes('--json')) {
  process.stdout.write(`${JSON.stringify({
    node: process.version,
    results,
    searchResults,
    summaryPayloadMiB,
  }, null, 2)}\n`)
} else {
  console.table(results.map(({ samplesMs, ...result }) => result))
  for (const result of results) {
    console.log(`${result.name} samples: ${result.samplesMs.join(', ')} ms`)
  }
  console.table(searchResults)
  console.log(`10k summary payload: ${summaryPayloadMiB} MiB`)
}
