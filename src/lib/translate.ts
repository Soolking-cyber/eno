import 'server-only'
import crypto from 'crypto'
import { db } from './db'
import { detectContentLang } from './detect-lang'
import { LANGS, type Lang } from './i18n/langs'
import { rateLimit } from '@/lib/ratelimit'

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

// A word-free, universal string — a bare year, a phone number, an ASCII price ("12000000"),
// pure emoji or symbols — is identical in every language, so it must never reach the paid provider.
// Two things still count as translatable: (1) any script's LETTERS (`\p{L}` — Latin, CJK, Hangul,
// Cyrillic, Thai, Arabic…), so real content always translates; (2) NATIVE-SCRIPT NUMERALS (Thai
// ๑๒๓, Khmer ១២៣, Devanagari १२३ — Unicode category Nd but not ASCII 0-9), which DO change per
// language (an English reader needs 123), so they must not be skipped. Used by translateBatch AND
// uncachedStats so the billing estimate and the actual paid work stay in lock-step.
function worthTranslating(t: string): boolean {
  if (!t || t.trim().length === 0) return false
  if (/\p{L}/u.test(t)) return true
  return /[^\P{Nd}0-9]/u.test(t) // a decimal digit that is NOT an ASCII 0-9 ⇒ a native-script numeral
}
const translatableUniq = (texts: string[]): string[] => Array.from(new Set(texts.filter(worthTranslating)))

// Any Vietnamese diacritic, not just the language-exclusive ones. Used ONLY to judge whether
// a WORD looks Vietnamese-shaped, so that a long undiacriticked passage can be spotted.
const VI_DIACRITIC =
  /[àáảãạâầấẩẫậăằắẳẵặèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđÀÁẢÃẠÂẦẤẨẪẬĂẰẮẲẴẶÈÉẺẼẸÊỀẾỂỄỆÌÍỈĨỊÒÓỎÕỌÔỒỐỔỖỘƠỜỚỞỠỢÙÚỦŨỤƯỪỨỬỮỰỲÝỶỸỴĐ]/

// Scripts whose presence genuinely establishes ONE language. Hangul is Korean-exclusive and
// Thai script is Thai-exclusive, so a high ratio of either really does certify the string.
//
// ⚠️ 'ja' and 'ru' are deliberately ABSENT — decisions, not omissions. Both share their script
// with other languages, so a script test cannot certify them (both found by codex reviewing
// this change):
//  · Japanese shares Han with Chinese, and detectContentLang probes kana BEFORE Han, so Chinese
//    carrying one decorative kana ("價格非常優惠 の" — ordinary CJK marketing copy) reports 'ja'.
//    Measured, that string is 6.7% kana and a real kanji-heavy Japanese title is 9%: no gap, so
//    no defensible threshold.
//  · Cyrillic is not Russian. Bulgarian, Serbian and Macedonian are written in it, and Bulgarian
//    in particular shares essentially all of Russian's letters — a veto list of Ukrainian
//    letters does not exclude it.
// In both cases a wrong skip would serve a reader text in a language they did not ask for, and
// the ambiguity is not narrow or rare, so ja→ja and ru→ru keep paying.
const SCRIPT_OF: Record<string, RegExp> = {
  // \u escapes, not literal characters: a multibyte range is unreadable in a diff and does not
  // survive every review pipeline intact (one reviewer saw `th` as /[-]/ and reported it broken).
  ko: /[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7A3]/u, // Hangul jamo + syllables
  th: /[\u0E00-\u0E7F]/u, // Thai
}

/** Longest run of consecutive words carrying NO Vietnamese diacritic. */
function longestUndiacritickedRun(text: string): number {
  let run = 0
  let max = 0
  for (const word of text.split(/\s+/)) {
    if (!/\p{L}/u.test(word)) continue // pure digits/punctuation break nothing
    if (VI_DIACRITIC.test(word)) run = 0
    else if (++run > max) max = run
  }
  return max
}

