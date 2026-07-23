'use client'

import React, { createContext, useContext, useState, useMemo, useEffect, useSyncExternalStore } from 'react'
import { detectContentLang } from '@/lib/detect-lang'
import { LANGUAGES, type Language } from '@/lib/i18n/langs'
import { TR_OVERRIDES } from '@/lib/i18n/glossary'
import { EN, STATIC } from '@/lib/i18n/static-dicts'
import {
  hashStrings,
  trCache,
  trInflight,
  viDict,
  viLoaded,
  loadViOverrides,
  emitTrChange,
  subscribeTr,
  getTrSnapshot,
  translateText,
} from '@/lib/i18n/mt-client'

// Re-exported so the many existing importers of the roster keep working
// (the canonical definition now lives in the isomorphic @/lib/i18n/langs).
export { LANGUAGES }
export type { Language }

// Map a browser BCP-47 tag (navigator.language) to a supported Language, or null.
function matchLanguage(raw: string): Language | null {
  if (!raw) return null
  const lc = raw.toLowerCase()
  // All Chinese variants (Simplified, Traditional, Taiwan/HK/Macau) → Simplified,
  // the single supported Chinese option.
  if (lc.startsWith('zh')) return 'zh-Hans'
  const primary = lc.split('-')[0]
  const hit = LANGUAGES.find((l) => !l.code.startsWith('zh') && l.code === primary)
  return hit ? hit.code : null
}

// Mirror the active language into a cookie so the server can read it for SSR
// translation / <html lang> / hreflang (a later phase). Purely additive today.
function writeLangCookie(lang: Language) {
  if (typeof document === 'undefined') return
  document.cookie = `lang=${lang};path=/;max-age=31536000;samesite=lax`
}

// localStorage access can throw (Safari private mode, storage-blocked WebViews,
// quota) — never let a preference read/write take down the provider.
function safeGetItem(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}
function safeSetItem(key: string, value: string) {
  try { localStorage.setItem(key, value) } catch { /* storage unavailable — non-fatal */ }
}

// Pick the device language: walk the user's ordered preference list, first match
// wins; English if none of the supported languages appear.
function detectDeviceLanguage(): Language {
  if (typeof navigator === 'undefined') return 'en'
  const prefs = navigator.languages?.length ? navigator.languages : [navigator.language]
  for (const p of prefs) {
    const m = matchLanguage(p)
    if (m) return m
  }
  return 'en'
}

// True inside the Capacitor native shell (iOS/Android WebView). There, navigator.language can lag
// the real DEVICE language (WKWebView especially), so we confirm the locale via @capacitor/device.
function isNativePlatform(): boolean {
  if (typeof window === 'undefined') return false
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor
  return !!cap?.isNativePlatform?.()
}

interface LanguageContextProps {
  lang: Language
  setLang: (lang: Language) => void
  t: (key: string) => string
  // Inline UI-string helper: tr('English', 'Tiếng Việt?'). Returns the English
  // source for en, the hand-authored Vietnamese for vi (if given), and a cached
  // machine translation for every other language (and for vi when no hand
  // translation is supplied). Safe to call anywhere tr is in scope.
  tr: (en: string, vi?: string) => string
}

