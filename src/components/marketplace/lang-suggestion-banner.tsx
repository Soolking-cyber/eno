'use client'

import { useEffect, useState, type MouseEvent } from 'react'
import { CloseButton } from '@/components/ui/close-button'
import { useLanguage } from '@/context/language-context'
import { LANGUAGES } from '@/lib/languages'
import { LANG_COOKIE, variantOfLanguage } from '@/lib/lang-variant'
import { VI_PILOT, pinnedPair, stripViPrefix, type ViPilot } from '@/lib/lang-pinned'
import { isNativeAppClient } from '@/lib/app-review-gates'

/**
 * ⛔ THE ONE-TAP SUGGESTION ON A `/vi` PILOT PAGE (SEO wave B, V3b — dormant until V5; decision V-a: no
 * language redirect, a banner instead). Copy sheet CS-3 V3b-7…12, approved 2026-10-01.
 *
 * - **When:** on a piloted plain path (always English) for a visitor whose stored choice, `lang` cookie
 *   or first supported browser language is Vietnamese; the reverse on `/vi…`. Never on any other page.
 * - **What:** a fixed literal in the TARGET language, `lang` on the root so the dismiss label is in that
 *   language too — never `tr()`, which would translate it into the page's language.
 * - **Tap:** goes to the twin through `setLang`, which stores the choice and `location.assign`s the pair.
 * - **Dismiss:** remembered in localStorage (reads and writes in try/catch).
 * ⚠️ IT RENDERS AFTER MOUNT ONLY — it reads `location`, storage and the navigator, none of which the server
 * has — so it can never mismatch on hydration. It floats (no layout shift), on the mobile ladder's z-50
 * with the toast, below the app hint (install-hint.tsx).
 * ⛔ IT STANDS ABOVE THE FIRST-VISIT CONSENT BAR, NEVER UNDER IT. Both dock at the same bottom offset,
 * and the bar (z-[200]) used to cover this link four seconds in: at 390x844 a tap on it landed on the
 * bar's "No thanks" and stored a refusal (measured 2026-10-03). The bar publishes its height as
 * `--consent-clearance` on <html> (cookie-consent.tsx, CONSENT_CLEARANCE_VAR) and this lifts by it —
 * with `translate`, not `bottom`, so the move is a transform, not a layout shift (CLS across the bar's
 * arrival measured the same before and after), on the 150ms strong ease-out the bar rises on. Unset
 * (no bar, or the bar hidden or closed) it is 0. While Choose expands the bar the banner rides above it.
 */
export const BANNER_COPY = {
  vi: { text: 'Trang này có bản tiếng Việt.', link: 'Xem bản tiếng Việt', dismiss: 'Đóng', hrefLang: 'vi-VN' },
  en: { text: 'This page is also available in English.', link: 'View in English', dismiss: 'Dismiss', hrefLang: 'en' },
} as const

export const BANNER_DISMISS_KEY = 'eno-lang-suggest-dismissed'

type Prefs = { stored: string | null; cookie: string | null; languages: readonly string[] }

type Code = (typeof LANGUAGES)[number]['code']

/** The visitor's preferred language: stored choice, then the `lang` cookie, then the first supported browser language. */
export function preferredLanguage(p: Prefs): Code | null {
  const known = (v: string | null): Code | null => (v && LANGUAGES.some((l) => l.code === v) ? (v as Code) : null)
  const pick = known(p.stored) ?? known(p.cookie)
  if (pick) return pick
  for (const raw of p.languages) {
    const lc = raw.toLowerCase()
    const code = lc.startsWith('zh') ? 'zh-Hans' : LANGUAGES.find((l) => !l.code.startsWith('zh') && l.code === lc.split('-')[0])?.code
    if (code) return code
  }
  return null
}

/** Which banner a page shows, if any: the target language and the twin's path. Pure, for the matrix test. */
export function bannerFor(pathname: string, prefs: Prefs, dismissed: boolean, lists: ViPilot = VI_PILOT): { target: 'en' | 'vi'; href: string; choice: Code } | null {
  if (dismissed) return null
  const plain = stripViPrefix(pathname, lists)
  if (!lists.live.includes(plain)) return null
  const pageVariant = plain === pathname ? 'en' : 'vi'
  const choice = preferredLanguage(prefs)
  const want = choice ? variantOfLanguage(choice) : null
  if (!choice || !want || want === pageVariant) return null
  const href = pinnedPair(pathname, lists)
  // The tap stores the visitor's OWN language (a machine-translated choice rides on the English twin).
  return href ? { target: want, href, choice } : null
}

function readCookie(name: string): string | null {
  const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`))
  return m ? decodeURIComponent(m[1]) : null
}

export function LangSuggestionBanner() {
  const { setLang } = useLanguage()
  const [shown, setShown] = useState<ReturnType<typeof bannerFor>>(null)

  useEffect(() => {
    let stored: string | null = null
    let dismissed = false
    try { stored = localStorage.getItem('lang'); dismissed = localStorage.getItem(BANNER_DISMISS_KEY) === '1' } catch { /* storage blocked: no stored choice */ }
    const languages = navigator.languages?.length ? navigator.languages : [navigator.language]
    const b = bannerFor(window.location.pathname, { stored, cookie: readCookie(LANG_COOKIE), languages }, dismissed)
    // ⛔ NEVER IN THE APPS: their start page FOLLOWS to the twin instead, in the pre-paint script, before any launch
    // link or push tap is routed (src/lib/app-home-language.ts — following from a mount effect raced them).
    if (isNativeAppClient()) return
    setShown(b ? { ...b, href: b.href + window.location.search } : null)
  }, [])

  if (!shown) return null
  const copy = BANNER_COPY[shown.target]
  const dismiss = () => {
    try { localStorage.setItem(BANNER_DISMISS_KEY, '1') } catch { /* storage blocked: hidden for this view only */ }
    setShown(null)
  }
  const go = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    e.preventDefault()
    setLang(shown.choice)
  }
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-50 -translate-y-[var(--consent-clearance,0px)] px-3 transition-[translate] duration-150 ease-out-strong pc:bottom-4 lg:px-4">
      <div lang={shown.target} className="pointer-events-auto mx-auto flex w-full max-w-sm items-center gap-3 rounded-2xl border border-foreground/10 bg-popover p-3.5 shadow-overlay animate-in fade-in slide-in-from-bottom-4 duration-300 ease-out-strong lg:max-w-md">
        <p className="min-w-0 flex-1 text-sm leading-snug text-foreground">
          {copy.text}{' '}
          <a href={shown.href} hrefLang={copy.hrefLang} onClick={go} className="font-semibold text-accent-foreground hover:underline">
            {copy.link}
          </a>
        </p>
        <CloseButton size="sm" type="button" label={copy.dismiss} onClick={dismiss} />
      </div>
    </div>
  )
}
