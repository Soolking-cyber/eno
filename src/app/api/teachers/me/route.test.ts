import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// PUT /api/teachers/me — the profile the form was loaded for (2026-10-07). A form opened as one account and still open when
// the session became another (a sign-in in another tab) must never write that account's profile: its cover and video bases
// could coincide. ⛔ A save names the profile it edits, or claims there is none — never neither (gate review, 2026-10-08):
// edit mode sends the TeacherProfile id it loaded; a body with none (the join form's null, a tab from before the field) may
// only create.
type Row = Record<string, any>
const h = vi.hoisted(() => ({
  me: { id: 'p-b', accountType: 'individual', email: 'b@example.com' } as Row,
  mine: { id: 'tp-b' } as Row | null,
  saved: [] as Row[],
  opts: [] as unknown[],
  changedUnderLock: false, // the save's own check under the account lock refuses (publish.ts TeacherProfileChangedError)
  noticeChanged: null as string | null, // the save refuses an older notice (publish.ts TeacherNoticeChangedError)
  decision: { ok: true } as Row,
  decisionFails: false, // the identity-gate read throws (a failed query)
  logged: [] as unknown[],
  created: false, // the save made the profile (its FIRST save) — what the Meta conversion fires on
  live: true, // …and left it public
  appleThrows: false,
  sendRejects: false,
  afterWork: [] as Array<() => unknown>,
  afterThrows: false, // scheduling the after-response work itself fails
  capi: [] as Row[],
  capiOn: true,
  appleLinked: false,
  appleAsked: 0,
}))
vi.mock('next/server', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  after: (fn: () => unknown) => { if (h.afterThrows) throw new Error('after: outside a request scope'); h.afterWork.push(fn) },
}))
vi.mock('@/lib/meta-capi', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  metaCapiConfigured: () => h.capiOn,
  sendMetaCapiEvent: async (name: string, opts: Row) => { if (h.sendRejects) throw new Error('graph unreachable'); h.capi.push({ name, ...opts }) },
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/log', () => ({ logError: (e: unknown) => { h.logged.push(e) } }))
vi.mock('@/lib/admin', () => ({ getCurrentProfile: async () => h.me, getCurrentProfileId: async () => h.me.id, getAdmin: async () => null, isAdminEmail: () => false, isCurrentUserAppleLinkedByClaims: async () => { h.appleAsked++; if (h.appleThrows) throw new Error('claims unreadable'); return h.appleLinked } }))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => ({ success: true, resetSec: 0 }), kv: { set: async () => 'OK', get: async () => null } }))
vi.mock('@/lib/db', () => ({ db: { teacherProfile: { findUnique: async () => h.mine } } }))
vi.mock('@/lib/publish-guard', () => ({ PublishBlockedError: class extends Error {} }))
vi.mock('@/lib/compliance/seller-publish-gate', () => ({
  sellerPublishDecision: async () => { if (h.decisionFails) throw new Error('identity_verifications: connection reset'); return h.decision },
}))
vi.mock('@/lib/listing-image', () => ({ isListingImageUrl: (u: unknown) => typeof u === 'string' && u.startsWith('https://sb.eno.vn/storage/v1/object/public/listings/') }))
const fo = vi.hoisted(() => ({ after: [] as unknown[][], committed: true }))
vi.mock('@/lib/core/first-onboarding', () => ({
  individualOnboardingWrite: (p: { displayName: string | null }) => ({ data: { accountType: 'individual', tos: 'stamp' }, nameIfNone: !p.displayName }),
  afterIndividualOnboarding: async (...a: unknown[]) => { fo.after.push(a) },
}))
vi.mock('@/lib/teachers/publish', () => {
  class E extends Error {}
  // Its own class: the route tests the other errors first, and a shared one would be caught as a validation error.
  class TeacherProfileChangedError extends Error {}
  class TeacherNoticeChangedError extends Error { constructor(public notice: string) { super('notice_changed') } }
  return {
    TeacherCoverConflictError: E, TeacherValidationError: E, TeacherVideoConflictError: E, TeacherVideoStoreError: E, TeacherProfileChangedError,
    TeacherNoticeChangedError,
    deleteTeacherProfile: async () => true,
    saveTeacherProfile: async (_p: Row, body: Row, opts?: unknown) => {
      h.opts.push(opts)
      if (h.changedUnderLock) throw new TeacherProfileChangedError()
      if (h.noticeChanged) throw new TeacherNoticeChangedError(h.noticeChanged)
      h.saved.push(body)
      // the account step rides the save's own transaction (publish.ts `onboard`): it commits with it, or not at all
      const onboarded = !!(opts as { onboard?: unknown } | undefined)?.onboard && fo.committed
      return { listingId: 'L1', created: h.created, live: h.live, noGoal: false, cover: null, video: null, onboarded }
    },
  }
})

