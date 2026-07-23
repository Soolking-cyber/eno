import 'server-only'
import crypto from 'crypto'
import { db } from './db'
import { detectContentLang } from './detect-lang'
import { LANGS, type Lang } from './i18n/langs'

// Supported-language roster: canonical definition lives in the isomorphic
// @/lib/i18n/langs; re-exported here so existing importers keep working.
export { LANGS }
export type { Lang }

// Azure AI Translator language codes. Almost all match our internal codes 1:1
// (our codes are already Azure-canonical, e.g. zh-Hans — NOT Google's zh-CN).
const AZURE_CODE: Record<Lang, string> = {
  en: 'en', vi: 'vi', 'zh-Hans': 'zh-Hans', ko: 'ko',
  ja: 'ja', ru: 'ru', km: 'km', ms: 'ms', th: 'th', fr: 'fr', hi: 'hi',
}


const AZURE_KEY = process.env.AZURE_TRANSLATOR_KEY
const AZURE_REGION = process.env.AZURE_TRANSLATOR_REGION
const AZURE_ENDPOINT = process.env.AZURE_TRANSLATOR_ENDPOINT || 'https://api.cognitive.microsofttranslator.com'

// Google Cloud Translation (v2) — PRIMARY provider; Azure stays as a fallback.
const GOOGLE_KEY = process.env.GOOGLE_TRANSLATE_API_KEY
const GOOGLE_ENDPOINT = 'https://translation.googleapis.com/language/translate/v2'

// Google v2 codes match ours except Simplified Chinese (Google uses zh-CN).
const GOOGLE_CODE: Record<Lang, string> = {
  en: 'en', vi: 'vi', 'zh-Hans': 'zh-CN', ko: 'ko', ja: 'ja',
  ru: 'ru', km: 'km', ms: 'ms', th: 'th', fr: 'fr', hi: 'hi',
}

// Keep chunks safe for BOTH providers (Google ≤128 items/request; Azure ≤1000).
const MAX_ITEMS = 100
const MAX_CHARS = 28000

function hash(text: string): string {
  return crypto.createHash('sha1').update(text).digest('hex')
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

let warnedNoKey = false

/** Split a list of strings into Azure-safe chunks (by item count AND char total). */
function chunkTexts(texts: string[]): string[][] {
  const chunks: string[][] = []
  let cur: string[] = []
  let curChars = 0
  for (const t of texts) {
    const len = t.length
    if (cur.length > 0 && (cur.length >= MAX_ITEMS || curChars + len > MAX_CHARS)) {
      chunks.push(cur)
      cur = []
      curChars = 0
    }
    cur.push(t)
    curChars += len
  }
  if (cur.length) chunks.push(cur)
  return chunks
}

/**
 * Translate one chunk into a single target via Azure, with retry/backoff on
 * transient 429/5xx. Returns translated strings in input order, or null on a
 * hard failure (caller falls back to source text).
 */
async function azureTranslate(chunk: string[], target: Lang): Promise<string[] | null> {
  const url = `${AZURE_ENDPOINT}/translate?api-version=3.0&to=${AZURE_CODE[target]}`
  const headers: Record<string, string> = {
    'Ocp-Apim-Subscription-Key': AZURE_KEY!,
    'Content-Type': 'application/json; charset=UTF-8',
  }
  // Multi-service / regional keys require the region header (omitting it 401s).
  if (AZURE_REGION) headers['Ocp-Apim-Subscription-Region'] = AZURE_REGION
  const body = JSON.stringify(chunk.map((t) => ({ Text: t })))

  let lastStatus = 0
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url, { method: 'POST', headers, body })
      lastStatus = res.status
      // 429 = F0 rate throttle (~33k chars/min), 5xx = transient. Honor the
      // server's Retry-After, but cap the wait so a live request never blocks
      // long (it falls back to source text and fills in on the next load).
      if (res.status === 429 || res.status >= 500) {
        const retryAfter = Number(res.headers.get('retry-after')) || 0
        const wait = Math.min(retryAfter > 0 ? retryAfter * 1000 : 400 * (attempt + 1), 5000)
        await sleep(wait)
        continue
      }
      if (!res.ok) {
        console.error('[translate] azure error', res.status, await res.text().catch(() => ''))
        return null
      }
      const json = await res.json()
      // Parallel array; one target per request, so translations[0].
      return chunk.map((src, i) => json?.[i]?.translations?.[0]?.text ?? src)
    } catch (err) {
      if (attempt === 3) {
        console.error('[translate] azure request failed', err)
        return null
      }
      await sleep(400 * (attempt + 1))
    }
  }
  console.warn(`[translate] azure gave up after retries (last status ${lastStatus}) — source fallback for ${chunk.length} strings`)
  return null
}

