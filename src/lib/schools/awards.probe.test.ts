// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

/**
 * Teachers' Choice against a REAL Postgres (2026-10-05): what a year counts (the vote LOG, identity AS OF the
 * cutoff, reviews by checked AND verified writers), qualification, the frozen finalisation and its idempotency.
 * Year 2099, so nothing the scratch database holds for real years can take part.
 *
 * ⛔ Same opt-in and guards as queries.probe.test.ts: RACE_DB_TESTS=1, loopback only, never :5433.
 * Run it: DATABASE_URL=postgresql://postgres@127.0.0.1:5544/eno RACE_DB_TESTS=1 npx vitest run src/lib/schools/awards.probe.test.ts
 */
vi.mock('server-only', () => ({}))
const url = process.env.DATABASE_URL || ''
const parsed = (() => { try { return new URL(url) } catch { return null } })()
const loopback = ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(parsed?.hostname ?? '')
const live = process.env.RACE_DB_TESTS === '1' && loopback && parsed?.port !== '5433'

const YEAR = 2099
const DAY = 86_400_000
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const at = (iso: string) => new Date(iso)
const WIN = 'probe-award-winner', SHORT = 'probe-award-short'
// 10 counted voters (9 up, 1 down), and five who must NOT count.
const GOOD = Array.from({ length: 10 }, (_, i) => uuid(9400 + i))
const WITHDREW = uuid(9411), LAST_YEAR = uuid(9412), AFTER_CUTOFF = uuid(9413), VERIFIED_LATE = uuid(9414), REVOKED_LATE = uuid(9415)
const WRITERS = [uuid(9420), uuid(9421), uuid(9422)], UNVERIFIED_WRITER = uuid(9423)
const ALL = [...GOOD, WITHDREW, LAST_YEAR, AFTER_CUTOFF, VERIFIED_LATE, REVOKED_LATE, ...WRITERS, UNVERIFIED_WRITER]

