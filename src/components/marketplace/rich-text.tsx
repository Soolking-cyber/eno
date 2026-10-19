import type { ReactNode } from 'react'
import { richTextGroups, type DetailFact } from '@/lib/rich-text-blocks'

export type { DetailFact }

/**
 * LIGHT-MARKDOWN RENDERING FOR SELLER- AND EDITOR-AUTHORED PROSE.
 *
 * ⛔ THIS FILE HAS NO `'use client'` ON PURPOSE, AND THAT IS THE WHOLE REASON IT EXISTS. The
 * formatter used to live inside listing-content.tsx, which IS a client component — so a SERVER
 * component that wanted the same rendering (the SEO landing intro) could only get it by pulling in
 * a client boundary and its `useTr` translation behaviour along with it. Split out, the parser is
 * plain functions returning React elements: a client file may import it, and a server file may
 * import it and ship ZERO extra client JavaScript.
 *
 * Safe by construction — it only ever builds known React elements and escaped text, never
 * dangerouslySetInnerHTML, so untrusted seller input cannot inject markup.
 */

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

/**
 * ⚠️ THE DESCRIPTION MUST NOT REPEAT DETAILS (review, 2026-09-29). An imported rental's fact block
 * carries Area, Bedrooms and Bathrooms, and the PDP's Details — directly below it, in the same table
 * style — shows the same three from the structured columns, in Vietnamese under DIFFERENT labels
 * ("Phòng vệ sinh" above, the taxonomy's "Số toilet" below). The formatter tags each such row with
 * `data-fact`; the page passes the rows its Details rendered to this, and puts the result on the
 * description's className, so a repeated row is `display: none` from the server HTML on.
 * ⚠️ WHY A CLASS AND NOT A PROP: the description is translated on the client (ListingDescription →
 * useLocalized) BEFORE it is parsed, so the page cannot drop the lines from the text it passes down,
 * and the one component between the page and this parser takes a className and nothing else.
 * ⚠️ LITERAL CLASS STRINGS, ONE PER ROW: Tailwind generates only the classes it can read in source.
 */
const HIDE_FACT: Record<DetailFact, string> = {
  area: '[&_[data-fact=area]]:hidden',
  bedrooms: '[&_[data-fact=bedrooms]]:hidden',
  bathrooms: '[&_[data-fact=bathrooms]]:hidden',
  furnishing: '[&_[data-fact=furnishing]]:hidden',
  direction: '[&_[data-fact=direction]]:hidden',
  floors: '[&_[data-fact=floors]]:hidden',
  year: '[&_[data-fact=year]]:hidden',
  mileage: '[&_[data-fact=mileage]]:hidden',
  engine: '[&_[data-fact=engine]]:hidden',
  transmission: '[&_[data-fact=transmission]]:hidden',
}
export function hideRepeatedFacts(rendered: Iterable<string>): string {
  const out = new Set<string>()
  for (const key of rendered) if (Object.hasOwn(HIDE_FACT, key)) out.add(HIDE_FACT[key as DetailFact])
  return [...out].join(' ')
}

/**
 * The text as React elements — the elements richTextGroups (src/lib/rich-text-blocks.ts) parses it into, so what the page
 * shows and what the job-text screen reads are one parse (that file's header). The grammar and its notes live there.
 */
