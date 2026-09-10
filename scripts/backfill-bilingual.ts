/**
 * Give EVERY listing a real English AND a real Vietnamese version of its name and description.
 *
 *   npx tsx scripts/backfill-bilingual.ts                  # DRY RUN + per-direction cost
 *   npx tsx scripts/backfill-bilingual.ts --apply
 *   npx tsx scripts/backfill-bilingual.ts --seller HShop --apply
 *   npx tsx scripts/backfill-bilingual.ts --audit          # post-run correctness check, no writes
 *
 * ⛔ WHY THIS EXISTS AND WHY IT IS NOT translate-imported-listings.ts. That script fixes ONE
 * direction (Vietnamese sitting in the English slot) for ONE seller, and it POISONS the Vietnamese
 * slot: its row set is "title OR description is Vietnamese", and it then writes `titleVi := title`
 * for every row in that set — so a listing with an English title and a Vietnamese description gets
 * an ENGLISH string stored as its Vietnamese title. useLocalized() prefers the *Vi column over the
 * translation cache, so a Vietnamese reader is served English with no way back. MEASURED on
 * production 2026-09-08: 166 of Phương Tín's 174 rows are exactly that shape, 1,137 rows in total.
 * This script sets a language slot ONLY from text it can prove is in that language, and REPAIRS
 * the rows the old one poisoned.
 *
 * ── THE LANGUAGE GATE, WHICH IS THE WHOLE CORRECTNESS ARGUMENT ─────────────────────────────────
 * ⛔ A SINGLE VIETNAMESE CHARACTER IS NOT A LANGUAGE. "Apartment for rent near Hồ Tây, 2 bedrooms"
 * is English; so is a 796-character English visa description whose brand line ends "VISA 24 GIỜ"
 * (14 real rows) and "Robusta Anaerobic Honey - TR4 & Sẻ (Local Robusta)" (5 real rows). A
 * one-character test writes all of those into the Vietnamese slot — the poisoning above, verbatim.
 *
 * ⛔ AND THE RENDERER'S OWN TEST IS NOT USABLE AS THE WRITER'S EITHER. detectContentLang (used by
 * useLocalized) keys on VI_EXCLUSIVE — horn, breve, đ and the dot-below vowels — deliberately
 * excluding the accents Vietnamese shares with French. It answers a different question (never
 * MISLABEL, for a WCAG lang attribute) and it is too strict here: measured on production, 1,237
 * titles are unmistakable Vietnamese that it does not match ("Bếp Từ Hồng Ngoài KANGAROO Cũ Chính
 * Hãng Giá Rẻ" carries no exclusive letter at all).
 *
 * So the gate is SHAPE, the same reasoning src/lib/translate.ts uses to skip paid no-ops:
 *   · Vietnamese prose is DENSELY diacriticked and its longest run of undiacriticked words is 1-2.
 *   · English prose with a Vietnamese place or brand name in it has a low density and a long run.
 *   · Anything between the two is NOT CLASSIFIED AND NOT TOUCHED. Refusing to guess is free; a
 *     wrong guess is written into a column that outranks every other source and cannot be undone.
 * Verified against all 19,469 production rows — the three buckets are printed by --audit.
 *
 * ⚠️ UNDIACRITICKED VIETNAMESE ("Ban xe may Honda Wave gia re") reads as EN and gets a Vietnamese
 * translation written into the empty titleVi. That is a known, bounded imperfection: it FILLS an
 * empty slot and never overwrites, so a Vietnamese reader ends up better off and an English reader
 * is exactly where they started. Nothing here can tell that register from English by shape.
 *
 * ── THE THIRD TIER, WHICH IS WHERE MOST OF THE CATALOGUE ACTUALLY LIVES ────────────────────────
 * ⛔ REFUSING TO CLASSIFY IS NOT THE SAME AS REFUSING TO HELP. The UNKNOWN band is not junk — it is
 * Vietnamese product prose carrying long English model strings ("Máy tính để bàn Dell Pro Slim Plus
 * QBS1250 | Intel Core Ultra 7 265 vPro | Ram 16 GB DDR5"), which is what a spec sheet looks like
 * on this marketplace. Measured: 4,217 of 4,344 UNKNOWN descriptions and 1,494 of 3,449 UNKNOWN
 * titles are ones the RENDERER already calls Vietnamese (detectContentLang !== null).
 *
 * For exactly those, useLocalized takes the `i18n.en` branch (listing-content.tsx:30) — so writing
 * a Translation row under sha1(source)/'en' makes the English reader see English SYNCHRONOUSLY,
 * with NO column written, NO original moved, and therefore no way to poison anything. That is the
 * whole of tier 2: buy the translation, put it in the cache, leave the row alone.
 *
 * ⚠️ AND WHAT IS LEFT OVER IS REPORTED, NEVER SILENTLY DROPPED. The ~1,955 titles the renderer
 * calls language-neutral ("[Mới 99%] Dell Vostro 3400 14 inch Core i5-1135G7 RAM 16GB SSD 512GB")
 * are shown verbatim to both audiences and cannot be reached by either mechanism. The run prints
 * them as `no mechanism reaches this` rather than letting the totals imply full coverage.
 *
 * ── EVERYTHING ELSE THAT IS LOAD-BEARING ───────────────────────────────────────────────────────
 * ⚠️ WORK IS COMMITTED PER CHUNK, NOT AT THE END. An earlier draft bought all four legs into memory
 * and wrote nothing until every one had returned: one thrown fetch late in a ~650-request run
 * discarded the whole $57. Each chunk now translates → writes its Translation rows → writes its
 * listing rows, so a crash keeps everything already paid for and the re-run resumes.
 *
 * ⚠️ BOTH DIRECTIONS CONSULT THE CACHE BEFORE PAYING. The importer's own warmTranslations already
 * cached many of these under sha1(source)/'en', and a resumed run must not re-buy what the previous
 * attempt banked.
 *
 * ⚠️ THE PRIMARY COLUMN IS NEVER OVERWRITTEN UNLESS THE ORIGINAL IS PRESERVED FIRST. 113 rows have
 * a *Vi column already holding something DIFFERENT from the primary one; overwriting `title` there
 * would destroy the only copy (the Translation cache stores sha1(source), never the source, and
 * searchText is diacritic-folded, so neither can reconstruct it).
 *
 * ⚠️ THE PROVIDER RESPONSE IS LENGTH-CHECKED. A response shorter than the request misaligns
 * batch[i] with translations[i] and would cache one listing's text under another's hash forever.
 *
 * ⚠️ FOLLOW-UPS, ALL THREE REQUIRED (printed again at the end):
 *   1. npx tsx scripts/rebuild-search-text.ts --all --force --apply
 *      ⛔ --force IS NOT OPTIONAL. Without it that script filters `searchText: ''` and matches ZERO
 *         of these rows — they all have a non-empty blob — so search keeps only the old language.
 *   2. node scripts/purge-isr-listings.mjs   (the PDP is ISR revalidate=30d; this is not a Next
 *      runtime and cannot call revalidatePath, so the tombstone is the only way the pages regenerate)
 *   3. re-index for AI search, or let the nightly cron do it.
 */
