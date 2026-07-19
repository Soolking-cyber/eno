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
// Hand-authored VI dictionary — lazily imported so its ~22 KB never ships in the
// first-load bundle of non-Vietnamese sessions (mirrors the UI_STRINGS lazy pattern).
// Sync readers (tr/useTr) see {} until the chunk lands, then emitTrChange repaints.
// NOTE: consumers read these as ESM live bindings — only this module reassigns them.
export let viDict: Record<string, string> = {}
export let viLoaded = false
let viLoading: Promise<void> | null = null
export function loadViOverrides(): Promise<void> {
  if (viLoaded) return Promise.resolve()
  if (!viLoading) {
    viLoading = import('@/generated/vi-overrides').then((m) => {
      viDict = m.VI_OVERRIDES
      viLoaded = true
      emitTrChange()
    })
  }
  return viLoading
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
