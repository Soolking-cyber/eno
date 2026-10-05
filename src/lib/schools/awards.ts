import 'server-only'
import { db } from '@/lib/db'
import { verifiedProfileIds } from '@/lib/kyc/identity'
import { AWARD_FIRST_YEAR, REVIEWS_NEED_PROOF, SCHOOL_KINDS, VOTES_NEED_IDENTITY, type SchoolKind } from './constants'
import { awardReviews, awardVotes, queuedReviewCountIn } from './queries'
import { awardWindow, currentAwardYear, placesOf, rankCategory, type Standing } from './award-rank'

/**
 * TEACHERS' CHOICE — the yearly awards (owner, 2026-10-05: "make it yearly award like experience like best school
 * to work with in Saigon 2026"). Plan: ~/.claude/plans/eno-schools-v2-2026-10-05.md §D and v2.2.
 *
 * One category per school kind. A year is Saigon's calendar year. What counts (queries.ts awardVotes /
 * awardReviews say exactly): each identity-verified voter's last vote CAST in the year, and published reviews
 * submitted in the year by writers whose employment was checked AND who hold a verified identity — both judged
 * AS OF THE CUTOFF (verifiedProfileIds asOf), a revocation whenever it happens. A school qualifies with
 * AWARD_MIN_VOTERS voters and AWARD_MIN_REVIEWS reviews; the board's own Wilson score ranks it (award-rank.ts).
 *
 * ⛔ FROZEN ONCE FINAL: finaliseAwards writes the places and the year's marker in one transaction, under a lock
 * per year, and never again — later votes never change a past award.
 * ⛔ NO LEADERBOARD WHILE OPEN: the page lists who qualifies, alphabetically, without numbers — it does not present
 * the year as a race. (The board's live counts are public all year, so this is presentation, not secrecy.)
 * ⚠️ NO SUPERLATIVE in any name (Vietnamese advertising rules; counsel to confirm): "Teachers' Choice 2026".
 */

export type CategoryStandings = Record<SchoolKind, (Standing & { slug: string })[]>

/** Every category's qualified schools for a year, best first, with what they were computed from. */
export async function awardStandings(year: number, now: Date = new Date()): Promise<{ categories: CategoryStandings; voters: number; reviews: number }> {
  const { start, end } = awardWindow(year)
  // Identity is judged at the cutoff for a closed year — and at TODAY for an open one (diff review: judging it at a
  // future 31 December would drop a teacher whose document is valid now but expires before then).
  const asOf = now < end ? now : end
  const [votes, reviews, schools] = await Promise.all([
    awardVotes(start, end, asOf),
    awardReviews(start, end),
    db.school.findMany({ where: { status: 'active' }, select: { id: true, slug: true, name: true, kind: true } }),
  ])
  // A verified person AS OF THE CUTOFF — a revocation counts whenever it was made (identity.ts says how).
  // A closed year: AS OF its cutoff. An open year: plainly today (diff review: "as of" sets aside rows with no decision
  // date, which today's view — the board's — would count).
  const ids = [...votes.map((v) => v.profileId), ...reviews.map((r) => r.profileId)]
  const people = !VOTES_NEED_IDENTITY && !REVIEWS_NEED_PROOF ? new Set<string>()
    : now < end ? await verifiedProfileIds(ids, now) : await verifiedProfileIds(ids, end, { asOf: end })
  // Identity counts only while a switch asks for it (constants.ts, owner 2026-10-06: any signed-in account votes and reviews).
  const votesOk = (id: string) => !VOTES_NEED_IDENTITY || people.has(id)
  const reviewsOk = (id: string) => !REVIEWS_NEED_PROOF || people.has(id)
  const tally = new Map<string, { up: number; down: number; reviews: number }>()
  const at = (id: string) => { let t = tally.get(id); if (!t) tally.set(id, (t = { up: 0, down: 0, reviews: 0 })); return t }
  const voters = new Set<string>()
  for (const v of votes) {
    if (!votesOk(v.profileId) || (v.value !== 1 && v.value !== -1)) continue
    voters.add(v.profileId)
    if (v.value === 1) at(v.schoolId).up++
    else at(v.schoolId).down++
  }
  let reviewCount = 0
  for (const r of reviews) if (reviewsOk(r.profileId)) { at(r.schoolId).reviews++; reviewCount++ }
  const categories = Object.fromEntries(SCHOOL_KINDS.map((k) => [k, [] as (Standing & { slug: string })[]])) as CategoryStandings
  for (const kind of SCHOOL_KINDS) {
    const of = schools.filter((s) => s.kind === kind && tally.has(s.id))
    const slug = new Map(of.map((s) => [s.id, s.slug]))
    categories[kind] = rankCategory(of.map((s) => ({ schoolId: s.id, name: s.name, ...tally.get(s.id)! }))).map((x) => ({ ...x, slug: slug.get(x.schoolId)! }))
  }
  return { categories, voters: voters.size, reviews: reviewCount }
}