describe.skipIf(!live)("Teachers' Choice against a real Postgres", () => {
  let db: typeof import('@/lib/db').db
  let awards: typeof import('./awards')

  async function reset() {
    await db.schoolAward.deleteMany({ where: { year: YEAR } })
    await db.schoolAwardYear.deleteMany({ where: { year: YEAR } })
    await db.school.deleteMany({ where: { slug: { in: [WIN, SHORT] } } })
    await db.identityVerification.deleteMany({ where: { id: { startsWith: 'probe-aw-iv-' } } })
    await db.profile.deleteMany({ where: { id: { in: ALL } } })
  }

  beforeAll(async () => {
    db = (await import('@/lib/db')).db
    awards = await import('./awards')
    const { forgetCountedVoters } = await import('./queries')
    forgetCountedVoters()
    await reset()
    const old = new Date(Date.now() - 400 * DAY)
    for (const id of ALL) await db.profile.create({ data: { id, email: `${id.slice(-4)}@probe.test`, displayName: 'Probe', accountType: 'individual', createdAt: old } })
    const verify = async (id: string, i: number, decidedAt: Date, status = 'verified') => db.identityVerification.create({ data: {
      id: `probe-aw-iv-${i}-${status}`, profileId: id, tier: 'B', method: 'passport_mrz', status, decidedAt,
      documentExpiresAt: new Date('2199-01-01T00:00:00Z'), subjectHash: `${'a'.repeat(52)}${String(i).padStart(12, '0')}`,
    } })
    const before = at('2099-01-01T00:00:00Z'), afterCutoff = at('2100-01-05T00:00:00Z')
    for (const [i, id] of [...GOOD, WITHDREW, LAST_YEAR, AFTER_CUTOFF, REVOKED_LATE, ...WRITERS].entries()) await verify(id, i, before)
    await verify(VERIFIED_LATE, 90, afterCutoff) // verified only after the year closed: never counted for it
    await verify(REVOKED_LATE, 91, afterCutoff, 'revoked') // revoked after the cutoff: a revocation always counts
    const win = await db.school.create({ data: { slug: WIN, name: 'Probe Award Winner', kind: 'agency' } })
    const short = await db.school.create({ data: { slug: SHORT, name: 'Probe Award Short', kind: 'agency' } })
    // The vote LOG (the trigger writes it in life; written directly here to place events in 2099).
    const ev = (schoolId: string, profileId: string, value: number, when: string) => db.schoolVoteEvent.create({ data: { schoolId, profileId, value, at: at(when) } })
    for (const [i, id] of GOOD.entries()) {
      await ev(win.id, id, -1, '2099-02-01T00:00:00Z')
      await ev(win.id, id, i === 0 ? -1 : 1, '2099-03-01T00:00:00Z') // the LAST vote of the year counts
      await ev(short.id, id, 1, '2099-03-01T00:00:00Z')
    }
    await ev(win.id, WITHDREW, 1, '2099-03-01T00:00:00Z'); await ev(win.id, WITHDREW, 0, '2099-04-01T00:00:00Z')
    await ev(win.id, LAST_YEAR, 1, '2098-06-01T00:00:00Z')
    await ev(win.id, AFTER_CUTOFF, 1, '2099-12-31T17:30:00Z') // 00:30 on 1 January 2100 in Saigon
    await ev(win.id, VERIFIED_LATE, 1, '2099-05-01T00:00:00Z')
    await ev(win.id, REVOKED_LATE, 1, '2099-05-01T00:00:00Z')
    // Reviews: three by checked AND verified writers; one by a checked writer with no verified identity.
    for (const [i, id] of [...WRITERS, UNVERIFIED_WRITER].entries()) {
      await db.schoolEmployment.create({ data: { schoolId: win.id, profileId: id, method: 'linkedin', status: 'verified', linkedinHash: `${'b'.repeat(56)}${String(i).padStart(8, '0')}`, decidedAt: before, decidedBy: 'probe' } })
      await db.schoolReview.create({ data: {
        schoolId: win.id, profileId: id, current: false, tenure: '1to2', role: 'teacher', employment: 'full_time',
        pros: 'Pays on time and supports new teachers well.', cons: 'Long commutes between campuses.', status: 'published', submittedAt: at('2099-06-01T00:00:00Z'),
      } })
    }
    // SHORT: two reviews only — 10 voters, but it does not qualify.
    for (const [i, id] of WRITERS.slice(0, 2).entries()) {
      await db.schoolEmployment.create({ data: { schoolId: short.id, profileId: id, method: 'linkedin', status: 'verified', linkedinHash: `${'c'.repeat(56)}${String(i).padStart(8, '0')}`, decidedAt: before, decidedBy: 'probe' } })
      await db.schoolReview.create({ data: {
        schoolId: short.id, profileId: id, current: true, tenure: 'lt1', role: 'teacher', employment: 'part_time',
        pros: 'Friendly staff and good materials.', cons: 'Classes are large and often noisy.', status: 'published', submittedAt: at('2099-06-01T00:00:00Z'),
      } })
    }
  })
  afterAll(async () => { await reset(); await db.$disconnect() })

  it('counts each verified voter’s last vote of the year, and reviews by checked AND verified writers', async () => {
    const st = await awards.awardStandings(YEAR, at('2100-01-02T00:00:00Z')) // asked once the year has closed
    expect(st.categories.agency).toHaveLength(1)
    expect(st.categories.agency[0]).toMatchObject({ slug: WIN, up: 9, down: 1, reviews: 3, voters: 10 })
  })

  it('while open: who qualifies, by name only; it cannot be closed early', async () => {
    const open = await awards.awardsPage(YEAR, at('2099-06-01T00:00:00Z'))
    expect(open).toMatchObject({ state: 'open', qualified: { agency: [{ slug: WIN, name: 'Probe Award Winner' }] } })
    expect(JSON.stringify(open)).not.toMatch(/"(up|down|score)"/)
    expect(await awards.finaliseAwards(YEAR, 'probe', at('2099-12-31T16:59:00Z'))).toEqual({ ok: false, code: 'award_year_open' })
    expect(await awards.awardsPage(YEAR + 1, at('2099-06-01T00:00:00Z'))).toBeNull() // a future year has no page
  })

  it('closing writes the places once; a second close writes nothing; later votes change nothing', async () => {
    const after = at('2100-01-01T00:00:00Z')
    // Not while a review submitted in the year still waits for a moderator.
    const win = await db.school.findUniqueOrThrow({ where: { slug: WIN } })
    const waiting = await db.schoolReview.update({ where: { schoolId_profileId: { schoolId: win.id, profileId: WRITERS[0] } }, data: { status: 'pending' } })
    expect(await awards.finaliseAwards(YEAR, 'probe', after)).toEqual({ ok: false, code: 'award_reviews_pending', pending: 1 })
    // A waiting review whose writer has no live proof could never count: it does not hold the year open.
    const { queuedReviewCountIn } = await import('./queries')
    const { awardWindow } = await import('./award-rank')
    const w = awardWindow(YEAR)
    expect(await queuedReviewCountIn(w.start, w.end)).toBe(1)
    await db.schoolEmployment.update({ where: { profileId_schoolId: { profileId: WRITERS[0], schoolId: win.id } }, data: { status: 'withdrawn' } })
    expect(await queuedReviewCountIn(w.start, w.end)).toBe(0)
    await db.schoolEmployment.update({ where: { profileId_schoolId: { profileId: WRITERS[0], schoolId: win.id } }, data: { status: 'verified' } })
    await db.schoolReview.update({ where: { id: waiting.id }, data: { status: 'published' } })
    expect(await awards.finaliseAwards(YEAR, 'probe', after)).toEqual({ ok: true, already: false, places: 1, slugs: [WIN] })
    expect(await awards.finaliseAwards(YEAR, 'probe', after)).toEqual({ ok: true, already: true, places: 0, slugs: [] })
    await db.schoolVoteEvent.create({ data: { schoolId: win.id, profileId: GOOD[0], value: 1, at: at('2099-12-31T16:00:00Z') } })
    const page = await awards.awardsPage(YEAR, at('2100-01-02T00:00:00Z'))
    expect(page).toMatchObject({ state: 'final', withheld: {}, places: [{ category: 'agency', rank: 1, up: 9, down: 1, reviews: 3, school: { slug: WIN } }] })
    // Hidden since: not named — the category says a place is no longer listed.
    await db.school.update({ where: { id: win.id }, data: { status: 'hidden' } })
    expect(await awards.awardsPage(YEAR, at('2100-01-02T00:00:00Z'))).toMatchObject({ state: 'final', places: [], withheld: { agency: 1 } })
    await db.school.update({ where: { id: win.id }, data: { status: 'active' } })
    const { schoolAwards } = await import('./queries')
    expect((await schoolAwards([win.id])).get(win.id)).toEqual([{ year: YEAR, rank: 1 }])
  })
})