const { GET, PUT } = await import('./route')
/** Every save of this release carries the teach-area list (the v2 shape) — `old: true` sends one without it. */
const put = (body: Row, { old = false } = {}) =>
  PUT(new Request('https://eno.vn/api/teachers/me', { method: 'PUT', body: JSON.stringify(old ? body : { teachAreas: ['online'], ...body }) }) as never, {} as never)
const get = async () => (await GET(new Request('https://eno.vn/api/teachers/me') as never, {} as never)).json()

beforeEach(() => {
  h.mine = { id: 'tp-b' }; h.saved = []; h.opts = []; h.changedUnderLock = false; h.noticeChanged = null; h.decision = { ok: true }
  h.decisionFails = false; h.logged = []
  h.created = false; h.live = true; h.afterWork = []; h.capi = []; h.capiOn = true; h.appleLinked = false; h.appleAsked = 0; h.appleThrows = false; h.sendRejects = false; h.afterThrows = false
  h.me = { id: 'p-b', accountType: 'individual', email: 'b@example.com' }
  fo.after = []; fo.committed = true
})

describe('PUT /api/teachers/me — the profile the form was loaded for', () => {
  it('saves when the form names this account\'s profile', async () => {
    expect((await put({ fullName: 'B', teacherProfileId: 'tp-b' })).status).toBe(200)
    expect(h.saved).toHaveLength(1)
  })
  it('⛔ refuses a form loaded for ANOTHER profile — nothing is written', async () => {
    const res = await put({ fullName: 'A', teacherProfileId: 'tp-a' })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'profile_changed' })
    expect(h.saved).toEqual([])
  })
  it('refuses a named profile when this account has none (deleted elsewhere)', async () => {
    h.mine = null
    expect((await put({ fullName: 'A', teacherProfileId: 'tp-a' })).status).toBe(409)
    expect(h.saved).toEqual([])
  })
  it('⛔ a body with NO id never writes an existing profile — an edit tab from before the field, opened as A, saving as B', async () => {
    const res = await put({ fullName: 'A' })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'profile_changed' })
    expect(h.opts).toEqual([]) // the save is never called
  })
  it('the join form\'s null claims there is none: refused over an existing profile, like no id at all', async () => {
    for (const teacherProfileId of [null, 42]) { // a non-string id is no claim to a profile either
      expect((await put({ fullName: 'B', teacherProfileId })).status).toBe(409)
    }
    expect(h.opts).toEqual([])
  })
  it('no profile yet: a body with no id, or null, may CREATE — and the save re-checks "none" under the lock', async () => {
    h.mine = null
    expect((await put({ fullName: 'B' })).status).toBe(200)
    expect((await put({ fullName: 'B', teacherProfileId: null })).status).toBe(200)
    expect(h.saved).toHaveLength(2)
    expect(h.opts).toEqual([{ expectTeacherProfileId: null }, { expectTeacherProfileId: null }])
  })
  it('⛔ hands the loaded profile to the save, which re-checks it UNDER THE LOCK — the read above is only the fast path', async () => {
    await put({ fullName: 'B', teacherProfileId: 'tp-b' })
    expect(h.opts).toEqual([{ expectTeacherProfileId: 'tp-b' }])
  })
  it('⛔ ONE SHAPE: a body with no teach-area list (a tab from before the redesign) is 409 profile_changed — never saved, edit or create', async () => {
    let res = await put({ fullName: 'B', teacherProfileId: 'tp-b', preferredCities: ['ha-noi'] }, { old: true })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'profile_changed' })
    h.mine = null
    res = await put({ fullName: 'B', teacherProfileId: null, preferredCities: ['ha-noi'] }, { old: true })
    expect(res.status).toBe(409)
    expect(h.opts).toEqual([]) // the save is never called
  })
  it('maps an older Publish / cover / AI notice to 409 notice_changed, naming which', async () => {
    h.noticeChanged = 'publish'
    const res = await put({ fullName: 'B', teacherProfileId: 'tp-b' })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'notice_changed', notice: 'publish' })
    expect(h.saved).toEqual([])
  })
  it('a change the fast path missed (deleted, made or re-made before the lock) is the same 409 profile_changed', async () => {
    h.changedUnderLock = true
    const res = await put({ fullName: 'B', teacherProfileId: 'tp-b' })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'profile_changed' })
    // …and for a "none" claim, when another window made a profile in between.
    h.mine = null
    expect((await put({ fullName: 'B', teacherProfileId: null })).status).toBe(409)
    expect(h.saved).toEqual([])
  })
})

