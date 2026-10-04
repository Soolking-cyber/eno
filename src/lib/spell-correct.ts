import 'server-only'
/**
 * TYPO CORRECTION FOR A SEARCH THAT FOUND NOTHING — "iphnoe" → "iphone".
 *
 * ⛔ ONLY A ZERO-RESULT QUERY IS EVER CORRECTED (the route decides that; this module only proposes).
 * Measured 2026-09-29: "iphnoe" answered 0 while "iphone" answered 3,439. Vertex was the typo-tolerant
 * path and it is off in production; this is the in-memory stand-in. It needs no index and no schema
 * change: the vocabulary is the catalogue's own product lines, the taxonomy and the synonym groups,
 * plus the live brand names — one cached read.
 *
 * What bounds a wrong guess: only tokens of 4+ letters that are NOT already a known word are
 * candidates; the first letter must match; the edit budget is 1 for words up to 5 letters and 2 from
 * 6; and the explorer offers "Search instead for …" (the response's `correctedQuery`).
 */
import { db } from './db'
import { liveBrandCounts } from './live-brands'
import { fold } from './fold'
import { MODEL_LINEAGE } from '@/generated/model-lineage'
import { TAXONOMY } from './taxonomy'
import { SYNONYM_GROUPS, conditionWordMask } from './search-synonyms'
import synonymData from '@/data/search-synonyms.json'

/**
 * Optimal-string-alignment distance: Levenshtein plus the swap of two adjacent letters as ONE edit
 * ("iphnoe" is one swap from "iphone", two plain edits). Returns `max + 1` as soon as the distance is
 * known to exceed `max`.
 */
export function osaDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1
  const n = a.length
  const m = b.length
  let prev2: number[] = []
  let prev = Array.from({ length: m + 1 }, (_, j) => j)
  for (let i = 1; i <= n; i++) {
    const cur = [i]
    let rowMin = i
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1)
      cur.push(v)
      if (v < rowMin) rowMin = v
    }
    if (rowMin > max) return max + 1
    prev2 = prev
    prev = cur
  }
  return prev[m] > max ? max + 1 : prev[m]
}

/** folded word → priority (3 product lines and brands, 2 taxonomy and synonyms, 1 live brand names). */
export type Vocab = ReadonlyMap<string, number>

const CANDIDATE = /^[a-z]{4,}$/

/**
 * Correct each unknown token to its nearest vocabulary word, or return null when nothing changed.
 * A token is a candidate only if it is 4+ plain letters (no digits: "s24" is a model, not a typo) and
 * not in the vocabulary. Ties go to the smaller distance, then the higher priority, then the shorter
 * word, then alphabetical order — so the answer never depends on Map iteration order.
 */
export function correctTokens(tokens: readonly string[], vocab: Vocab): string[] | null {
  let changed = false
  const out = tokens.map((t) => {
    if (!CANDIDATE.test(t) || vocab.has(t)) return t
    const budget = t.length <= 5 ? 1 : 2
    let best: { w: string; d: number; p: number } | null = null
    for (const [w, p] of vocab) {
      if (w[0] !== t[0] || Math.abs(w.length - t.length) > budget) continue
      const d = osaDistance(t, w, budget)
      if (d > budget) continue
      if (
        !best ||
        d < best.d ||
        (d === best.d && (p > best.p || (p === best.p && (w.length < best.w.length || (w.length === best.w.length && w < best.w)))))
      ) {
        best = { w, d, p }
      }
    }
    if (!best) return t
    changed = true
    return best.w
  })
  return changed ? out : null
}

/** Folded single words of 3+ characters out of a phrase. */
const wordsOf = (s: string) => fold(s).split(/[^a-z0-9]+/).filter((w) => w.length >= 3)

/** The vocabulary that ships in the bundle: product lines, brands, the taxonomy, the synonyms. */
export function staticVocab(): Map<string, number> {
  const v = new Map<string, number>()
  const put = (w: string, p: number) => { if ((v.get(w) ?? 0) < p) v.set(w, p) }
  for (const [brand, lineage] of Object.entries(MODEL_LINEAGE)) {
    for (const w of wordsOf(brand.replace(/-/g, ' '))) put(w, 3)
    for (const line of lineage.lines) for (const w of wordsOf(line)) put(w, 3)
  }
  for (const cat of TAXONOMY) {
    for (const w of [...wordsOf(cat.name), ...wordsOf(cat.nameVi)]) put(w, 2)
    for (const sub of cat.subcategories) {
      for (const s of [sub.name, sub.nameVi, ...sub.keywords]) for (const w of wordsOf(s)) put(w, 2)
    }
  }
  for (const g of SYNONYM_GROUPS) for (const t of g) for (const w of wordsOf(t)) put(w, 2)
  return v
}

