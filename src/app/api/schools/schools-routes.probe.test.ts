// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

/**
 * The /api/schools write paths end to end against a REAL Postgres (2026-10-04): route wrapper, zod body,
 * eligibility, text screening, pay band, moderation transitions and the database's own CHECKs. Only the
 * session, the rate limiter and the ISR purge are stubbed.
 *
 * ⛔ Same opt-in and guards as queries.probe.test.ts: RACE_DB_TESTS=1, loopback only, never :5433.
 * Run it: DATABASE_URL=postgresql://postgres@127.0.0.1:5544/eno RACE_DB_TESTS=1 npx vitest run src/app/api/schools/schools-routes.probe.test.ts
 */
const url = process.env.DATABASE_URL || ''
const parsed = (() => { try { return new URL(url) } catch { return null } })()
// Loopback ONLY — not the `postgres` service name the older probe accepts (codex, diff review).
const loopback = ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(parsed?.hostname ?? '')
const live = process.env.RACE_DB_TESTS === '1' && loopback && parsed?.port !== '5433'

const h = vi.hoisted(() => ({ me: null as null | Record<string, unknown>, admin: null as string | null, purged: [] as string[] }))
vi.mock('@/lib/admin', () => ({
  getCurrentProfile: async () => h.me,
  getCurrentProfileId: async () => (h.me?.id as string | undefined) ?? null,
  getAdmin: async () => h.admin,
}))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => ({ success: true }) }))
vi.mock('@/lib/revalidate-lang', () => ({ revalidatePublicPath: (p: string) => { h.purged.push(p) } }))

const DAY = 86_400_000
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const T1 = uuid(9201), T2 = uuid(9202), BIZ = uuid(9203), OWNER = uuid(9204)
const SCHOOL = 'probe-route-school', SHOP = 'probe-route-shop'
const GOOD = {
  confirm: true, current: false, tenure: '1to2', role: 'teacher', employment: 'part_time', district: 'District 7',
  pros: 'Classes are well resourced and the academic team answers questions quickly.',
  cons: 'Timetables change at short notice and prep time is not paid.',
  goodTags: ['materials_provided'], badTags: ['unpaid_prep', 'last_minute_changes'],
  pay: { amount: 450000, currency: 'VND', period: 'hour' },
}