// Google's REST response HTML-escapes some chars even with format:text — undo it.
function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&')
}

/** Translate one chunk into a single target via Google Cloud Translation v2, with
 *  retry/backoff on 429/5xx. Returns translated strings in order, or null on a
 *  hard failure (caller falls back to Azure, then source text). */
async function googleTranslate(chunk: string[], target: Lang): Promise<string[] | null> {
  const body = JSON.stringify({ q: chunk, target: GOOGLE_CODE[target], format: 'text' })
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(`${GOOGLE_ENDPOINT}?key=${GOOGLE_KEY}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
      })
      if (res.status === 429 || res.status >= 500) { await sleep(Math.min(400 * (attempt + 1), 5000)); continue }
      if (!res.ok) { console.error('[translate] google error', res.status, await res.text().catch(() => '')); return null }
      const json = await res.json()
      const items = json?.data?.translations
      if (!Array.isArray(items)) return null
      return chunk.map((src, i) => decodeEntities(items[i]?.translatedText ?? src))
    } catch (err) {
      if (attempt === 3) { console.error('[translate] google request failed', err); return null }
      await sleep(400 * (attempt + 1))
    }
  }
  return null
}

/** Provider dispatch: Google first (preferred), Azure as fallback. */
async function translateChunk(chunk: string[], target: Lang): Promise<string[] | null> {
  if (GOOGLE_KEY) {
    const g = await googleTranslate(chunk, target)
    if (g) return g
  }
  if (AZURE_KEY) return azureTranslate(chunk, target)
  return null
}

/**
 * Translate a batch of strings into `target`, preserving input order and
 * duplicates. Results are cached in the DB so the same source string is never
 * re-translated. If AZURE_TRANSLATOR_KEY is missing, returns inputs as-is.
 */
export async function translateBatch(texts: string[], target: Lang, opts?: { cachedOnly?: boolean }): Promise<string[]> {
  // Collect the unique, non-trivial strings that actually need translating.
  const uniq = Array.from(new Set(texts.filter((t) => t && t.trim().length > 0)))
  const out = new Map<string, string>() // source text -> translated

  if (uniq.length === 0) return texts

  // 1) Pull whatever is already cached.
  const hashes = uniq.map(hash)
  const cached = await db.translation.findMany({ where: { target, hash: { in: hashes } } })
  const cachedByHash = new Map(cached.map((c) => [c.hash, c.value]))
  const misses: string[] = []
  for (const t of uniq) {
    const hit = cachedByHash.get(hash(t))
    if (hit != null) out.set(t, hit)
    else misses.push(t)
  }

  // 2) Translate the misses via Azure (if configured), else passthrough.
  if (misses.length > 0) {
    // cachedOnly = the route's degrade path (rate-limited/budget-exhausted caller):
    // serve the free cache hits, pass misses through as source, call NO provider.
    if (opts?.cachedOnly) {
      for (const t of misses) out.set(t, t)
    } else if (!GOOGLE_KEY && !AZURE_KEY) {
      if (!warnedNoKey) {
        console.warn('[translate] no provider configured (set GOOGLE_TRANSLATE_API_KEY) — returning source text untranslated.')
        warnedNoKey = true
      }
      for (const t of misses) out.set(t, t)
    } else {
      for (const chunk of chunkTexts(misses)) {
        const translated = await translateChunk(chunk, target)
        // A response with a DIFFERENT length than the request is misaligned — pairing
        // translated[i] with chunk[i] would cache wrong translations forever (audit).
        if (!translated || translated.length !== chunk.length) {
          for (const t of chunk) out.set(t, t) // failure/misalignment → source fallback
          continue
        }
        await Promise.all(
          chunk.map(async (src, i) => {
            const value = translated[i] ?? src
            out.set(src, value)
            try {
              await db.translation.upsert({
                where: { hash_target: { hash: hash(src), target } },
                create: { hash: hash(src), target, value },
                update: { value },
              })
            } catch {
              /* cache write is best-effort */
            }
          }),
        )
      }
    }
  }

  // 3) Map back onto the original (ordered, possibly duplicated) input.
  return texts.map((t) => (t && t.trim() ? out.get(t) ?? t : t))
}

/**
 * How many UNIQUE, non-trivial strings in `texts` are NOT yet cached for `target`,
 * and their total length — i.e. the BILLABLE work this batch would trigger. The
 * public /api/translate endpoint uses this to bound paid translation WITHOUT
 * rejecting large but already-cached batches (the full UI dictionary, repeat
 * listing views), which cost nothing.
 */
export async function uncachedStats(texts: string[], target: Lang): Promise<{ count: number; chars: number }> {
  const uniq = Array.from(new Set(texts.filter((t) => t && t.trim().length > 0)))
  if (uniq.length === 0) return { count: 0, chars: 0 }
  const cached = await db.translation.findMany({
    where: { target, hash: { in: uniq.map(hash) } },
    select: { hash: true },
  })
  const cachedSet = new Set(cached.map((c) => c.hash))
  let count = 0
  let chars = 0
  for (const t of uniq) {
    if (!cachedSet.has(hash(t))) { count++; chars += t.length }
  }
  return { count, chars }
}

// EAGER warm set = the TOP visitor languages only (vi is the home market; zh/ko/ja/ru are
// the biggest inbound markets per the GSO arrival data the language list is built from).
// Warming all 10 non-EN languages on every create/edit billed ~10k chars/listing (~$0.20
// at Google's $20/M) with most of it never read. The long tail (km/ms/th/fr/hi) fills via
// the nightly warm-translations cron (which sweeps ALL languages for missing rows) or
// lazily on first view through /api/translate. Sequential to respect provider throttles.
const EAGER_WARM_LANGS: Lang[] = (['vi', 'zh-Hans', 'ko', 'ja', 'ru'] as Lang[]).filter((l) => LANGS.includes(l))

/**
 * Warm the translation cache for freshly authored content (listing title,
 * description, attribute values, location) into the TOP visitor languages, so the
 * public read path is a pure cache hit where it matters most — the nightly cron
 * completes the long tail. Best-effort and non-blocking — call from a Next.js
 * `after()` so it never delays the response.
 */
export async function warmTranslations(texts: string[], langs: Lang[] = EAGER_WARM_LANGS): Promise<void> {
  const clean = Array.from(new Set(texts.filter((t) => t && t.trim().length > 0)))
  if (clean.length === 0 || (!GOOGLE_KEY && !AZURE_KEY)) return
  for (const l of langs) {
    try { await translateBatch(clean, l) } catch { /* best-effort per language */ }
  }
  // Vietnamese-authored (or any non-Latin) content must ALSO warm INTO English —
  // the EN UI renders source text verbatim otherwise (user report 2026-07-14:
  // vi description shown raw under the English UI). Gated by script detection so
  // English source never pays for an EN→EN round trip; runs regardless of the
  // langs param so the nightly cron gets it too.
  const nonEn = clean.filter((t) => detectContentLang(t) !== null)
  if (nonEn.length > 0) {
    try { await translateBatch(nonEn, 'en') } catch { /* best-effort */ }
  }
}

/**
 * Read ALREADY-CACHED translations (NO API calls) for some source texts across every
 * language → `{ [sourceText]: { [lang]: translated } }`. A server page EMBEDS this so the
 * client renders the visitor's language SYNCHRONOUSLY — no flash, no per-request translate,
 * and no per-language cache variants (the page stays a single ISR entry). One indexed read.
 */
export async function cachedTranslations(texts: string[]): Promise<Record<string, Record<string, string>>> {
  const clean = Array.from(new Set(texts.filter((t) => t && t.trim().length > 0)))
  if (clean.length === 0) return {}
  const byHashSource = new Map(clean.map((t) => [hash(t), t]))
  const rows = await db.translation.findMany({
    where: { hash: { in: [...byHashSource.keys()] } },
    select: { hash: true, target: true, value: true },
  }).catch(() => [])
  const out: Record<string, Record<string, string>> = {}
  for (const r of rows) {
    const src = byHashSource.get(r.hash)
    if (!src) continue
    ;(out[src] ||= {})[r.target] = r.value
  }
  return out
}

/**
 * Attach `titleI18n` (pre-warmed title translations) to a list of cards so they render in the
 * visitor's language with no client fetch/flash. `onlyLang` (from the request's `lang` cookie)
 * embeds JUST that language to keep the hot feed payload tiny; omit it on ISR/SSR pages
 * (language-neutral) to embed every language. en/vi are never embedded — the source title and
 * `titleVi` already cover them, so the dominant VN traffic adds zero query/payload.
 */
export async function localizeListingTitles<T extends { title: string }>(
  listings: T[],
  onlyLang?: string,
): Promise<(T & { titleI18n?: Record<string, string> })[]> {
  if (!listings.length || onlyLang === 'en' || onlyLang === 'vi') return listings
  const map = await cachedTranslations(listings.map((l) => l.title))
  return listings.map((l) => {
    const m = map[l.title]
    if (!m) return l
    const rest: Record<string, string> = {}
    if (onlyLang) { if (m[onlyLang]) rest[onlyLang] = m[onlyLang] }
    else for (const k in m) { if (k !== 'en' && k !== 'vi') rest[k] = m[k] }
    return Object.keys(rest).length ? { ...l, titleI18n: rest } : l
  })
}
