'use client'

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
  const embedded = lang === 'en' ? text : lang === 'vi' ? (vi || i18n?.vi || null) : (i18n?.[lang] || null)
  // useTr is a hook → always called; '' is a no-op, so we skip translation when embedded.
  const translated = useTr(embedded ? '' : lang === 'vi' ? vi || text : text)
  return embedded || translated || text
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
  let para: string[] = [], ul: string[] = [], ol: string[] = [], k = 0
  const flushPara = () => { if (para.length) { out.push(<p key={k++}>{inlineFmt(para.join(' '), `p${k}`)}</p>); para = [] } }
  const flushUl = () => { if (ul.length) { out.push(<ul key={k++} className="list-disc space-y-1 pl-5 marker:text-ink-4">{ul.map((li, i) => <li key={i}>{inlineFmt(li, `u${k}-${i}`)}</li>)}</ul>); ul = [] } }
  const flushOl = () => { if (ol.length) { out.push(<ol key={k++} className="list-decimal space-y-1 pl-5 marker:text-ink-4">{ol.map((li, i) => <li key={i}>{inlineFmt(li, `o${k}-${i}`)}</li>)}</ol>); ol = [] } }
  const flushAll = () => { flushPara(); flushUl(); flushOl() }
  for (const raw of lines) {
    const line = raw.trim()
    if (line === '') { flushAll(); continue }
    const heading = line.match(/^#{1,6}\s+(.+)/)
    if (heading) { flushAll(); out.push(<p key={k++} className="font-semibold text-foreground">{inlineFmt(heading[1], `h${k}`)}</p>); continue }
    const bullet = line.match(/^[*\-•]\s+(.+)/)          // "* " / "- " / "• " — NOT "**bold**" (needs a space after one marker)
    if (bullet) { flushPara(); flushOl(); ul.push(bullet[1]); continue }
    const numbered = line.match(/^\d{1,3}[.)]\s+(.+)/)   // "1." / "1)"
    if (numbered) { flushPara(); flushUl(); ol.push(numbered[1]); continue }
    flushUl(); flushOl(); para.push(line)
  }
  flushAll()
  return out
}

/** Localized listing description rendered with light markdown (bullets / bold / paragraphs). */
export function ListingDescription({ text, i18n, className }: { text: string; i18n?: Record<string, string> | null; className?: string }) {
  const { lang } = useLanguage()
  const out = useLocalized(text, null, i18n)
  const cl = detectContentLang(out)
  return <div lang={cl && cl !== lang ? cl : undefined} className={className}>{formatDescription(out)}</div>
}

/** Relative "x ago" in the active language (client — keeps the page cacheable). */
export function PostedAgo({ iso }: { iso: string }) {
  const { lang } = useLanguage()
  return <>{timeAgo(iso, lang)}</>
}
