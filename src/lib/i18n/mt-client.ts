import type { Language } from './langs'
import { looksVietnamese } from '@/lib/detect-lang'

// djb2 hash of the UI string set → cache-busts the localStorage UI dictionary when
// copy changes. A function (not a top-level const over a static import) so the large
// UI_STRINGS dictionary can be loaded LAZILY — it's only needed when prefetching a
// third language's machine translations, never for the en/vi audience — keeping
// ~19KB out of first-load JS on every page.
export function hashStrings(strings: string[]): string {
  let h = 5381
  const s = strings.join('')
  for (let i = 0; i < s.length; i++) h = (((h << 5) + h + s.charCodeAt(i)) | 0)
  return (h >>> 0).toString(36)
}

/* ============================================================
   Dynamic content translation (listing titles, descriptions, …)
   English is the source language, so en is a no-op. Other targets
   hit /api/translate (DB-cached). Calls are batched per language.
   ============================================================ */

export const trCache = new Map<string, string>() // `${lang} ${text}` -> translated
export const trInflight = new Set<string>() // `${lang} ${text}` currently being fetched (de-dupes tr() calls)
const pending: Partial<Record<Language, { text: string; resolve: (s: string) => void }[]>> = {}
let scheduled = false

// External store: any useLanguage() consumer subscribes so it repaints the
// moment a batch of inline tr() translations lands in trCache. Reliable across
// the whole tree — unlike bumping provider state.
let trVersion = 0
const trListeners = new Set<() => void>()
// Hand-authored VI dictionary — lazily imported so it never ships in the first-load bundle of
// non-Vietnamese sessions (mirrors the UI_STRINGS lazy pattern). ⚠️ It is no longer small: 2,060
// entries, 171 KB raw / 53 KB gz since 2026-09-20 — which is why it must never be inlined per page.
// Sync readers (tr/useTr) see {} until the chunk lands, then emitTrChange repaints.
// NOTE: consumers read these as ESM live bindings — only this module reassigns them.
export let viDict: Record<string, string> = {}
export const VI_RETRY_MS = 30_000
export let viLoaded = false
let viLoading: Promise<void> | null = null
export function loadViOverrides(): Promise<void> {
  if (viLoaded) return Promise.resolve()
  if (!viLoading) {
    viLoading = import('@/generated/vi-overrides').then(
      (m) => {
        viDict = m.VI_OVERRIDES
        viLoaded = true
        emitTrChange()
      },
      (e: unknown) => {
        // SERVER: forget the failure, or one bad load would fail every later Vietnamese render in this
        // process. CLIENT: keep it for VI_RETRY_MS first — every <Tr> asks, and re-arming at once
        // turned one missing chunk into ~30 requests for it (measured with the chunk blocked). After
        // the pause the next asker tries once more, so a soft-navigating session can still recover
        // (a success repaints through emitTrChange) — one attempt per interval, never a storm.
        if (typeof window === 'undefined') viLoading = null
        else setTimeout(() => { if (!viLoaded) viLoading = null }, VI_RETRY_MS)
        throw e
      },
    )
  }
  return viLoading
}

/**
 * The gate's promise (LanguageProvider → ViDictGate). Memoized so React's `use()` sees one object
 * across retries — and it behaves differently on each side, deliberately:
 *
 * · SERVER: the loader's own promise, REJECTIONS INCLUDED. A render that cannot load the dictionary
 *   must fail, not quietly render English into a page that ISR keeps for hours and Cloudflare
 *   caches on top. The loader resets itself on failure, so the next request tries again — nothing
 *   here is memoized on the server side of this function.
 * · CLIENT: a promise that NEVER REJECTS. The gate sits above every provider, so a rejection would
 *   take the whole page down for Vietnamese visitors, and the trigger is routine: HTML cached from
 *   before a deploy asking for a chunk the new build no longer has. On failure the gate lets the tree
 *   render without the dictionary; React then finds the Vietnamese server HTML does not match,
 *   discards it and client-renders — `tr()` strings in English, `useTr` strings through machine
 *   translation (batched per language). A MIXED page, degraded but alive, never a dead one. It stays
 *   settled for THIS page load (re-arming it would have React retry a failing fetch in a loop); the
 *   next full load tries again. (The inline dictionary this replaced could not fail at all, so this
 *   path is new — audit #1 review.)
 */
