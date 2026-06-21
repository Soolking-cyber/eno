// Re-translate every CURRENTLY-shown source string (UI strings + listing fields)
// via Google Cloud Translation and OVERWRITE the cached value in the Translation
// table — replacing the wrong Azure machine translations. Force-overwrites (it
// does NOT read the cache first, unlike translateBatch), so existing rows are
// re-done. Orphan rows for no-longer-used strings are left (never looked up).
//
//   set -a; . ./.env; set +a; node scripts/retranslate-google.mjs

import pg from 'pg'
import crypto from 'crypto'
import { readFileSync } from 'fs'

const KEY = process.env.GOOGLE_TRANSLATE_API_KEY
if (!KEY) { console.error('Set GOOGLE_TRANSLATE_API_KEY'); process.exit(1) }
const dbUrl = process.env.DIRECT_URL || process.env.DATABASE_URL
if (!dbUrl) { console.error('Set DIRECT_URL'); process.exit(1) }

const client = new pg.Client({ connectionString: dbUrl })
await client.connect()

// Google v2 codes (zh-Hans -> zh-CN). All app languages except the source (en).
const GOOGLE_CODE = { vi: 'vi', 'zh-Hans': 'zh-CN', ko: 'ko', ja: 'ja', ru: 'ru', km: 'km', ms: 'ms', th: 'th', fr: 'fr', hi: 'hi' }
const TARGETS = Object.keys(GOOGLE_CODE)
const hash = (t) => crypto.createHash('sha1').update(t).digest('hex') // MUST match src/lib/translate.ts
const decode = (s) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, '&')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function gt(chunk, target) {
  const body = JSON.stringify({ q: chunk, target: GOOGLE_CODE[target], format: 'text' })
  for (let a = 0; a < 4; a++) {
    const res = await fetch(`https://translation.googleapis.com/language/translate/v2?key=${KEY}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
    })
    if (res.status === 429 || res.status >= 500) { await sleep(Math.min(600 * (a + 1), 6000)); continue }
    if (!res.ok) { console.error('  google', res.status, (await res.text().catch(() => '')).slice(0, 200)); return null }
    const j = await res.json()
    const it = j?.data?.translations
    if (!Array.isArray(it)) return null
    return chunk.map((s, i) => decode(it[i]?.translatedText ?? s))
  }
  return null
}

// Sources: UI strings (from the generated list) + every listing text field.
const uiFile = readFileSync('src/generated/ui-strings.ts', 'utf8')
const arrStart = uiFile.indexOf('[', uiFile.indexOf('=')) // skip the [] in "string[]"
const uiArr = JSON.parse(uiFile.slice(arrStart, uiFile.lastIndexOf(']') + 1))
const { rows } = await client.query('select title, description, location, attributes from "Listing"')
const listingStrs = []
for (const l of rows) {
  for (const f of [l.title, l.description, l.location]) if (f) listingStrs.push(f)
  if (l.attributes) { try { for (const v of Object.values(JSON.parse(l.attributes))) listingStrs.push(String(v)) } catch {} }
}
const all = [...new Set([...uiArr, ...listingStrs].filter((s) => s && String(s).trim()))]
console.log(`${all.length} unique strings × ${TARGETS.length} langs (${rows.length} listings, ${uiArr.length} UI strings)`)

const MAX_ITEMS = 100, MAX_CHARS = 28000
function chunks(a) { const o = []; let c = [], n = 0; for (const t of a) { if (c.length && (c.length >= MAX_ITEMS || n + t.length > MAX_CHARS)) { o.push(c); c = []; n = 0 } c.push(t); n += t.length } if (c.length) o.push(c); return o }

let chars = 0
for (const target of TARGETS) {
  let ok = 0
  for (const ch of chunks(all)) {
    const tr = await gt(ch, target)
    if (!tr) { console.warn(`  ${target}: chunk failed, skipped`); continue }
    chars += ch.reduce((n, t) => n + t.length, 0)
    const params = []
    const tuples = ch.map((src, i) => { const b = i * 4; params.push(crypto.randomUUID(), hash(src), target, tr[i] ?? src); return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},now())` }).join(',')
    await client.query(`insert into "Translation"(id,hash,target,value,"createdAt") values ${tuples} on conflict (hash,target) do update set value=excluded.value`, params)
    ok += ch.length
  }
  console.log(`✓ ${target}: ${ok} strings`)
  await sleep(150)
}
console.log(`Done. ~${chars} source chars translated (~$${(chars / 1e6 * 20).toFixed(3)} at $20/M).`)
await client.end()