import 'dotenv/config'
import crypto from 'node:crypto'
import { db } from '../src/lib/db'
import { detectContentLang } from '../src/lib/detect-lang'
import { gateTranslation } from '../src/lib/mt-gate'

const KEY = process.env.GOOGLE_TRANSLATE_API_KEY
/**
 * The self-hosted translator (infra/vn-node/mt-server). PREFERRED over Google when set.
 *
 * ⛔ THIS SCRIPT IS THE REASON THE BOX MODEL EXISTS. Its own estimate for the Tiki catalogue is
 * 15,779,619 characters ≈ $315.59 at Google's $20/M — on top of the $56.69 an earlier 2.83M-char
 * run already cost. Owner, 2026-09-09: "we would need permanent solution run in the box for it no
 * api since its too costly". With MT_LOCAL_URL set the same job costs nothing.
 */
const MT_URL = process.env.MT_LOCAL_URL
const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined }
const APPLY = process.argv.includes('--apply')
const AUDIT = process.argv.includes('--audit')
const SELLER = arg('seller')
const INCLUDE_OWNED = process.argv.includes('--include-owned')
if (APPLY && !KEY && !MT_URL) { console.error('set MT_LOCAL_URL (free, preferred) or GOOGLE_TRANSLATE_API_KEY to apply'); process.exit(1) }