const LanguageContext = createContext<LanguageContextProps | undefined>(undefined)

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Language>('en')
  const [dicts, setDicts] = useState<Partial<Record<Language, Record<string, string>>>>(STATIC)

  useEffect(() => {
    // A saved preference always wins; otherwise fall back to the device language
    // (navigator.languages), then English.
    const stored = safeGetItem('lang') as Language | null
    if (stored && LANGUAGES.some((l) => l.code === stored)) {
      setLangState(stored)
      writeLangCookie(stored)
      return
    }
    const detected = detectDeviceLanguage()
    writeLangCookie(detected)
    if (detected !== 'en') setLangState(detected)
    // NATIVE apps: iOS WKWebView's navigator.language can report the app's locale, not the DEVICE
    // language — so confirm via @capacitor/device (the real OS locale) and apply it. The dynamic
    // import keeps the plugin out of the WEB bundle (isNativePlatform gates it). A saved preference
    // already returned above, so this only refines the auto-detected default. NOT persisted
    // (setLangState + cookie, no localStorage), so it keeps following the device on each launch —
    // exactly like the web navigator path.
    if (isNativePlatform()) {
      void (async () => {
        try {
          const { Device } = await import('@capacitor/device')
          const { value } = await Device.getLanguageTag()
          // The user may have picked a language explicitly while this resolved —
          // an explicit preference always wins over the device locale.
          if (safeGetItem('lang')) return
          const dev = matchLanguage(value)
          if (dev) { writeLangCookie(dev); setLangState(dev) }
        } catch { /* plugin missing / not synced — the navigator fallback already applied */ }
      })()
    }
  }, [])

  // Persist the chosen language to the signed-in user's Profile so SERVER-sent messages
  // (e.g. moderation notifications, which the recipient can't supply a cookie for) reach
  // them in this language. Debounced so only the settled language is written (the mount
  // effect above may flip en→vi first). GUESTS ARE SKIPPED (no Supabase auth cookie):
  // firing anyway 401s, and although .catch() swallows the JS error the browser still
  // logs the failed request to console — Lighthouse flags that on every guest page load
  // (Best Practices 100→96), and each one burned a function invocation for nothing.
  useEffect(() => {
    if (typeof document === 'undefined' || !/(^|;\s*)sb-[^=]*-auth-token/.test(document.cookie)) return
    // Skip when the settled language was already synced (persisted marker), so a
    // hard load doesn't re-POST the same locale on every visit.
    if (safeGetItem('lang-synced') === lang) return
    const id = setTimeout(() => {
      fetch('/api/profile/locale', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ locale: lang }) })
        .then((r) => { if (r.ok) safeSetItem('lang-synced', lang) })
        .catch(() => {})
    }, 800)
    return () => clearTimeout(id)
  }, [lang])

  // Seed BOTH translation systems (t() dictionary + <Tr>/tr cache) from one map
  // of {englishSource: translation}, then repaint consumers.
  const seedFromMap = (target: Language, map: Record<string, string>) => {
    for (const [en, val] of Object.entries(map)) trCache.set(`${target} ${en}`, val)
    // vi has a hand-authored t() dictionary (STATIC.vi) — never overwrite it with
    // machine translations; only its <Tr> cache (above) gets warmed.
    if (target !== 'vi') {
      const dict: Record<string, string> = {}
      for (const k of Object.keys(EN)) dict[k] = map[EN[k]] ?? EN[k]
      setDicts((d) => ({ ...d, [target]: dict }))
    }
    emitTrChange() // repaint <Tr>/tr consumers now that the cache is warm
  }

  // Warm EVERY static UI string for the active language in ONE batch (then cache
  // to localStorage), so the in-language swap is instant — no per-string lazy
  // /api/translate cascade. Repeat visits seed synchronously from localStorage.
  useEffect(() => {
    if (lang === 'en') return // source language — nothing to translate
    // Vietnamese is hand-authored (the lazily-imported vi-overrides dict in tr()/useTr());
    // skip the machine-translation prefetch entirely. Any string not yet in the
    // overrides falls back to lazy per-string machine translation via tr()/useTr().
    if (lang === 'vi') return
    let cancelled = false
    // Lazy-load the big UI string list ONLY for a third language (en/vi already
    // returned above), so it never ships in the en/vi first-load bundle.
    import('@/generated/ui-strings').then(({ UI_STRINGS }) => {
      if (cancelled) return
      // Key the cache by a hash of the CURRENT string set, so adding/changing any
      // UI copy auto-invalidates stale caches (otherwise new strings stay English).
      // The version segment busts every client's cached UI dictionary when the
      // *translations* change (not the source) — g2: Azure→Google re-translate;
      // g3: 2026-07-06 purge of half-English dictionaries persisted while the prod
      // translate key was dead + the curated category glossary.
      const cacheKey = `ui-dict:g3:${hashStrings(UI_STRINGS)}:${lang}`
      const cached = typeof localStorage !== 'undefined' ? localStorage.getItem(cacheKey) : null
      if (cached) {
        try { seedFromMap(lang, JSON.parse(cached)); return } catch { /* refetch */ }
      }
      // Fetch the dictionary in chunks so a not-yet-warmed language (many cache
      // misses) stays under the endpoint's per-request billable cap; an already
      // cached language just resolves in a few cheap parallel hits.
      const CHUNK = 100
      const chunks: string[][] = []
      for (let i = 0; i < UI_STRINGS.length; i += CHUNK) chunks.push(UI_STRINGS.slice(i, i + CHUNK))
      Promise.all(
        chunks.map((texts) =>
          fetch('/api/translate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ texts, target: lang }),
          })
            .then((r) => (r.ok ? r.json() : null))
            // A partial answer (the route's degraded rate-limited path) seeds the UI but
            // must not be PERSISTED: under the current cache key a 99%-complete dict
            // would freeze its English stragglers until the harvest hash next changes.
            .then((d) => (d && Array.isArray(d.translations) ? { translations: d.translations as string[], partial: d.partial === true } : null))
            .catch(() => null),
        ),
      ).then((results) => {
        if (cancelled) return
        const map: Record<string, string> = {}
        let anyFail = false
        results.forEach((res, ci) => {
          if (!res || res.partial) anyFail = true
          chunks[ci].forEach((s, i) => { map[s] = res ? (res.translations[i] ?? s) : s })
        })
        seedFromMap(lang, map)
        // Cache only a COMPLETE, actually-translated dictionary — never persist a
        // partial result. `anyFail` only catches HTTP-level chunk failures; a dead
        // provider 200s with per-string ENGLISH passthroughs, and the old "at least
        // one translated" guard froze half-English dictionaries into localStorage
        // for every visitor (2026-07-06 audit: 573/1051 ru strings were English).
        // Require ≥95% of strings to actually differ from source before persisting
        // (a few legit source-identical strings — brand names, "OK" — always exist).
        const translated = UI_STRINGS.reduce((n, s) => (map[s] !== s ? n + 1 : n), 0)
        if (!anyFail && translated >= UI_STRINGS.length * 0.95) {
          try {
            localStorage.setItem(cacheKey, JSON.stringify(map))
            // Evict superseded dictionaries (old hash/generation, other languages'
            // stale copies) — nothing else ever deletes 'ui-dict:' keys, and each
            // is a full ~100KB dictionary.
            for (let i = localStorage.length - 1; i >= 0; i--) {
              const k = localStorage.key(i)
              if (k && k.startsWith('ui-dict:') && k !== cacheKey) localStorage.removeItem(k)
            }
          } catch { /* ignore */ }
        }
      })
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang])

  // Keep <html lang> in sync so screen readers use the right voice (WCAG 3.1.1).
  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])

  const setLang = (newLang: Language) => {
    setLangState(newLang)
    safeSetItem('lang', newLang)
    writeLangCookie(newLang)
  }

  const t = (key: string): string => dicts[lang]?.[key] ?? EN[key] ?? key

  // Inline UI-string translation (see interface). English source is the cache
  // key; results are shared with <Tr>/useTr via the same module cache.
  const tr = (en: string, vi?: string): string => {
    if (!en) return en
    if (lang === 'en') return en
    if (lang === 'vi') {
      if (vi != null) return vi
      const hv = viDict[en]
      if (hv != null) return hv
      if (!viLoaded) { void loadViOverrides(); return en } // dict inbound — emitTrChange repaints
    }
    const override = TR_OVERRIDES[en]?.[lang]
    if (override) return override
    const ck = `${lang} ${en}`
    const hit = trCache.get(ck)
    if (hit != null) return hit
    if (!trInflight.has(ck)) {
      trInflight.add(ck)
      // flush() calls emitTrChange() on resolve, which repaints subscribers.
      translateText(en, lang).finally(() => trInflight.delete(ck))
    }
    return en // optimistic source fallback until the translation lands
  }

  // t/tr read module-level caches at call time, so [lang, dicts] deps are enough —
  // async translation arrivals repaint via the external store, not new closures.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const value = useMemo(() => ({ lang, setLang, t, tr }), [lang, dicts])

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  )
}

