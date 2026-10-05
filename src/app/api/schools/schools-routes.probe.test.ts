// @vitest-environment node
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

/**
 * The /api/schools write paths end to end against a REAL Postgres (2026-10-04): route wrapper, zod body,
 * eligibility, text screening, pay band, moderation transitions and the database's own CHECKs. Only the
 * session, the rate limiter and the ISR purge are stubbed.
 *
 * ⛔ Same opt-in and guards as queries.probe.test.ts: RACE_DB_TESTS=1, loopback only, never :5433.
 * Run it: DATABASE_URL=postgresql://postgres@127.0.0.1:5544/eno RACE_DB_TESTS=1 npx vitest run src/app/api/schools/schools-routes.probe.test.ts
 * ⚠️ A KILLED RUN LEAVES THIS PROBE'S KEY FINGERPRINT RECORDED (afterAll never ran): a scratch preview using another
 * SCHOOL_PROOF_SECRET then refuses proofs (it logs why) — delete the SchoolProofKeyCheck row. Only this file touches it.
 * ⚠️ THE TESTS RUN IN FILE ORDER AND SHARE STATE (T3's proved profile, T4's waiting one, …): run the whole file, not
 * one case with -t — a single case on its own can fail for want of the state an earlier one leaves.
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
// ⛔ THIS PROBE PINS THE STRICT RULES (identity for votes, a 7-day account age, a proof for reviews): they are off in
// production since 2026-10-06 (constants.ts — owner: any signed-in account votes and reviews) but stay in the code
// behind switches, and this keeps them working for the day they are turned back on. The open rules have their own
// probe: schools-open.probe.test.ts.
vi.mock('@/lib/schools/constants', async (orig) => ({ ...(await orig<typeof import('@/lib/schools/constants')>()), VOTES_NEED_IDENTITY: true, REVIEWS_NEED_PROOF: true, ELIGIBLE_ACCOUNT_AGE_DAYS: 7 }))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => ({ success: true }) }))
vi.mock('@/lib/revalidate-lang', () => ({ revalidatePublicPath: (p: string) => { h.purged.push(p) } }))
// A probe-only secret unless one is set: then a fingerprint made with it can only be this probe's own (a killed run's).
// Stubbed in the LIVE suite's beforeAll, never at load (diff review): a skipped suite runs no afterAll, so a stub
// made here would leak into later test files in the same worker on every ordinary run.
const PROBE_OWN_SECRET = !process.env.SCHOOL_PROOF_SECRET
/** The LinkedIn profiles this probe submits — their ledger keys are the only ones it ever deletes. */
const PROBE_PROFILES = ['probe-teacher-three', 'probe-teacher-four', 'probe-teacher-six', 'probe-attacker', 'probe-victim', 'probe-ten', 'probe-eleven', 'probe-x-thirteen', 'probe-y-thirteen', 'probe-a-fourteen']