describe.skipIf(!live)('/api/schools routes against a real Postgres', () => {
  let db: typeof import('@/lib/db').db
  let NextRequest: typeof import('next/server').NextRequest
  const call = async (mod: Record<string, unknown>, method: string, params: Record<string, string>, body?: unknown) => {
    const handler = mod[method] as (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>
    const req = new NextRequest('https://eno.vn/api/x', { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
    const res = await handler(req, { params: Promise.resolve(params) })
    return { status: res.status, json: await res.json().catch(() => null) as Record<string, any> | null }
  }
  let vote: Record<string, unknown>, review: Record<string, unknown>, rvote: Record<string, unknown>, report: Record<string, unknown>, complaint: Record<string, unknown>, admin: Record<string, unknown>

  beforeAll(async () => {
    db = (await import('@/lib/db')).db
    NextRequest = (await import('next/server')).NextRequest
    vote = await import('./[id]/vote/route')
    review = await import('./[id]/review/route')
    rvote = await import('./reviews/[id]/vote/route')
    report = await import('./reviews/[id]/report/route')
    complaint = await import('./[id]/complaint/route')
    admin = await import('../admin/schools/route')
    await reset()
    const old = new Date(Date.now() - 30 * DAY)
    for (const [id, accountType] of [[T1, 'individual'], [T2, 'individual'], [BIZ, 'business'], [OWNER, 'individual']] as const) {
      await db.profile.create({ data: { id, email: `${id.slice(-4)}@probe.test`, displayName: 'Probe', accountType, createdAt: old } })
    }
    await db.seller.create({ data: { id: SHOP, name: 'Probe Route Shop', ownerId: OWNER } })
    await db.school.create({ data: { id: SCHOOL, slug: SCHOOL, name: 'Probe Route School', kind: 'language_centre', sellerId: SHOP } })
  })
  afterAll(async () => { await reset(); await db.$disconnect() })

  async function reset() {
    await db.school.deleteMany({ where: { id: SCHOOL } })
    await db.seller.deleteMany({ where: { id: SHOP } })
    await db.profile.deleteMany({ where: { id: { in: [T1, T2, BIZ, OWNER] } } })
  }
  const as = async (id: string | null) => { h.me = id ? await db.profile.findUnique({ where: { id } }) : null }

  it('vote: signed-out 401, business 403, no tick 400, then store / flip / clear', async () => {
    await as(null)
    expect((await call(vote, 'POST', { id: SCHOOL }, { value: 1, confirm: true })).status).toBe(401)
    await as(BIZ)
    expect(await call(vote, 'POST', { id: SCHOOL }, { value: 1, confirm: true })).toMatchObject({ status: 403, json: { error: 'business_account' } })
    await as(T1)
    expect(await call(vote, 'POST', { id: SCHOOL }, { value: 1 })).toMatchObject({ status: 400, json: { error: 'stint_required' } })
    expect(await call(vote, 'POST', { id: SCHOOL }, { value: 1, confirm: true })).toMatchObject({ status: 200, json: { countsNow: true } })
    expect(await call(vote, 'POST', { id: SCHOOL }, { value: -1, confirm: true })).toMatchObject({ status: 200 })
    expect((await db.schoolVote.findMany({ where: { schoolId: SCHOOL } })).map((v) => v.value)).toEqual([-1])
    expect((await call(vote, 'POST', { id: SCHOOL }, { value: 0 })).status).toBe(200)
    expect(await db.schoolVote.count({ where: { schoolId: SCHOOL } })).toBe(0)
    // An account that has since become ineligible can still take its vote back.
    expect((await call(vote, 'POST', { id: SCHOOL }, { value: 1, confirm: true })).status).toBe(200)
    await db.profile.update({ where: { id: T1 }, data: { enforcementState: 'held' } })
    await as(T1)
    expect((await call(vote, 'POST', { id: SCHOOL }, { value: 0 })).status).toBe(200)
    expect(await db.schoolVote.count({ where: { schoolId: SCHOOL } })).toBe(0)
    await db.profile.update({ where: { id: T1 }, data: { enforcementState: 'good_standing' } })
    await as(T1)
    expect((await call(vote, 'POST', { id: 'no-such-school' }, { value: 1, confirm: true })).status).toBe(404)
  })

  it("the school's own shop owner cannot vote on it or review it (refused, not just uncounted) — but can take an old vote back", async () => {
    await db.schoolVote.create({ data: { schoolId: SCHOOL, profileId: OWNER, value: 1 } }) // cast before the shop was linked
    await as(OWNER)
    expect((await call(vote, 'POST', { id: SCHOOL }, { value: 0 })).status).toBe(200)
    expect(await call(vote, 'POST', { id: SCHOOL }, { value: 1, confirm: true })).toMatchObject({ status: 403, json: { error: 'forbidden' } })
    expect(await call(review, 'POST', { id: SCHOOL }, GOOD)).toMatchObject({ status: 403, json: { error: 'forbidden' } })
    expect(await db.schoolVote.count({ where: { profileId: OWNER } })).toBe(0)
  })

  it('review: links, contact details and silly pay are refused; a good one lands PENDING', async () => {
    await as(T1)
    expect(await call(review, 'POST', { id: SCHOOL }, { ...GOOD, pros: GOOD.pros + ' See www.example.com' })).toMatchObject({ status: 422, json: { error: 'links_not_allowed' } })
    expect(await call(review, 'POST', { id: SCHOOL }, { ...GOOD, cons: GOOD.cons + ' Call 0903 123 456.' })).toMatchObject({ status: 422, json: { error: 'contact_in_text' } })
    expect(await call(review, 'POST', { id: SCHOOL }, { ...GOOD, pay: { amount: 6000000, currency: 'VND', period: 'hour' } })).toMatchObject({ status: 422, json: { error: 'pay_out_of_range' } })
    expect((await call(review, 'POST', { id: SCHOOL }, { ...GOOD, confirm: false })).status).toBe(400)
    const ok = await call(review, 'POST', { id: SCHOOL }, GOOD)
    expect(ok).toMatchObject({ status: 200, json: { review: { status: 'pending', payAmount: 450000 } } })
    const row = await db.schoolReview.findFirstOrThrow({ where: { schoolId: SCHOOL, profileId: T1 } })
    expect(row).toMatchObject({ payVnd: 450000, payCurrency: 'VND', fxRate: null, leftYear: null, flags: [] })
    // The author can read it back (with pay); nobody else sees it before moderation.
    expect(await call(review, 'GET', { id: SCHOOL })).toMatchObject({ status: 200, json: { review: { status: 'pending' } } })
  })

  it('an accusation is FLAGGED for the moderator, not refused', async () => {
    await as(T2)
    const r = await call(review, 'POST', { id: SCHOOL }, { ...GOOD, cons: 'They are a scam and kept my deposit at the end of the contract.', pay: null })
    expect(r.status).toBe(200)
    expect((await db.schoolReview.findFirstOrThrow({ where: { schoolId: SCHOOL, profileId: T2 } })).flags).toEqual(['accusation'])
  })

  it('moderation: approve publishes and purges; helpful votes and reports work on a published review', async () => {
    const mine = await db.schoolReview.findFirstOrThrow({ where: { schoolId: SCHOOL, profileId: T1 } })
    h.admin = null
    expect((await call(admin, 'POST', {}, { action: 'approve', reviewId: mine.id, seenUpdatedAt: mine.updatedAt.toISOString() })).status).toBe(403)
    h.admin = 'support@eno.vn'
    h.purged = []
    // ⛔ THE REAL RACE: the moderator reads version 1, the teacher edits, the moderator clicks Approve.
    const v1 = mine.updatedAt.toISOString()
    await as(T1)
    expect((await call(review, 'POST', { id: SCHOOL }, { ...GOOD, cons: GOOD.cons + ' Edited after the moderator opened it.' })).status).toBe(200)
    expect(await call(admin, 'POST', {}, { action: 'approve', reviewId: mine.id, seenUpdatedAt: v1 })).toMatchObject({ status: 409, json: { error: 'review_changed_reload' } })
    Object.assign(mine, await db.schoolReview.findUniqueOrThrow({ where: { id: mine.id } })) // the moderator reloads
    // ⛔ Approving a version the moderator did not see is refused, never published.
    expect(await call(admin, 'POST', {}, { action: 'approve', reviewId: mine.id, seenUpdatedAt: new Date(Date.now() - 60_000).toISOString() })).toMatchObject({ status: 409, json: { error: 'review_changed_reload' } })
    expect((await db.schoolReview.findUniqueOrThrow({ where: { id: mine.id } })).status).toBe('pending')
    h.purged = []
    expect((await call(admin, 'POST', {}, { action: 'approve', reviewId: mine.id, seenUpdatedAt: mine.updatedAt.toISOString() })).status).toBe(200)
    expect(await call(admin, 'POST', {}, { action: 'approve', reviewId: mine.id, seenUpdatedAt: mine.updatedAt.toISOString() })).toMatchObject({ status: 409, json: { error: 'invalid_status_transition' } })
    expect(await db.schoolReview.findUniqueOrThrow({ where: { id: mine.id } })).toMatchObject({ status: 'published', moderatedBy: 'support@eno.vn' })
    expect(h.purged).toEqual(['/schools', `/schools/${SCHOOL}`])

    await as(T1)
    expect(await call(rvote, 'POST', { id: mine.id }, { value: 1 })).toMatchObject({ status: 403, json: { error: 'forbidden' } })
    await as(T2)
    expect((await call(rvote, 'POST', { id: mine.id }, { value: 1 })).status).toBe(200)
    await as(OWNER)
    expect(await call(rvote, 'POST', { id: mine.id }, { value: -1 })).toMatchObject({ status: 403, json: { error: 'forbidden' } })
    await as(T2)
    expect(await call(report, 'POST', { id: mine.id }, { reason: 'false_or_misleading', detail: 'Prep is paid since 2025.' })).toMatchObject({ status: 200 })
    expect(await call(report, 'POST', { id: mine.id }, { reason: 'spam' })).toMatchObject({ status: 200, json: { duplicate: true } })
    // A report never hides anything by itself.
    expect((await db.schoolReview.findUniqueOrThrow({ where: { id: mine.id } })).status).toBe('published')
    const pendingOther = await db.schoolReview.findFirstOrThrow({ where: { schoolId: SCHOOL, profileId: T2 } })
    expect((await call(rvote, 'POST', { id: pendingOther.id }, { value: 1 })).status).toBe(404)
  })

  it('an edit of a published review goes back to pending, drops the school reply and leaves the cached page; withdrawal removes it', async () => {
    const pub = await db.schoolReview.findFirstOrThrow({ where: { schoolId: SCHOOL, profileId: T1 } })
    h.admin = 'support@eno.vn'
    expect((await call(admin, 'POST', {}, { action: 'reply', reviewId: pub.id, text: 'Thank you — we have changed this.', seenUpdatedAt: pub.updatedAt.toISOString() })).status).toBe(200)
    expect(await db.schoolReviewVote.count({ where: { reviewId: pub.id } })).toBeGreaterThan(0)
    await as(T1)
    h.purged = []
    expect(await call(review, 'POST', { id: SCHOOL }, { ...GOOD, advice: 'Ask for the paid-prep policy in writing.' })).toMatchObject({ status: 200, json: { review: { status: 'pending' } } })
    expect(h.purged).toContain(`/schools/${SCHOOL}`)
    // the school answered the OLD text, and readers judged it — neither carries over to the new one
    expect(await db.schoolReview.findFirstOrThrow({ where: { schoolId: SCHOOL, profileId: T1 } })).toMatchObject({ replyText: null, replyAt: null })
    expect(await db.schoolReviewVote.count({ where: { reviewId: pub.id } })).toBe(0)
    expect((await call(review, 'DELETE', { id: SCHOOL })).status).toBe(200)
    // withdrawn = gone: no text or pay left stored
    expect(await db.schoolReview.findFirst({ where: { schoolId: SCHOOL, profileId: T1 } })).toBeNull()
    expect(await call(review, 'GET', { id: SCHOOL })).toMatchObject({ json: { review: null } })
  })

  it('a school complaint lands with its contact email; admin reply, reject and resolve', async () => {
    await as(T2)
    expect((await call(complaint, 'POST', { id: SCHOOL }, { reason: 'reply', detail: 'We changed the prep policy in 2025 and would like to reply.', contactEmail: 'hr@probe-school.test' })).status).toBe(200)
    const c = await db.schoolReport.findFirstOrThrow({ where: { schoolId: SCHOOL, kind: 'school_complaint' } })
    expect(c).toMatchObject({ status: 'open', contactEmail: 'hr@probe-school.test' })
    h.admin = 'support@eno.vn'
    const t2 = await db.schoolReview.findFirstOrThrow({ where: { schoolId: SCHOOL, profileId: T2 } })
    expect((await call(admin, 'POST', {}, { action: 'reject', reviewId: t2.id, reason: '', seenUpdatedAt: t2.updatedAt.toISOString() })).status).toBe(400)
    expect((await call(admin, 'POST', {}, { action: 'reject', reviewId: t2.id, reason: 'Describe what happened to you rather than accusing the school of a crime.', seenUpdatedAt: t2.updatedAt.toISOString() })).status).toBe(200)
    // a response only sits under PUBLISHED text
    expect(await call(admin, 'POST', {}, { action: 'reply', reviewId: t2.id, text: 'Thank you for the feedback.', seenUpdatedAt: t2.updatedAt.toISOString() })).toMatchObject({ status: 409, json: { error: 'invalid_status_transition' } })
    expect(await db.schoolReview.findUniqueOrThrow({ where: { id: t2.id } })).toMatchObject({ status: 'rejected', replyText: null })
    expect((await call(admin, 'POST', {}, { action: 'resolve', reportId: c.id, status: 'resolved' })).status).toBe(200)
    expect(await call(admin, 'POST', {}, { action: 'resolve', reportId: c.id, status: 'dismissed' })).toMatchObject({ status: 409, json: { error: 'already_resolved' } })
    expect(await db.schoolReport.findUniqueOrThrow({ where: { id: c.id } })).toMatchObject({ status: 'resolved', resolvedBy: 'support@eno.vn' })
  })
})
