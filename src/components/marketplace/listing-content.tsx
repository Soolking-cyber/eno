'use client'

import { useEffect, useState } from 'react'
import { useLanguage, useTr } from '@/context/language-context'
import { timeAgo } from '@/lib/types'
import { detectContentLang } from '@/lib/detect-lang'

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

// ── Description formatter ────────────────────────────────────────────────────────────
// Listing descriptions (AI-polished + human) carry light markdown — "* " / "- " bullets,
// "1." numbered lists, "**bold**", "#"-headings, blank-line paragraphs. Rendered raw (as a
// pre-line <p>) those markers show as literal characters and look messy. This parses that
// SUBSET into clean, semantic blocks. Safe by construction: it only ever builds known React
// elements + escaped text (no dangerouslySetInnerHTML), so untrusted text can't inject markup.

/** Inline pass: **bold** → <strong>, the rest is plain (escaped) text. */
function inlineFmt(text: string, key: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = []
  const re = /\*\*(.+?)\*\*/g
  let last = 0, m: RegExpExecArray | null, i = 0
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index))
    nodes.push(<strong key={`${key}-b${i++}`} className="font-semibold text-foreground">{m[1]}</strong>)
    last = m.index + m[0].length
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}

function formatDescription(text: string): React.ReactNode[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const out: React.ReactNode[] = []
  let para: string[] = [], ul: string[] = [], ol: string[] = [], ck: [string, string][] = [], k = 0
  const flushPara = () => { if (para.length) { out.push(<p key={k++}>{inlineFmt(para.join(' '), `p${k}`)}</p>); para = [] } }
  const flushUl = () => { if (ul.length) { out.push(<ul key={k++} className="list-disc space-y-1 pl-5 marker:text-ink-4">{ul.map((li, i) => <li key={i}>{inlineFmt(li, `u${k}-${i}`)}</li>)}</ul>); ul = [] } }
  const flushOl = () => { if (ol.length) { out.push(<ol key={k++} className="list-decimal space-y-1 pl-5 marker:text-ink-4">{ol.map((li, i) => <li key={i}>{inlineFmt(li, `o${k}-${i}`)}</li>)}</ol>); ol = [] } }
  /**
   * ⚠️ A TICK LIST KEEPS ITS TICK AND TAKES NO DISC. The author already chose a marker; adding
   * `list-disc` would render "• ✓ Clear options" — two markers for one list. `list-none` plus the
   * glyph as a real (aria-hidden) child gives back exactly the line the seller typed, and the flex
   * row keeps a wrapped second line aligned under the text instead of under the tick.
   */
  const flushCk = () => {
    if (!ck.length) return
    out.push(
      <ul key={k++} className="list-none space-y-1 pl-0">
        {ck.map(([mark, li], i) => (
          <li key={i} className="flex gap-2">
            {/* ⚠️ THE SELLER'S OWN GLYPH, NOT A NORMALISED ONE. The first version matched four tick
                characters and then rendered ✓ for all of them, while the comment above claimed it
                gave back the line as typed — a reviewer caught the contradiction. Either the code
                or the comment had to go, and the code was the wrong half: someone who typed ☑ or ✅
                chose that mark. */}
            <span aria-hidden className="shrink-0 text-success">{mark}</span>
            <span>{inlineFmt(li, `c${k}-${i}`)}</span>
          </li>
        ))}
      </ul>,
    )
    ck = []
  }
  const flushAll = () => { flushPara(); flushUl(); flushOl(); flushCk() }
  for (const raw of lines) {
    const line = raw.trim()
    if (line === '') { flushAll(); continue }
    const heading = line.match(/^#{1,6}\s+(.+)/)
    if (heading) { flushAll(); out.push(<p key={k++} className="font-semibold text-foreground">{inlineFmt(heading[1], `h${k}`)}</p>); continue }
    /**
     * ⚠️ THE TICK MARKERS ARE NOT DECORATION — OMITTING THEM SILENTLY DESTROYED THE LAYOUT.
     * Nothing here matched "✓ Clear options", so four consecutive tick lines fell through to the
     * paragraph branch and were joined with SPACES into one run-on sentence: "✓ Clear options &
     * upfront pricing ✓ Standard and express e-Visa processing ✓ …". That is the failure mode to
     * watch for in this function — an unrecognised marker does not render as a plain line, it
     * MERGES lines, because a paragraph is the fallback and paragraphs join.
     * ✔/✅/☑ are included because a seller pasting from a phone keyboard gets whichever one it
     * offers, and they mean the same thing to a reader.
     *
     * ⚠️ `️?` CONSUMES THE EMOJI VARIATION SELECTOR. "☑️" is TWO code points — ☑ plus an
     * invisible U+FE0F — so without this the class matches the tick, `\s*` does not match FE0F
     * (it is not whitespace), and the selector lands at the head of the captured text where it
     * renders as a stray box on some fonts. Reviewer-caught.
     *
     * ⚠️ THE SPACE IS OPTIONAL (`\s*`) WHERE THE DASH BRANCH BELOW REQUIRES ONE, AND A REVIEWER
     * called that over-broad. Kept deliberately: "-word" is ordinary prose and a hyphen is a
     * common punctuation mark, whereas a line STARTING with a tick is a tick list in every case
     * worth caring about, space or not. The asymmetric risk decides it — a missed tick does not
     * degrade to a plain line, it MERGES the line into the paragraph above.
     */
    const check = line.match(/^([✓✔✅☑])️?\s*(.+)/)
    if (check) { flushPara(); flushUl(); flushOl(); ck.push([check[1], check[2]]); continue }
    const bullet = line.match(/^[*\-•]\s+(.+)/)          // "* " / "- " / "• " — NOT "**bold**" (needs a space after one marker)
    if (bullet) { flushPara(); flushOl(); flushCk(); ul.push(bullet[1]); continue }
    const numbered = line.match(/^\d{1,3}[.)]\s+(.+)/)   // "1." / "1)"
    if (numbered) { flushPara(); flushUl(); flushCk(); ol.push(numbered[1]); continue }
    flushUl(); flushOl(); flushCk(); para.push(line)
  }
  flushAll()
  return out
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
 * ⚠️ BLOCK ELEMENTS, SO THE CALLER MUST NOT BE A <p>. formatDescription emits <p>/<ul>/<ol>, and a
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
      {formatDescription(out)}
    </div>
  )
}

/** Localized listing description rendered with light markdown (bullets / bold / paragraphs). */
export function ListingDescription({ text, i18n, className }: { text: string; i18n?: Record<string, string> | null; className?: string }) {
  const { lang } = useLanguage()
  const out = useLocalized(text, null, i18n)
  const cl = detectContentLang(out)
  // `allow-select`: keep the description selectable/copyable in the native app, where chrome
  // selection is disabled (globals.css html.native). Content text is the exception users need.
  return <div lang={cl && cl !== lang ? cl : undefined} className={`allow-select${className ? ` ${className}` : ''}`}>{formatDescription(out)}</div>
}

/** Relative "x ago" in the active language (client — keeps the page cacheable). */
export function PostedAgo({ iso }: { iso: string }) {
  const { lang } = useLanguage()
  return <>{timeAgo(iso, lang)}</>
}
