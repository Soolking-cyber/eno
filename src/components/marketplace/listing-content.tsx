'use client'

import { useEffect, useState } from 'react'
import { RelativeTime } from './relative-time'
import { useLanguage, useTr } from '@/context/language-context'
import { detectContentLang } from '@/lib/detect-lang'
import { formatRichText } from '@/components/marketplace/rich-text'

/**
 * Client-side localized listing title — mirrors the card: Vietnamese uses the
 * hand-authored titleVi, every other language machine-translates the source title
 * (from the warm cache). Lets the listing page be statically/ISR-rendered (no
 * per-request server translation) while still showing in-language content.
 */
/**
 * Localized listing content (title/description/location). Prefers an EMBEDDED translation
 * (`i18n[lang]`, pre-warmed + baked into the ISR page) so it renders the visitor's language
 * SYNCHRONOUSLY with no flash and no network call. Falls back to the client machine-translate
 * (useTr) only when the embed is missing — so it's always at least as good as before.
 */
/** The localized STRING: embedded translation first (synchronous), else client machine-
 *  translate. Use when you need the text value (e.g. an alt attribute), not a node. */
export function useLocalized(text: string, vi?: string | null, i18n?: Record<string, string> | null): string {
  const { lang } = useLanguage()
  // EN is a translation TARGET too (user decision 2026-07-14): a Vietnamese-authored
  // description must render in English under the EN UI. Script detection gates it so
  // English source text never round-trips.
  const srcLang = detectContentLang(text)
  const embedded =
    lang === 'en'
      ? (srcLang ? (i18n?.en || null) : text)
      : lang === 'vi'
        ? (srcLang === 'vi' ? text : vi || i18n?.vi || null)
        : (i18n?.[lang] || null)
  // useTr is a hook → always called; '' is a no-op, so we skip translation when embedded.
  const translated = useTr(embedded || lang === 'en' ? '' : lang === 'vi' ? vi || text : text)
  const mtEn = useMachineEn(!embedded && lang === 'en' ? text : '')
  return embedded || (lang === 'en' ? mtEn : translated) || text
}

// One-shot client translate INTO English for cache-miss non-EN content (the embed
// covers warmed content; this is the same fallback role useTr plays for other
// languages, which by design never targets EN). Module cache — a text translates
// once per session.
const enCache = new Map<string, string>()
function useMachineEn(text: string): string {
  const [val, setVal] = useState('')
  useEffect(() => {
    if (!text) { setVal(''); return }
    const hit = enCache.get(text)
    if (hit) { setVal(hit); return }
    let off = false
    fetch('/api/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texts: [text], target: 'en' }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const out = d?.translations?.[0]
        if (!off && typeof out === 'string' && out) { enCache.set(text, out); setVal(out) }
      })
      .catch(() => {})
    return () => { off = true }
  }, [text])
  return val
}

export function LocalizedText({ text, vi, i18n }: { text: string; vi?: string | null; i18n?: Record<string, string> | null }) {
  const { lang } = useLanguage()
  const out = useLocalized(text, vi, i18n)
  const cl = detectContentLang(out)
  return cl && cl !== lang ? <span lang={cl}>{out}</span> : <>{out}</>
}

export function LocalizedTitle({ title, titleVi, i18n }: { title: string; titleVi: string | null; i18n?: Record<string, string> | null }) {
  return <LocalizedText text={title} vi={titleVi} i18n={i18n} />
}

/**
 * The same light-markdown rendering as a listing description, for any OTHER piece of
 * user-authored prose — today the storefront bio.
 *
 * ⚠️ IT EXISTS BECAUSE THE FORMATTER WAS PRIVATE TO ONE CALL SITE AND THE PROBLEM WAS NOT.
 * Sellers write bios in exactly the register they write descriptions in: blank-line paragraphs,
 * "✓"/"-" lines, **bold** on the thing that matters. The storefront rendered that through a bare
 * `<p>`, where HTML collapses every newline and the asterisks show as literal characters — so a
 * bio authored as seven lines with two bold phrases arrived as one grey block containing "**".
 * Measured on the live data: 1 of 3 seller bios carries `**` and newlines, and 14 of 15 active
 * listing descriptions carry bullet lines, which is why the listing side grew this formatter first.
 *
 * ⚠️ BLOCK ELEMENTS, SO THE CALLER MUST NOT BE A <p>. formatRichText emits <p>/<ul>/<ol>, and a
 * <div> inside a <p> is invalid HTML that React hydrates into a different tree than the server
 * rendered — the caller was a <p> and had to become a <div>.
 *
 * ⚠️ TRANSLATE FIRST, FORMAT SECOND. useTr returns the translated STRING, and the markers survive
 * translation, so the structure is parsed from whatever language the reader is actually seeing —
 * formatting first would hand the translator a React tree it cannot take.
 */
export function RichText({ text, className }: { text: string; className?: string }) {
  const { lang } = useLanguage()
  const out = useTr(text) || text
  const cl = detectContentLang(out)
  return (
    <div lang={cl && cl !== lang ? cl : undefined} className={`allow-select${className ? ` ${className}` : ''}`}>
      {formatRichText(out)}
    </div>
  )
}

/** Localized listing description rendered with light markdown (bullets / bold / paragraphs). */
export function ListingDescription({ text, vi, i18n, className }: { text: string; vi?: string | null; i18n?: Record<string, string> | null; className?: string }) {
  const { lang } = useLanguage()
  // ⚠️ `vi` WAS HARDCODED null HERE while the heading passed titleVi through the same hook — so a
  // listing stored in two languages showed its title correctly and its description always in the
  // primary one. The slot existed; nothing was filling it.
  const out = useLocalized(text, vi ?? null, i18n)
  const cl = detectContentLang(out)
  // `allow-select`: keep the description selectable/copyable in the native app, where chrome
  // selection is disabled (globals.css html.native). Content text is the exception users need.
  return <div lang={cl && cl !== lang ? cl : undefined} className={`allow-select${className ? ` ${className}` : ''}`}>{formatRichText(out)}</div>
}

/** Relative "x ago" in the active language (client — keeps the page cacheable).
 *  Hydration-stable: see RelativeTime — the clock is never read before mount. */
export function PostedAgo({ iso }: { iso: string }) {
  return <RelativeTime iso={iso} />
}