export function formatRichText(text: string): React.ReactNode[] {
  return richTextGroups(text).map((g, k) => {
    if (g.kind === 'p') return <p key={k}>{inlineFmt(g.text, `p${k}`)}</p>
    if (g.kind === 'h') return <p key={k} className="font-semibold text-foreground">{inlineFmt(g.text, `h${k}`)}</p>
    if (g.kind === 'ul') return <ul key={k} className="list-disc space-y-1 pl-5 marker:text-ink-4">{g.items.map((li, i) => <li key={i}>{inlineFmt(li, `u${k}-${i}`)}</li>)}</ul>
    if (g.kind === 'ol') return <ol key={k} className="list-decimal space-y-1 pl-5 marker:text-ink-4">{g.items.map((li, i) => <li key={i}>{inlineFmt(li, `o${k}-${i}`)}</li>)}</ol>
    /**
     * ⚠️ A TICK LIST KEEPS ITS TICK AND TAKES NO DISC. The author already chose a marker; adding
     * `list-disc` would render "• ✓ Clear options" — two markers for one list. `list-none` plus the
     * glyph as a real (aria-hidden) child gives back exactly the line the seller typed, and the flex
     * row keeps a wrapped second line aligned under the text instead of under the tick.
     */
    if (g.kind === 'ck') {
      return (
        <ul key={k} className="list-none space-y-1 pl-0">
          {g.items.map(([mark, li], i) => (
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
        </ul>
      )
    }
    // A fact run that is a table (rich-text-blocks.ts isFactRun); one that is not came back as paragraph text.
    return (
      <dl key={k} className="divide-y divide-border text-sm">
        {g.rows.map(([dt, dd, fact], i) => (
          <div key={i} data-fact={fact ?? undefined} className="flex items-start justify-between gap-4 py-2">
            <dt className="text-muted-foreground">{dt}</dt>
            {/* data-fab-avoid: the same opt-in as the PDP's Details values — these right-aligned
                values run into the corner the floating support mark rests in (back-to-top.tsx). */}
            <dd data-fab-avoid className="text-right font-medium text-foreground">{inlineFmt(dd, `k${k}-${i}`)}</dd>
          </div>
        ))}
      </dl>
    )
  })
}

// ── Help-answer formatter ────────────────────────────────────────────────────────────
// Help answers are authored ONE LINE PER PARAGRAPH, with bare-line sub-heads ("Before you go") and
// "•" bullets (scripts/help-center-seed.json). The thread and the accordion printed them verbatim in
// a pre-line <p>, so a 1,320-character checklist was one paragraph with literal bullets and no
// headings (C-HELP-RENDER, measured 2026-09-29). formatRichText is the wrong tool as it stands: it
// JOINS consecutive plain lines into one paragraph (right for a seller's soft-wrapped description,
// wrong here) and has no notion of a heading that is not marked with "#".

/**
 * A line that reads as a SUB-HEAD in a help answer: a short, unpunctuated line standing alone after a
 * blank line, with more content after it. Measured against all 40 seeded answers in both languages:
 * 89 headings (45 EN, 44 VI), no false positives.
 *
 * What it deliberately refuses: a list item; a line glued to the one above (a continuation, not a
 * head); more than seven words once parentheticals are dropped ("Hanoi, Noi Bai (HAN)" is three); a
 * line ending in sentence punctuation — so a label that introduces a list ("Safety advice before you
 * pay anyone:") stays a sentence; a line naming a domain ("… eno.vn/safety"); and a last line, which
 * has nothing to head.
 */
export function isImplicitHeading(lines: string[], i: number): boolean {
  const line = (lines[i] ?? '').trim()
  if (!line) return false
  if (/^[•*\-]\s+/.test(line) || /^\d{1,3}[.)]\s+/.test(line)) return false
  if (i > 0 && lines[i - 1].trim() !== '') return false
  if (line.replace(/\([^)]*\)/g, '').trim().split(/\s+/).length > 7) return false
  if (/[.?!:;…,]$/.test(line)) return false
  if (/\b[a-z0-9-]+\.(vn|com|net|org|gov|io)\b/.test(line)) return false
  return lines.slice(i + 1).some((l) => l.trim() !== '')
}

/**
 * A help answer as headings, paragraphs and lists. Every plain line is its OWN paragraph — never
 * joined to its neighbour, which is the difference from formatRichText. `implicitHeadings` is for
 * answers the eno team wrote (the heading rule is tuned to that corpus); a community post gets the
 * lists and the paragraphs but no guessed headings. `headingLevel` follows the page's outline: h3 in
 * a thread (under the question's h1 and a section h2), h4 inside the /help accordion (whose trigger is
 * the h3). Server-safe like everything in this file.
 */
export function formatHelpBody(text: string, opts: { implicitHeadings: boolean; headingLevel?: 2 | 3 | 4 }): ReactNode[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const H = opts.headingLevel === 4 ? 'h4' : opts.headingLevel === 2 ? 'h2' : 'h3'
  const out: ReactNode[] = []
  let ul: string[] = [], ol: string[] = [], k = 0
  // The block right under a heading sits 8px below it, every other block 16px (12px for a list) below
  // its predecessor: a heading has to belong to what follows it, not float between two paragraphs.
  let tight = false
  const gap = (normal: string) => { const c = tight ? 'mt-2' : normal; tight = false; return c }
  const flushUl = () => { if (ul.length) { out.push(<ul key={k++} className={`${gap('mt-3')} list-disc space-y-2 pl-5 marker:text-ink-4 first:mt-0`}>{ul.map((li, i) => <li key={i}>{inlineFmt(li, `hu${k}-${i}`)}</li>)}</ul>); ul = [] } }
  const flushOl = () => { if (ol.length) { out.push(<ol key={k++} className={`${gap('mt-3')} list-decimal space-y-2 pl-5 marker:text-ink-4 first:mt-0`}>{ol.map((li, i) => <li key={i}>{inlineFmt(li, `ho${k}-${i}`)}</li>)}</ol>); ol = [] } }
  lines.forEach((raw, i) => {
    const line = raw.trim()
    if (line === '') { flushUl(); flushOl(); return }
    const bullet = line.match(/^[•*\-]\s+(.+)/)
    if (bullet) { flushOl(); ul.push(bullet[1]); return }
    const numbered = line.match(/^\d{1,3}[.)]\s+(.+)/)
    if (numbered) { flushUl(); ol.push(numbered[1]); return }
    flushUl(); flushOl()
    if (opts.implicitHeadings && isImplicitHeading(lines, i)) {
      tight = false
      out.push(<H key={k++} className="mt-8 text-lg font-bold leading-snug text-foreground first:mt-0">{inlineFmt(line, `hh${k}`)}</H>)
      tight = true
      return
    }
    out.push(<p key={k++} className={`${gap('mt-4')} first:mt-0`}>{inlineFmt(line, `hp${k}`)}</p>)
  })
  flushUl(); flushOl()
  return out
}

/**
 * Server-rendered light markdown. No translation, no client JS — for copy that is authored in the
 * repo rather than by a seller (the SEO landing intros). Seller-authored text wants
 * `RichText` from listing-content.tsx instead, which translates first.
 */
export function RichBlock({ text, className }: { text: string; className?: string }) {
  return <div className={className}>{formatRichText(text)}</div>
}
