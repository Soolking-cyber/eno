import type { ReactNode } from 'react'

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

export function formatRichText(text: string): React.ReactNode[] {
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
 * Server-rendered light markdown. No translation, no client JS — for copy that is authored in the
 * repo rather than by a seller (the SEO landing intros). Seller-authored text wants
 * `RichText` from listing-content.tsx instead, which translates first.
 */
export function RichBlock({ text, className }: { text: string; className?: string }) {
  return <div className={className}>{formatRichText(text)}</div>
}
