// @vitest-environment node
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

/**
 * The OPEN rules against a real Postgres (owner, 2026-10-06: "just google or normal sign in can post review and
 * upvote, too complex for users to engage"): a brand-new account with no verified identity and no proof of
 * employment votes and reviews, its vote counts at once, a moderator still reads the review before it shows, and the
 * nightly retention sweep never deletes a review for having no proof. The strict rules keep their own probes
 * (schools-routes / queries / awards), which pin the switches back on.
 *
 * ⛔ Same opt-in and guards as the routes probe: RACE_DB_TESTS=1, loopback only, never :5433.
 * Run it: DATABASE_URL=postgresql://postgres@127.0.0.1:5544/eno RACE_DB_TESTS=1 npx vitest run src/app/api/schools/schools-open.probe.test.ts
 */
const url = process.env.DATABASE_URL || ''
const parsed = (() => { try { return new URL(url) } catch { return null } })()
const loopback = ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(parsed?.hostname ?? '')
const live = process.env.RACE_DB_TESTS === '1' && loopback && parsed?.port !== '5433'

const h = vi.hoisted(() => ({ me: null as null | Record<string, unknown>, admin: null as string | null }))
vi.mock('@/lib/admin', () => ({
  getCurrentProfile: async () => h.me,
  getCurrentProfileId: async () => (h.me?.id as string | undefined) ?? null,
  getAdmin: async () => h.admin,
}))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => ({ success: true }) }))
vi.mock('@/lib/revalidate-lang', () => ({ revalidatePublicPath: () => {} }))

const DAY = 86_400_000
const NEW = '00000000-0000-4000-8000-000000009301'
const SCHOOL = 'probe-open-school'
const GOOD = {
  confirm: true, current: false, tenure: '1to2', role: 'teacher', employment: 'part_time', district: 'District 7',
  pros: 'Friendly staff, clear curriculum and the books are provided for every class.',
  cons: 'Long split shifts on weekends and the office is slow to answer messages.',
  goodTags: [], badTags: [],
}

describe.skipIf(!live)('schools — open rules (any signed-in account) against a real Postgres', () => {
  let db: typeof import('@/lib/db').db
  let NextRequest: typeof import('next/server').NextRequest
  let vote: Record<string, unknown>, review: Record<string, unknown>, admin: Record<string, unknown>
  const call = async (mod: Record<string, unknown>, method: string, params: Record<string, string>, body?: unknown) => {
    const handler = mod[method] as (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>
    const req = new NextRequest('https://eno.vn/api/x', { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
    const res = await handler(req, { params: Promise.resolve(params) })
    return { status: res.status, json: await res.json().catch(() => null) as Record<string, any> | null }
  }
  const reset = async () => {
    await db.school.deleteMany({ where: { id: SCHOOL } })
    await db.profile.deleteMany({ where: { id: NEW } })
  }

  beforeAll(async () => {
    db = (await import('@/lib/db')).db
    NextRequest = (await import('next/server')).NextRequest
    vote = await import('./[id]/vote/route')
    review = await import('./[id]/review/route')
    admin = await import('../admin/schools/route')
    await reset()
    // Created NOW: no identity verification, no proof of employment, no account age.
    await db.profile.create({ data: { id: NEW, email: '9301@probe.test', displayName: 'Probe', accountType: 'individual' } })
    await db.school.create({ data: { id: SCHOOL, slug: SCHOOL, name: 'Probe Open School', kind: 'language_centre' } })
  })
  afterEach(() => { h.admin = null; h.me = null })
  afterAll(async () => { if (db) { await reset(); await db.$disconnect() } })

  it('a brand-new, unverified account votes and the vote counts at once', async () => {
    h.me = await db.profile.findUnique({ where: { id: NEW } })
    expect(await call(vote, 'POST', { id: SCHOOL }, { value: 1, confirm: true })).toMatchObject({ status: 200, json: { countsNow: true } })
    const { liveState } = await import('@/lib/schools/queries')
    expect((await liveState([SCHOOL], NEW)).counts[SCHOOL]).toEqual({ up: 1, down: 0 })
  })

  it('it writes a review with no proof; a moderator approves it and it shows; the retention sweep keeps it', async () => {
    h.me = await db.profile.findUnique({ where: { id: NEW } })
    expect((await call(review, 'POST', { id: SCHOOL }, GOOD)).status).toBe(200)
    const mine = await db.schoolReview.findFirstOrThrow({ where: { schoolId: SCHOOL, profileId: NEW } })
    expect(mine.status).toBe('pending')
    const { queuedReviewIds, getSchoolPage } = await import('@/lib/schools/queries')
    expect(await queuedReviewIds(500)).toContain(mine.id)
    h.me = null
    h.admin = 'probe-moderator'
    expect((await call(admin, 'POST', {}, { action: 'approve', reviewId: mine.id, seenUpdatedAt: mine.updatedAt.toISOString() })).status).toBe(200)
    expect((await getSchoolPage(SCHOOL))?.reviews.map((r: { id: string }) => r.id)).toContain(mine.id)
    // A review with no proof row, last changed long ago: the proof-era sweep would have deleted it.
    await db.schoolReview.update({ where: { id: mine.id }, data: { updatedAt: new Date(Date.now() - 400 * DAY) } })
    const { sweepProofRetention } = await import('@/lib/schools/employment')
    expect((await sweepProofRetention(new Date(), { schoolIds: [SCHOOL] })).reviews).toBe(0)
    expect(await db.schoolReview.count({ where: { id: mine.id } })).toBe(1)
    // A writer whose proof at this school a moderator REJECTED stays out, proofs off or not.
    await db.schoolEmployment.create({ data: { schoolId: SCHOOL, profileId: NEW, method: 'linkedin', status: 'rejected', decidedAt: new Date(), decidedBy: 'probe', rejectReason: 'not in Experience' } })
    expect((await getSchoolPage(SCHOOL))?.reviews.map((r: { id: string }) => r.id)).not.toContain(mine.id)
  })
})
