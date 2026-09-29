/**
 * LEXICAL RELEVANCE FOR THE KEYWORD SEARCH PATH — the `relevance` input the owner's searchScore
 * (ranking-formula.ts: 0.50 relevance · 0.40 trust · 0.10 recency, decided 2026-07-05) has always
 * assumed, computed from the row itself.
 *
 * ⛔ WHY THIS EXISTS: IN PRODUCTION THE KEYWORD PATH IS THE ONLY SEARCH PATH, AND IT HAD NO RELEVANCE.
 * Vertex (semantic-rank.ts) needs K_SERVICE for its credentials and the box is not Cloud Run
 * (infra/vn-node/cutover.md accepted "AI search degrades off Cloud Run"), so every search fell back to
 * `searchText contains token` ordered by the BROWSE rankScore. Measured 2026-09-29: q=iphone opened on
 * a Viettel eSIM and an Under Armour tote bag (each mentions an iPhone in passing), then the phone;
 * q=honda led with a pressure washer that has no "Honda" in its title. The weights are unchanged —
 * this only supplies the relevance term they were written for.
 *
 * Pure: no db, no 'server-only'. The scorer reads title, titleVi, model, brand and category — never
 * the description, which is exactly what a passing mention lives in.
 */
import { fold } from './fold'
import { TAXONOMY } from './taxonomy'
import { searchUnits } from './search-match'
import type { SearchUnit } from './search-synonyms'

export type RelevanceRow = {
  title: string
  titleVi: string | null
  model: string | null
  brandSlug: string | null
  subcategorySlug: string | null
  category: { slug: string; name: string; nameVi: string }
}

/**
 * `typed[i]` is unit i's own words as the reader typed them (accents kept, lowercased, NFC) — the
 * keyword ranker's title recall needs them, because Postgres ILIKE cannot fold "tủ lạnh" to "tu lanh".
 */
export type ParsedQuery = { units: SearchUnit[]; phrase: string; typed: string[] }

/**
 * The weights, per unit. A title hit is the strongest evidence; a title that STARTS with the term
 * ("iPhone 18 Pro" for "iphone") a little more; a model/brand hit and a category hit are
 * corroboration. A row that matched recall only through text none of these fields hold (the
 * description, the location) scores DESC_ONLY for that unit and is WEAK.
 * MAX_PER_UNIT is the most one unit can earn (3 + 1 + 2 + 1.5), so relevance stays in [0, 1].
 */
export const REL = {
  TITLE: 3,
  TITLE_START: 1,
  MODEL_BRAND: 2,
  CATEGORY: 1.5,
  DESC_ONLY: 0.3,
  SYNONYM_FACTOR: 0.8,
  PHRASE_BONUS: 0.1,
  MAX_PER_UNIT: 7.5,
} as const

/**
 * Intent maps, built once from TAXONOMY: a folded keyword / name → the subcategories (and category
 * names → the categories) it names. ⚠️ THEY FEED RANKING ONLY, NEVER RECALL: keywords like 'lead' and
 * 'chair' are far too noisy to widen a query with, but a row already found by its text and filed
 * under the aisle the word names is better evidence than one that is not.
 */
const SUB_INTENT = new Map<string, Set<string>>()
const CAT_INTENT = new Map<string, Set<string>>()
const add = (map: Map<string, Set<string>>, key: string, slug: string) => {
  const k = fold(key)
  if (!k) return
  const s = map.get(k)
  if (s) s.add(slug)
  else map.set(k, new Set([slug]))
}
for (const cat of TAXONOMY) {
  add(CAT_INTENT, cat.name, cat.slug)
  add(CAT_INTENT, cat.nameVi, cat.slug)
  for (const sub of cat.subcategories) {
    for (const k of [...sub.keywords, sub.name, sub.nameVi]) add(SUB_INTENT, k, sub.slug)
  }
}

/** The subcategories a folded term names (possibly empty). */
export function subcategoryIntent(term: string): ReadonlySet<string> {
  return SUB_INTENT.get(term) ?? EMPTY
}
const EMPTY: ReadonlySet<string> = new Set()

