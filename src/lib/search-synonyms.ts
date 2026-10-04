/**
 * SEARCH SYNONYMS — the groups in src/data/search-synonyms.json, folded once, and the scan that turns a
 * query's tokens into search UNITS. Pure: no db, no 'server-only', so the feed, the typeahead and the
 * relevance scorer (text-relevance.ts) all read one definition.
 *
 * ⛔ A UNIT IS WHAT THE QUERY MUST MATCH ONCE. "xe máy" is one unit, not the tokens `xe` AND `may`:
 * as two substring tokens they matched a sports bra and a MacBook ("máy tính") — 1,111 rows on
 * production, 2026-09-29. As one unit it is the phrase at a word start OR any of its group's terms.
 * Tokens outside every group stay one unit each, exactly as before.
 */
import data from '@/data/search-synonyms.json'
import { fold } from './fold'

/** One thing a query asks for: `terms[0]` is what the reader typed, the rest are its synonyms. */
export type SearchUnit = { terms: string[]; synonym: boolean }

type Group = { terms: string[] }

/** Folded, de-duplicated groups (`terms` in file order). */
export const SYNONYM_GROUPS: readonly (readonly string[])[] = (data.groups as Group[]).map((g) =>
  [...new Set(g.terms.map((t) => fold(t)).filter(Boolean))],
)

/** folded term → its group. A term listed in two groups keeps the first (the file should not do that). */
const GROUP_OF = new Map<string, readonly string[]>()
for (const g of SYNONYM_GROUPS) for (const t of g) if (!GROUP_OF.has(t)) GROUP_OF.set(t, g)

/** The longest group term, in words — the widest run the scan below has to try. */
const MAX_WORDS = Math.max(1, ...[...GROUP_OF.keys()].map((t) => t.split(' ').length))

/**
 * Folded tokens → units: a left-to-right, longest-match-first scan of contiguous token runs against
 * the group terms. A matched run becomes ONE unit whose first term is the run as typed, followed by
 * the rest of its group; anything else is a unit of its own token.
 */
export function unitsFor(foldedTokens: readonly string[]): SearchUnit[] {
  const units: SearchUnit[] = []
  for (let i = 0; i < foldedTokens.length; ) {
    let matched = 0
    for (let len = Math.min(MAX_WORDS, foldedTokens.length - i); len >= 1; len--) {
      const run = foldedTokens.slice(i, i + len).join(' ')
      const group = GROUP_OF.get(run)
      if (group) {
        units.push({ terms: [run, ...group.filter((t) => t !== run)], synonym: true })
        matched = len
        break
      }
    }
    if (matched) {
      i += matched
    } else {
      units.push({ terms: [foldedTokens[i]], synonym: false })
      i++
    }
  }
  return units
}

/**
 * CONDITION WORDS ARE NOT A UNIT (field-03, UX program 2). "second hand furniture" — the exact slug of
 * our own SEO hub — found 2 unrelated rows while "furniture" found hundreds: as units, `second` and
 * `hand` had to appear in the row's text, and almost no used sofa says "second hand". So the words
 * leave the text — and filter NOTHING (commit gate, 2026-10-04): the post wizard labels the stored value
 * 'new' "Mới / Như mới" (new / like new), so a "not new" filter would drop members' like-new second-hand
 * items. A query of condition words ONLY is the goods browse — items for sale (feed-query.ts).
 * ⛔ NOT A SYNONYM GROUP: groups OR their terms, which would leave `hand` free to match on its own.
 * ⛔ MATCHED ON THE WORDS AS TYPED, BEFORE fold(): fold() makes "cũ" (used) and "củ" (Củ Chi, an HCMC
 * district — and rentals are most of the stock) the same `cu`. Only the ACCENTED "cũ" is a condition
 * word; a bare unaccented `cu` stays an ordinary unit, so "nha cu chi" still finds Củ Chi.
 * ⚠️ 'thanh lý' (a moving-sale clear-out) is NOT here: it names the moving-sale shelf, so it stays
 * a word the rows must match.
 */
const CONDITION_PHRASES: readonly (readonly string[])[] = [
  ['đã', 'qua', 'sử', 'dụng'],
  ['second', 'hand'],
  ['pre', 'owned'],
  ['đồ', 'cũ'],
  ['second-hand'],
  ['secondhand'],
  ['pre-owned'],
  ['preowned'],
  ['used'],
  ['cũ'],
]

/** Punctuation a typed word may carry at either end ("used," "(cũ)") — not part of the word. */
const EDGE_PUNCT = /^[("'“‘[]+|[)"'”’\].,!?;:]+$/g

/**
 * For each word of a query already split on whitespace, whether it belongs to a condition phrase —
 * the reading `splitConditionWords` applies, word by word, for a caller that must keep the words in
 * place: the typo corrector (spell-correct.ts) must neither "correct" `hand` into `han` nor hand back
 * "cũ" folded into the `cu` of Củ Chi. Pure.
 */
export function conditionWordMask(words: readonly string[]): boolean[] {
  const bare = words.map((w) => w.normalize('NFC').toLowerCase().replace(EDGE_PUNCT, ''))
  const mask = words.map(() => false)
  for (let i = 0; i < words.length; ) {
    const hit = CONDITION_PHRASES.find((p) => p.every((t, j) => bare[i + j] === t))
    if (hit) {
      for (let j = 0; j < hit.length; j++) mask[i + j] = true
      i += hit.length
    } else {
      i++
    }
  }
  return mask
}

/**
 * Splits a raw query into the words left for the text search and whether it asked for second-hand.
 * `rest` keeps the reader's own spelling of every other word (the district reader and the accented
 * title recall downstream need it); it is '' when the query was ONLY condition words ("second hand",
 * "đồ cũ"), which the feed answers as the used-goods browse. Pure.
 */
export function splitConditionWords(raw: string): { rest: string; used: boolean } {
  const words = raw.normalize('NFC').trim().split(/\s+/).filter(Boolean)
  const mask = conditionWordMask(words)
  const used = mask.some(Boolean)
  return { rest: used ? words.filter((_, i) => !mask[i]).join(' ') : raw, used }
}