// ── The gate ───────────────────────────────────────────────────────────────────────────────────
/** Every Vietnamese diacritic, including the accents shared with other Latin languages. */
const VI_RE = /[ăâđêôơưàáảãạằắẳẵặầấẩẫậèéẻẽẹềếểễệìíỉĩịòóỏõọồốổỗộờớởỡợùúủũụừứửữựỳýỷỹỵ]/i
const MIN_DENSITY = 0.25 // share of word tokens carrying a diacritic
const MAX_EN_RUN = 3     // longest run of consecutive undiacriticked words

type Lang = 'VI' | 'EN' | 'UNKNOWN' | 'EMPTY'
function classify(s: string | null | undefined): Lang {
  if (!s || !s.trim()) return 'EMPTY'
  let run = 0, maxRun = 0, viWords = 0, words = 0
  for (const tok of s.split(/\s+/)) {
    if (!/\p{L}/u.test(tok)) continue // digits and punctuation break nothing
    words++
    if (VI_RE.test(tok)) { viWords++; run = 0 } else if (++run > maxRun) maxRun = run
  }
  if (!words) return 'EMPTY'
  if (viWords === 0) return 'EN'
  return viWords / words >= MIN_DENSITY && maxRun <= MAX_EN_RUN ? 'VI' : 'UNKNOWN'
}

const sha1 = (s: string) => crypto.createHash('sha1').update(s).digest('hex')
/** Google v2 answers in HTML entities even under format:text for some inputs. */
const decode = (s: string) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, '&')

const BATCH = 50         // proven ceiling: 100 with no pause failed partway through 8,038 titles
const MAX_CHARS = 25_000 // Google rejects an oversized body; binds on descriptions, BATCH on titles
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function chunk(texts: string[]): string[][] {
  const out: string[][] = []
  let cur: string[] = [], n = 0
  for (const t of texts) {
    if (cur.length && (cur.length >= BATCH || n + t.length > MAX_CHARS)) { out.push(cur); cur = []; n = 0 }
    cur.push(t); n += t.length
  }
  if (cur.length) out.push(cur)
  return out
}

/**
 * One batch through the self-hosted model, gated.
 *
 * ⛔ THE GATE IS NOT OPTIONAL HERE — IT IS STRICTER THAN THE REQUEST PATH NEEDS. This script does
 * not fill a cache that can be evicted; it MOVES COLUMNS, writing straight into `title` and
 * `description`, which useLocalized() prefers over every other source. A hallucination written
 * here is what every reader sees, forever, with no way back. So a refused string is simply LEFT
 * ALONE — the row keeps its Vietnamese in both slots (visibly untranslated, obviously wrong to a
 * human, and re-selectable by a later run) rather than being given confident nonsense.
 *
 * ⚠️ SAME GATE AS THE REQUEST PATH, imported rather than re-implemented (src/lib/mt-gate.ts).
 * Two copies of "which translations are trustworthy" is how one of them quietly stops rejecting.
 */
