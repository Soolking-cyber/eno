#!/usr/bin/env node
/**
 * Fill `GeoBoundary` with every curated district outline, once.
 *
 * ⛔ WHY A SCRIPT AND NOT A REQUEST-TIME FETCH. `/api/geo/boundaries` is cache-only on purpose:
 * OSM's Nominatim policy is ONE request per second, so warming ~23 districts inside a page load
 * would stall it for half a minute and, run concurrently by two readers, is how a production IP
 * gets banned — which would take the reverse-geocode route down with it. This does the same work
 * out of band, sequentially, at a deliberate 1.1s spacing.
 *
 * ⚠️ IT DRIVES THE APP'S OWN ROUTE, NOT NOMINATIM DIRECTLY. `/api/geo/boundary` already owns the
 * picking (administrative/historic + polygon + name match), the simplification and the write —
 * including the negative caching. Re-implementing any of that here would give the warm path
 * different behaviour from the live path, which is the bug this avoids rather than risks.
 *
 * ⚠️ A MISS IS A RESULT, NOT A FAILURE. Two of the curated districts have no usable boundary in
 * OSM; the route records that as `found=false` and this reports it. Re-running is safe and cheap —
 * cached areas answer from the DB without touching OSM.
 *
 *   node scripts/geo-warm-districts.mjs                 # against production
 *   BASE=http://localhost:3000 node scripts/geo-warm-districts.mjs
 */
import { readFileSync } from 'node:fs'

const BASE = process.env.BASE || 'https://eno.vn'
const PROVINCE = process.env.PROVINCE || 'Hồ Chí Minh'
const GAP_MS = Number(process.env.GAP_MS || 1100)

// Read the curated list straight out of the constants file — a second copy of these names here
// would drift from the picker, and the whole point is that the map offers exactly what it filters by.
const src = readFileSync(new URL('../src/components/marketplace/listings-explorer.constants.ts', import.meta.url), 'utf8')
const block = src.match(/export const DISTRICTS[\s\S]*?\n\]/)
if (!block) { console.error('could not find DISTRICTS in listings-explorer.constants.ts'); process.exit(1) }
const districts = [...block[0].matchAll(/\{\s*slug:\s*'([^']+)'\s*,\s*name:\s*'([^']+)'/g)]
  .map(([, slug, name]) => ({ slug, name }))
  .filter((d) => d.slug !== 'all')

if (!districts.length) { console.error('parsed zero districts — the constant shape changed'); process.exit(1) }
console.log(`warming ${districts.length} districts in ${PROVINCE} via ${BASE} (${GAP_MS}ms apart)\n`)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let found = 0, missing = 0, failed = 0

for (const [i, d] of districts.entries()) {
  const url = `${BASE}/api/geo/boundary?kind=district&name=${encodeURIComponent(d.name)}&province=${encodeURIComponent(PROVINCE)}`
  let label
  try {
    // ⚠️ LONGER THAN THE ROUTE'S WORST CASE, which a reviewer caught at 20s: a cold district now
    // tries up to four (query, name) candidates at 6s each with 1.1s between them, so ~27s. A
    // client timeout under that aborts precisely the multi-candidate districts this exists for —
    // and can kill the handler before it writes, so the next run repeats every upstream call.
    const res = await fetch(url, { signal: AbortSignal.timeout(70000) })
    const src_ = res.headers.get('x-boundary-source') ?? '?'
    if (!res.ok) {
      // 503 is the route refusing to cache a transient upstream failure — the right thing, and it
      // means this district is simply not warmed yet. Re-run later rather than forcing it.
      failed++; label = `HTTP ${res.status} (${src_}) — not cached, re-run`
    } else {
      const body = await res.json()
      if (body.boundary) { found++; label = `ok (${src_})` }
      else { missing++; label = `no boundary in OSM (${src_}) — cached as a miss` }
    }
  } catch (e) {
    failed++; label = `error: ${e.message}`
  }
  console.log(`  ${String(i + 1).padStart(2)}/${districts.length}  ${d.name.padEnd(18)} ${label}`)
  // Only pause when we might actually have hit OSM; a cache hit costs it nothing.
  if (i < districts.length - 1) await sleep(GAP_MS)
}

console.log(`\nfound ${found} · no-boundary ${missing} · failed ${failed}`)
if (missing) {
  // ⛔ A CACHED MISS IS STICKY FOR 30 DAYS AND THIS SCRIPT CANNOT CLEAR IT (reviewer). It drives the
  // route, and the route answers a cached `found=false` without ever reaching the new query
  // candidates — so improving the aliases does NOT retry an area that was already written off.
  // Say so, with the exact way out, rather than reporting a clean run over a stale negative.
  console.log('\n⚠️  Areas above marked "(cache)" were written off on an EARLIER run and were not')
  console.log('   re-tried — a cached miss lasts 30 days. If the lookup has since improved, clear')
  console.log('   them first and re-run:')
  console.log(`   psql "$DIRECT_URL" -c "DELETE FROM \\"GeoBoundary\\" WHERE found = false AND key LIKE 'district|%';"`)
}
// ⚠️ ANY failure is a non-zero exit (reviewer). `failed && !found` reported success on a run with
// one hit and twenty-one transient errors, which is exactly the partial cache an operator would
// then treat as warm.
process.exit(failed ? 1 : 0)
