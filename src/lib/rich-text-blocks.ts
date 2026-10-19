/**
 * THE STRUCTURE formatRichText RENDERS — pure, no React (src/components/marketplace/rich-text.tsx renders exactly this).
 *
 * ⛔ ONE PARSE, TWO READERS (2026-10-19). The listing page renders a seller's light markdown through formatRichText, and
 * the job-text screen (job-listing.ts jobTextProblem) judges a hiring post AS THE READER SEES IT — so both read this one
 * parse, and a paragraph the page shows as one run of text is the run the screen reads: "…thẻ tạm" on one line and "trú"
 * on the next is ONE paragraph, "…thẻ tạm trú" on the page, while two "- " lines are two list items. A marker the parse
 * learns reaches both at once. Pinned both ways in rich-text-blocks.test.tsx (each rendered block's text equals the block
 * richTextBlocks gives).
 *
 * The grammar (a SUBSET of markdown — "* " / "- " / "• " bullets, "1." / "1)" numbered lists, tick lines, "#"-headings,
 * 'Label: value' fact runs, blank-line paragraphs, "**bold**" inline) and why each rule is shaped as it is are in the
 * notes below; the elements, classes and keys are rich-text.tsx's.
 */

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
 * hideRepeatedFacts in rich-text.tsx).
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

/** A table row: the label, the value (inline markdown), and the PDP Details row it repeats, if any (`data-fact`). */
export type RichTextFactRow = readonly [label: string, value: string, fact: DetailFact | null]

/**
 * One rendered element, in order. `text` / `items` / a row's value are INLINE markdown (rich-text.tsx inlineFmt renders
 * them; inlineText gives what the reader sees); a tick item keeps the seller's own glyph.
 */
export type RichTextGroup =
  | { kind: 'p'; text: string }
  | { kind: 'h'; text: string }
  | { kind: 'ul'; items: string[] }
  | { kind: 'ol'; items: string[] }
  | { kind: 'ck'; items: (readonly [mark: string, text: string])[] }
  | { kind: 'dl'; rows: RichTextFactRow[] }

/** The text as the elements formatRichText renders, in order. */
export function richTextGroups(text: string): RichTextGroup[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const out: RichTextGroup[] = []
  let para: string[] = [], ul: string[] = [], ol: string[] = [], ck: [string, string][] = [], kv: [string, string][] = []
  const flushPara = () => { if (para.length) { out.push({ kind: 'p', text: para.join(' ') }); para = [] } }
  const flushUl = () => { if (ul.length) { out.push({ kind: 'ul', items: ul }); ul = [] } }
  const flushOl = () => { if (ol.length) { out.push({ kind: 'ol', items: ol }); ol = [] } }
  const flushCk = () => { if (ck.length) { out.push({ kind: 'ck', items: ck }); ck = [] } }
  // A run of fact lines. One that is not a table (isFactRun) is handed back to the paragraph as the
  // lines it was; flushKv always runs BEFORE flushPara, so those lines keep their place in the text.
  const flushKv = () => {
    if (!kv.length) return
    if (!isFactRun(kv)) { for (const [label, value] of kv) para.push(`${label}: ${value}`); kv = []; return }
    flushPara()
    out.push({ kind: 'dl', rows: kv.map(([dt, dd]): RichTextFactRow => [dt, dd, FACT_LABELS.get(factKey(dt)) ?? null]) })
    kv = []
  }
  const flushAll = () => { flushKv(); flushPara(); flushUl(); flushOl(); flushCk() }
  for (const raw of lines) {
    const line = raw.trim()
    if (line === '') { flushAll(); continue }
    const heading = line.match(/^#{1,6}\s+(.+)/)
    if (heading) { flushAll(); out.push({ kind: 'h', text: heading[1] }); continue }
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

/** Inline markdown as the reader sees it — what rich-text.tsx inlineFmt renders: each "**bold**" without its asterisks. */
export const inlineText = (text: string): string => text.replace(/\*\*(.+?)\*\*/g, '$1')

/**
 * EACH RENDERED BLOCK'S TEXT, as the reader sees it, in order: a paragraph (its lines joined with a space), a heading,
 * each list item (a tick item without its glyph, which carries no words), each table row as "label: value" (the page sets
 * the two side by side). The unit the job-text screen judges (job-listing.ts jobTextProblem).
 */
export function richTextBlocks(text: string): string[] {
  const out: string[] = []
  for (const g of richTextGroups(text)) {
    if (g.kind === 'p' || g.kind === 'h') out.push(inlineText(g.text))
    else if (g.kind === 'ul' || g.kind === 'ol') for (const li of g.items) out.push(inlineText(li))
    else if (g.kind === 'ck') for (const [, li] of g.items) out.push(inlineText(li))
    else for (const [dt, dd] of g.rows) out.push(`${dt}: ${inlineText(dd)}`)
  }
  return out
}