// What the edit form reads on load (teacher-form): the TeacherProfile id it then names on every save and Remove, the video
// base, the visibility choice, the public URL — and only WHETHER a private video exists, never its path (gate review,
// 2026-10-08: "if GET does not return the id, every edit save is refused" — it does, and this pins it).
// A new teacher profile is a listing posted: it sends the Meta conversion a posted listing sends (Lead), so an ad for
// teacher.eno.vn can be measured by the profiles it brought (2026-10-11). The sender's own consent gate is meta-capi.ts's;
// here: WHETHER it may go is settled before the save, it goes after the response — and nothing about it can fail a save.
describe('PUT /api/teachers/me — the Meta conversion for a NEW profile', () => {
  /** A consent v2 answer (src/lib/consent-value.ts): bits = personalization · analytics · advertising. */
  const consent = (bits: string) => `eno-consent-v2=v2.${bits}.${Math.floor(Date.now() / 1000) - 60}.c0ffee00-1234-4abc-8def-001122334455`
  const ADS_ON = consent('001')
  const create = (headers: Record<string, string> = { cookie: ADS_ON }) => {
    h.mine = null; h.created = true
    return PUT(new Request('https://eno.vn/api/teachers/me', { method: 'PUT', headers, body: JSON.stringify({ teachAreas: ['online'], teacherProfileId: null }) }) as never, {} as never)
  }
  const flush = async () => { for (const fn of h.afterWork) await fn() }
  beforeEach(() => { vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://eno.vn') })
  afterEach(() => { vi.unstubAllEnvs() })

  it('the first save sends ONE Lead, after the response: the listing, the category, no value — and who, from this request', async () => {
    h.me = { id: 'p-b', accountType: 'individual', email: 'b@example.com', phone: '+84901234567' }
    // The join page's address as the hand-off leaves it: with the campaign in its query.
    const res = await create({ cookie: ADS_ON, referer: 'https://eno.vn/teachers/join?utm_source=meta&utm_campaign=teacher_profiles', 'user-agent': 'UA/1' })
    expect(res.status).toBe(200)
    expect(h.capi).toHaveLength(0) // nothing before the response
    await flush()
    expect(h.capi).toHaveLength(1)
    expect(h.capi[0].name).toBe('Lead')
    expect(h.capi[0].customData).toEqual({ content_ids: ['L1'], content_type: 'product', content_category: 'Teachers', value: 0, currency: 'VND' })
    expect(h.capi[0].userData).toMatchObject({ email: 'b@example.com', phone: '+84901234567', externalId: 'p-b', appleLinked: false, userAgent: 'UA/1', adConsent: true })
    // ⛔ The page is NAMED, never read from the request: /privacy sends a campaign to Meta only when Analytics is on too.
    expect(h.capi[0].eventSourceUrl).toBe('https://eno.vn/teachers/join')
    expect(JSON.stringify(h.capi[0])).not.toContain('utm_')
    // ⛔ No event id: the account id leaves as `externalId` (hashed by the sender) or not at all.
    expect(h.capi[0].eventId).toBeUndefined()
  })
  it('⛔ whatever the request says its page was — another site, a path with a secret — the event names the join page', async () => {
    await create({ cookie: ADS_ON, referer: 'https://evil.example/steal?token=abc' }); await flush()
    expect(h.capi[0].eventSourceUrl).toBe('https://eno.vn/teachers/join')
    expect(JSON.stringify(h.capi[0])).not.toContain('evil.example')
  })
  it('a build with no app address sends the event without a page', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '')
    await create(); await flush()
    expect(h.capi).toHaveLength(1)
    expect(h.capi[0].eventSourceUrl).toBeUndefined()
  })
  it('⛔ Advertising not chosen (no answer, or the other two purposes only): nothing is queued, and the Apple link is not even asked', async () => {
    expect((await create({})).status).toBe(200)
    expect((await create({ cookie: consent('110') })).status).toBe(200)
    await flush()
    expect(h.capi).toHaveLength(0)
    expect(h.afterWork).toHaveLength(0)
    expect(h.appleAsked).toBe(0)
  })
  it('⛔ an edit is not a new profile — nothing is asked, nothing is sent', async () => {
    const res = await PUT(new Request('https://eno.vn/api/teachers/me', { method: 'PUT', headers: { cookie: ADS_ON }, body: JSON.stringify({ teachAreas: ['online'], fullName: 'B', teacherProfileId: 'tp-b' }) }) as never, {} as never)
    expect(res.status).toBe(200)
    await flush()
    expect(h.capi).toHaveLength(0)
    expect(h.appleAsked).toBe(0)
  })
  it('⛔ a new profile the save did not leave public is not a listing posted — nothing is sent', async () => {
    h.live = false
    expect((await create()).status).toBe(200)
    await flush()
    expect(h.capi).toHaveLength(0)
  })
  it('⛔ an Apple-linked account says so, so its email never becomes a hash (D14)', async () => {
    h.appleLinked = true
    await create(); await flush()
    expect(h.capi[0].userData.appleLinked).toBe(true)
  })
  it('not configured: nothing is queued and nothing is asked', async () => {
    h.capiOn = false
    expect((await create()).status).toBe(200)
    await flush()
    expect(h.capi).toHaveLength(0)
    expect(h.appleAsked).toBe(0)
  })
  it('a refused save sends nothing', async () => {
    h.changedUnderLock = true
    expect((await create()).status).toBe(409)
    await flush()
    expect(h.capi).toHaveLength(0)
    expect(h.afterWork).toHaveLength(0)
  })
  it('⛔ THE APPLE ANSWER IS ASKED BEFORE THE SAVE: one that cannot be read costs the event, never the save — 200, saved, logged', async () => {
    h.appleThrows = true
    const res = await create()
    expect(res.status).toBe(200)
    expect((await res.json()).listingId).toBe('L1')
    expect(h.saved).toHaveLength(1)
    await flush()
    expect(h.capi).toHaveLength(0)
    expect(h.afterWork).toHaveLength(0) // never sent without the answer
    expect(h.logged).toHaveLength(1)
  })
  it('⛔ …and so does a cookie that cannot be decoded (a malformed _fbp): 200, saved, no event, logged', async () => {
    const res = await create({ cookie: `${ADS_ON}; _fbp=%E0%A4%A` })
    expect(res.status).toBe(200)
    expect(h.saved).toHaveLength(1)
    await flush()
    expect(h.capi).toHaveLength(0)
    expect(h.logged).toHaveLength(1)
  })
  it('⛔ AFTER THE COMMIT NOTHING REACHES THE SAVE\'S ERROR HANDLING: scheduling that throws still answers 200 with the saved profile, logged', async () => {
    h.afterThrows = true
    const res = await create()
    expect(res.status).toBe(200)
    expect((await res.json()).listingId).toBe('L1')
    expect(h.capi).toHaveLength(0)
    expect(h.logged).toHaveLength(1)
  })
  it('a send that rejects after the response is logged, never thrown', async () => {
    h.sendRejects = true
    expect((await create()).status).toBe(200)
    await flush()
    expect(h.capi).toHaveLength(0)
    expect(h.logged).toHaveLength(1)
  })
})