let viGate: Promise<void> | null = null
export function viDictForHydration(): Promise<void> {
  if (typeof window === 'undefined') return loadViOverrides()
  if (!viGate) {
    viGate = loadViOverrides().catch((e: unknown) => {
      console.error('[i18n] Vietnamese dictionary chunk failed to load — rendering without it', e)
    })
  }
  return viGate
}

/**
 * Seed the dictionary synchronously from a caller that already holds it (tests, and the
 * `initialViDict` prop). A page whose HTML is already Vietnamese does NOT go through here any more:
 * LanguageProvider suspends on loadViOverrides() instead, so hydration waits for the chunk rather
 * than the document carrying the whole dictionary (audit #1). Idempotent; a later
 * loadViOverrides() resolves immediately.
 */
export function seedViDict(dict: Record<string, string>) {
  if (viLoaded) return
  viDict = dict
  viLoaded = true
  viLoading = Promise.resolve()
}

export function emitTrChange() {
  trVersion++
  trListeners.forEach((l) => l())
}
export function subscribeTr(cb: () => void) {
  trListeners.add(cb)
  return () => { trListeners.delete(cb) }
}
export function getTrSnapshot() { return trVersion }

/**
 * ⛔ AN ENGLISH PASSTHROUGH IS NOT RE-ASKED ON EVERY REPAINT (preview check, 2026-10-07). flush() leaves a passthrough
 * uncached on purpose (see there), but it also repainted every tr() reader, and tr() — finding no cache entry and
 * nothing in flight — asked again 60 ms later: a page holding a string the provider would not translate re-POSTed
 * /api/translate 15–17 times a second for as long as it stayed open (measured with the per-IP limit spent, which
 * answers English with `partial`). A miss now waits before it is asked again — 15 s, then ×4 each time, at most
 * 10 min — and a repaint happens only when a translation actually landed. A success clears the wait.
 */
const missUntil = new Map<string, number>() // `${lang} ${text}` → epoch ms before which it is not asked again
const missCount = new Map<string, number>() // every miss — sets the wait
// Only a DEFINITE passthrough (a 200 that was not `partial`) counts toward giving up. A failed request, a 429/5xx or a
// `partial` reply (the per-IP limit — shared by whole carriers behind CGNAT) only waits: fifteen minutes of outage must
// never switch translation off for the rest of a reader's visit (gate review, 2026-10-07).
const definiteMisses = new Map<string, number>()
const MISS_FIRST_MS = 15_000
const MISS_MAX_MS = 600_000
// A long session over user-written text must not grow these without end: past the cap the OLDEST misses are
// forgotten (a Map iterates in insertion order), which only means they may be asked once more.
const MISS_CAP = 1000
const MISS_GIVE_UP = 5
// Waits that end within this of each other are retried by ONE repaint, never a burst of app-wide repaints 60 ms apart.
const DUE_SLACK_MS = 2_000
// ONE timer, at the earliest expiry, repaints so the waiting strings are asked again — without it a page that never
// re-rendered stayed in English for the whole visit after one outage (gate review, 2026-10-07).
let retryTimer: ReturnType<typeof setTimeout> | null = null
let retryAt = Infinity
function scheduleRetry(at: number) {
  // An earlier timer still pending covers this one; a retryAt already in the past is stale and is replaced.
  if (at >= retryAt && retryAt > Date.now()) return
  if (retryTimer) clearTimeout(retryTimer)
  retryAt = at
  retryTimer = setTimeout(() => {
    retryTimer = null
    retryAt = Infinity
    const now = Date.now()
    let due = false
    let next = Infinity
    for (const t of missUntil.values()) {
      if (t <= now + DUE_SLACK_MS) due = true
      else if (t < next) next = t
    }
    // Repaint only for a string whose wait is over: one that landed meanwhile (in the slack before this timer) was
    // repainted then, and its wait deleted — an app-wide repaint for nothing otherwise (gate review, 2026-10-07).
    if (due) emitTrChange()
    // Re-arm for the next string still waiting, or it would stay English if this repaint's retry succeeds (no new miss
    // would schedule anything) — gate review, 2026-10-07.
    if (next !== Infinity) scheduleRetry(next)
  }, Math.max(0, at - Date.now()))
}
/** Tests only: forget every miss and its timer, so no test depends on another's leftovers (gate review). */
export function __resetMtMissesForTests() {
  missUntil.clear()
  missCount.clear()
  definiteMisses.clear()
  if (retryTimer) clearTimeout(retryTimer)
  retryTimer = null
  retryAt = Infinity
}
function noteMiss(ck: string, definite: boolean) {
  const n = (missCount.get(ck) ?? 0) + 1
  const d = (definiteMisses.get(ck) ?? 0) + (definite ? 1 : 0)
  missCount.delete(ck); missUntil.delete(ck); definiteMisses.delete(ck) // re-insert at the end: newest is forgotten last
  missCount.set(ck, n)
  definiteMisses.set(ck, d)
  // Five DEFINITE misses and it is left alone for the session: a string the provider never translates (a name, a brand)
  // must not keep a timer — and an app-wide repaint — alive forever (gate review, 2026-10-07).
  const until = d >= MISS_GIVE_UP ? Infinity : Date.now() + Math.min(MISS_FIRST_MS * 4 ** (n - 1), MISS_MAX_MS)
  missUntil.set(ck, until)
  for (const k of missUntil.keys()) { if (missUntil.size <= MISS_CAP) break; missUntil.delete(k); missCount.delete(k); definiteMisses.delete(k) }
  if (until !== Infinity) scheduleRetry(until)
}

