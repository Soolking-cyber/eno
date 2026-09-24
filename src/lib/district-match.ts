import type { Prisma } from '@/generated/prisma/client'
import { DISTRICTS } from '@/components/marketplace/listings-explorer.constants'

/**
 * HOW ONE CURATED DISTRICT SPELLING (`DISTRICTS[].match`) IS MATCHED AGAINST A LISTING — the SQL
 * predicate and its JavaScript mirror, defined side by side so they cannot drift.
 *
 * ⛔ "Quận 1" IS A SUBSTRING OF "Quận 10", "Quận 11" AND "Quận 12", AND A BARE `contains` SAID YES
 * TO ALL THREE. Measured on production 2026-09-24: `?district=d1` returned 2,794 rentals where
 * Quận 1 has 1,373 — the rest were Quận 10 (730), 11 (143) and 12 (558), and 15 of the first 24
 * cards were Quận 12. The /c/rentals/d1 landing page announced "District 1 · 2,799".
 *
 * ⚠️ A SPELLING THAT ENDS IN A DIGIT THEREFORE MATCHES ONLY AT A NUMBER BOUNDARY, in any of three
 * ways: followed by one of the delimiters below; at the very end of the field; or — whatever follows
 * it — in a field where it is never followed by a DIGIT (no "Quận 10…" anywhere in it). The first two
 * cover every shape the importers write — `Quận 1` (the district column), `Quận 1 (P. Bến Thành mới)`
 * (Batdongsan, nhatot), `Phường 5, Quận 1, Hồ Chí Minh` (Rever, muaban), `P. An Phú, Quận 2`
 * (Honeycomb). The third exists because a delimiter list is only ever as complete as the data seen
 * so far (reviewers named CRLF, quotes, `#`…): a field that names one district is matched whatever
 * character follows the number, and only a field that ALSO names a longer number relies on the
 * list. `Quận 10 (…)` can satisfy a search for Quận 1 in none of the three. A spelling ending in a
 * letter keeps the plain `contains` it always had.
 *
 * ⚠️ STILL CASE-SENSITIVE, like every district predicate before it: Prisma's `contains` without a
 * mode is `LIKE '%x%'`, and `districtTextMatches` below uses `includes`/`endsWith` to agree with it.
 */

/**
 * What may follow a numbered spelling for it to be that number and not the start of a longer one.
 * Measured 2026-09-24: every live row that names a numbered district follows it with one of the first
 * seven or ends there (0 rows with anything else); the rest cover free text a seller might type.
 * Anything not listed still matches through the no-longer-number clause below.
 */
export const DISTRICT_NUMBER_DELIMITERS = [' ', ',', ')', '.', ';', '/', '-', ':', '|', '(', '–', '—', '\u00a0', '\n', '\t'] as const

const endsInDigit = (m: string) => /\d$/.test(m)

type Field = 'district' | 'location'
const on = (field: Field, filter: { contains: string } | { endsWith: string }): Prisma.ListingWhereInput =>
  field === 'district' ? { district: filter } : { location: filter }

const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'] as const

/** The OR-clauses that match spelling `m` on one text column. */
export function districtFieldClauses(field: Field, m: string): Prisma.ListingWhereInput[] {
  if (!endsInDigit(m)) return [on(field, { contains: m })]
  // ⚠️ ORDERED FOR THE ROWS THAT MATCH (the guard in districtMatchWhere has already failed the rest):
  // the district column usually IS the spelling, so `endsWith` answers it in one LIKE.
  return [
    on(field, { endsWith: m }),
    ...DISTRICT_NUMBER_DELIMITERS.map((d) => on(field, { contains: m + d })),
    // Any other character after the number, in a field that never continues it with a digit.
    { AND: [on(field, { contains: m }), { NOT: { OR: DIGITS.map((g) => on(field, { contains: m + g })) } }] },
  ]
}

/**
 * The scope for a curated district: any of its spellings, on the district OR the location column.
 *
 * ⚠️ THE BOUNDED FORM IS GUARDED BY THE CHEAP ONE. A number boundary costs one LIKE per delimiter
 * plus an `endsWith` — sixteen per spelling per column — where a bare substring cost one, and nearly
 * every row fails ALL of them: ~80,000 of the ~100,000 live rows carry no district at all. Measured
 * on production with the first, seven-delimiter version, the unguarded OR took the d1 rentals count
 * from 91 ms to 165 ms. So the bare `contains` of each spelling comes first as its own AND operand: a
 * row without "Quận 1" anywhere fails it at one LIKE per spelling and column, and only the few that
 * pass pay for the boundary. Measured again with the full list and the guard (all live rows, median
 * of 7): d1 197 → 125 ms (fewer matches), d7 121 → 123 ms, thu-duc 132 → 151 ms. It changes no
 * answer — a bounded match implies the bare one.
 */
export function districtMatchWhere(match: readonly string[]): Prisma.ListingWhereInput {
  const OR: Prisma.ListingWhereInput[] = []
  for (const m of match) OR.push(...districtFieldClauses('district', m), ...districtFieldClauses('location', m))
  if (!match.some(endsInDigit)) return { OR }
  const bare: Prisma.ListingWhereInput[] = []
  for (const m of match) bare.push(on('district', { contains: m }), on('location', { contains: m }))
  return { AND: [{ OR: bare }, { OR }] }
}

/** The JavaScript twin of `districtFieldClauses` for one field value — same answer, row by row. */
export function districtTextMatches(hay: string, m: string): boolean {
  // The same guard the SQL has: nearly every field does not contain the spelling at all.
  if (!hay.includes(m)) return false
  if (!endsInDigit(m)) return true
  return (
    hay.endsWith(m) ||
    DISTRICT_NUMBER_DELIMITERS.some((d) => hay.includes(m + d)) ||
    (hay.includes(m) && !DIGITS.some((g) => hay.includes(m + g)))
  )
}

/**
 * The OTHER curated spellings that one of `slug`'s spellings is a strict prefix of — for `d1`, the
 * "Quận 10/11/12" and "District 10/11/12" families. The feed (district-slug.ts) refuses a row whose
 * canonical `district` column contains one of these, and the chip counts (facet-counts.ts) mirror it
 * through this same function. Derived, never typed out, so a district added to DISTRICTS is covered.
 */
export function longerDistrictSpellings(slug: string): string[] {
  const curated = DISTRICTS.find((d) => d.slug === slug)
  if (!curated?.match?.length) return []
  const longer = DISTRICTS.flatMap((d) => (d.slug === curated.slug ? [] : d.match ?? []))
    .filter((other) => curated.match!.some((m) => other.length > m.length && other.startsWith(m)))
  return [...new Set(longer)]
}
