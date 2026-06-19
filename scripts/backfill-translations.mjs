// One-time backfill: pre-translate every existing listing's title + description
// into the high-volume markets so the whole catalog renders from cache instantly.
// Uses the running app's /api/translate route, so it exercises the exact same
// Azure + Postgres-cache path as production (idempotent — re-running is cheap,
// already-cached strings are skipped by the route).
//
// Run:  set -a; . ./.env; set +a; export DATABASE_URL="$DIRECT_URL"; node scripts/backfill-translations.mjs

import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()
const BASE = process.env.BACKFILL_BASE_URL || 'http://localhost:3000'
const EAGER = ['en', 'vi', 'zh-Hans', 'zh-Hant', 'ko', 'ja', 'ru']
const CHUNK = 80 // texts per request
// F0 free tier throttles at ~33,300 chars/MINUTE. Pace cache-miss passes so a
// burst backfill never trips a 429. (Cache hits are instant and skip the wait.)
const PACE_MS = 16000

function chunk(arr, n) {
  const out = []
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n))
  return out
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const listings = await db.listing.findMany({ select: { title: true, description: true } })

  // Unique, non-trivial source strings across the whole catalog.
  const set = new Set()
  for (const l of listings) {
    if (l.title && l.title.trim()) set.add(l.title.trim())
    if (l.description && l.description.trim()) set.add(l.description.trim())
  }
  const texts = [...set]
  const totalChars = texts.reduce((s, t) => s + t.length, 0)

  console.log(`Listings: ${listings.length}`)
  console.log(`Unique strings: ${texts.length}  (${totalChars.toLocaleString()} chars/lang)`)
  console.log(`Languages: ${EAGER.join(', ')}`)
  console.log(`Worst-case quota use: ~${(totalChars * EAGER.length).toLocaleString()} chars (only cache-misses actually call Azure)\n`)

  for (let li = 0; li < EAGER.length; li++) {
    const target = EAGER[li]
    let done = 0
    const started = Date.now()
    for (const part of chunk(texts, CHUNK)) {
      const res = await fetch(`${BASE}/api/translate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texts: part, target }),
      })
      if (!res.ok) {
        console.error(`  [${target}] HTTP ${res.status} — ${await res.text().catch(() => '')}`)
        break
      }
      done += part.length
      process.stdout.write(`\r  ${target}: ${done}/${texts.length}`)
    }
    // Pace only when Azure was actually called (a cache-hit pass is sub-second).
    const hitAzure = Date.now() - started > 1000
    console.log(hitAzure ? '  ✓' : '  ✓ (cached)')
    if (hitAzure && li < EAGER.length - 1) await sleep(PACE_MS)
  }

  const cached = await db.translation.count()
  console.log(`\nDone. Translation cache now holds ${cached} rows.`)
  await db.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await db.$disconnect()
  process.exit(1)
})
