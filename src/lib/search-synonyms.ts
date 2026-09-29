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
