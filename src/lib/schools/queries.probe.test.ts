// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
// ⛔ THIS PROBE PINS THE STRICT RULES (identity for votes, a 7-day account age, a proof for reviews): they are off in
// production since 2026-10-06 (constants.ts — owner: any signed-in account votes and reviews) but stay in the code
// behind switches, and this keeps them working for the day they are turned back on. The open rules have their own
// probe: schools-open.probe.test.ts.
vi.mock('@/lib/schools/constants', async (orig) => ({ ...(await orig<typeof import('@/lib/schools/constants')>()), VOTES_NEED_IDENTITY: true, REVIEWS_NEED_PROOF: true, ELIGIBLE_ACCOUNT_AGE_DAYS: 7 }))

/**
 * ⛔ THE ELIGIBILITY RULE IS RAW SQL, SO ONLY A REAL POSTGRES CAN TEST IT (2026-10-04).
 *
 * Every public number on /schools — the score, % recommend, helpful counts, the pay range — is computed
 * at read time by joining votes to the voter's Profile (src/lib/schools/queries.ts eligibleSql). A mock
 * would only echo the predicate back. This file seeds voters of every kind and checks who counts.
 *
 * ⛔ Opts in on RACE_DB_TESTS=1 (CI's throwaway-Postgres probe step) and refuses any host that is not
 * loopback, and port 5433 (the SSH tunnel to production) — the same guards as
 * src/lib/core/business-verification-race.probe.test.ts. It WRITES, and cleans up after itself.
 *
 * Run it: DATABASE_URL=postgresql://postgres@127.0.0.1:5544/eno RACE_DB_TESTS=1 npx vitest run src/lib/schools/queries.probe.test.ts
 */
const url = process.env.DATABASE_URL || ''
const parsed = (() => { try { return new URL(url) } catch { return null } })()
// Loopback ONLY — not the `postgres` service name the older probe accepts (codex, diff review).
const loopback = ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(parsed?.hostname ?? '')
const live = process.env.RACE_DB_TESTS === '1' && loopback && parsed?.port !== '5433'

const DAY = 86_400_000
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const P = {
  old1: uuid(9101), old2: uuid(9102), old3: uuid(9103), old4: uuid(9104), old5: uuid(9105),
  young: uuid(9106), business: uuid(9107), held: uuid(9108), restricted: uuid(9109), owner: uuid(9110), nullType: uuid(9111),
}
const SCHOOL = 'probe-school-a', SCHOOL_B = 'probe-school-b', SHOP = 'probe-school-shop'
/** A live passport verification for a probe account (a distinct subject per account). */
const verifiedIdentity = (profileId: string, i: number, status = 'verified') => ({
  id: `probe-iv-${status}-${i}`, profileId, tier: 'B', method: 'passport_mrz', status,
  decidedAt: new Date(Date.now() - 30 * DAY), documentExpiresAt: new Date(Date.now() + 365 * DAY), subjectHash: `${'f'.repeat(56)}${String(i).padStart(8, '0')}`,
})