/**
 * Is `text` ALREADY in `target`, as a WHOLE? Then translating it is a paid no-op.
 *
 * warmTranslations pushes every listing string into each of EAGER_WARM_LANGS, and 'vi' is one
 * of them — so on a Vietnamese-first marketplace the vi→vi leg was billed on every create and
 * edit and returned the input. (The mirror case, EN source → 'en', was already guarded at the
 * warm call site; this closes the other direction, for every caller rather than just warm.)
 *
 * ⚠️ WHAT THIS DOES AND DOES NOT PROVE. detectContentLang needs a SINGLE diagnostic character
 * to name a language — by design, since it exists to add a WCAG lang attribute. Reused naively
 * as "this string needs no translation", one Vietnamese word in an otherwise English
 * description ("Brand new sealed iPhone, worldwide shipping, cảm ơn") would skip the whole
 * string and serve a Vietnamese reader untranslated English.
 *
 * So detection is only the entry condition, and each language then applies a DOMINANCE test.
 * Be clear about the strength of that: dominance shows the string is mostly the detected
 * language; it does NOT prove the string is monolingual, and therefore does not prove
 * translation is unnecessary (codex, reviewing this change — the tests below reduce
 * mixed-language false positives, they do not eliminate them). The tests are:
 *  · Latin-script Vietnamese cannot be certified by script, so it is certified by SHAPE: real
 *    Vietnamese prose is densely diacriticked, and its longest undiacriticked run measures 1-2
 *    words (model names, "pin", "view"), whereas a mostly-English string measures 8-10. The
 *    cut-off sits in that gap with room to spare.
 *  · The non-Latin scripts are certified by RATIO — at least half the letters must actually be
 *    in the detected script, so an English sentence with one Korean word is not "Korean".
 *  · null (plain Latin) is never skipped: the detector refuses to distinguish en/fr/ms/km, so
 *    neither can we.
 *  · 'zh' is never skipped even when it matches, because the detector reports Han script as
 *    'zh' while the supported target is zh-Hans — Han text may be TRADITIONAL, and
 *    Traditional→Simplified is real conversion work.
 *
 * ⚠️ THE TRADE THIS MAKES, stated plainly so it can be reversed on purpose rather than by
 * accident. Because these are dominance tests and not language identification, a MIXED string
 * can still be skipped while carrying a substantial foreign-language portion — most obviously
 * one that alternates word by word ("Brand new cảm ơn sealed iPhone rất đẹp worldwide shipping
 * giá tốt"), which trips no long undiacriticked run, but in principle any mixed Korean/English
 * or Thai/English string that clears 50% too.
 *
 * And the scope is every caller, not just the warm path: this sits inside translateBatch, so it
 * covers cache warming, the nightly cron, /api/translate and live chat translation. The failure
 * mode is a reader seeing part of a string in a language they did not ask for.
 *
 * That is accepted here as a deliberate best-effort cost reduction — the alternative is billing
 * every vi→vi leg on every listing create and edit — and it is the right call only so long as
 * "occasionally leaving mixed-language content untranslated" is acceptable. If it ever is not,
 * the fix is NOT to tune these thresholds: delete the skip and pay, or add real language
 * identification. Do not let this drift into being treated as a correctness guarantee.
 */