/**
 * The query's units and the phrase they spell — the same units the feed's text filter matches
 * (searchUnits: fold, ≥2-character tokens, the first six, synonym runs grouped).
 */
export function parseSearchQuery(q: string): ParsedQuery {
  const units = searchUnits(fold(q))
  // The same tokens again, each beside the word it was folded from (fold keeps the word count).
  const kept = q.trim().split(/\s+/).map((raw) => ({ raw: raw.normalize('NFC').toLowerCase(), folded: fold(raw) }))
    .filter((t) => t.folded.length >= 2).slice(0, 6)
  const typed: string[] = []
  let i = 0
  for (const u of units) {
    const n = u.terms[0].split(' ').length
    typed.push(kept.slice(i, i + n).map((t) => t.raw).join(' '))
    i += n
  }
  const phrase = units.length >= 2 ? kept.map((t) => t.folded).join(' ') : ''
  return { units, phrase, typed }
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const WORD_START_CACHE = new Map<string, RegExp>()
/**
 * `term` begins a word of the folded `hay` — the boundary semantics of search-match.ts's WORD_BOUNDARY
 * (and the concierge before it), stated as the regex those LIKE clauses reproduce.
 */
export function wordStart(hay: string, term: string): boolean {
  if (!hay || !term) return false
  let re = WORD_START_CACHE.get(term)
  if (!re) {
    re = new RegExp('(^|[^a-z0-9])' + escapeRegExp(term))
    if (WORD_START_CACHE.size > 500) WORD_START_CACHE.clear()
    WORD_START_CACHE.set(term, re)
  }
  return re.test(hay)
}

type Folded = { title: string; titleVi: string; model: string; brand: string; categoryText: string }

function foldRow(row: RelevanceRow): Folded {
  return {
    title: fold(row.title || ''),
    titleVi: fold(row.titleVi || ''),
    model: fold(row.model || ''),
    brand: (row.brandSlug || '').replace(/-/g, ' '),
    categoryText: fold(`${row.category.name} ${row.category.nameVi}`),
  }
}

/** Evidence for one term: title + model/brand + category, 0 when none of those fields hold it. */
function termWeight(f: Folded, row: RelevanceRow, term: string): number {
  let t = 0
  if (wordStart(f.title, term) || wordStart(f.titleVi, term)) {
    t = REL.TITLE
    if (f.title.startsWith(term) || f.titleVi.startsWith(term)) t += REL.TITLE_START
  }
  const m = wordStart(f.model, term) || (!!f.brand && f.brand.startsWith(term)) ? REL.MODEL_BRAND : 0
  const c =
    (row.subcategorySlug != null && subcategoryIntent(term).has(row.subcategorySlug)) ||
    (CAT_INTENT.get(term)?.has(row.category.slug) ?? false) ||
    wordStart(f.categoryText, term)
      ? REL.CATEGORY
      : 0
  return t + m + c
}

/**
 * How well a row answers the query, in [0, 1], and whether EVERY unit found evidence in the row's
 * own title, model, brand or category (`strong`). A synonym term counts SYNONYM_FACTOR of the typed
 * one, so "condo" still prefers a row that says "condo". Two or more units spelled out, in order, in
 * the title earn PHRASE_BONUS.
 */
export function scoreRow(row: RelevanceRow, query: ParsedQuery): { relevance: number; strong: boolean } {
  const { units, phrase } = query
  if (!units.length) return { relevance: 0, strong: false }
  const f = foldRow(row)
  let sum = 0
  let strong = true
  for (const u of units) {
    let best = 0
    u.terms.forEach((term, i) => {
      const w = termWeight(f, row, term) * (i === 0 ? 1 : REL.SYNONYM_FACTOR)
      if (w > best) best = w
    })
    if (best > 0) sum += best
    else {
      sum += REL.DESC_ONLY
      strong = false
    }
  }
  const bonus = units.length >= 2 && phrase && (f.title.includes(phrase) || f.titleVi.includes(phrase)) ? REL.PHRASE_BONUS : 0
  return { relevance: Math.min(1, sum / (REL.MAX_PER_UNIT * units.length) + bonus), strong }
}