async function localChunk(batch: string[], source: 'vi' | 'en', target: 'en' | 'vi'): Promise<Map<string, string> | null> {
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt) await sleep(2 ** attempt * 1000)
    try {
      const res = await fetch(`${MT_URL}/translate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texts: batch, source, target }),
        // The box model runs on 4 shared cores at ~300 chars/sec; a full batch is minutes, and
        // this is a background job where waiting costs nothing and giving up costs money.
        signal: AbortSignal.timeout(900_000),
      })
      if (!res.ok) { if (res.status >= 500) continue; console.error(`  mt HTTP ${res.status}`); return null }
      const j = await res.json() as { translations?: unknown }
      const tr = j?.translations
      // ⛔ A RESPONSE OF A DIFFERENT LENGTH IS MISALIGNED — pairing batch[i] with tr[i] would
      // write one listing's text into another's columns, permanently.
      if (!Array.isArray(tr) || tr.length !== batch.length) {
        console.error(`  mt misaligned: sent ${batch.length}, got ${Array.isArray(tr) ? tr.length : 'none'} — batch skipped`)
        return null
      }
      const map = new Map<string, string>()
      let refused = 0
      batch.forEach((src, i) => {
        const v = tr[i]
        if (typeof v !== 'string') { refused++; return }
        if (gateTranslation(src, v, target, source)) { refused++; return }
        map.set(src, v)
      })
      if (refused) console.log(`  gate refused ${refused}/${batch.length} (left untranslated, not guessed)`)
      return map
    } catch (e) {
      if (attempt === 3) { console.error(`  mt failure after 4 attempts: ${(e as Error).message}`); return null }
    }
  }
  return null
}

/**
 * One paid batch. Returns null instead of throwing so the caller keeps what it has already
 * committed — a thrown fetch (DNS blip, ECONNRESET, the 60s timeout) used to abort the whole run.
 */
async function googleChunk(batch: string[], source: 'vi' | 'en', target: 'en' | 'vi'): Promise<Map<string, string> | null> {
  for (let attempt = 0; attempt < 6; attempt++) {
    if (attempt) await sleep(2 ** attempt * 1000) // a limit that just tripped trips again immediately
    try {
      const res = await fetch(`https://translation.googleapis.com/language/translate/v2?key=${KEY}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: batch, source, target, format: 'text' }),
        signal: AbortSignal.timeout(60_000),
      })
      if (!res.ok) {
        if (res.status === 403 || res.status === 429 || res.status >= 500) continue // retryable
        console.error(`  HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
        return null
      }
      const j = await res.json() as { data?: { translations?: { translatedText: string }[] } }
      const tr = j?.data?.translations
      // ⛔ A RESPONSE OF A DIFFERENT LENGTH IS MISALIGNED. Pairing batch[i] with tr[i] would store
      // one listing's text under another's hash — permanently, in a cache every page reads.
      if (!Array.isArray(tr) || tr.length !== batch.length) {
        console.error(`  misaligned response: sent ${batch.length}, got ${Array.isArray(tr) ? tr.length : 'none'} — batch skipped`)
        return null
      }
      const map = new Map<string, string>()
      batch.forEach((src, i) => { const v = tr[i]?.translatedText; if (v) map.set(src, decode(v)) })
      return map
    } catch (e) {
      if (attempt === 5) { console.error(`  network failure after 6 attempts: ${(e as Error).message}`); return null }
    }
  }
  return null
}

/**
 * Free first, paid only if the box model is not configured.
 * ⚠️ NOT paid-as-a-fallback-on-failure: a local failure means the server is down or the gate
 * refused, and quietly spending $315 because a container was restarting is not a decision this
 * script should make on its own. Fix the box, re-run — the run is idempotent.
 */
async function translateChunk(batch: string[], source: 'vi' | 'en', target: 'en' | 'vi'): Promise<Map<string, string> | null> {
  if (MT_URL) return localChunk(batch, source, target)
  return googleChunk(batch, source, target)
}

/** Fill the shared cache so other surfaces read it instead of paying again. Never overwrites. */
async function writeCache(map: Map<string, string>, target: 'en' | 'vi') {
  const rows = Array.from(map.entries())
  for (let i = 0; i < rows.length; i += 500) {
    const slice = rows.slice(i, i + 500)
    await db.$executeRawUnsafe(
      `insert into "Translation" (id, hash, target, value, "createdAt") values ${
        slice.map((_, j) => `($${j * 4 + 1},$${j * 4 + 2},$${j * 4 + 3},$${j * 4 + 4},now())`).join(',')
      } on conflict (hash, target) do nothing`,
      ...slice.flatMap(([src, val]) => [crypto.randomUUID(), sha1(src), target, val]),
    )
  }
}

type Row = { id: string; title: string; description: string; titleVi: string | null; descriptionVi: string | null }
/** One unit of work: this row's `field` needs `target`, and `source` is the text to send. */
type Job = { row: Row; field: 'title' | 'description'; source: string; target: 'en' | 'vi'; cacheOnly?: true }

/** Read any cached values for these sources so a resumed run pays only for what is missing. */
async function cached(sources: string[], target: 'en' | 'vi'): Promise<Map<string, string>> {
  const uniq = Array.from(new Set(sources))
  const out = new Map<string, string>()
  for (let i = 0; i < uniq.length; i += 1000) {
    const slice = uniq.slice(i, i + 1000)
    const byHash = new Map(slice.map((s) => [sha1(s), s]))
    const hit = await db.translation.findMany({ where: { target, hash: { in: [...byHash.keys()] } }, select: { hash: true, value: true } })
    for (const h of hit) { const src = byHash.get(h.hash); if (src && h.value) out.set(src, h.value) }
  }
  return out
}

async function main() {
  /**
   * ⛔ IMPORTED STOREFRONTS BY DEFAULT, BECAUSE THAT IS WHAT EVERY MEASUREMENT HERE IS ABOUT. An
   * unscoped run rewrites a HUMAN seller's own words: their Vietnamese title is replaced by machine
   * English and demoted to `titleVi`, a column the post wizard cannot edit — so they open their
   * listing and find English they never wrote, and updateListingCore nulls the original on their
   * next real edit. An imported catalogue has no author to wrong; a person does. `--include-owned`
   * is there for the deliberate case, and it has to be typed.
   */
  const where: Record<string, unknown> = INCLUDE_OWNED ? {} : { seller: { ownerId: null } }
  if (SELLER) {
    const s = await db.seller.findFirst({ where: { name: SELLER }, select: { id: true } })
    if (!s) { console.error(`no storefront "${SELLER}"`); process.exit(1) }
    where.sellerId = s.id
  }
  const all: Row[] = await db.listing.findMany({
    where, select: { id: true, title: true, description: true, titleVi: true, descriptionVi: true },
    orderBy: { createdAt: 'desc' },
  })
  console.log(`scanned ${all.length} listings${SELLER ? ` for ${SELLER}` : ''}\n`)

  const buckets: Record<string, number> = {}
  const bump = (k: string) => { buckets[k] = (buckets[k] || 0) + 1 }

  // ── Build the job list ────────────────────────────────────────────────────────────────────────
  const jobs: Job[] = []
  for (const r of all) {
    for (const field of ['title', 'description'] as const) {
      const viField = field === 'title' ? 'titleVi' : 'descriptionVi'
      const primary = r[field]
      const secondary = r[viField]
      const pLang = classify(primary)
      bump(`${field} primary=${pLang}`)

      if (pLang === 'VI') {
        // Vietnamese is in the English slot. Translate it out — but ONLY if the original survives:
        // either the *Vi column is empty (we fill it) or it already holds this exact string.
        const preservable = !secondary || secondary === primary
        if (!preservable) { bump(`${field} SKIPPED (original would be lost)`); continue }
        jobs.push({ row: r, field, source: primary, target: 'en' })
      } else if (pLang === 'EN') {
        // English in the primary slot. The Vietnamese slot needs filling if it is empty OR if it
        // holds text that is not Vietnamese — the poisoning the old script left behind.
        const sLang = classify(secondary)
        if (sLang === 'VI') continue                       // already correct
        if (secondary && sLang === 'UNKNOWN') continue      // not provably wrong; do not touch
        if (secondary && secondary !== primary) continue    // a human or another pass put it there
        if (secondary) bump(`${field} REPAIR (${viField} held non-Vietnamese)`)
        jobs.push({ row: r, field, source: primary, target: 'vi' })
      } else if (pLang === 'UNKNOWN') {
        // Tier 2 — cache-only. Safe ONLY when the renderer itself calls this text non-English,
        // because that is the exact condition under which useLocalized reads i18n.en at all.
        if (detectContentLang(primary)) jobs.push({ row: r, field, source: primary, target: 'en', cacheOnly: true })
        else bump(`${field} UNREACHABLE (renderer sees no language; shown verbatim to everyone)`)
      }
      // EMPTY: nothing to translate.
    }
  }

  for (const [k, v] of Object.entries(buckets).sort()) console.log(`  ${String(v).padStart(6)}  ${k}`)
  console.log()

  // ── Cost, after removing anything already cached ──────────────────────────────────────────────
  const pre = { en: await cached(jobs.filter((j) => j.target === 'en').map((j) => j.source), 'en'),
                vi: await cached(jobs.filter((j) => j.target === 'vi').map((j) => j.source), 'vi') }
  const todo = jobs.filter((j) => !pre[j.target].has(j.source))
  const free = jobs.length - todo.length
  const uniqChars = (js: Job[]) => Array.from(new Set(js.map((j) => j.source))).reduce((n, s) => n + s.length, 0)
  let chars = 0
  for (const [k, js] of Object.entries({
    'name  VI->EN  (moves columns)': todo.filter((j) => j.field === 'title' && j.target === 'en' && !j.cacheOnly),
    'descr VI->EN  (moves columns)': todo.filter((j) => j.field === 'description' && j.target === 'en' && !j.cacheOnly),
    'name  VI->EN  (cache only)   ': todo.filter((j) => j.field === 'title' && j.target === 'en' && j.cacheOnly),
    'descr VI->EN  (cache only)   ': todo.filter((j) => j.field === 'description' && j.target === 'en' && j.cacheOnly),
    'name  EN->VI  (fills titleVi)': todo.filter((j) => j.field === 'title' && j.target === 'vi'),
    'descr EN->VI  (fills descVi) ': todo.filter((j) => j.field === 'description' && j.target === 'vi'),
  })) { const c = uniqChars(js); chars += c; console.log(`  ${k}  ${String(js.length).padStart(6)} jobs  ${String(c).padStart(9)} unique chars`) }
  console.log(`\n  ${free} jobs already in the translation cache (free)`)
  // ⚠️ REPORT THE PRICE OF THE PROVIDER THAT WILL ACTUALLY RUN. Printing $315.59 for a run that
  // costs nothing trains whoever reads it to ignore the number — and the reverse mistake, printing
  // "free" while Google is the configured provider, is worse.
  if (MT_URL) {
    console.log(`  TOTAL ${chars.toLocaleString()} chars -> $0.00 (self-hosted at ${MT_URL}; ~${Math.round(chars / 300 / 3600)}h at the measured ~300 chars/sec)`)
    console.log(`         for reference, the same work on Google would be about $${(chars / 1e6 * 20).toFixed(2)} at $20/M`)
  } else {
    console.log(`  TOTAL ${chars.toLocaleString()} chars -> about $${(chars / 1e6 * 20).toFixed(2)} at $20/M (set MT_LOCAL_URL to make this free)`)
  }

  if (AUDIT) { await audit(); await db.$disconnect(); return }
  if (!APPLY) { console.log('\nDRY RUN — re-run with --apply.'); await db.$disconnect(); return }

  // ── Apply, committing per chunk so a crash keeps everything already paid for ───────────────────
  const pending = new Map<string, Record<string, string>>() // listingId -> partial update
  const stage = (j: Job, value: string) => {
    if (j.cacheOnly) return // the Translation row IS the fix; the listing row is deliberately untouched
    const r = j.row
    const viField = j.field === 'title' ? 'titleVi' : 'descriptionVi'
    const d = pending.get(r.id) || {}
    if (j.target === 'en') {
      if (value === j.source) return                  // provider handed back the input; nothing to do
      if (!r[viField as 'titleVi' | 'descriptionVi']) d[viField] = j.source // preserve the original FIRST
      d[j.field] = value
    } else {
      if (value === j.source) return
      d[viField] = value
    }
    if (Object.keys(d).length) pending.set(r.id, d)
  }
  const flush = async () => {
    for (const [id, data] of pending) await db.listing.update({ where: { id }, data })
    const n = pending.size; pending.clear(); return n
  }

  // Cached values cost nothing but still need writing to the rows.
  for (const j of jobs) { const hit = pre[j.target].get(j.source); if (hit) stage(j, hit) }
  let written = await flush()
  console.log(`\n  ${written} rows written from cache`)

  let spent = 0, failed = 0
  for (const target of ['en', 'vi'] as const) {
    for (const field of ['title', 'description'] as const) {
      const js = todo.filter((j) => j.target === target && j.field === field)
      if (!js.length) continue
      const source = target === 'en' ? 'vi' : 'en'
      const bySource = new Map<string, Job[]>()
      for (const j of js) { const a = bySource.get(j.source) || []; a.push(j); bySource.set(j.source, a) }
      const parts = chunk([...bySource.keys()])
      console.log(`\n  ${field} ${source}->${target}: ${bySource.size} unique strings in ${parts.length} batches`)
      let done = 0
      for (const batch of parts) {
        const map = await translateChunk(batch, source, target)
        await sleep(250)
        if (!map) { failed += batch.length; continue }
        await writeCache(map, target)                   // bank the spend BEFORE touching rows
        for (const [src, val] of map) for (const j of bySource.get(src) || []) stage(j, val)
        written += await flush()                        // then commit the rows for this batch
        spent += batch.reduce((n, s) => n + s.length, 0)
        done += batch.length
        if (parts.length > 4) console.log(`    ${done}/${bySource.size}  (${written} rows written)`)
      }
    }
  }

  // ⛔ "BOUGHT" IS A CLAIM ABOUT MONEY AND MUST NOT BE MADE WHEN NONE CHANGED HANDS. With
  // MT_LOCAL_URL set this run cannot reach a paid provider at all, so printing "6,859 chars
  // bought (~$0.14)" reported a spend that did not happen — the mirror of the bug fixed in
  // src/lib/translate.ts, where the counters read $0 for work that WAS paid for. Same rule
  // either way: name the provider that actually did the work.
  const tail = failed ? `, ${failed} strings FAILED — re-run to retry` : ''
  console.log(
    MT_URL
      ? `\nAPPLIED: ${written} row updates, ${spent.toLocaleString()} chars translated in the box — $0.00 (Google would have been ~$${(spent / 1e6 * 20).toFixed(2)})${tail}`
      : `\nAPPLIED: ${written} row updates, ${spent.toLocaleString()} chars bought (~$${(spent / 1e6 * 20).toFixed(2)})${tail}`,
  )
  console.log('\nNEXT, all three:')
  console.log('  1. npx tsx scripts/rebuild-search-text.ts --all --force --apply   <- --force is REQUIRED')
  console.log('  2. node scripts/purge-isr-listings.mjs')
  console.log('  3. npx tsx scripts/backfill-bilingual.ts --audit')
  await db.$disconnect()
}

/** Post-run correctness check: nothing should be left in the wrong slot. No writes. */
async function audit() {
  const rows: Row[] = await db.listing.findMany({ select: { id: true, title: true, description: true, titleVi: true, descriptionVi: true } })
  const bad: Record<string, string[]> = {}
  const flag = (k: string, id: string) => { (bad[k] ||= []).push(id) }
  for (const r of rows) {
    /**
     * ⛔ THE OBVIOUS ASSERTIONS ARE FALSE POSITIVES, AND EACH WAS REMOVED ONLY AFTER SAMPLING IT.
     * `classify(titleVi) === 'EN'` flagged 468 titles; every one sampled was real Vietnamese
     * carrying no diacritic at all ("Tai nghe Bluetooth True Wireless SoundPEATS"; "CPU AMD Ryzen 7
     * 7700 (KHAY)" against an English "(TRAY)"). Density cannot see that register — stated as a
     * limitation at the top of this file, and an audit that forgets its own gate's limits invents
     * work. `!titleVi` flagged 825 more whose cached Vietnamese is BYTE-IDENTICAL to the source
     * ("Tai nghe Sony MDR-EX155AP"): a name that is the same in both languages needs no second copy.
     * What remains are the conditions that cannot be explained away.
     */
    // A *Vi column that is a byte copy of a provably-English primary is the poisoning shape.
    if (r.titleVi && r.titleVi === r.title && classify(r.title) === 'EN' && detectContentLang(r.title) === null)
      flag('titleVi is a copy of an English title', r.id)
    if (r.descriptionVi && r.descriptionVi === r.description && classify(r.description) === 'EN' && detectContentLang(r.description) === null)
      flag('descriptionVi is a copy of an English description', r.id)
    // Vietnamese still in the English slot, with nothing preserving the original.
    if (classify(r.title) === 'VI' && !r.titleVi) flag('title still Vietnamese, titleVi empty', r.id)
    if (classify(r.description) === 'VI' && !r.descriptionVi) flag('description still Vietnamese, descriptionVi empty', r.id)
    // Reachable by neither the column move nor the cache — reported so coverage is never implied.
    if (classify(r.title) === 'UNKNOWN' && !detectContentLang(r.title)) flag('title reachable by neither mechanism (shown verbatim)', r.id)
    if (classify(r.description) === 'UNKNOWN' && !detectContentLang(r.description)) flag('description reachable by neither mechanism (shown verbatim)', r.id)
  }
  console.log('\n── AUDIT ──')
  if (!Object.keys(bad).length) console.log('  clean')
  for (const [k, ids] of Object.entries(bad).sort()) console.log(`  ${String(ids.length).padStart(6)}  ${k}   e.g. ${ids.slice(0, 3).join(' ')}`)
}
main().catch((e) => { console.error(e); process.exit(1) })