describe.skipIf(!live)('schools read-time eligibility against a real Postgres', () => {
  let db: typeof import('@/lib/db').db
  let q: typeof import('./queries')

  beforeAll(async () => {
    db = (await import('@/lib/db')).db
    q = await import('./queries')
    await reset()
    const old = new Date(Date.now() - 30 * DAY)
    const mk = (id: string, extra: Record<string, unknown> = {}) =>
      db.profile.create({ data: { id, email: `${id.slice(-4)}@probe.test`, displayName: 'Probe', accountType: 'individual', createdAt: old, ...extra } })
    await Promise.all([
      mk(P.old1), mk(P.old2), mk(P.old3), mk(P.old4), mk(P.old5),
      mk(P.young, { createdAt: new Date(Date.now() - 2 * DAY) }),
      mk(P.business, { accountType: 'business' }),
      mk(P.held, { enforcementState: 'held' }),
      mk(P.restricted, { trustTier: 'restricted' }),
      mk(P.owner),
      mk(P.nullType, { accountType: null }),
    ])
    await db.seller.create({ data: { id: SHOP, name: 'Probe School Shop', ownerId: P.owner } })
    await db.school.create({ data: { id: SCHOOL, slug: SCHOOL, name: 'Probe School A', kind: 'language_centre', sellerId: SHOP } })
    await db.school.create({ data: { id: SCHOOL_B, slug: SCHOOL_B, name: 'Probe School B', kind: 'agency' } })
    // ⚠️ EVERY probe account is an identity-verified person with a verified proof of employment at both schools
    // (2026-10-05 rules), so each test below still isolates the rule it names; the last tests take one away.
    for (const [i, id] of Object.values(P).entries()) {
      await db.identityVerification.create({ data: verifiedIdentity(id, i) })
      for (const schoolId of [SCHOOL, SCHOOL_B]) {
        await db.schoolEmployment.create({ data: { schoolId, profileId: id, method: 'linkedin', status: 'verified', linkedinHash: `${'0'.repeat(56)}${String(i).padStart(8, '0')}`, decidedAt: new Date(), decidedBy: 'probe' } })
      }
    }
    // A: 4 eligible ups (old1-3 + null-type), 1 eligible down (old4) — and one vote from every ineligible kind.
    const votes: [string, string, number][] = [
      [SCHOOL, P.old1, 1], [SCHOOL, P.old2, 1], [SCHOOL, P.old3, 1], [SCHOOL, P.nullType, 1], [SCHOOL, P.old4, -1],
      [SCHOOL, P.young, 1], [SCHOOL, P.business, 1], [SCHOOL, P.held, 1], [SCHOOL, P.restricted, 1], [SCHOOL, P.owner, 1],
      // The shop owner is excluded only from ITS school — on B their vote counts.
      [SCHOOL_B, P.owner, -1], [SCHOOL_B, P.old1, -1],
    ]
    for (const [schoolId, profileId, value] of votes) await db.schoolVote.create({ data: { schoolId, profileId, value } })
  })
  afterAll(async () => { await reset(); await db.$disconnect() })

  async function reset() {
    await db.school.deleteMany({ where: { id: { in: [SCHOOL, SCHOOL_B] } } }) // cascades votes/reviews/aliases/proofs
    await db.seller.deleteMany({ where: { id: SHOP } })
    // Identity rows outlive their profile on purpose (SET NULL, the 3-year retention): delete them by id.
    await db.identityVerification.deleteMany({ where: { id: { startsWith: 'probe-iv-' } } })
    await db.profile.deleteMany({ where: { id: { in: [...Object.values(P), uuid(9199)] } } })
  }

  it('counts only individual, good-standing, unrestricted, 7-day-old accounts that do not own the school', async () => {
    const s = await q.liveState([SCHOOL, SCHOOL_B], P.young)
    expect(s.counts[SCHOOL]).toEqual({ up: 4, down: 1 })
    expect(s.counts[SCHOOL_B]).toEqual({ up: 0, down: 2 })
    // The young voter still sees their OWN vote (it is stored, just not counted yet).
    expect(s.mine[SCHOOL]).toBe(1)
  })

  it('a young account starts counting the moment it ages in — no stored counter to fix', async () => {
    await db.profile.update({ where: { id: P.young }, data: { createdAt: new Date(Date.now() - 8 * DAY) } })
    expect((await q.liveState([SCHOOL], null)).counts[SCHOOL]).toEqual({ up: 5, down: 1 })
    await db.profile.update({ where: { id: P.young }, data: { createdAt: new Date(Date.now() - 2 * DAY) } })
  })

  it('pay shows only at 5 eligible reporters, as a rounded middle range', async () => {
    const pros = 'Supportive academic team and good materials.', cons = 'Schedule changes were sometimes announced late.'
    // Approved LAST WEEK: pay counts only reviews published before the current week (payReports).
    const lastWeek = new Date(Date.now() - 8 * DAY)
    const base = { schoolId: SCHOOL, current: false, tenure: '1to2', role: 'teacher', employment: 'part_time', pros, cons, status: 'published', payCurrency: 'VND', payPeriod: 'hour', moderatedAt: lastWeek, leftYear: 2024, showLeftYear: false }
    const pay = [P.old1, P.old2, P.old3, P.old4].map((profileId, i) => ({ ...base, profileId, payAmount: 400_000 + i * 50_000, payVnd: 400_000 + i * 50_000 }))
    await db.schoolReview.createMany({ data: pay })
    // An INELIGIBLE fifth reporter must not unlock the range.
    await db.schoolReview.create({ data: { ...base, profileId: P.business, payAmount: 900_000, payVnd: 900_000 } })
    let page = await q.getSchoolPage(SCHOOL)
    expect(page?.pay).toEqual([])
    // ⛔ No profileId, no pay figure and no hidden leaving year on a public review.
    expect(Object.keys(page!.reviews[0])).not.toContain('profileId')
    expect(Object.keys(page!.reviews[0])).not.toContain('payVnd')
    expect(page!.reviews.every((r) => r.leftYear === null)).toBe(true)

    // A fifth report published THIS week does not move the range yet…
    const fresh = await db.schoolReview.create({ data: { ...base, profileId: P.old5, payAmount: 600_000, payVnd: 600_000, moderatedAt: new Date() } })
    expect((await q.getSchoolPage(SCHOOL))?.pay).toEqual([])
    // …it counts from next week.
    await db.schoolReview.update({ where: { id: fresh.id }, data: { moderatedAt: lastWeek } })
    page = await q.getSchoolPage(SCHOOL)
    const hour = page!.pay.find((p) => p.period === 'hour')
    expect(hour).toMatchObject({ shown: true })
    // 400k/450k/500k/550k/600k → p20 440k, p80 560k, widened outward on the 50k grid → 400k–600k. With five
    // round-number reports the ends LAND ON the lowest and highest report: the documented residual risk
    // (logic.ts summarisePay), stated to the teacher before they enter pay — not something rounding hides.
    expect(hour && hour.shown && [hour.lo, hour.hi]).toEqual([400_000, 600_000])
  })

  it('pending reviews are invisible on the page and in the counts', async () => {
    await db.schoolReview.create({ data: { schoolId: SCHOOL_B, profileId: P.old2, current: true, tenure: 'lt1', role: 'teacher', employment: 'full_time', pros: 'x'.repeat(30), cons: 'y'.repeat(30), status: 'pending' } })
    const page = await q.getSchoolPage(SCHOOL_B)
    expect(page?.reviews).toEqual([])
    const rows = await q.listSchools({ sort: 'top' })
    expect(rows.find((r) => r.id === SCHOOL_B)?.reviews).toBe(0)
    // 6 published, but the business account's is not public: 5 (the same rule as the pay range).
    expect(rows.find((r) => r.id === SCHOOL)?.reviews).toBe(5)
  })

  it('a published review leaves every public number the moment its author loses standing', async () => {
    expect((await q.getSchoolPage(SCHOOL))?.reviews.length).toBe(5)
    await db.profile.update({ where: { id: P.old5 }, data: { enforcementState: 'held' } })
    const page = await q.getSchoolPage(SCHOOL)
    expect(page?.reviews.length).toBe(4)
    // …and its pay report with it: 4 reporters is under the floor again.
    expect(page?.pay).toEqual([])
    await db.profile.update({ where: { id: P.old5 }, data: { enforcementState: 'good_standing' } })
  })

  it('the database refuses a fabricated pay figure and a report that crosses schools (schools-ddl.mjs)', async () => {
    // Only meaningful where the DDL ran (scratch preview, production); CI's schema has no CHECKs.
    const hasCheck = await db.$queryRaw<{ n: number }[]>`select count(*)::int as n from pg_constraint where conname = 'SchoolReview_pay_check'`
    // CI runs scripts/schools-ddl.mjs, so there a missing rule is a FAILURE, never a quiet skip.
    if (process.env.CI) expect(hasCheck[0]?.n).toBe(1)
    if (!hasCheck[0]?.n) return
    const base = { schoolId: SCHOOL_B, current: true, tenure: 'lt1', role: 'teacher', employment: 'full_time', pros: 'x'.repeat(30), cons: 'y'.repeat(30), status: 'published' }
    // Two DIFFERENT authors, so a rejection can only be the CHECK — never the (school, author) unique key.
    await expect(db.schoolReview.create({ data: { ...base, profileId: P.old3, payAmount: 400_000, payVnd: 9_000_000, payCurrency: 'VND', payPeriod: 'hour' } })).rejects.toThrow(/SchoolReview_pay_check/)
    await expect(db.schoolReview.create({ data: { ...base, profileId: P.old4, payAmount: 20, payVnd: 520_000, payCurrency: 'USD', payPeriod: 'hour' } })).rejects.toThrow(/SchoolReview_pay_check/) // no rate
    const reviewOfA = await db.schoolReview.findFirstOrThrow({ where: { schoolId: SCHOOL } })
    await expect(db.schoolReview.update({ where: { id: reviewOfA.id }, data: { schoolId: SCHOOL_B } })).rejects.toThrow(/cannot move to another school/)
    await expect(db.schoolReport.create({ data: { kind: 'review_report', schoolId: SCHOOL_B, reviewId: reviewOfA.id, reason: 'spam' } })).rejects.toThrow(/does not belong to school/)
  })

  it("a new account's APPROVED review waits for the same 7 days its vote does — page and sitemap alike", async () => {
    await db.schoolReview.create({ data: { schoolId: SCHOOL_B, profileId: P.young, current: true, tenure: 'lt1', role: 'teacher', employment: 'full_time', pros: 'x'.repeat(30), cons: 'y'.repeat(30), status: 'published', moderatedAt: new Date() } })
    expect((await q.getSchoolPage(SCHOOL_B))?.reviews.length).toBe(0)
    expect((await q.schoolsForSitemap()).map((x) => x.slug)).not.toContain(SCHOOL_B)
    await db.profile.update({ where: { id: P.young }, data: { createdAt: new Date(Date.now() - 8 * DAY) } })
    expect((await q.getSchoolPage(SCHOOL_B))?.reviews.length).toBe(1)
    expect((await q.schoolsForSitemap()).map((x) => x.slug)).toContain(SCHOOL_B)
    await db.profile.update({ where: { id: P.young }, data: { createdAt: new Date(Date.now() - 2 * DAY) } })
  })

  it('live helpful counts: eligible voters only, never the author on their own review', async () => {
    const r = await db.schoolReview.findFirstOrThrow({ where: { schoolId: SCHOOL, profileId: P.old1 } })
    for (const [profileId, value] of [[P.old2, 1], [P.old3, 1], [P.old1, 1], [P.young, 1], [P.business, -1]] as const) {
      await db.schoolReviewVote.create({ data: { reviewId: r.id, profileId, value } })
    }
    // old2 + old3 count; the author (old1), a young and a business account do not.
    expect((await q.liveReviewCounts([r.id]))[r.id]).toEqual({ up: 2, down: 0 })
    await db.schoolReviewVote.deleteMany({ where: { reviewId: r.id } })
  })

  it("erasing a reviewer's account keeps the complaint about their review (the moderation trail)", async () => {
    const victim = await db.profile.create({ data: { id: uuid(9199), email: 'erase@probe.test', displayName: 'Probe', accountType: 'individual', createdAt: new Date(Date.now() - 30 * DAY) } })
    const r = await db.schoolReview.create({ data: { schoolId: SCHOOL_B, profileId: victim.id, current: true, tenure: 'lt1', role: 'teacher', employment: 'full_time', pros: 'x'.repeat(30), cons: 'y'.repeat(30), status: 'published' } })
    const c = await db.schoolReport.create({ data: { kind: 'school_complaint', schoolId: SCHOOL_B, reviewId: r.id, reason: 'reply', detail: 'We would like to reply.' } })
    await db.profile.delete({ where: { id: victim.id } })
    expect(await db.schoolReview.findUnique({ where: { id: r.id } })).toBeNull()
    expect(await db.schoolReport.findUnique({ where: { id: c.id } })).toMatchObject({ reviewId: null, detail: 'We would like to reply.' })
    await db.schoolReport.delete({ where: { id: c.id } })
  })

  it("the school's own shop owner never counts, even with a published review", async () => {
    const pros = 'Supportive academic team and good materials.', cons = 'Schedule changes were sometimes announced late.'
    await db.schoolReview.create({ data: { schoolId: SCHOOL, profileId: P.owner, current: true, tenure: '2plus', role: 'other', employment: 'full_time', pros, cons, status: 'published' } })
    expect((await q.getSchoolPage(SCHOOL))?.reviews.length).toBe(5)
  })
  it('ONE VERIFIED PERSON, ONE VOTE: a revoked identity stops counting at once, and counts again when cleared', async () => {
    const before = (await q.liveState([SCHOOL], null)).counts[SCHOOL]
    const revoked = await db.identityVerification.create({ data: verifiedIdentity(P.old1, 901, 'revoked') })
    q.forgetCountedVoters() // the counting memo holds an answer for a minute (queries.ts)
    const after = (await q.liveState([SCHOOL], null)).counts[SCHOOL]
    expect(after).toEqual({ up: before.up - 1, down: before.down }) // old1's up-vote, and nothing else
    expect((await q.liveState([SCHOOL], P.old1)).verified).toBe(false)
    await db.identityVerification.delete({ where: { id: revoked.id } })
    q.forgetCountedVoters()
    expect((await q.liveState([SCHOOL], null)).counts[SCHOOL]).toEqual(before)
  })

  it('a published review shows only while its author holds a VERIFIED proof of employment at THAT school', async () => {
    const pros = 'The academic manager gave clear feedback every term.', cons = 'Paperwork for each class took longer than the class.'
    const r = await db.schoolReview.create({ data: { schoolId: SCHOOL_B, profileId: P.old3, current: true, tenure: 'lt1', role: 'teacher', employment: 'full_time', pros, cons, status: 'published', moderatedAt: new Date(Date.now() - 8 * DAY) } })
    const shown = async () => ((await q.getSchoolPage(SCHOOL_B))?.reviews ?? []).some((x) => x.id === r.id)
    expect(await shown()).toBe(true)
    await db.schoolEmployment.update({ where: { profileId_schoolId: { profileId: P.old3, schoolId: SCHOOL_B } }, data: { status: 'withdrawn' } })
    expect(await shown()).toBe(false)
    // A proof at ANOTHER school is no proof here.
    expect(await db.schoolEmployment.count({ where: { profileId: P.old3, schoolId: SCHOOL, status: 'verified' } })).toBe(1)
    await db.schoolEmployment.update({ where: { profileId_schoolId: { profileId: P.old3, schoolId: SCHOOL_B } }, data: { status: 'verified' } })
    expect(await shown()).toBe(true)
    await db.schoolReview.delete({ where: { id: r.id } })
  })

  it('the vote log records every change in the database (the awards cutoff reads it), and nothing on a cascade', async () => {
    const id = uuid(9199)
    await db.profile.create({ data: { id, email: '9199@probe.test', displayName: 'Probe', accountType: 'individual', createdAt: new Date(Date.now() - 30 * DAY) } })
    await db.schoolVote.create({ data: { schoolId: SCHOOL_B, profileId: id, value: 1 } })
    await db.schoolVote.update({ where: { schoolId_profileId: { schoolId: SCHOOL_B, profileId: id } }, data: { value: -1 } })
    await db.schoolVote.delete({ where: { schoolId_profileId: { schoolId: SCHOOL_B, profileId: id } } })
    expect((await db.schoolVoteEvent.findMany({ where: { profileId: id }, orderBy: { id: 'asc' } })).map((e) => e.value)).toEqual([1, -1, 0])
    await db.schoolVote.create({ data: { schoolId: SCHOOL_B, profileId: id, value: 1 } })
    await db.profile.delete({ where: { id } }) // erasure: the vote and the whole log go, and the delete succeeds
    expect(await db.schoolVoteEvent.count({ where: { profileId: id } })).toBe(0)
  })
})
