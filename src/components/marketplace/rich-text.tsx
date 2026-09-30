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

/**
 * A 'Label: value' FACT LINE — a short label (a letter first; letters, digits, spaces and / & . ' -
 * after it; no parentheses or asterisks) and a value of at most 80 characters.
 *
 * ⚠️ THIS IS THE SAME FAILURE AS THE TICK LIST BELOW, IN ITS MOST COMMON FORM. The listing importers
 * write their fact block one 'Label: value' per SINGLE newline (nhatot-listing.ts, import-rever-
 * rentals.ts), a single newline is a soft wrap here, and so a rental's Type, Area, Bedrooms, Ward and
 * Rent arrived as ONE paragraph: "Type: Serviced / mini apartment Area: 28 m² Bedrooms: 1 …".
 * Two or more CONSECUTIVE fact lines become a spec list (<dl>), styled like the page's own Details.
 * ONE stays prose — a lone "Note: call first" is a sentence, not a table.
 * What it deliberately does NOT match: "**Who can buy:** …" (starts with an asterisk), "Free (0đ): …"
 * (parentheses), "https://…" (no space after the colon), and a label or value long enough to be a
 * sentence. A "- Size: M" bullet is still a bullet: that branch runs first.
 *
 * ⚠️ THE SHAPE ALONE MATCHED FEATURE COPY, AND THE TABLE IS NOT FOR IT (review, 2026-09-29). A shop's
 * "Powerful 125cc Engine: Smooth and responsive performance for city riding." has the shape, and a
 * partner motorbike PDP rendered a run of those as spec rows — a feature name as the label, a
 * sentence right-aligned as the value. Two more tests now decide it (see isFactLine / isFactRun): the
 * VALUE may not end like a sentence, and a run is a table only when every label is one the importers
 * write (FACT_LABELS) or when it is at least three lines long. Measured 2026-09-29 on the staged
 * import journals: all 48,060 imported rental descriptions (en + vi) still put every fact line in the
 * table; of 469 bike blurbs, 59 keep a table (753 rows — spec sheets and rate plans, "Displacement:
 * 125cc", "Max Power: 8.8 kW @ 8,000 rpm") and none of the review's feature labels is a row; 1 of 1,099
 * car blurbs keeps one (a per-km price list). ⚠️ KNOWN TO PASS: three short benefit phrases with no
 * full stop ("Distinct style: sporty design, aggressive look", one bike). By shape that is a lowercase
 * spec value ("Frame: steel tubular / semi-double cradle"), and the rule cannot tell them apart.
 */
