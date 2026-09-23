import type { Language } from './langs'

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

function flush() {
  scheduled = false
  for (const key of Object.keys(pending) as Language[]) {
    const items = pending[key]!
    delete pending[key]
    const texts = items.map((i) => i.text)
    fetch('/api/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texts, target: key }),
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(({ translations }) => {
        items.forEach((it, i) => {
          const value = translations?.[i] ?? it.text
          // Don't PIN an English passthrough: when the provider is down the API
          // 200s with the source text, and caching that froze English into the
          // session until a full reload (2026-07-06 audit). Resolve it (render
          // something now) but leave the cache empty so the next render retries.
          if (value !== it.text) trCache.set(`${key} ${it.text}`, value)
          it.resolve(value)
        })
        emitTrChange() // repaint every component reading trCache via tr()
      })
      .catch(() => items.forEach((it) => it.resolve(it.text)))
  }
}

export function translateText(text: string, lang: Language): Promise<string> {
  return new Promise((resolve) => {
    (pending[lang] ||= []).push({ text, resolve })
    if (!scheduled) { scheduled = true; setTimeout(flush, 60) }
  })
}