export type FinaliseResult =
  | { ok: true; already: boolean; places: number; slugs: string[] }
  | { ok: false; code: 'award_year_open' | 'award_year_invalid' }
  | { ok: false; code: 'award_reviews_pending'; pending: number }

/**
 * Close a year: write its places and its marker, ONCE. Refuses an open year; a second call (the cron and an
 * admin at the same moment, or the cron the next day) finds the marker under the same lock and writes nothing.
 */
export async function finaliseAwards(year: number, by: string, now: Date = new Date()): Promise<FinaliseResult> {
  if (!Number.isInteger(year) || year < AWARD_FIRST_YEAR) return { ok: false, code: 'award_year_invalid' }
  const { start, end } = awardWindow(year)
  if (now < end) return { ok: false, code: 'award_year_open' }
  // ⛔ NOT WHILE THE YEAR'S REVIEWS ARE STILL BEING READ (diff review): a review submitted in the year and still in the
  // moderation queue would otherwise miss the year for good, and the frozen result would depend on WHEN it was closed.
  // Only reviews a moderator can decide (the queue's own rule): one whose writer has no live proof waits off the
  // queue and could never count, so it must not hold the year open (diff review).
  const pending = await queuedReviewCountIn(start, end)
  if (pending > 0) return { ok: false, code: 'award_reviews_pending', pending }
  // Computed BEFORE the transaction (diff review): reading through `db` while a transaction holds a connection could
  // wait forever on a one-connection pool. A closed year's inputs no longer change, so the result is the same.
  const st = await awardStandings(year, now)
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`select pg_advisory_xact_lock(hashtext(${`school-awards:${year}`}))`
    if (await tx.schoolAwardYear.findUnique({ where: { year }, select: { year: true } })) return { ok: true as const, already: true, places: 0, slugs: [] }
    const placed = SCHOOL_KINDS.flatMap((category) => placesOf(st.categories[category]).map((p) => ({ category, p })))
    const rows = placed.map(({ category, p }) => ({ year, category, rank: p.rank, schoolId: p.schoolId, score: p.score, up: p.up, down: p.down, reviews: p.reviews }))
    if (rows.length) await tx.schoolAward.createMany({ data: rows })
    await tx.schoolAwardYear.create({ data: { year, finalisedBy: by, voters: st.voters, reviews: st.reviews } })
    // The placed schools' pages carry the new badge: the caller purges them.
    return { ok: true as const, already: false, places: rows.length, slugs: placed.map(({ p }) => p.slug) }
  }, { timeout: 120_000, maxWait: 10_000 })
}

export type AwardsPage =
  | { state: 'final'; year: number; finalisedAt: string; voters: number; reviews: number; places: { category: SchoolKind; rank: number; score: number; up: number; down: number; reviews: number; school: { slug: string; name: string } }[]; withheld: Partial<Record<SchoolKind, number>> }
  | { state: 'open' | 'counting'; year: number; qualified: Record<SchoolKind, { slug: string; name: string }[]> }

/** What /schools/awards/[year] shows: the frozen results, or — while open — who qualifies so far, by name only. */
export async function awardsPage(year: number, now: Date = new Date()): Promise<AwardsPage | null> {
  if (!Number.isInteger(year) || year < AWARD_FIRST_YEAR || year > currentAwardYear(now)) return null
  const final = await db.schoolAwardYear.findUnique({ where: { year } })
  if (final) {
    const rows = await db.schoolAward.findMany({
      where: { year }, orderBy: [{ category: 'asc' }, { rank: 'asc' }],
      select: { category: true, rank: true, score: true, up: true, down: true, reviews: true, school: { select: { slug: true, name: true, status: true } } },
    })
    // ⛔ A SCHOOL HIDDEN SINCE IS NOT NAMED (diff review): its place stays in the record, but the page says only that
    // a place is no longer listed — hiding is a moderator's decision, not the public's to read (as everywhere else).
    const withheld: Partial<Record<SchoolKind, number>> = {}
    for (const r of rows) if (r.school.status !== 'active') withheld[r.category as SchoolKind] = (withheld[r.category as SchoolKind] ?? 0) + 1
    return {
      state: 'final', year, finalisedAt: final.finalisedAt.toISOString(), voters: final.voters, reviews: final.reviews, withheld,
      places: rows.filter((r) => r.school.status === 'active').map((r) => ({ category: r.category as SchoolKind, rank: r.rank, score: r.score, up: r.up, down: r.down, reviews: r.reviews, school: { slug: r.school.slug, name: r.school.name } })),
    }
  }
  const st = await awardStandings(year, now)
  const qualified = Object.fromEntries(SCHOOL_KINDS.map((k) => [k, st.categories[k].map((s) => ({ slug: s.slug, name: s.name })).sort((a, b) => a.name.localeCompare(b.name))])) as Record<SchoolKind, { slug: string; name: string }[]>
  return { state: year === currentAwardYear(now) ? 'open' : 'counting', year, qualified }
}