function flush() {
  scheduled = false
  for (const key of Object.keys(pending) as Language[]) {
    const items = pending[key]!
    delete pending[key]
    // ⚠️ ONE COPY OF EACH TEXT PER REQUEST. Every card asks for its own location and a batch window
    // holds a whole feed page, so the same string was queued many times and all of them were posted
    // (one vi home view: "Hồ Chí Minh" ×54 across 5 requests, 2026-09-29). Every waiter still
    // resolves — from the one answer for its text.
    const texts = [...new Set(items.map((i) => i.text))]
    fetch('/api/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texts, target: key }),
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(({ translations, partial }) => {
        const byText = new Map(texts.map((t, i) => [t, translations?.[i] ?? t]))
        let landed = false
        for (const t of texts) {
          const value = byText.get(t) ?? t
          const ck = `${key} ${t}`
          // Don't PIN an English passthrough: when the provider is down the API
          // 200s with the source text, and caching that froze English into the
          // session until a full reload (2026-07-06 audit). Resolve it (render
          // something now) but leave the cache empty, so it is retried — after its wait (noteMiss).
          if (value !== t) { trCache.set(ck, value); missUntil.delete(ck); missCount.delete(ck); definiteMisses.delete(ck); landed = true }
          // One miss per TEXT per answer (`texts` is the Set above), however many waiters asked for it. `partial` = the
          // route's degrade path or a provider failure: retryable, never counted toward giving up.
          else noteMiss(ck, partial !== true)
        }
        items.forEach((it) => it.resolve(byText.get(it.text) ?? it.text))
        // Repaint every component reading trCache via tr() — only when there is something new to show.
        if (landed) emitTrChange()
      })
      .catch(() => {
        for (const t of texts) noteMiss(`${key} ${t}`, false)
        items.forEach((it) => it.resolve(it.text))
      })
  }
}

export function translateText(text: string, lang: Language): Promise<string> {
  /**
   * ⛔ VIETNAMESE IS NOT SENT TO BE TRANSLATED INTO VIETNAMESE. Category names, districts and
   * "Hồ Chí Minh" reach here already in Vietnamese, and the server's alreadyInTarget skip returned
   * each one unchanged — after a round trip per batch (src/lib/detect-lang.ts looksVietnamese, same
   * cut-off). The identity is deterministic, so unlike the provider-down passthrough in flush() it
   * IS cached: every later useTr/tr() reads it synchronously.
   */
  if (lang === 'vi' && looksVietnamese(text)) {
    trCache.set(`vi ${text}`, text)
    return Promise.resolve(text)
  }
  // Still waiting after a miss (noteMiss): answer the English now, with no request. A wait ending within the slack
  // counts as over, so one repaint retries every nearly-due string together.
  if ((missUntil.get(`${lang} ${text}`) ?? 0) > Date.now() + DUE_SLACK_MS) return Promise.resolve(text)
  return new Promise((resolve) => {
    (pending[lang] ||= []).push({ text, resolve })
    if (!scheduled) { scheduled = true; setTimeout(flush, 60) }
  })
}
