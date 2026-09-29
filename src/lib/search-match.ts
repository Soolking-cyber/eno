/**
 * THE TEXT PREDICATE OF A SEARCH — one builder for the feed (feed-query.ts), the typeahead
 * (api/search/suggest) and the trending chips (trending.ts), so a query means the same rows on every
 * surface: total, histogram, facet counts and the map's buildings all derive from the feed's
 * `andFilters`, which is built here.
 *
 * ⛔ SHORT TOKENS MATCH AT A WORD START, NOT ANYWHERE. Recall used to be a raw substring AND over the
 * folded tokens, and 2-3 character Vietnamese syllables live inside unrelated words: `may` in "maybe"
 * and "máy tính", `xe` in "flexes", `tu` in half the catalogue. Measured on production 2026-09-29:
 * "xe máy" 1,111 rows led by a sports bra and a MacBook, "tu lanh" 2,052 led by a jacket. The AI
 * concierge had already solved this with word-boundary matching (its comment: never revert it to a
 * plain contains); this is that rule, shared.
 * ⚠️ TYPED TOKENS OF 4+ CHARACTERS KEEP SUBSTRING MATCHING, so "phone" still finds "iphone" and
 * "smartphone", and "iphone" keeps its total. Only the short syllables were the noise. A SYNONYM the
 * reader did not type always matches at a word start (unitClause).
 *
 * ⚠️ PURE AND PRISMA-TYPED ONLY (a type import), so the relevance scorer and its tests read the same
 * units without a database.
 */
import type { Prisma } from '@/generated/prisma/client'
import { unitsFor, type SearchUnit } from './search-synonyms'

/**
 * The characters that start a word inside the folded `searchText` blob. fold() keeps punctuation, so a
 * space alone is not enough: "scooter" lives in "e-scooter" and "(scooter)". This set reproduces a
 * `~ '(^|[^a-z0-9])tok'` regex across the live table (verified per token by the concierge, which owned
 * it first: pen 2→1, scooter 50→100, art 144→28). Prisma has no regex filter, hence the list.
 */
export const WORD_BOUNDARY = [' ', '-', '/', '(', ',', '.', '&'] as const

/**
 * `searchText` has `term` at a word start.
 * ⛔ THE PLAIN `contains term` LEADS, AND IT IS WHAT KEEPS A RARE SEARCH FAST. Every disjunct below
 * implies it, so the meaning is unchanged — but a row that does not hold the term at all (nearly every
 * row, for a rare term) now costs ONE LIKE instead of eight. That matters because a feed page is
 * `ORDER BY rankScore LIMIT n`: when few rows match, Postgres walks the whole sorted index testing
 * each row. Measured 2026-09-29 against the production data (dev server, fresh process each run):
 * "mũ bảo hiểm" (three terms, 24 LIKEs a row) took 4.4 s cold and 4.2 s warm; with this guard,
 * 0.26-0.35 s cold and 0.17-0.18 s warm. The old three-substring filter was ~0.4 s on eno.vn.
 */
export function wordStart(term: string): Prisma.ListingWhereInput {
  return {
    AND: [
      { searchText: { contains: term } },
      {
        OR: [
          { searchText: { startsWith: term } },
          ...WORD_BOUNDARY.map((b): Prisma.ListingWhereInput => ({ searchText: { contains: `${b}${term}` } })),
        ],
      },
    ],
  }
}

/** One term: a word start for a short token or a phrase, a substring for a single word of 4+ characters. */
function termClause(term: string): Prisma.ListingWhereInput {
  return term.length <= 3 || term.includes(' ') ? wordStart(term) : { searchText: { contains: term } }
}

/** A single typed token (no synonyms): the same rule, named for what the feed calls it. */
export function tokenClause(t: string): Prisma.ListingWhereInput {
  return termClause(t)
}

/**
 * One unit: its token, or ANY of its synonym terms. The typed term (`terms[0]`) follows the token
 * rule above; every OTHER term matches at a word start only.
 * ⛔ A SYNONYM IS NOT A SUBSTRING. The 4+ character substring exception exists so what the reader
 * TYPED keeps its recall ("phone" → "iphone"). Applied to the synonyms too, it widened the query
 * through words the reader never typed: "smartphone" and "điện thoại" also matched "headphone",
 * "microphone" and "earphone" through the synonym "phone", and "tv" matched "sensitivity" through
 * "tivi" (review, 2026-09-29).
 * ⚠️ A word start is still a PREFIX: "condo" (a synonym of "apartment") also starts "condom".
 * Prisma has no regex filter to anchor the end of a word; the relevance ranker (text-relevance.ts)
 * scores such a row by its own title and aisle, so it sits in the tail, not the head.
 */
export function unitClause(u: SearchUnit): Prisma.ListingWhereInput {
  return u.terms.length > 1
    ? { OR: u.terms.map((t, i) => (i === 0 ? termClause(t) : wordStart(t))) }
    : tokenClause(u.terms[0])
}

/**
 * The units a folded query searches for: its ≥2-character tokens (the first six — the feed's
 * long-standing rule, so a pasted paragraph cannot build an unbounded query), grouped by synonyms.
 */
export function searchUnits(textFolded: string): SearchUnit[] {
  const tokens = textFolded.split(/\s+/).filter((t) => t.length >= 2).slice(0, 6)
  return unitsFor(tokens)
}

/**
 * The clauses a query ANDs together (one per unit). A query with no ≥2-character token keeps the old
 * whole-string substring, so a one-letter search still answers; an empty query has no clause.
 */
export function textClauses(textFolded: string): Prisma.ListingWhereInput[] {
  const units = searchUnits(textFolded)
  if (units.length) return units.map(unitClause)
  return textFolded ? [{ searchText: { contains: textFolded } }] : []
}

/**
 * The feed's text filter: every unit (AND), or any unit for a `loose` caller (visual search's
 * `match=any`, so "blue pen" still surfaces "pen"). null when there is nothing to match.
 */
export function textPredicate(textFolded: string, opts: { loose?: boolean } = {}): Prisma.ListingWhereInput | null {
  const units = searchUnits(textFolded)
  if (!units.length) return textFolded ? { searchText: { contains: textFolded } } : null
  const clauses = units.map(unitClause)
  return opts.loose ? { OR: clauses } : { AND: clauses }
}