const VOCAB_TTL = 10 * 60_000
let vocabCache: { at: number; vocab: Promise<Vocab> } | null = null

/**
 * The full vocabulary: the static words plus every active brand with live listings (`normalized`,
 * e.g. "louisvuitton"), priority 1. Memoized for 10 minutes, the in-flight promise included. A failed
 * brand read degrades to the static words and is not cached.
 * ⛔ "LIVE" IS src/lib/live-brands.ts, NOT `listingCount > 0`: a correction steers a zero-result search
 * onto a brand, and the counter keeps a brand whose rows were sold or hidden since the last recount —
 * a correction into another empty result.
 */
export function buildVocab(): Promise<Vocab> {
  if (vocabCache && Date.now() - vocabCache.at < VOCAB_TTL) return vocabCache.vocab
  const vocab = liveBrandCounts()
    .then((live) => db.brand.findMany({ where: { status: 'active', slug: { in: [...live.keys()] } }, select: { normalized: true } }))
    .then((brands) => {
      const v = staticVocab()
      for (const b of brands) for (const w of wordsOf(b.normalized)) if (!v.has(w)) v.set(w, 1)
      return v as Vocab
    })
    .catch((e: unknown) => {
      console.error('[spell-correct] brand vocabulary read failed — static words only', e)
      vocabCache = null
      return staticVocab() as Vocab
    })
  vocabCache = { at: Date.now(), vocab }
  return vocab
}

/** Test seam. */
export function __resetVocabCache() {
  vocabCache = null
}

/**
 * folded word → its ONE accented spelling in the bundled words (taxonomy names and keywords, the raw
 * synonym file), so a corrected token can be shown the way the dictionary writes it ("thoai" → "thoại").
 * ⚠️ ONLY WHEN UNAMBIGUOUS: a folded word with two accented spellings ("ban": "bàn" a table, "bán" to
 * sell) or that also appears unaccented gets none — the folded word is shown rather than a guess.
 */
const ACCENTED: ReadonlyMap<string, string> = (() => {
  const forms = new Map<string, Set<string>>()
  const add = (text: string) => {
    for (const w of text.normalize('NFC').toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
      if (!w) continue
      const f = fold(w)
      const set = forms.get(f) ?? new Set<string>()
      set.add(w)
      forms.set(f, set)
    }
  }
  for (const cat of TAXONOMY) {
    add(cat.name); add(cat.nameVi)
    for (const sub of cat.subcategories) for (const t of [sub.name, sub.nameVi, ...sub.keywords]) add(t)
  }
  for (const g of synonymData.groups as { terms: string[] }[]) for (const t of g.terms) add(t)
  const out = new Map<string, string>()
  for (const [f, set] of forms) if (set.size === 1 && !set.has(f)) out.set(f, [...set][0])
  return out
})()

/**
 * The corrected query, or null when no token needed (or found) a correction.
 * Every word that was NOT corrected comes back exactly as typed — case and accents ("tủ lạnh samsng" →
 * "tủ lạnh samsung"); a corrected word comes back in its dictionary spelling when one is known
 * (ACCENTED), else folded like the vocabulary. The feed folds whatever it is sent, so this only changes
 * what the reader is shown (the typeahead's "did you mean", the results' "Showing results for").
 * ⛔ THE CONDITION WORDS ("second hand", "used", "cũ", "đồ cũ" — search-synonyms.ts conditionWordMask)
 * ARE NEVER CANDIDATES. Measured on the bundled vocabulary, "second hand sofaa" came back "second han
 * sofa" (`hand` is one edit from the word `han`), which no longer says second-hand; and folded, "cũ"
 * would be the `cu` of Củ Chi — a word the feed must match, not one it leaves out.
 */
export async function correctQuery(raw: string): Promise<string | null> {
  // Word by word, so each folded token stays beside the word it came from (fold keeps the word count).
  const words = raw.normalize('NFC').trim().split(/\s+/).filter((w) => fold(w))
  const condition = conditionWordMask(words)
  // A condition word goes in as '' — never a candidate — and so comes back unchanged.
  const tokens = words.map((w, i) => (condition[i] ? '' : fold(w)))
  if (!tokens.some((t) => CANDIDATE.test(t))) return null
  const fixed = correctTokens(tokens, await buildVocab())
  return fixed ? fixed.map((t, i) => (t === tokens[i] ? words[i] : ACCENTED.get(t) ?? t)).join(' ') : null
}