export function useLanguage() {
  // Subscribe to the inline-translation cache so this consumer repaints when a
  // tr() batch resolves (called before the guard to satisfy rules-of-hooks).
  useSyncExternalStore(subscribeTr, getTrSnapshot, () => 0)
  const context = useContext(LanguageContext)
  if (!context) throw new Error('useLanguage must be used within a LanguageProvider')
  return context
}

/**
 * Translate an arbitrary string to the active language. Pass the best source:
 * for fields with a native Vietnamese variant, pass the vi field when lang==='vi'
 * (it will be echoed). English is returned unchanged (it is the source language).
 */
export function useTr(text: string | null | undefined): string {
  const { lang } = useLanguage()
  const safe = text ?? ''
  const cacheKey = `${lang} ${safe}`
  const [val, setVal] = useState<string>(() =>
    lang === 'en' || !safe
      ? safe
      : lang === 'vi' && viDict[safe] != null
      ? viDict[safe]
      // Curated glossary wins over the MT cache — same precedence as tr(). Without
      // this, <Tr>-rendered category tiles kept serving a stale WRONG cache row
      // (ru "Свойства" for Property) that the glossary couldn't override.
      : TR_OVERRIDES[safe]?.[lang] ?? trCache.get(cacheKey) ?? safe,
  )

  useEffect(() => {
    if (!safe || lang === 'en') { setVal(safe); return }
    // Hand-authored Vietnamese wins over machine translation.
    if (lang === 'vi' && !viLoaded) {
      // Dict inbound — wait for it before falling back to machine translation.
      let c = false
      loadViOverrides().then(() => {
        if (c) return
        const hv = viDict[safe]
        if (hv != null) setVal(hv)
        else translateText(safe, lang).then((t2) => { if (!c) setVal(t2) })
      })
      return () => { c = true }
    }
    if (lang === 'vi') { const hv = viDict[safe]; if (hv != null) { setVal(hv); return } }
    // Curated glossary before the MT cache (mirrors tr()).
    const override = TR_OVERRIDES[safe]?.[lang]
    if (override) { setVal(override); return }
    const ck = `${lang} ${safe}`
    const hit = trCache.get(ck)
    if (hit != null) { setVal(hit); return }
    let cancelled = false
    translateText(safe, lang).then((tr) => { if (!cancelled) setVal(tr) })
    return () => { cancelled = true }
  }, [safe, lang])

  return val
}

/** Renders a string translated to the active language (safe to use inside .map()).
 *  When the resolved text is in a DIFFERENT language than the page (e.g. an
 *  untranslated Vietnamese title on an English page), it's wrapped in
 *  `<span lang>` so assistive tech voices it correctly (WCAG 3.1.2). Detection only
 *  fires on unambiguous scripts / VI-exclusive letters, so chrome in the page
 *  language is never wrapped. */
export function Tr({ text }: { text?: string | null }) {
  const { lang } = useLanguage()
  const out = useTr(text)
  const cl = detectContentLang(out)
  return cl && cl !== lang ? <span lang={cl}>{out}</span> : <>{out}</>
}
