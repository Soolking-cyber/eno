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
/**
 * ⛔ A LANDING REPAINTS THE APP ONLY FOR A TEXT tr() ASKED FOR (speed audit, 2026-11-10). emitTrChange() re-renders every
 * useLanguage() consumer in one synchronous pass: 1,203 components and a ~175 ms task at 4x on Vietnamese /c/rentals,
 * 867 on /vi, to land 2 and 16 card titles. Those were asked by useTr / useMachineEn / useAwaitingTranslation, which
 * take their answer from the promise; tr() alone reads trCache during render and needs the repaint. So tr() asks with
 * `repaint`, its key waits here until that text lands — whoever's batch carries it — and a miss keeps it waiting.
 * ⚠️ ITS OWN CAP, NOT THE MISS CACHE'S: forgetting an old miss (MISS_CAP) must not forget that tr() still waits on the
 * text, or a batch already out could land it with no repaint and the label would stay English (commit-gate review).
 * A text that never lands (a name) stays here; tr() asks for interface copy, so the cap is far above what a visit holds.
 * ⚠️ PAST THE CAP EVERY LANDING REPAINTS AGAIN (trAskedLost), as before this rule: a forgotten wait may belong to a
 * label still on screen, and a label stuck in English costs more than the repaint this rule saves.
 */
const trAsked = new Set<string>() // `${lang} ${text}`
const TR_ASKED_CAP = 5000
let trAskedLost = false
/** tr() waits on `ck`. Re-inserted at the end, so past the cap the texts asked longest ago are the ones forgotten. */
function noteTrAsked(ck: string) {
  trAsked.delete(ck)
  trAsked.add(ck)
  for (const k of trAsked) { if (trAsked.size <= TR_ASKED_CAP) break; trAsked.delete(k); trAskedLost = true }
}
/**
 * ⛔ A TEXT A FAILED REQUEST LEFT IN ENGLISH IS ASKED AGAIN FOR WHOEVER STILL SHOWS IT (2026-11-11). useTr and useMachineEn
 * take their answer from translateText's promise, once, in an effect keyed on text and language. A failed request answers
 * that promise with the English, and the retry below only repainted, which re-runs tr() but not those effects: after one
 * 500, every card title, place name and <Tr> label of that batch stayed English for the visit, even once the UI
 * dictionary held the label (measured on the wave-1 build: 0/12 card titles on Korean / and on /vi, 14 texts of the
 * failed batch still English on Korean /, 3 on /c/rentals). So a reader left with the English waits here
 * (waitForTranslation). When its text lands — from a retry, another batch or the UI dictionary (wakeTranslationWaiters) —
 * it gets the translation, and only it re-renders (render counts in language-context.mt-repaint.test.tsx; jsdom, not a
 * browser).
 * ⚠️ ONLY A FAILURE IS ASKED AGAIN FOR A WAITER: a text whose every miss was a failed request or a `partial` reply. A
 * DEFINITE passthrough (a name, a brand) is not, so a visit with no failure never sends more requests than before: the
 * waiter adds none (the flush filter below can only send fewer).
 * ⚠️ BOUNDED BY THE MISS WAIT: once per wait (15 s, ×4 each time, at most 10 min), in the timer's one wave, and only while
 * a mounted reader still shows the text — an unmount ends it.
 * ⚠️ NEVER TWICE IN FLIGHT (review, 2026-11-11): while a re-ask is still out (a slow origin that has not answered yet),
 * the timer wave of a later miss finds the same text due again — its missUntil is still the old one, in the past — and
 * posted it again (unit test, a re-ask that never settles: the text went out 3 times, not 2). `reasking` holds a
 * waiter's text from its re-ask until that request settles; the failure that ends it sets a new wait.
 * ⛔ NOT trInflight: a tr() that first renders the text while this re-ask is out would then skip noteTrAsked, and the
 * landing would not repaint it.
 */