describe('GET /api/teachers/me — what the edit form loads', () => {
  it('returns the id and the video state the form saves against — never the private path', async () => {
    h.mine = {
      id: 'tp-b', videoUrl: null, videoOnRequest: true, videoVersion: 7, status: 'live', fullName: 'B',
      private: { phone: '+84901234567', cvFileName: null, videoPath: 'p-b/intro.mp4' }, listing: { status: 'active', verified: true },
    }
    const body = await get()
    expect(body.teacher).toMatchObject({ id: 'tp-b', videoVersion: 7, videoOnRequest: true, videoUrl: null, hasPrivateVideo: true, listingLive: true })
    expect(JSON.stringify(body)).not.toContain('intro.mp4')
  })
  it('⛔ returns a not-yet-migrated row AS STORED — no runtime adapter re-reads the old columns (D1)', async () => {
    h.mine = { id: 'tp-b', situationVersion: null, teachAreas: [], preferredCities: ['ha-noi'], private: null, listing: null }
    const body = await get()
    expect(body.teacher).toMatchObject({ situationVersion: null, teachAreas: [], preferredCities: ['ha-noi'] })
  })
  it('says whether the account may publish — the identity check shows at the top of the last step, not as a refusal at the tap', async () => {
    h.decision = { ok: false, code: 'identity_unverified' }
    expect((await get()).publishGate).toEqual({ ok: false, code: 'identity_unverified' })
    h.mine = null
    expect((await get()).publishGate).toEqual({ ok: false, code: 'identity_unverified' })
    h.decision = { ok: true }
    expect((await get()).publishGate).toEqual({ ok: true, code: null })
  })
  it('⛔ a failed identity-gate read never takes the edit page down — `publishGate: null` (not known), logged (gate review, 2026-10-09)', async () => {
    h.decisionFails = true
    h.mine = { id: 'tp-b', fullName: 'B', private: null, listing: { status: 'active', verified: true } }
    const body = await get()
    expect(body.teacher).toMatchObject({ id: 'tp-b', fullName: 'B' })
    expect(body.publishGate).toBeNull()
    expect(h.logged).toHaveLength(1)
    h.mine = null // the join form's read too
    expect(await get()).toMatchObject({ teacher: null, publishGate: null })
  })
})