const KV = /^([\p{L}][\p{L}\p{M}\p{N} /&.'-]{0,23}):\s+(\S.{0,79})$/u
/** A value that ends like a sentence — a full stop, "!", "?" or an ellipsis, before any closing quote. */
const SENTENCE_END = /[.!?…]["'”’)]*$/u

/**
 * The PDP Details rows a description fact can repeat, named as the page names them (see
 * hideRepeatedFacts).
 */
export type DetailFact = 'area' | 'bedrooms' | 'bathrooms' | 'furnishing' | 'direction' | 'floors' | 'year' | 'mileage' | 'engine' | 'transmission'

/**
 * THE FACT LABELS THE LISTING IMPORTERS WRITE, in both languages (lower-cased, NFC) → the Details row
 * that shows the same fact, or null when Details has no such row. Sources: nhatot-listing.ts,
 * scripts/muaban-net-map.ts, honeycomb-listing.ts, import-i18n.ts (Rever / Batdongsan) and
 * vehicle-rental-listing.ts; the Vietnamese Details labels (taxonomy labelVi) are here too, because a
 * seller's own Vietnamese fact block uses them. ⚠️ "Area" maps to the floor-area row even though the
 * motorbike importer writes "Area: District 2, …" for a place: the page only hides a row Details
 * actually rendered, and a motorbike has no floor area.
 */
const FACT_LABELS: ReadonlyMap<string, DetailFact | null> = new Map<string, DetailFact | null>([
  ['type', null], ['area', 'area'], ['bedrooms', 'bedrooms'], ['bathrooms', 'bathrooms'], ['furnishing', 'furnishing'],
  ['building', null], ['project', null], ['street', null], ['ward', null], ['former ward', null], ['district', null],
  ['city', null], ['location', null], ['address', null], ['direction', 'direction'], ['facing', 'direction'],
  ['floors', 'floors'], ['rent', null], ['price', null], ['deposit', null], ['delivery', null], ['engine', 'engine'],
  ['listing code', null], ['year', 'year'], ['mileage', 'mileage'], ['transmission', 'transmission'],
  ['loại hình', null], ['loại', null], ['loại xe', null], ['diện tích', 'area'], ['phòng ngủ', 'bedrooms'],
  ['phòng vệ sinh', 'bathrooms'], ['phòng tắm', 'bathrooms'], ['số toilet', 'bathrooms'], ['nội thất', 'furnishing'],
  ['dự án', null], ['đường', null], ['phường/xã', null], ['phường cũ', null], ['quận/huyện', null], ['tỉnh/thành', null],
  ['khu vực', null], ['địa chỉ', null], ['hướng', 'direction'], ['hướng nhà', 'direction'], ['số tầng', 'floors'],
  ['giá thuê', null], ['dung tích', 'engine'], ['phân khối', 'engine'], ['mã tin', null], ['đời xe', 'year'],
  ['số km đã đi', 'mileage'], ['hộp số', 'transmission'],
])
const factKey = (label: string) => label.normalize('NFC').toLowerCase()

/** One line of a fact run: the 'Label: value' shape, with a value that does not end like a sentence. */
function isFactLine(line: string): [string, string] | null {
  const m = line.match(KV)
  return m && !SENTENCE_END.test(m[2]) ? [m[1], m[2]] : null
}

/**
 * Whether a run of consecutive fact lines is a table: two or more lines whose labels are ALL importer
 * fact labels (an imported rental's block), or three or more of any label (a seller's own spec sheet).
 * Anything shorter — "Note: call first", or "Brand: Honda" beside "Model: Wave" — stays prose.
 */
const isFactRun = (run: [string, string][]) =>
  run.length >= 3 || (run.length >= 2 && run.every(([label]) => FACT_LABELS.has(factKey(label))))

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

export function formatRichText(text: string): React.ReactNode[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const out: React.ReactNode[] = []
  let para: string[] = [], ul: string[] = [], ol: string[] = [], ck: [string, string][] = [], kv: [string, string][] = [], k = 0
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
  // A run of fact lines. One that is not a table (isFactRun) is handed back to the paragraph as the
  // lines it was; flushKv always runs BEFORE flushPara, so those lines keep their place in the text.
  const flushKv = () => {
    if (!kv.length) return
    if (!isFactRun(kv)) { for (const [label, value] of kv) para.push(`${label}: ${value}`); kv = []; return }
    flushPara()
    out.push(
      <dl key={k++} className="divide-y divide-border text-sm">
        {kv.map(([dt, dd], i) => (
          <div key={i} data-fact={FACT_LABELS.get(factKey(dt)) ?? undefined} className="flex items-start justify-between gap-4 py-2">
            <dt className="text-muted-foreground">{dt}</dt>
            {/* data-fab-avoid: the same opt-in as the PDP's Details values — these right-aligned
                values run into the corner the floating support mark rests in (back-to-top.tsx). */}
            <dd data-fab-avoid className="text-right font-medium text-foreground">{inlineFmt(dd, `k${k}-${i}`)}</dd>
          </div>
        ))}
      </dl>,
    )
    kv = []
  }
  const flushAll = () => { flushKv(); flushPara(); flushUl(); flushOl(); flushCk() }
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
    if (check) { flushKv(); flushPara(); flushUl(); flushOl(); ck.push([check[1], check[2]]); continue }
    const bullet = line.match(/^[*\-•]\s+(.+)/)          // "* " / "- " / "• " — NOT "**bold**" (needs a space after one marker)
    if (bullet) { flushKv(); flushPara(); flushOl(); flushCk(); ul.push(bullet[1]); continue }
    const numbered = line.match(/^\d{1,3}[.)]\s+(.+)/)   // "1." / "1)"
    if (numbered) { flushKv(); flushPara(); flushUl(); flushCk(); ol.push(numbered[1]); continue }
    const fact = isFactLine(line)
    if (fact) { flushUl(); flushOl(); flushCk(); kv.push(fact); continue }
    flushKv(); flushUl(); flushOl(); flushCk(); para.push(line)
  }
  flushAll()
  return out
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