function alreadyInTarget(text: string, target: Lang): boolean {
  const detected = detectContentLang(text)
  if (!detected || detected === 'zh') return false
  if (detected !== target.split('-')[0]) return false

  if (detected === 'vi') return longestUndiacritickedRun(text) <= 3

  const script = SCRIPT_OF[detected]
  if (!script) return false
  const letters = text.match(/\p{L}/gu)
  if (!letters?.length) return false
  return letters.filter((c) => script.test(c)).length / letters.length >= 0.5
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
export async function translateBatch(
  texts: string[],
  target: Lang,
  opts?: {
    cachedOnly?: boolean
    /**
     * EPHEMERAL mode: translate, but do NOT write the result into the shared `Translation`
     * table. Reads still hit it (a cache hit costs nothing and reveals nothing).
     *
     * ⚠️ Required for PRIVATE text — live chat translation (POST /api/messages/translate).
     * The cache is keyed by `sha1(source)` with NO owner column and is read by every page
     * for every user, so a written row is effectively public: anyone who can guess or
     * replay a message's exact text could confirm it, and the row outlives the message
     * (chat deletion would not evict it). The provider still sees the text — that is
     * inherent to translating it — but our own database must not accumulate a permanent,
     * unowned copy of people's conversations.
     */
    skipWrite?: boolean
    /**
     * Optional out-param: set `providerFailed = true` if any chunk came back null or
     * misaligned, i.e. the returned text is SOURCE FALLBACK rather than a translation.
     *
     * Without this a caller cannot tell "the provider is down" from "this text translates
     * to itself" — both look like output === input. A live request needs that distinction
     * to answer retryably instead of handing back originals the client would cache as
     * final (codex + Gemini, review of the chat-translate endpoint).
     */
    stats?: { providerFailed: boolean }
    /**
     * Attribution tag for the `[translate:spend]` billable-char log — 'warm' | 'warm-cron' |
     * 'api' | 'chat' | 'health' | … Lets a future cost spike be diagnosed by source in the logs,
     * INCLUDING ephemeral chat, which never lands in the cache table a SQL query could tally.
     */
    source?: string
  },
): Promise<string[]> {
  // Collect the unique strings that actually need translating (letter-free strings — prices,
  // phone numbers, emoji — are identical in every language and never billed; see worthTranslating).
  const uniq = translatableUniq(texts)
  const out = new Map<string, string>() // source text -> translated

  if (uniq.length === 0) return texts

  // 1) Pull whatever is already cached.
  const hashes = uniq.map(hash)
  const cached = await db.translation.findMany({ where: { target, hash: { in: hashes } } })
  const cachedByHash = new Map(cached.map((c) => [c.hash, c.value]))
  // Anything not cached is a candidate for paid work — EXCEPT a string already in the target
  // language, which resolves to itself for free: no provider call, and no cache row (an
  // identity row would be pure noise, and skipWrite callers must persist nothing anyway).
  //
  // The same-language test sits AFTER the cache read, deliberately. A string may have been
  // translated to something better than itself on an earlier pass, and a cached value must
  // always beat our own guess — testing first would discard that translation and hand back
  // source text.
  //
  // A skip must NOT set stats.providerFailed: "translates to itself" is exactly the case that
  // flag exists to distinguish from "the provider is down", so a live caller still answers 200
  // rather than 503.
  const misses: string[] = []
  for (const t of uniq) {
    const hit = cachedByHash.get(hash(t))
    if (hit != null) out.set(t, hit)
    else if (alreadyInTarget(t, target)) out.set(t, t)
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
      let billedChars = 0
      let billedStrings = 0
      for (const chunk of chunkTexts(misses)) {
        const translated = await translateChunk(chunk, target)
        // A response with a DIFFERENT length than the request is misaligned — pairing
        // translated[i] with chunk[i] would cache wrong translations forever (audit).
        if (!translated || translated.length !== chunk.length) {
          for (const t of chunk) out.set(t, t) // failure/misalignment → source fallback
          if (opts?.stats) opts.stats.providerFailed = true
          continue
        }
        billedChars += chunk.reduce((n, s) => n + s.length, 0) // this chunk reached the paid provider
        billedStrings += chunk.length
        await Promise.all(
          chunk.map(async (src, i) => {
            const value = translated[i] ?? src
            out.set(src, value)
            // skipWrite = private text (chat): serve the translation, persist nothing.
            if (opts?.skipWrite) return
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
      // Per-source billable-char attribution (structured log): a future cost spike is one
      // `[translate:spend]` grep away, source-tagged — including ephemeral chat, which never
      // reaches the cache table a SQL tally could see.
      if (billedChars > 0) {
        console.log('[translate:spend]', JSON.stringify({ source: opts?.source ?? 'other', target, chars: billedChars, strings: billedStrings }))
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
  // Same-language strings are excluded for the same reason worthTranslating's output is: this
  // estimate and the actual paid work must stay in LOCK-STEP (see worthTranslating). Counting
  // a string translateBatch will now skip would over-state the bill and could reject a batch
  // that is in fact free.
  const uniq = translatableUniq(texts).filter((t) => !alreadyInTarget(t, target))
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
/** Global hourly ceiling on automatic warm-translation batches (all accounts combined).
 *  Sized well above organic publishing — ~500 listings/hour — so it only ever bites on a
 *  runaway or an abuse burst, never on real sellers. */
const WARM_GLOBAL_HOURLY = 500

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
  // ⚠️ A GLOBAL, FAIL-CLOSED CEILING ON THE ONLY UNCAPPED PAID CALL IN THE PUBLISH PATH.
  // This runs from `after()` on EVERY listing create and bulk-import row, and it calls Google/Azure
  // translate once per language — six of them. Until now nothing bounded it: chargeCharBudget()
  // lives in /api/translate and guards the user-facing route only, so the automatic warm had no
  // budget at all. The per-account publish limiter is not a substitute, because it fails OPEN by
  // design (posting is the marketplace's core action and a limiter blip must not stop sellers).
  // So the breaker goes on the SPEND instead of the post — the same shape semantic-rank.ts and
  // ai-guard.ts already use. `strict: true` means an rl_check outage SKIPS the warm rather than
  // un-capping it; the cost is only that these strings translate on demand later (still cached),
  // which is exactly the degrade path `cachedOnly` already exists for.
  const budget = await rateLimit('warm-translate-global', 'global', WARM_GLOBAL_HOURLY, '1 h', { strict: true })
  if (!budget.success) return
  for (const l of langs) {
    try { await translateBatch(clean, l, { source: 'warm' }) } catch { /* best-effort per language */ }
  }
  // Vietnamese-authored (or any non-Latin) content must ALSO warm INTO English —
  // the EN UI renders source text verbatim otherwise (user report 2026-07-14:
  // vi description shown raw under the English UI). Gated by script detection so
  // English source never pays for an EN→EN round trip; runs regardless of the
  // langs param so the nightly cron gets it too.
  const nonEn = clean.filter((t) => detectContentLang(t) !== null)
  if (nonEn.length > 0) {
    try { await translateBatch(nonEn, 'en', { source: 'warm' }) } catch { /* best-effort */ }
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
