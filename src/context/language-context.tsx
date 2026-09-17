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
  seedViDict,
} from '@/lib/i18n/mt-client'
import { LANG_COOKIE, variantOfLanguage } from '@/lib/lang-variant'

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
/**
 * ⚠️ AN EXPLICIT CHOICE ALSO LEAVES A MARKER COOKIE, FOR BROWSERS THAT BLOCK localStorage. The `lang`
 * cookie alone cannot say whether the visitor CHOSE a language or it was only detected, and only a
 * choice may outrank the device language. Without this, choosing English where storage is blocked
 * reloaded, found no stored choice, re-detected Vietnamese and reloaded straight back (a reviewer's catch).
 */
const LANG_CHOICE_COOKIE = 'lang-choice'
function writeChoiceCookie() {
  if (typeof document === 'undefined') return
  document.cookie = `${LANG_CHOICE_COOKIE}=1;path=/;max-age=31536000;samesite=lax`
}
function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null
  const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`))
  return m ? decodeURIComponent(m[1]) : null
}
function chosenCookieLanguage(): Language | null {
  if (readCookie(LANG_CHOICE_COOKIE) !== '1') return null
  const v = readCookie(LANG_COOKIE)
  return v && LANGUAGES.some((l) => l.code === v) ? (v as Language) : null
}

// ⛔ THE SERVER READS THIS NOW (src/proxy.ts → src/lib/lang-variant.ts). It decides which HTML the
// NEXT request renders, so it must always hold the language the visitor is actually reading.
function writeLangCookie(lang: Language): boolean {
  if (typeof document === 'undefined') return false
  document.cookie = `${LANG_COOKIE}=${lang};path=/;max-age=31536000;samesite=lax`
  // ⛔ READ IT BACK — THIS IS THE LOOP GUARD. A reload only helps if the server will SEE the cookie,
  // and it is the one condition that makes a second reload impossible: the next render matches the
  // variant and reconciliation stops. Where cookies are blocked the write silently does nothing, so
  // reloading would land on the same variant forever; that visitor keeps the client-side swap instead.
  return readCookie(LANG_COOKIE) === lang
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

/**
 * ⛔ `initialLang` IS THE LANGUAGE THE SERVER ALREADY RENDERED, AND STARTING ANYWHERE ELSE UNDOES THE
 * FEATURE. This provider used to start at 'en' on every request and switch after hydration, so a
 * Vietnamese visitor read English for 4–6 s on a throttled phone and watched the layout shift as it
 * swapped. The proxy now picks the variant from the `lang` cookie / Accept-Language and the root layout
 * passes it here, so the first paint is already in the right language and hydration agrees with it.
 * The nine machine-translated languages still arrive on the English variant and swap client-side.
 */
export function LanguageProvider({
  children,
  initialLang = 'en',
  initialViDict,
}: {
  children: React.ReactNode
  initialLang?: Language
  initialViDict?: Record<string, string>
}) {
  if (initialViDict) seedViDict(initialViDict)
  const [lang, setLangState] = useState<Language>(initialLang)
  // The variant THIS page was rendered in. Server text, data and every router-cache entry are in it,
  // whatever the client state says later, so every "does this need a reload" question is asked against
  // it — not against `lang`, which can already have been swapped client-side.
  const serverVariant = variantOfLanguage(initialLang)
  const [dicts, setDicts] = useState<Partial<Record<Language, Record<string, string>>>>(STATIC)

  useEffect(() => {
    // A saved preference always wins; otherwise fall back to the device language
    // (navigator.languages), then English.
    // ⚠️ A STORED CHOICE, THEN THE DEVICE — and state changes only when that differs from what the
    // server already rendered, so a correctly-served page never swaps. A DETECTED cookie is deliberately
    // not read back here: it only records the LAST detection, and letting it win would pin a visitor to
    // their old browser language after they change it. A CHOSEN one is (see chosenCookieLanguage). The server's first
    // render can be one page stale in that case; this corrects it and rewrites the cookie.
    /**
     * ⛔ A MOUNT THAT NEEDS THE OTHER VARIANT RELOADS ONCE — A CLIENT SWAP WOULD LEAVE A MIXED PAGE.
     * Server-rendered text (a category lede, listing data) cannot follow a state change, so switching
     * here left Vietnamese server text beside English client labels. It happens when the cookie the
     * server read is gone but the stored choice is not — Safari expires JS-written cookies after 7 days —
     * or when the device language changed since the cookie was written. The cookie is rewritten first,
     * so the reload renders the right variant; a per-session marker stops a loop where cookies are
     * blocked, and that visitor keeps the old client-side swap.
     */
    const reconcile = (next: Language) => {
      const cookieHeld = writeLangCookie(next)
      const marker = `lang-reload:${next}`
      if (variantOfLanguage(next) === serverVariant) {
        // Agreement: forget any earlier attempt, so a LATER mismatch in this tab can reload again
        // rather than inheriting a spent guard and leaving a mixed page (a reviewer's catch).
        try { sessionStorage.removeItem(marker) } catch { /* no storage */ }
        if (next !== initialLang) setLangState(next)
        return
      }
      let already = false
      // Storage may be unavailable; the cookie read-back above is the guard that cannot be missing.
      try { already = sessionStorage.getItem(marker) === '1'; sessionStorage.setItem(marker, '1') } catch { already = false }
      if (cookieHeld && !already) { window.location.reload(); return }
      setLangState(next)
    }
    const stored = safeGetItem('lang') as Language | null
    if (stored && LANGUAGES.some((l) => l.code === stored)) {
      reconcile(stored)
      return
    }
    const chosen = chosenCookieLanguage()
    if (chosen) {
      reconcile(chosen)
      return
    }
    /**
     * ⛔ NATIVE: ONE SOURCE OF TRUTH, OR THE APP RELOADS TWICE ON EVERY LAUNCH. WKWebView's
     * navigator.language can be the APP's locale while @capacitor/device reports the OS's; reconciling
     * with the first and then the second flipped the cookie between them and reloaded for each
     * (a reviewer's catch). The native shell waits for the device answer and uses only that, falling
     * back to the navigator if the plugin is missing. Until it resolves, the server-rendered language
     * (from last launch's cookie) is what shows.
     */
    if (isNativePlatform()) {
      void (async () => {
        let dev: Language | null = null
        try {
          const { Device } = await import('@capacitor/device')
          dev = matchLanguage((await Device.getLanguageTag()).value)
        } catch { /* plugin missing / not synced — fall back below */ }
        // The user may have picked a language explicitly while this resolved.
        if (safeGetItem('lang') || chosenCookieLanguage()) return
        reconcile(dev ?? detectDeviceLanguage())
      })()
      return
    }
    reconcile(detectDeviceLanguage())
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
    /**
     * ⚠️ TWO CATALOGUES, MERGED HERE, AND THE SERVICES ONE IS ALIASED AWAY ON eno.vn.
     *
     * The combined list used to carry 26 e-Visa strings into every marketplace client. Splitting it
     * is not enough on its own — a runtime `IS_SERVICES ?` around the import would NOT keep the
     * services file out of the bundle, because the flag is not dead-code-eliminated across module
     * boundaries (measured; see src/lib/edition.ts). next.config.ts therefore aliases
     * `@/generated/ui-strings.services` to an empty stub on a marketplace build, so this import
     * resolves to `[]` and the words are not in the artifact at all.
     *
     * Both stay lazy: neither ships in the en/vi first-load bundle, which is what the early return
     * above is for.
     */
    Promise.all([
      import('@/generated/ui-strings'),
      import('@/generated/ui-strings.services'),
    ]).then(([core, services]) => {
      const UI_STRINGS = [...core.UI_STRINGS, ...services.UI_STRINGS_SERVICES]
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
  }, [lang])

  // Keep <html lang> in sync so screen readers use the right voice (WCAG 3.1.1).
  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])

  /**
   * ⛔ A SWITCH ACROSS SERVER VARIANTS RELOADS THE PAGE, AND A CLIENT-SIDE SWAP IS NOT ENOUGH.
   * Server-rendered text and data are in the old variant, and Next's router cache keeps serving the
   * old variant for every route already visited — measured on Next 16.3.1: after the cookie changed,
   * soft navigation back to a visited page still rendered the previous language; only a reload
   * fetched the new one. Switching between two languages on the SAME variant (English and a
   * machine-translated one) stays instant, as before.
   */
  const setLang = (newLang: Language) => {
    safeSetItem('lang', newLang)
    const cookieHeld = writeLangCookie(newLang)
    writeChoiceCookie()
    // State first, so the choice shows immediately; the reload then replaces server-rendered text
    // and the router cache with the new variant.
    setLangState(newLang)
    // ⛔ ONLY RELOAD IF THE CHOICE WILL SURVIVE IT (a reviewer's catch). With cookies blocked the
    // reload would come back in the OLD language and the mount effect would find nothing to restore,
    // silently discarding the choice — worse than the client-side swap this otherwise replaces.
    if (typeof window !== 'undefined' && cookieHeld && variantOfLanguage(newLang) !== serverVariant) {
      window.location.reload()
    }
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
    // Machine translation is a browser fetch; during SSR there is nothing to fetch from.
    if (typeof window !== 'undefined' && !trInflight.has(ck)) {
      trInflight.add(ck)
      // flush() calls emitTrChange() on resolve, which repaints subscribers.
      translateText(en, lang).finally(() => trInflight.delete(ck))
    }
    return en // optimistic source fallback until the translation lands
  }

  // t/tr read module-level caches at call time, so [lang, dicts] deps are enough —
  // async translation arrivals repaint via the external store, not new closures.
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