const DAY = 86_400_000
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const T1 = uuid(9201), T2 = uuid(9202), BIZ = uuid(9203), OWNER = uuid(9204), T3 = uuid(9205), T4 = uuid(9206), T5 = uuid(9207)
const SCHOOL = 'probe-route-school', SCHOOL2 = 'probe-route-school-2', SHOP = 'probe-route-shop'
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
  let vote: Record<string, unknown>, review: Record<string, unknown>, rvote: Record<string, unknown>, report: Record<string, unknown>, complaint: Record<string, unknown>, admin: Record<string, unknown>, proof: Record<string, unknown>

  // ⛔ THE RECORDED KEY FINGERPRINT (employment.ts proofKeyMatches) IS NEVER ALTERED UNLESS THIS PROBE RECORDED IT
  // (diff review): a fingerprint made with another key means this is not a database to prove against, and the probe
  // stops rather than replace it. One it recorded itself is removed afterwards.
  let ownsKeyCheck = false
  let recordedByUs = false
  beforeAll(async () => {
    if (PROBE_OWN_SECRET) vi.stubEnv('SCHOOL_PROOF_SECRET', 'probe-secret-for-school-proof-0123456789abcdef')
    await setUp() // a failed setup still reaches afterAll, whose finally unstubs (diff review)
  })
  async function setUp() {
    db = (await import('@/lib/db')).db
    // A killed key-swap case of this probe's left the swap's marker behind: put it right (nothing else writes it).
    await db.schoolProofKeyCheck.deleteMany({ where: { fingerprint: 'f'.repeat(64) } })
    const preexisting = !!(await db.schoolProofKeyCheck.findUnique({ where: { id: 1 } }))
    const { proofKeyMatches, forgetProofKeyCheck } = await import('@/lib/schools/employment')
    forgetProofKeyCheck()
    if (!(await proofKeyMatches())) throw new Error('A proof-key fingerprint made with another key is recorded here: the probe will not alter it. On a scratch database, delete the SchoolProofKeyCheck row first.')
    // OURS only when made with the probe-only secret — which only this probe (a killed run included) can have recorded:
    // the key-swap case runs only then, never on a real key (diff review). A row this run recorded with a real secret
    // is removed afterwards too, putting the database back as it was.
    ownsKeyCheck = PROBE_OWN_SECRET
    recordedByUs = !preexisting
    NextRequest = (await import('next/server')).NextRequest
    vote = await import('./[id]/vote/route')
    review = await import('./[id]/review/route')
    rvote = await import('./reviews/[id]/vote/route')
    report = await import('./reviews/[id]/report/route')
    complaint = await import('./[id]/complaint/route')
    admin = await import('../admin/schools/route')
    proof = await import('./[id]/proof/route')
    await reset()
    const old = new Date(Date.now() - 30 * DAY)
    for (const [id, accountType] of [[T1, 'individual'], [T2, 'individual'], [BIZ, 'business'], [OWNER, 'individual'], [T3, 'individual'], [T4, 'individual'], [T5, 'individual']] as const) {
      await db.profile.create({ data: { id, email: `${id.slice(-4)}@probe.test`, displayName: 'Probe', accountType, createdAt: old } })
    }
    await db.seller.create({ data: { id: SHOP, name: 'Probe Route Shop', ownerId: OWNER } })
    await db.school.create({ data: { id: SCHOOL, slug: SCHOOL, name: 'Probe Route School', kind: 'language_centre', sellerId: SHOP } })
    await db.school.create({ data: { id: SCHOOL2, slug: SCHOOL2, name: 'Probe Route School Two', kind: 'language_centre' } })
    // T1 and T2 are verified people with a verified proof of employment (2026-10-05 rules); T3–T5 start with neither.
    for (const [i, id] of [T1, T2].entries()) {
      await db.identityVerification.create({ data: { id: `probe-rt-iv-${i}`, profileId: id, tier: 'B', method: 'passport_mrz', status: 'verified', decidedAt: old, documentExpiresAt: new Date(Date.now() + 365 * DAY), subjectHash: `${'e'.repeat(56)}${String(i).padStart(8, '0')}` } })
      await db.schoolEmployment.create({ data: { schoolId: SCHOOL, profileId: id, method: 'linkedin', status: 'verified', linkedinHash: `${'1'.repeat(56)}${String(i).padStart(8, '0')}`, decidedAt: old, decidedBy: 'probe' } })
    }
  }
  // A failed assertion must not leave the next test signed in as an admin (diff review).
  afterEach(() => { h.admin = null; h.me = null })
  afterAll(async () => {
    try {
      if (!db) return // setup never reached the database
      await reset()
      if (ownsKeyCheck || recordedByUs) await db.schoolProofKeyCheck.deleteMany({ where: { id: 1 } })
      await db.$disconnect()
    } finally {
      vi.unstubAllEnvs() // whatever failed above (diff review)
    }
  })

  async function reset() {
    await db.school.deleteMany({ where: { id: { in: [SCHOOL, SCHOOL2] } } })
    await db.seller.deleteMany({ where: { id: SHOP } })
    await db.identityVerification.deleteMany({ where: { id: { startsWith: 'probe-rt-iv-' } } })
    // Ledger keys outlive their profiles on purpose (ownerless after erasure), so the probe clears EXACTLY its own:
    // the hashes of the profiles it submits, and keys its accounts own — never anyone else's (diff review).
    const { proofHash, proofConfigured } = await import('@/lib/schools/employment')
    const mine = [T1, T2, BIZ, OWNER, T3, T4, T5, uuid(9208), uuid(9209), uuid(9210), uuid(9211), uuid(9212), uuid(9213), uuid(9214), uuid(9215), uuid(9216)]
    await db.schoolProofKey.deleteMany({ where: { OR: [{ hash: { in: (proofConfigured() ? PROBE_PROFILES.map((x) => proofHash('linkedin', x)) : []) } }, { profileId: { in: mine } }] } })
    await db.profile.deleteMany({ where: { id: { in: [T1, T2, BIZ, OWNER, T3, T4, T5, uuid(9208), uuid(9209), uuid(9210), uuid(9211), uuid(9212), uuid(9213), uuid(9214), uuid(9215), uuid(9216)] } } })
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
  it('an unverified person can vote, and is told it counts only once they verify (one person, one vote)', async () => {
    await as(T3)
    expect(await call(vote, 'POST', { id: SCHOOL }, { value: 1, confirm: true })).toMatchObject({ status: 200, json: { countsNow: false, needsIdentity: true } })
    expect((await call(vote, 'POST', { id: SCHOOL }, { value: 0 })).status).toBe(200)
  })

  it('a review needs a proof of employment; LinkedIn is checked by a moderator before the review can go live', async () => {
    await as(T3)
    expect(await call(review, 'POST', { id: SCHOOL }, GOOD)).toMatchObject({ status: 409, json: { error: 'proof_required' } })
    expect(await call(proof, 'POST', { id: SCHOOL }, { action: 'linkedin', url: 'https://www.linkedin.com/company/probe/', consent: true })).toMatchObject({ status: 400, json: { error: 'linkedin_url_invalid' } })
    const li = await call(proof, 'POST', { id: SCHOOL }, { action: 'linkedin', url: 'linkedin.com/in/probe-teacher-three', consent: true })
    expect(li).toMatchObject({ status: 200, json: { proof: { method: 'linkedin', status: 'pending', linkedinUrl: 'https://www.linkedin.com/in/probe-teacher-three/' } } })
    expect(li.json?.proof.challenge).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}$/)
    expect(await call(review, 'POST', { id: SCHOOL }, GOOD)).toMatchObject({ status: 200, json: { review: { status: 'pending' } } })
    const r = await db.schoolReview.findFirstOrThrow({ where: { schoolId: SCHOOL, profileId: T3 } })
    h.admin = 'probe-admin@eno.vn'
    expect(await call(admin, 'POST', {}, { action: 'approve', reviewId: r.id, seenUpdatedAt: r.updatedAt.toISOString() })).toMatchObject({ status: 409, json: { error: 'proof_not_verified' } })
    const p = await db.schoolEmployment.findUniqueOrThrow({ where: { profileId_schoolId: { profileId: T3, schoolId: SCHOOL } } })
    expect((await call(admin, 'POST', {}, { action: 'proof_verify', proofId: p.id, seenUpdatedAt: p.updatedAt.toISOString() })).status).toBe(200)
    expect((await call(admin, 'POST', {}, { action: 'approve', reviewId: r.id, seenUpdatedAt: r.updatedAt.toISOString() })).status).toBe(200)
    // Withdrawing the proof takes the review down at once (read-time), without touching the review row.
    await as(T3)
    expect(await call(proof, 'POST', { id: SCHOOL }, { action: 'withdraw' })).toMatchObject({ status: 200, json: { proof: { status: 'withdrawn', linkedinUrl: null } } })
    const { getSchoolPage } = await import('@/lib/schools/queries')
    expect((await getSchoolPage(SCHOOL))?.reviews.some((x) => x.id === r.id)).toBe(false)
    // Proving again sends the review back to the moderators: it returns only through a fresh read.
    expect((await call(proof, 'POST', { id: SCHOOL }, { action: 'linkedin', url: 'linkedin.com/in/probe-teacher-three', consent: true })).status).toBe(200)
    expect((await db.schoolReview.findUniqueOrThrow({ where: { id: r.id } })).status).toBe('pending')
    h.admin = null
  })

  it('an edition whose key differs from the one recorded for this database proves nothing (the editions share one key)', async (ctx) => {
    // ⛔ Only on a fingerprint this probe recorded itself (diff review): swapping one a running preview recorded would
    // refuse its proofs for the length of the test.
    if (!ownsKeyCheck) {
      console.warn('[schools probe] key-mismatch case skipped: it runs only with the probe\'s own secret, and SCHOOL_PROOF_SECRET is set in this environment.')
      ctx.skip()
    }
    const { forgetProofKeyCheck } = await import('@/lib/schools/employment')
    // Recorded by this key (beforeAll made sure): swapped for a foreign one for this test only, then put back exactly.
    const recorded = await db.schoolProofKeyCheck.findUniqueOrThrow({ where: { id: 1 } })
    await db.schoolProofKeyCheck.update({ where: { id: 1 }, data: { fingerprint: 'f'.repeat(64) } })
    forgetProofKeyCheck()
    try {
      await as(T4)
      expect(await call(proof, 'GET', { id: SCHOOL })).toMatchObject({ status: 200, json: { open: false } }) // said up front
      expect(await call(proof, 'POST', { id: SCHOOL }, { action: 'linkedin', url: 'linkedin.com/in/probe-teacher-four', consent: true })).toMatchObject({ status: 503, json: { error: 'not_configured' } })
    } finally {
      await db.schoolProofKeyCheck.update({ where: { id: 1 }, data: { fingerprint: recorded.fingerprint } })
      forgetProofKeyCheck()
    }
  })

  it('a proved LinkedIn profile stays with its account: another account submitting it is flagged, and cannot be verified', async () => {
    // T3 proved probe-teacher-three in the test above and then withdrew it; the ledger still names T3.
    await as(T4)
    expect((await call(proof, 'POST', { id: SCHOOL }, { action: 'linkedin', url: 'linkedin.com/in/probe-teacher-three', consent: true })).status).toBe(200)
    const p = await db.schoolEmployment.findUniqueOrThrow({ where: { profileId_schoolId: { profileId: T4, schoolId: SCHOOL } } })
    // Sending the same profile again while it waits changes nothing: no new 60-day clock, no bumped row.
    expect((await call(proof, 'POST', { id: SCHOOL }, { action: 'linkedin', url: 'linkedin.com/in/probe-teacher-three', consent: true })).status).toBe(200)
    expect(await db.schoolEmployment.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ updatedAt: p.updatedAt, purgeAt: p.purgeAt })
    expect(p.flags).toEqual(['linkedin_shared']) // told to the moderator…
    expect((await call(proof, 'GET', { id: SCHOOL })).json?.proof).not.toHaveProperty('flags') // …never to the submitter
    h.admin = 'probe-admin@eno.vn'
    expect(await call(admin, 'POST', {}, { action: 'proof_verify', proofId: p.id, seenUpdatedAt: p.updatedAt.toISOString() })).toMatchObject({ status: 409, json: { error: 'linkedin_already_used' } })
    expect((await db.schoolEmployment.findUniqueOrThrow({ where: { id: p.id } })).status).toBe('pending') // rolled back
    h.admin = null
    // The moderation queue holds only reviews that can be approved: with a pending proof T4's review is in it…
    await as(T4)
    expect((await call(review, 'POST', { id: SCHOOL }, GOOD)).status).toBe(200)
    const r = await db.schoolReview.findFirstOrThrow({ where: { schoolId: SCHOOL, profileId: T4 } })
    const { queuedReviewIds, queuedReviewCount } = await import('@/lib/schools/queries')
    expect(await queuedReviewIds(10_000)).toContain(r.id)
    // A waiting proof past its date is closed for the queue too (the Proofs tab no longer offers it).
    const live = await db.schoolEmployment.findUniqueOrThrow({ where: { profileId_schoolId: { profileId: T4, schoolId: SCHOOL } } })
    await db.schoolEmployment.update({ where: { id: live.id }, data: { purgeAt: new Date(Date.now() - 1000) } })
    expect(await queuedReviewIds(10_000)).not.toContain(r.id)
    // …the teacher sees it as closed ("not checked in time"), never as still waiting…
    expect(await call(proof, 'GET', { id: SCHOOL })).toMatchObject({ status: 200, json: { proof: { status: 'rejected', rejectReason: 'Not checked in time — please submit it again.', linkedinUrl: null } } })
    // …no review can be written on it, and sending the profile again opens a new one, on a fresh 60-day window.
    expect(await call(review, 'POST', { id: SCHOOL }, GOOD)).toMatchObject({ status: 409, json: { error: 'proof_required' } })
    expect((await call(proof, 'POST', { id: SCHOOL }, { action: 'linkedin', url: 'linkedin.com/in/probe-teacher-three', consent: true })).status).toBe(200)
    expect((await db.schoolEmployment.findUniqueOrThrow({ where: { id: live.id } })).purgeAt!.getTime()).toBeGreaterThan(Date.now())
    await db.schoolEmployment.update({ where: { id: live.id }, data: { purgeAt: live.purgeAt } })
    expect(await queuedReviewIds(10_000)).toContain(r.id)
    // …and once the proof is withdrawn it waits off the queue (still pending, still the writer's to delete).
    expect((await call(proof, 'POST', { id: SCHOOL }, { action: 'withdraw' })).status).toBe(200)
    expect(await queuedReviewIds(10_000)).not.toContain(r.id)
    // The count shares the queue's predicate; it is global, and other probe files write reviews in parallel, so only
    // that it runs is asserted here.
    expect(typeof await queuedReviewCount()).toBe('number')
    expect((await db.schoolReview.findUniqueOrThrow({ where: { id: r.id } })).status).toBe('pending')
  })

  it('an account has at most a few proofs waiting at once, and a stale card cannot verify one past its date', async () => {
    const { PROOFS_PENDING_MAX } = await import('@/lib/schools/constants')
    const extra = Array.from({ length: PROOFS_PENDING_MAX }, (_, i) => `probe-route-cap-${i}`)
    try {
      for (const [i, id] of extra.entries()) {
        await db.school.create({ data: { id, slug: id, name: `Probe Cap ${i}`, kind: 'agency' } })
        await db.schoolEmployment.create({ data: { schoolId: id, profileId: T2, method: 'linkedin', status: 'pending', linkedinUrl: `https://www.linkedin.com/in/probe-cap-${i}/`, linkedinHash: `${'9'.repeat(56)}${String(i).padStart(8, '0')}`, challenge: 'abcd-efgh', purgeAt: new Date(Date.now() + DAY) } })
      }
      await as(T2)
      expect(await call(proof, 'POST', { id: SCHOOL2 }, { action: 'linkedin', url: 'linkedin.com/in/probe-cap-new', consent: true })).toMatchObject({ status: 429, json: { error: 'too_many_pending_proofs' } })
      // A card opened before the proof ran out of time cannot verify it now.
      const stale = await db.schoolEmployment.findFirstOrThrow({ where: { schoolId: extra[0], profileId: T2 } })
      await db.schoolEmployment.update({ where: { id: stale.id }, data: { purgeAt: new Date(Date.now() - 1000) } })
      const seen = await db.schoolEmployment.findUniqueOrThrow({ where: { id: stale.id } })
      h.admin = 'probe-admin@eno.vn'
      expect(await call(admin, 'POST', {}, { action: 'proof_verify', proofId: stale.id, seenUpdatedAt: seen.updatedAt.toISOString() })).toMatchObject({ status: 409, json: { error: 'invalid_status_transition' } })
      h.admin = null
    } finally {
      await db.school.deleteMany({ where: { id: { in: extra } } })
    }
  })

  it('the queue puts reviews a moderator can approve first, ahead of older ones still waiting on a proof', async () => {
    const [ready, waiting] = [uuid(9213), uuid(9214)]
    const text = { current: false, tenure: '1to2', role: 'teacher', employment: 'full_time', pros: GOOD.pros, cons: GOOD.cons, status: 'pending' }
    try {
      for (const id of [ready, waiting]) await db.profile.create({ data: { id, email: `${id.slice(-4)}@probe.test`, displayName: 'Probe', accountType: 'individual', createdAt: new Date(Date.now() - 30 * DAY) } })
      await db.schoolEmployment.create({ data: { schoolId: SCHOOL2, profileId: ready, method: 'linkedin', status: 'verified', linkedinHash: `${'7'.repeat(64)}`, decidedAt: new Date(), decidedBy: 'probe' } })
      await db.schoolEmployment.create({ data: { schoolId: SCHOOL2, profileId: waiting, method: 'linkedin', status: 'pending', linkedinHash: `${'8'.repeat(64)}`, challenge: 'abcd-efgh', purgeAt: new Date(Date.now() + DAY) } })
      const older = await db.schoolReview.create({ data: { schoolId: SCHOOL2, profileId: waiting, ...text } })
      await db.schoolReview.update({ where: { id: older.id }, data: { updatedAt: new Date(Date.now() - 2 * DAY) } })
      const newer = await db.schoolReview.create({ data: { schoolId: SCHOOL2, profileId: ready, ...text } })
      const { queuedReviewIds } = await import('@/lib/schools/queries')
      const q = await queuedReviewIds(10_000)
      expect(q.indexOf(newer.id)).toBeGreaterThanOrEqual(0)
      expect(q.indexOf(newer.id)).toBeLessThan(q.indexOf(older.id))
    } finally {
      await db.profile.deleteMany({ where: { id: { in: [ready, waiting] } } })
    }
  })

  it('a stale Verify claims nothing: the compare-and-set fails first and the ledger stays empty', async () => {
    const T7 = uuid(9209)
    await db.profile.create({ data: { id: T7, email: '9209@probe.test', displayName: 'Probe', accountType: 'individual', createdAt: new Date(Date.now() - 30 * DAY) } })
    await as(T7)
    expect((await call(proof, 'POST', { id: SCHOOL }, { action: 'linkedin', url: 'linkedin.com/in/probe-attacker', consent: true })).status).toBe(200)
    const seen = await db.schoolEmployment.findUniqueOrThrow({ where: { profileId_schoolId: { profileId: T7, schoolId: SCHOOL } } })
    await new Promise((r) => setTimeout(r, 5))
    // After the moderator opened the card, the submitter swaps in someone else's profile…
    expect((await call(proof, 'POST', { id: SCHOOL }, { action: 'linkedin', url: 'linkedin.com/in/probe-victim', consent: true })).status).toBe(200)
    const swapped = await db.schoolEmployment.findUniqueOrThrow({ where: { profileId_schoolId: { profileId: T7, schoolId: SCHOOL } } })
    h.admin = 'probe-admin@eno.vn'
    expect(await call(admin, 'POST', {}, { action: 'proof_verify', proofId: seen.id, seenUpdatedAt: seen.updatedAt.toISOString() })).toMatchObject({ status: 409, json: { error: 'review_changed_reload' } })
    expect(await db.schoolProofKey.count({ where: { kind: 'linkedin', hash: swapped.linkedinHash! } })).toBe(0)
    h.admin = null
    await db.profile.delete({ where: { id: T7 } })
  })

  it('retention runs on a schedule: a decided proof is erased after 30 days, an undecided one closed after 60', async () => {
    const { sweepProofRetention } = await import('@/lib/schools/employment')
    const T8 = uuid(9210)
    await db.profile.create({ data: { id: T8, email: '9210@probe.test', displayName: 'Probe', accountType: 'individual', createdAt: new Date(Date.now() - 30 * DAY) } })
    const row = await db.schoolEmployment.create({ data: { schoolId: SCHOOL, profileId: T8, method: 'linkedin', status: 'pending', linkedinUrl: 'https://www.linkedin.com/in/probe-eight/', linkedinHash: `${'3'.repeat(64)}`, challenge: 'abcd-efgh', purgeAt: new Date(Date.now() + DAY) } })
    // T8 writes a review while the proof waits; nobody checks it in time (its 60 days run out).
    await as(T8)
    expect((await call(review, 'POST', { id: SCHOOL }, GOOD)).status).toBe(200)
    const rv = await db.schoolReview.findFirstOrThrow({ where: { schoolId: SCHOOL, profileId: T8 } })
    await db.schoolEmployment.update({ where: { id: row.id }, data: { purgeAt: new Date(Date.now() - 1000) } })
    const r = await sweepProofRetention(new Date(), { schoolIds: [SCHOOL, SCHOOL2] })
    expect(r.expired).toBeGreaterThanOrEqual(1)
    expect(await db.schoolEmployment.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ status: 'rejected', linkedinUrl: null, challenge: null, decidedBy: 'retention' })
    // Withdrawing a proof that is already closed keeps its decision — and the clock on the review it cannot publish.
    const closed = await db.schoolEmployment.findUniqueOrThrow({ where: { id: row.id } })
    expect((await call(proof, 'POST', { id: SCHOOL }, { action: 'withdraw' })).status).toBe(200)
    expect(await db.schoolEmployment.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ status: 'rejected', decidedAt: closed.decidedAt })
    // The review it can no longer publish is kept ORPHAN_REVIEW_DAYS after that decision, then deleted.
    const { ORPHAN_REVIEW_DAYS } = await import('@/lib/schools/constants')
    await db.schoolEmployment.update({ where: { id: row.id }, data: { decidedAt: new Date(Date.now() - (ORPHAN_REVIEW_DAYS - 1) * DAY) } })
    await sweepProofRetention(new Date(), { schoolIds: [SCHOOL, SCHOOL2] })
    expect(await db.schoolReview.findUnique({ where: { id: rv.id } })).not.toBeNull()
    await db.schoolEmployment.update({ where: { id: row.id }, data: { decidedAt: new Date(Date.now() - (ORPHAN_REVIEW_DAYS + 1) * DAY) } })
    expect((await sweepProofRetention(new Date(), { schoolIds: [SCHOOL, SCHOOL2] })).reviews).toBeGreaterThanOrEqual(1)
    expect(await db.schoolReview.findUnique({ where: { id: rv.id } })).toBeNull()
    await db.profile.delete({ where: { id: T8 } })
    // A review with NO proof row at all (written before proofs existed) goes too, counted from its last change.
    const T9 = uuid(9211)
    await db.profile.create({ data: { id: T9, email: '9211@probe.test', displayName: 'Probe', accountType: 'individual', createdAt: new Date(Date.now() - 400 * DAY) } })
    const text = { current: false, tenure: '1to2', role: 'teacher', employment: 'full_time', pros: GOOD.pros, cons: GOOD.cons, status: 'published' }
    const stale = await db.schoolReview.create({ data: { schoolId: SCHOOL, profileId: T9, ...text } })
    const fresh = await db.schoolReview.create({ data: { schoolId: SCHOOL2, profileId: T9, ...text } })
    await db.schoolReview.update({ where: { id: stale.id }, data: { updatedAt: new Date(Date.now() - (ORPHAN_REVIEW_DAYS + 1) * DAY) } })
    // Under an open report it is moderation evidence: kept until the report is resolved.
    const rep = await db.schoolReport.create({ data: { schoolId: SCHOOL, reviewId: stale.id, kind: 'review_report', reason: 'spam' } })
    await sweepProofRetention(new Date(), { schoolIds: [SCHOOL, SCHOOL2] })
    expect(await db.schoolReview.findUnique({ where: { id: stale.id } })).not.toBeNull()
    await db.schoolReport.update({ where: { id: rep.id }, data: { status: 'resolved', resolvedAt: new Date(), resolvedBy: 'probe' } })
    await sweepProofRetention(new Date(), { schoolIds: [SCHOOL, SCHOOL2] })
    expect(await db.schoolReview.findUnique({ where: { id: stale.id } })).toBeNull()
    expect(await db.schoolReview.findUnique({ where: { id: fresh.id } })).not.toBeNull()
    await db.profile.delete({ where: { id: T9 } })
    // The vote log is swept after VOTE_LOG_KEEP_DAYS; a recent event stays.
    const { VOTE_LOG_KEEP_DAYS } = await import('@/lib/schools/constants')
    const oldEv = await db.schoolVoteEvent.create({ data: { schoolId: SCHOOL, profileId: T1, value: 1, at: new Date(Date.now() - (VOTE_LOG_KEEP_DAYS + 1) * DAY) } })
    const newEv = await db.schoolVoteEvent.create({ data: { schoolId: SCHOOL, profileId: T1, value: 1, at: new Date(Date.now() - DAY) } })
    // An old event that is still an account's newest for its school is the vote as it stands: it stays.
    const lone = await db.schoolVoteEvent.create({ data: { schoolId: SCHOOL2, profileId: T1, value: -1, at: new Date(Date.now() - (VOTE_LOG_KEEP_DAYS + 5) * DAY) } })
    await sweepProofRetention(new Date(), { schoolIds: [SCHOOL, SCHOOL2] })
    expect(await db.schoolVoteEvent.findUnique({ where: { id: oldEv.id } })).toBeNull()
    expect(await db.schoolVoteEvent.findUnique({ where: { id: newEv.id } })).not.toBeNull()
    expect(await db.schoolVoteEvent.findUnique({ where: { id: lone.id } })).not.toBeNull()
    await db.schoolVoteEvent.deleteMany({ where: { id: { in: [lone.id, newEv.id] } } })
    // …but an old withdrawal (0) that is the newest event records no vote: it goes too.
    const gone = await db.schoolVoteEvent.create({ data: { schoolId: SCHOOL2, profileId: T1, value: 0, at: new Date(Date.now() - (VOTE_LOG_KEEP_DAYS + 5) * DAY) } })
    await sweepProofRetention(new Date(), { schoolIds: [SCHOOL, SCHOOL2] })
    expect(await db.schoolVoteEvent.findUnique({ where: { id: gone.id } })).toBeNull()
  })
  it('a revoked proof unpublishes its review, and its LinkedIn profile can never prove employment again', async () => {
    await as(T5)
    expect((await call(proof, 'POST', { id: SCHOOL }, { action: 'linkedin', url: 'linkedin.com/in/probe-teacher-six', consent: true })).status).toBe(200)
    h.admin = 'probe-admin@eno.vn'
    let p = await db.schoolEmployment.findUniqueOrThrow({ where: { profileId_schoolId: { profileId: T5, schoolId: SCHOOL } } })
    expect((await call(admin, 'POST', {}, { action: 'proof_verify', proofId: p.id, seenUpdatedAt: p.updatedAt.toISOString() })).status).toBe(200)
    await as(T5)
    expect((await call(review, 'POST', { id: SCHOOL }, GOOD)).status).toBe(200)
    const r = await db.schoolReview.findFirstOrThrow({ where: { schoolId: SCHOOL, profileId: T5 } })
    expect((await call(admin, 'POST', {}, { action: 'approve', reviewId: r.id, seenUpdatedAt: r.updatedAt.toISOString() })).status).toBe(200)
    // The same profile proves T5's employment at a second school too, with a published review there.
    await as(T5)
    expect((await call(proof, 'POST', { id: SCHOOL2 }, { action: 'linkedin', url: 'linkedin.com/in/probe-teacher-six', consent: true })).status).toBe(200)
    const p2 = await db.schoolEmployment.findUniqueOrThrow({ where: { profileId_schoolId: { profileId: T5, schoolId: SCHOOL2 } } })
    expect(p2.flags).toEqual([]) // the same account proving its own profile again is no clash
    expect((await call(admin, 'POST', {}, { action: 'proof_verify', proofId: p2.id, seenUpdatedAt: p2.updatedAt.toISOString() })).status).toBe(200)
    await as(T5)
    expect((await call(review, 'POST', { id: SCHOOL2 }, GOOD)).status).toBe(200)
    const r2 = await db.schoolReview.findFirstOrThrow({ where: { schoolId: SCHOOL2, profileId: T5 } })
    expect((await call(admin, 'POST', {}, { action: 'approve', reviewId: r2.id, seenUpdatedAt: r2.updatedAt.toISOString() })).status).toBe(200)
    // Another account submits the same profile meanwhile (flagged, waiting).
    await as(T4)
    expect((await call(proof, 'POST', { id: SCHOOL }, { action: 'linkedin', url: 'linkedin.com/in/probe-teacher-six', consent: true })).status).toBe(200)
    // Revoke at ONE school: every proof made with that profile goes, and every review they backed is UNPUBLISHED
    // (a later proof cannot bring one back without a moderator); the key is spent.
    expect((await call(admin, 'POST', {}, { action: 'proof_revoke', proofId: p.id, reason: 'Borrowed LinkedIn profile' })).status).toBe(200)
    // Another account's proof of the same profile is NOT touched — nothing may tell that account what was found…
    const t4 = await db.schoolEmployment.findUniqueOrThrow({ where: { profileId_schoolId: { profileId: T4, schoolId: SCHOOL } } })
    expect(t4.status).toBe('pending')
    // …and it can never verify: the key is spent.
    expect(await call(admin, 'POST', {}, { action: 'proof_verify', proofId: t4.id, seenUpdatedAt: t4.updatedAt.toISOString() })).toMatchObject({ status: 409, json: { error: 'proof_rejected' } })
    expect(await db.schoolReview.findUniqueOrThrow({ where: { id: r.id } })).toMatchObject({ status: 'rejected', rejectReason: 'Borrowed LinkedIn profile' })
    expect(await db.schoolEmployment.findUniqueOrThrow({ where: { id: p2.id } })).toMatchObject({ status: 'rejected' })
    expect(await db.schoolReview.findUniqueOrThrow({ where: { id: r2.id } })).toMatchObject({ status: 'rejected' })
    expect((await call(admin, 'POST', {}, { action: 'proof_revoke', proofId: p.id, reason: 'again' })).status).toBe(409)
    await as(T5)
    expect((await call(proof, 'POST', { id: SCHOOL }, { action: 'linkedin', url: 'linkedin.com/in/probe-teacher-six', consent: true })).status).toBe(200)
    p = await db.schoolEmployment.findUniqueOrThrow({ where: { profileId_schoolId: { profileId: T5, schoolId: SCHOOL } } })
    // Told to the moderator, never to the submitter: revoked, and (T4's closed proof) submitted from another account.
    expect(p.flags).toEqual(['linkedin_shared', 'account_revoked', 'linkedin_revoked'])
    expect(await call(admin, 'POST', {}, { action: 'proof_verify', proofId: p.id, seenUpdatedAt: p.updatedAt.toISOString() })).toMatchObject({ status: 409, json: { error: 'proof_rejected' } })
    h.admin = null
  })

  it('withdrawing is no way out of a revocation: a withdrawn proof that once verified can still be revoked', async () => {
    const T11 = uuid(9208)
    await db.profile.create({ data: { id: T11, email: '9208@probe.test', displayName: 'Probe', accountType: 'individual', createdAt: new Date(Date.now() - 30 * DAY) } })
    await as(T11)
    expect((await call(proof, 'POST', { id: SCHOOL2 }, { action: 'linkedin', url: 'linkedin.com/in/probe-eleven', consent: true })).status).toBe(200)
    const p = await db.schoolEmployment.findUniqueOrThrow({ where: { profileId_schoolId: { profileId: T11, schoolId: SCHOOL2 } } })
    h.admin = 'probe-admin@eno.vn'
    expect((await call(admin, 'POST', {}, { action: 'proof_verify', proofId: p.id, seenUpdatedAt: p.updatedAt.toISOString() })).status).toBe(200)
    await as(T11)
    expect((await call(proof, 'POST', { id: SCHOOL2 }, { action: 'withdraw' })).status).toBe(200)
    const withdrawn = await db.schoolEmployment.findUniqueOrThrow({ where: { id: p.id } })
    expect((await call(admin, 'POST', {}, { action: 'proof_revoke', proofId: p.id, reason: 'Borrowed LinkedIn profile' })).status).toBe(200)
    // The withdrawal's date stands: a later revocation does not restart the 60-day clock.
    expect(await db.schoolEmployment.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ status: 'rejected', decidedAt: withdrawn.decidedAt })
    const { proofHash } = await import('@/lib/schools/employment')
    expect((await db.schoolProofKey.findUniqueOrThrow({ where: { kind_hash: { kind: 'linkedin', hash: proofHash('linkedin', 'probe-eleven') } } })).rejectedAt).not.toBeNull()
    expect((await db.schoolEmployment.findUniqueOrThrow({ where: { id: p.id } })).status).toBe('rejected')
    h.admin = null
    await db.profile.delete({ where: { id: T11 } })
  })

  it('swapping profiles is no way out of a revocation either: every profile the account proved is burnt', async () => {
    const T13 = uuid(9215)
    await db.profile.create({ data: { id: T13, email: '9215@probe.test', displayName: 'Probe', accountType: 'individual', createdAt: new Date(Date.now() - 30 * DAY) } })
    await as(T13)
    expect((await call(proof, 'POST', { id: SCHOOL2 }, { action: 'linkedin', url: 'linkedin.com/in/probe-x-thirteen', consent: true })).status).toBe(200)
    let p = await db.schoolEmployment.findUniqueOrThrow({ where: { profileId_schoolId: { profileId: T13, schoolId: SCHOOL2 } } })
    h.admin = 'probe-admin@eno.vn'
    expect((await call(admin, 'POST', {}, { action: 'proof_verify', proofId: p.id, seenUpdatedAt: p.updatedAt.toISOString() })).status).toBe(200)
    // Withdraw, then send ANOTHER profile: flagged for the moderator…
    await as(T13)
    expect((await call(proof, 'POST', { id: SCHOOL2 }, { action: 'withdraw' })).status).toBe(200)
    expect((await call(proof, 'POST', { id: SCHOOL2 }, { action: 'linkedin', url: 'linkedin.com/in/probe-y-thirteen', consent: true })).status).toBe(200)
    p = await db.schoolEmployment.findUniqueOrThrow({ where: { id: p.id } })
    expect(p.flags).toEqual(['linkedin_changed'])
    // Even once that second proof is REJECTED, the card can still revoke: the account's first profile is live.
    expect((await call(admin, 'POST', {}, { action: 'proof_reject', proofId: p.id, reason: 'The school is not in Experience', seenUpdatedAt: p.updatedAt.toISOString() })).status).toBe(200)
    // …and a revocation of the (rejected) row burns the profile the account PROVED (Y was never proved: it may be anyone's,
    // so it is not burnt — the next test is why).
    expect((await call(admin, 'POST', {}, { action: 'proof_revoke', proofId: p.id, reason: 'Borrowed LinkedIn profile' })).status).toBe(200)
    const { proofHash } = await import('@/lib/schools/employment')
    expect((await db.schoolProofKey.findUniqueOrThrow({ where: { kind_hash: { kind: 'linkedin', hash: proofHash('linkedin', 'probe-x-thirteen') } } })).rejectedAt).not.toBeNull()
    expect(await db.schoolProofKey.findUnique({ where: { kind_hash: { kind: 'linkedin', hash: proofHash('linkedin', 'probe-y-thirteen') } } })).toBeNull()
    // Going back to the first profile: flagged as revoked, and it can never verify.
    await as(T13)
    expect((await call(proof, 'POST', { id: SCHOOL2 }, { action: 'linkedin', url: 'linkedin.com/in/probe-x-thirteen', consent: true })).status).toBe(200)
    p = await db.schoolEmployment.findUniqueOrThrow({ where: { id: p.id } })
    expect(p.flags).toContain('linkedin_revoked')
    expect(p.flags).toContain('account_revoked') // the account was caught before, whatever profile it sends
    expect(await call(admin, 'POST', {}, { action: 'proof_verify', proofId: p.id, seenUpdatedAt: p.updatedAt.toISOString() })).toMatchObject({ status: 409, json: { error: 'proof_rejected' } })
    h.admin = null
    await db.profile.delete({ where: { id: T13 } })
  })

  it('a revocation never burns a profile the account does not own (no griefing a victim whose URL it submitted)', async () => {
    const T14 = uuid(9216)
    await db.profile.create({ data: { id: T14, email: '9216@probe.test', displayName: 'Probe', accountType: 'individual', createdAt: new Date(Date.now() - 30 * DAY) } })
    await as(T14)
    expect((await call(proof, 'POST', { id: SCHOOL }, { action: 'linkedin', url: 'linkedin.com/in/probe-a-fourteen', consent: true })).status).toBe(200)
    const own = await db.schoolEmployment.findUniqueOrThrow({ where: { profileId_schoolId: { profileId: T14, schoolId: SCHOOL } } })
    h.admin = 'probe-admin@eno.vn'
    expect((await call(admin, 'POST', {}, { action: 'proof_verify', proofId: own.id, seenUpdatedAt: own.updatedAt.toISOString() })).status).toBe(200)
    // The account submits a VICTIM's profile at another school, and is caught.
    await as(T14)
    expect((await call(proof, 'POST', { id: SCHOOL2 }, { action: 'linkedin', url: 'linkedin.com/in/probe-victim', consent: true })).status).toBe(200)
    const theirs = await db.schoolEmployment.findUniqueOrThrow({ where: { profileId_schoolId: { profileId: T14, schoolId: SCHOOL2 } } })
    expect((await call(admin, 'POST', {}, { action: 'proof_revoke', proofId: theirs.id, reason: 'Not their profile' })).status).toBe(200)
    const { proofHash } = await import('@/lib/schools/employment')
    expect((await db.schoolProofKey.findUniqueOrThrow({ where: { kind_hash: { kind: 'linkedin', hash: proofHash('linkedin', 'probe-a-fourteen') } } })).rejectedAt).not.toBeNull()
    // The victim's profile is untouched: never claimed, never burnt.
    expect(await db.schoolProofKey.findUnique({ where: { kind_hash: { kind: 'linkedin', hash: proofHash('linkedin', 'probe-victim') } } })).toBeNull()
    h.admin = null
    await db.profile.delete({ where: { id: T14 } })
  })

  it("an erased account's profile stays spent (ownerless key); a hidden school still lets a teacher withdraw", async () => {
    const T10 = uuid(9212)
    await db.profile.create({ data: { id: T10, email: '9212@probe.test', displayName: 'Probe', accountType: 'individual', createdAt: new Date(Date.now() - 30 * DAY) } })
    await as(T10)
    expect((await call(proof, 'POST', { id: SCHOOL }, { action: 'linkedin', url: 'linkedin.com/in/probe-ten', consent: true })).status).toBe(200)
    h.admin = 'probe-admin@eno.vn'
    const p = await db.schoolEmployment.findUniqueOrThrow({ where: { profileId_schoolId: { profileId: T10, schoolId: SCHOOL } } })
    expect((await call(admin, 'POST', {}, { action: 'proof_verify', proofId: p.id, seenUpdatedAt: p.updatedAt.toISOString() })).status).toBe(200)
    await db.profile.delete({ where: { id: T10 } }) // erasure: the proof goes, the key stays — owned by no one
    const { proofHash } = await import('@/lib/schools/employment')
    expect(await db.schoolProofKey.findUnique({ where: { kind_hash: { kind: 'linkedin', hash: proofHash('linkedin', 'probe-ten') } } })).toMatchObject({ profileId: null })
    // Hide the school: proving is closed, but seeing and withdrawing one's own proof is not.
    await as(T1)
    await db.school.update({ where: { id: SCHOOL }, data: { status: 'hidden' } })
    try {
      expect((await call(proof, 'POST', { id: SCHOOL }, { action: 'linkedin', url: 'linkedin.com/in/probe-teacher-three', consent: true })).status).toBe(404)
      expect((await call(proof, 'GET', { id: SCHOOL })).status).toBe(200)
      expect(await call(proof, 'POST', { id: SCHOOL }, { action: 'withdraw' })).toMatchObject({ status: 200, json: { proof: { status: 'withdrawn' } } })
    } finally {
      await db.school.update({ where: { id: SCHOOL }, data: { status: 'active' } })
    }
    h.admin = null
  })
})
