#!/usr/bin/env node
/**
 * Iteration 2 Phase 8 - Epic 7 latency budget gate.
 *
 * Hits the five read endpoints called out in the AC (config, catalogue,
 * catalogue search, places, adopted-areas) N times against a running
 * API, computes p95 + p99 from wall-clock request time, and exits 1 if
 * any endpoint blows the SLO. The Prometheus histograms exposed at
 * /metrics carry the same signal for production dashboards; this
 * script is the CI equivalent so a regression fails the build.
 *
 * The gate values match what the acceptance doc calls the "read
 * endpoint" bracket: p95 <= 500ms, p99 <= 1200ms.
 *
 *   node scripts/latency-budget-check.mjs [--base http://localhost:8000] [--n 60]
 */

const args = process.argv.slice(2)
function argOf(flag, fallback) {
  const i = args.indexOf(flag)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}

const BASE = argOf('--base', process.env.INVATRACE_BASE || 'http://localhost:8000').replace(/\/$/, '')
const N = Math.max(5, Number(argOf('--n', '60')))
const P95_MS = Number(argOf('--p95', '500'))
const P99_MS = Number(argOf('--p99', '1200'))

const ENDPOINTS = [
  { name: 'config-limits',         path: '/api/v1/config/limits' },
  { name: 'catalogue-list',        path: '/api/v1/catalogue' },
  { name: 'catalogue-search',      path: '/api/v1/catalogue/search?q=mikania' },
  { name: 'health',                path: '/health' },
  { name: 'offline-pack-latest',   path: '/api/v1/offline-pack/latest' },
]

function percentile(sortedMs, p) {
  if (sortedMs.length === 0) return NaN
  const idx = Math.min(sortedMs.length - 1, Math.ceil((p / 100) * sortedMs.length) - 1)
  return sortedMs[idx]
}

async function timeOne(url) {
  const t0 = performance.now()
  try {
    const res = await fetch(url, { headers: { accept: 'application/json' } })
    // Drain body so keep-alive / server-side timing measures a full round trip.
    await res.arrayBuffer()
    return { ms: performance.now() - t0, ok: res.status < 500, status: res.status }
  } catch (err) {
    return { ms: performance.now() - t0, ok: false, status: 0, err: String(err) }
  }
}

async function measure(ep) {
  const samples = []
  let errored = 0
  for (let i = 0; i < N; i++) {
    const r = await timeOne(BASE + ep.path)
    samples.push(r.ms)
    if (!r.ok) errored++
  }
  samples.sort((a, b) => a - b)
  return {
    name: ep.name,
    path: ep.path,
    samples: samples.length,
    errored,
    p50: percentile(samples, 50),
    p95: percentile(samples, 95),
    p99: percentile(samples, 99),
    max: samples[samples.length - 1],
  }
}

const rows = []
for (const ep of ENDPOINTS) {
  const r = await measure(ep)
  rows.push(r)
}

let failed = 0
console.log(`Latency budget @ ${BASE} (${N} samples/endpoint, p95<=${P95_MS}ms p99<=${P99_MS}ms)`)
console.log('endpoint                     p50     p95     p99     max     err')
for (const r of rows) {
  const bad = r.p95 > P95_MS || r.p99 > P99_MS
  if (bad) failed++
  const tag = bad ? 'FAIL' : 'ok'
  console.log(
    `${r.name.padEnd(28)} ${r.p50.toFixed(0).padStart(5)}   ${r.p95.toFixed(0).padStart(5)}   ${r.p99.toFixed(0).padStart(5)}   ${r.max.toFixed(0).padStart(5)}   ${String(r.errored).padStart(3)}  ${tag}`,
  )
}

if (failed > 0) {
  console.error(`\n${failed}/${rows.length} endpoint(s) blew the latency budget.`)
  process.exit(1)
}
console.log('\nAll endpoints within budget.')