type TranslationWaiter = { text: string; lang: Language; cbs: Set<(translated: string) => void> }
const waiters = new Map<string, TranslationWaiter>() // `${lang} ${text}`
const reasking = new Set<string>() // `${lang} ${text}`: a waiter's re-ask still out
function wake(ck: string, value: string) {
  const w = waiters.get(ck)
  if (!w) return
  waiters.delete(ck)
  w.cbs.forEach((cb) => cb(value))
}
/** Call `cb` once with the translation of `text` when it lands. Returns the unsubscribe (an effect's cleanup). */
export function waitForTranslation(text: string, lang: Language, cb: (translated: string) => void): () => void {
  const ck = `${lang} ${text}`
  const hit = trCache.get(ck)
  if (hit != null && hit !== text) { cb(hit); return () => {} }
  let w = waiters.get(ck)
  if (!w) waiters.set(ck, (w = { text, lang, cbs: new Set() }))
  const mine = w
  mine.cbs.add(cb)
  return () => {
    mine.cbs.delete(cb)
    if (!mine.cbs.size && waiters.get(ck) === mine) waiters.delete(ck)
  }
}
/** trCache was seeded outside a request (the UI dictionary): hand every waiter whose text it now holds its translation. */
export function wakeTranslationWaiters() {
  for (const [ck, w] of waiters) {
    const v = trCache.get(ck)
    // A dictionary chunk that failed seeds the English; that is no answer, so the waiter keeps waiting.
    if (v != null && v !== w.text) wake(ck, v)
  }
}
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
    for (const [ck, t] of missUntil) {
      // The repaint is for tr(), which asks again while it renders — only for a text the cache still lacks (the UI
      // dictionary may have seeded it since, and repainted then). A text only waiters show is asked below instead. On the
      // wave-1 build, 15 s after one failed request, this repaint rendered 314 components on /c/rentals and 668 on the
      // home page, in Korean and in Vietnamese alike, and asked for nothing: no request left after the failure (Chromium,
      // 2 runs per page and language).
      if (t <= now + DUE_SLACK_MS) { if ((trAskedLost || trAsked.has(ck)) && !trCache.has(ck)) due = true }
      else if (t < next) next = t
    }
    // Asked again for a waiter after a failure only (see `waiters`); its landing wakes it, and a new miss re-arms this timer.
    for (const [ck, w] of waiters) {
      const t = missUntil.get(ck)
      if (t == null || t > now + DUE_SLACK_MS || definiteMisses.get(ck) || reasking.has(ck)) continue
      reasking.add(ck)
      void translateText(w.text, w.lang).finally(() => reasking.delete(ck))
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
  trAsked.clear()
  trAskedLost = false
  waiters.clear()
  reasking.clear()
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
    /**
     * ⚠️ A TEXT THE CACHE GOT WHILE IT WAITED HERE IS ANSWERED FROM IT, NOT POSTED (2026-11-11). On a repeat Korean visit
     * the first Korean render asks for every label on screen before the stored UI dictionary is read, and 125 of this
     * batch's 127 texts on /c/rentals (141 of 153 on /) are dictionary labels. The seeding has repainted tr() already.
     * ⚠️ CHROMIUM ONLY. Wave-1 build, persistent profile, warm HTTP cache: in Chromium the dictionary was read (and
     * seeded, synchronously) BEFORE this batch left in every run — 30-200 ms ahead unthrottled, 162-770 ms at 4x CPU
     * throttle, 418-1413 ms at 6x — so there the batch shrinks to the non-dictionary texts. In WebKit (Playwright's) it
     * was read 3-8 ms AFTER the batch left (12 of 12 runs), so there this filter skips nothing and the batch goes whole, as
     * before — expect the same on Safari, iOS and the Capacitor iOS app, which run WebKit (no device measured).
     * An English value (a dictionary chunk that failed seeds the source) is no answer, so that text is still posted.
     */
    const items = pending[key]!.filter((it) => {
      const ck = `${key} ${it.text}`
      const hit = trCache.get(ck)
      if (hit == null || hit === it.text) return true
      trAsked.delete(ck)
      it.resolve(hit)
      // Whoever wrote the cache may not have woken the waiters (seedViDict, a title the server sent); a waiter's own
      // re-ask ends here too, and nobody reads its promise. So the reader still showing the English gets it now.
      wake(ck, hit)
      return false
    })
    delete pending[key]
    if (!items.length) continue
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
          // `landed` only for a text tr() is waiting on (trAsked); every other asker repaints from its promise.
          // …and for an answer that REPLACES an earlier one (two requests for one text can come back worded
          // differently): a tr() label may already be showing the first.
          if (value !== t) {
            const shown = trCache.get(ck)
            trCache.set(ck, value); missUntil.delete(ck); missCount.delete(ck); definiteMisses.delete(ck)
            if (trAsked.delete(ck) || trAskedLost || (shown != null && shown !== value)) landed = true
            wake(ck, value)
          }
          // One miss per TEXT per answer (`texts` is the Set above), however many waiters asked for it. `partial` = the
          // route's degrade path or a provider failure: retryable, never counted toward giving up.
          else noteMiss(ck, partial !== true)
        }
        items.forEach((it) => it.resolve(byText.get(it.text) ?? it.text))
        // Repaint every component reading trCache via tr() — only when there is something new for tr() to show.
        if (landed) emitTrChange()
      })
      .catch(() => {
        for (const t of texts) noteMiss(`${key} ${t}`, false)
        items.forEach((it) => it.resolve(it.text))
      })
  }
}

/** `repaint`: the caller reads trCache during render (tr()), so the app repaints when this text lands (trAsked). */
export function translateText(text: string, lang: Language, repaint = false): Promise<string> {
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
  // Noted before the wait below too: a batch already out may still land this text, and tr() must see it.
  if (repaint) noteTrAsked(`${lang} ${text}`)
  // Still waiting after a miss (noteMiss): answer the English now, with no request. A wait ending within the slack
  // counts as over, so one repaint retries every nearly-due string together.
  if ((missUntil.get(`${lang} ${text}`) ?? 0) > Date.now() + DUE_SLACK_MS) return Promise.resolve(text)
  return new Promise((resolve) => {
    (pending[lang] ||= []).push({ text, resolve })
    if (!scheduled) { scheduled = true; setTimeout(flush, 60) }
  })
}