describe('GET /api/teachers/me — no profile yet: what the new form may start from', () => {
  it('offers the account name, its photo only when stored on eno.vn, and its (auth-verified) phone', async () => {
    h.mine = null
    h.me = { ...h.me, displayName: 'Bea', avatarUrl: 'https://sb.eno.vn/storage/v1/object/public/listings/a.webp', phone: '+84901234567' }
    expect(await get()).toMatchObject({ teacher: null, prefill: { displayName: 'Bea', avatarUrl: 'https://sb.eno.vn/storage/v1/object/public/listings/a.webp', phone: '+84901234567' } })
    h.me = { ...h.me, avatarUrl: 'https://lh3.googleusercontent.com/a/photo' } // a Google photo is not a listing photo
    expect((await get()).prefill.avatarUrl).toBeNull()
  })
  it('never prefills over an existing profile', async () => {
    h.mine = { id: 'tp-b', private: null, listing: null }
    expect(await get()).not.toHaveProperty('prefill')
  })
})

// ── The one-time account step for a new account that signed in on the teacher form (owner, 2026-10-11) ──────────────────
describe('PUT — a new account\'s first profile records the account step, in the publish\'s own transaction', () => {
  const newAccount = () => { h.me = { id: 'p-new', accountType: null, email: 'n@example.com', displayName: null, tosVersion: null }; h.mine = null }
  it('⛔ fails closed without the Terms line on screen: 409 terms_required, nothing saved, nothing recorded', async () => {
    newAccount()
    const res = await put({ teacherProfileId: null, fullName: 'Bea Smith' })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('terms_required')
    expect(h.saved).toHaveLength(0)
    expect(fo.after).toHaveLength(0)
  })
  it('with acceptTerms: the save carries the account write (individual + Terms), then the handle and effects run', async () => {
    newAccount()
    const res = await put({ teacherProfileId: null, fullName: 'Bea Smith', acceptTerms: true })
    expect(res.status).toBe(200)
    expect((await res.json()).onboarded).toBe(true)
    expect((h.opts[0] as { onboard?: unknown }).onboard).toEqual({ data: { accountType: 'individual', tos: 'stamp' }, nameIfNone: true })
    expect(fo.after).toHaveLength(1)
    expect(fo.after[0][2]).toBe('Bea Smith') // the normalized name the save published
  })
  it('a type chosen meanwhile (the conditional write matched nothing): the profile saves, no effects', async () => {
    newAccount(); fo.committed = false
    const res = await put({ teacherProfileId: null, fullName: 'Bea Smith', acceptTerms: true })
    expect(res.status).toBe(200)
    expect((await res.json()).onboarded).toBe(false)
    expect(fo.after).toHaveLength(0)
  })
  it('an onboarded account needs no line and writes no account step; an edit never does either', async () => {
    h.mine = null
    expect((await put({ teacherProfileId: null })).status).toBe(200)
    expect((h.opts[0] as { onboard?: unknown }).onboard).toBeUndefined()
    h.me = { id: 'p-b', accountType: null, email: 'b@example.com' }; h.mine = { id: 'tp-b' }
    expect((await put({ teacherProfileId: 'tp-b' })).status).toBe(200)
    expect((h.opts[1] as { onboard?: unknown }).onboard).toBeUndefined()
    expect(fo.after).toHaveLength(0)
  })
})

describe('PUT — any OTHER pending onboarding step still comes first (commit gate, 2026-10-11)', () => {
  it('a create while the phone step is pending is refused: 409 onboarding_required, nothing saved', async () => {
    vi.resetModules()
    vi.doMock('@/lib/auth-policy', async (orig) => ({ ...(await orig<object>()), pendingOnboardingStep: () => 'phone' }))
    const { PUT: put2 } = await import('./route')
    h.mine = null
    const res = await put2(new Request('https://eno.vn/api/teachers/me', { method: 'PUT', body: JSON.stringify({ teachAreas: ['online'], teacherProfileId: null, acceptTerms: true }) }) as never, {} as never)
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('onboarding_required')
    expect(h.saved).toHaveLength(0)
    vi.doUnmock('@/lib/auth-policy')
  })
})
