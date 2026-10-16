import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * saveTeacherProfile — the onboarding redesign's contract (2026-10-08): ONE shape (an old body is refused, never
 * guessed at), the Publish / cover / AI notices, the consent evidence each act stamps, the answers a save keeps (hidden
 * questions dropped on the SERVER), the old columns rewritten as mirrors, the Listing projection, and D6 (no goal left:
 * an edit saves and hides, a create is refused).
 */
type Row = Record<string, any>
const h = vi.hoisted(() => ({
  existing: null as Row | null, // the TeacherProfile the save finds (pre-read and under the lock)
  profileWrites: [] as Row[],
  listingWrites: [] as Row[],
  privateWrites: [] as Row[],
  copies: [] as Row[],
  accountWrites: [] as Row[],
  accountCount: 1, // what the conditional account update matches (0: a type was chosen meanwhile)
  draftDeletes: [] as Row[],
  identity: [] as Row[], // identity_verifications rows the card re-derivation reads on the transaction
  order: [] as string[],
}))

vi.mock('server-only', () => ({}))
vi.mock('next/server', () => ({ after: () => {} }))
vi.mock('@/lib/revalidate-lang', () => ({ revalidatePublicPath: vi.fn() }))
vi.mock('@/lib/ai-moderation', () => ({ moderateListingById: vi.fn() }))
vi.mock('@/lib/translate', () => ({ warmTranslations: vi.fn() }))
vi.mock('@/lib/compliance/seller-publish-gate', () => ({ assertSellerMayPublish: vi.fn() }))
vi.mock('@/lib/trust', () => ({ initialSellerTrust: async () => ({}) }))
vi.mock('@/lib/log', () => ({ logError: vi.fn() }))
vi.mock('@/lib/core/listings', () => ({ deleteListingCore: vi.fn(), parseVideoField: (u: string | null) => (u ? { action: 'set', url: u } : { action: 'clear' }) }))
vi.mock('@/lib/listing-image', () => ({ isListingImageUrl: () => true, listingObjectKey: () => null }))
vi.mock('@/lib/core/storage-purge', () => ({ purgeStorageObjects: async () => ({ settled: [] }) }))
vi.mock('@/lib/core/storage-tombstones', () => ({ writeTombstones: async () => 0, clearTombstones: async () => 0 }))
vi.mock('@/lib/teachers/video-store', () => ({
  ownsPublicVideo: async () => true, privateVideoPathFor: () => 'p', publicVideoKeyFor: () => 'k',
  copyPublicVideoToPrivate: async () => { h.copies.push({}); return true }, copyPrivateVideoToPublic: async () => null,
  removeUnreferencedPrivateVideos: async () => [],
}))

const tx = {
  $executeRaw: vi.fn(async (q: unknown) => {
    // A tagged template is an array of strings: the advisory lock, or the mark judgement's SAVEPOINT bookkeeping.
    const text = Array.isArray(q) ? (q as string[]).join('?') : ''
    h.order.push(q && typeof q === 'object' && 'strings' in (q as object) && !Array.isArray(q) ? 'card UPDATE' : /SAVEPOINT/.test(text) ? `savepoint: ${text.trim()}` : 'lock')
    return 1
  }),
  identityVerification: { findMany: vi.fn(async () => { h.order.push('identityVerification.findMany'); return h.identity }) },
  teacherProfile: {
    findUnique: async () => h.existing,
    upsert: async (args: Row) => {
      h.order.push('teacherProfile.upsert')
      h.profileWrites.push(args)
      return { id: h.existing?.id ?? 'tp-new', coverOpen: false, coverSlots: [], coverAreas: [], coverRateVnd: null, coverConfirmedAt: null, coverConsentVersion: null, videoVersion: 0, videoOnRequest: false }
    },
  },
  teacherPrivate: { upsert: async (args: Row) => { h.privateWrites.push(args) } },
  teacherDraft: { deleteMany: async (args: Row) => { h.draftDeletes.push(args); return { count: 1 } } },
  profile: { updateMany: async (args: Row) => { h.accountWrites.push(args); return { count: h.accountCount } } },
  listing: { update: async (args: Row) => { h.listingWrites.push(args) }, create: async (args: Row) => { h.listingWrites.push(args); return { id: 'L-new' } },
    // the save reads whether schools see it INSIDE its transaction (nothing after the commit may fail the request)
    findUnique: async () => ({ status: 'active', verified: true }) },
  storageTombstone: { deleteMany: async () => ({ count: 0 }) },
  teacherVideoShare: { updateMany: async () => ({ count: 0 }) },
}
vi.mock('@/lib/db', () => ({
  db: {
    teacherProfile: { findUnique: async ({ select }: Row) => (select?.videoVersion ? (h.existing ? { videoOnRequest: false, videoUrl: null, videoVersion: 0, private: { videoPath: null } } : null) : h.existing) },
    seller: { findUnique: async () => ({ id: 's1', trustTier: 'standard', trustScore: 50 }) },
    category: { findUnique: async () => ({ id: 'cat-teachers', name: 'Teachers', nameVi: 'Giáo viên' }) },
    listing: { findUnique: async () => ({ status: 'active', verified: true }) },
    // ⛔ NO identityVerification HERE ON PURPOSE: the save's mark judgement must read on the TRANSACTION (inside a
    // SAVEPOINT — publish.ts), never on a second connection; a regression to `db` finds no rows here and the tick drops.
    $transaction: async (cb: (t: typeof tx) => unknown) => cb(tx),
  },
}))

const { saveTeacherProfile, TeacherNoticeChangedError, TeacherProfileChangedError, TeacherValidationError } = await import('./publish')
const { AI_NOTICE_VERSION, PUBLISH_NOTICE_VERSION, TEACHER_SITUATION_VERSION } = await import('./profile')
const { IDENTITY_MARK_NOTICE_VERSION } = await import('./constants')
const { COVER_CONSENT_VERSION } = await import('./cover')

/** A complete v2 body: an HCMC full-time job seeker (District 7) who can teach in two districts, Online, and Hanoi. */
const body = (o: Row = {}) => ({
  livesIn: 'city', currentCity: 'ho-chi-minh-city', currentDistrictKey: 'd7', currentProvince: '', jobTypes: ['fulltime'], relocate: 'some',
  teachAreas: ['online', 'd7', 'd4', 'ha-noi'], teachAreasConfirmed: true, availableFrom: '2026-11-01', expectedSalaryM: 40,
  subjects: ['general-english'], teachLanguages: [], ageGroups: ['kids'], experienceBand: '5-10-years', experience: [],
  degreeLevel: null, degreeMajor: '', degreeInstitution: '', degreeYear: null, certificates: [],
  fullName: 'Jane Doe', nationality: 'GB', englishLevel: 'native', languages: [], headline: 'CELTA-certified English teacher', bio: '',
  coverOpen: false, coverSlots: [], coverRateVnd: null, coverConsent: false, coverNotice: COVER_CONSENT_VERSION,
  // A new profile publishes with its intro video (owner, 2026-10-16), so the complete body carries one, shown publicly.
  photoUrl: 'https://sb.eno.vn/storage/v1/object/public/listings/a.webp', videoUrl: 'https://sb.eno.vn/storage/v1/object/public/listing-videos/1700000000001-abcd12.mp4', videoOnRequest: false, videoBase: 0,
  phone: '', matchEmailOptIn: false, staffContactOptIn: false, publishNotice: PUBLISH_NOTICE_VERSION, aiNotice: AI_NOTICE_VERSION,
  ...o,
})
/** The stored row the save finds — v2, consented under today's Publish notice. */
const existing = (o: Row = {}): Row => ({
  id: 'tp1', listingId: 'L1', status: 'live', coverOpen: false, coverSlots: [], coverAreas: [], coverRateVnd: null,
  coverConsentAt: null, coverConsentVersion: null, coverConfirmedAt: null, coverWithdrawnAt: null, videoVersion: 0,
  yearsExperience: 6, teachAreas: ['online', 'd4', 'd7', 'ha-noi'], teachAreasConfirmedAt: new Date('2026-10-08T01:00:00Z'),
  consentPublicVersion: PUBLISH_NOTICE_VERSION, consentPublicAt: new Date('2026-10-08T01:00:00Z'),
  matchEmailOptIn: false, matchEmailOptInAt: null, matchEmailNoticeVersion: null, matchEmailWithdrawnAt: null,
  staffContactOptIn: false, staffContactOptInAt: null, staffContactNoticeVersion: null, staffContactWithdrawnAt: null,
  // "Identity verified" as Prisma returns it for a row nobody touched: the switch false, no hide — NOT hidden.
  identityMarkOn: false, identityMarkWithdrawnAt: null,
  ...o,
})
const edit = (b: Row) => saveTeacherProfile({ id: 'p1', email: 'jane@example.com' }, b, { expectTeacherProfileId: 'tp1' })
const create = (b: Row) => saveTeacherProfile({ id: 'p1', email: 'jane@example.com' }, b, { expectTeacherProfileId: null })
const profileWrite = () => h.profileWrites[0]
const listingData = () => h.listingWrites[0].data

beforeEach(() => {
  h.existing = existing(); h.profileWrites = []; h.listingWrites = []; h.privateWrites = []; h.copies = []; h.accountWrites = []; h.accountCount = 1; h.draftDeletes = []
  h.identity = []; h.order = []; tx.$executeRaw.mockClear(); tx.identityVerification.findMany.mockClear()
})

describe('⛔ ONE SHAPE (plan review D1/D2)', () => {
  it('refuses an old-shape body — no teach-area list — before anything is read, copied or written', async () => {
    const { teachAreas: _a, ...old } = body({ preferredCities: ['ho-chi-minh-city'], openToOnline: true, consentPublic: true })
    await expect(edit(old)).rejects.toBeInstanceOf(TeacherProfileChangedError)
    expect([h.profileWrites, h.listingWrites, h.privateWrites, h.copies]).toEqual([[], [], [], []])
  })
})

describe('the notices — a consent counts only under the words the page showed', () => {
  it('⛔ Publish IS the consent: no or an older Publish notice → 409 notice_changed, nothing written', async () => {
    await expect(edit(body({ publishNotice: undefined }))).rejects.toMatchObject({ notice: 'publish' })
    await expect(edit(body({ publishNotice: '2026-09-30' }))).rejects.toBeInstanceOf(TeacherNoticeChangedError)
    expect(h.profileWrites).toEqual([])
  })
  it('⛔ an opt-in switched on under an older AI notice (the Gemini one) → 409, never a silent off', async () => {
    await expect(edit(body({ matchEmailOptIn: true, aiNotice: '2026-09-30' }))).rejects.toMatchObject({ notice: 'ai' })
    await expect(edit(body({ staffContactOptIn: true, phone: '+84901234567', aiNotice: undefined }))).rejects.toMatchObject({ notice: 'ai' })
    // no opt-in on: the AI notice is not needed
    await expect(edit(body({ aiNotice: undefined }))).resolves.toBeTruthy()
  })
})

describe('⛔ the whole cover, every time (gate review, 2026-10-09)', () => {
  it('refuses a v2 body with NO cover field — never a withdrawal the teacher did not make', async () => {
    // Cover ON under the notice before the redesign's bump (the demo row's '2026-10-07'): the branch that "kept the stored
    // cover" for such a body read that grant as unconsented, and coverWrites recorded a switch-off and a withdrawal.
    h.existing = existing({ coverOpen: true, coverSlots: ['mon-am'], coverAreas: ['d7'], coverRateVnd: 300_000, coverConsentAt: new Date('2026-10-07'), coverConsentVersion: '2026-10-07' })
    const { coverOpen: _o, coverSlots: _s, coverRateVnd: _r, coverConsent: _c, coverNotice: _n, ...noCover } = body({ coverBase: '1|mon-am|d7|300000' })
    await expect(edit(noCover)).rejects.toMatchObject({ errors: { coverOpen: 'incomplete' } })
    expect([h.profileWrites, h.listingWrites, h.privateWrites, h.copies]).toEqual([[], [], [], []])
  })
})

describe('consent evidence (plan review C2) — each act its time and its notice version, each withdrawal its time', () => {
  it('a first publish stamps the public consent, its version and its time', async () => {
    h.existing = null
    await create(body())
    const { create: c } = profileWrite()
    expect(c.consentPublicVersion).toBe(PUBLISH_NOTICE_VERSION)
    expect(c.consentPublicAt).toBeInstanceOf(Date)
    expect(c.consentAt).toEqual(c.consentPublicAt)
  })
  it('an edit under the same notice keeps the grant\'s time; under a newer one (or the old tick-box\'s NULL) it is fresh', async () => {
    await edit(body())
    expect(profileWrite().update).not.toHaveProperty('consentPublicAt')
    expect(profileWrite().update.consentAt).toBeInstanceOf(Date)
    h.profileWrites = []
    h.existing = existing({ consentPublicVersion: null })
    await edit(body())
    expect(profileWrite().update.consentPublicAt).toBeInstanceOf(Date)
    expect(profileWrite().update.consentPublicVersion).toBe(PUBLISH_NOTICE_VERSION)
  })
  it('switching an opt-in ON stamps when and under which AI notice; OFF stamps the withdrawal and keeps the grant', async () => {
    await edit(body({ matchEmailOptIn: true }))
    expect(profileWrite().update).toMatchObject({ matchEmailOptIn: true, matchEmailNoticeVersion: AI_NOTICE_VERSION, matchEmailWithdrawnAt: null })
    const at = profileWrite().update.matchEmailOptInAt
    expect(at).toBeInstanceOf(Date)
    h.profileWrites = []
    h.existing = existing({ matchEmailOptIn: true, matchEmailOptInAt: at, matchEmailNoticeVersion: AI_NOTICE_VERSION })
    await edit(body({ matchEmailOptIn: false }))
    expect(profileWrite().update).toMatchObject({ matchEmailOptIn: false, matchEmailOptInAt: at, matchEmailNoticeVersion: AI_NOTICE_VERSION })
    expect(profileWrite().update.matchEmailWithdrawnAt).toBeInstanceOf(Date)
  })
  it('keeps a current opt-in\'s time on an unrelated save, and RE-STAMPS a Gemini-era one (no version) saved under today\'s note (D5)', async () => {
    const at = new Date('2026-10-08T02:00:00Z')
    h.existing = existing({ staffContactOptIn: true, staffContactOptInAt: at, staffContactNoticeVersion: AI_NOTICE_VERSION })
    await edit(body({ staffContactOptIn: true, phone: '+84901234567' }))
    expect(profileWrite().update.staffContactOptInAt).toEqual(at)
    h.profileWrites = []
    h.existing = existing({ matchEmailOptIn: true, matchEmailOptInAt: null, matchEmailNoticeVersion: null })
    await edit(body({ matchEmailOptIn: true }))
    expect(profileWrite().update.matchEmailNoticeVersion).toBe(AI_NOTICE_VERSION)
    expect(profileWrite().update.matchEmailOptInAt).toBeInstanceOf(Date)
  })
})

describe('⛔ what a save keeps — the server drops the answers to hidden questions', () => {
  it('no salary without full-time, no other cities for a private tutor, no opt-ins without a job goal', async () => {
    await edit(body({ jobTypes: ['parttime'], relocate: 'no', expectedSalaryM: 40 }))
    expect(profileWrite().update.expectedSalaryM).toBeNull()
    expect(listingData().salaryM).toBeNull()
    h.profileWrites = []; h.listingWrites = []
    await edit(body({ jobTypes: ['private'], relocate: 'some', teachAreas: ['d7', 'ha-noi', 'anywhere'] }))
    expect(profileWrite().update.teachAreas).toEqual(['d7'])
    expect(listingData().facetTokens).not.toContain('|workIn:ha-noi|')
  })
  it('no district outside HCMC', async () => {
    await edit(body({ currentCity: 'binh-duong', currentDistrictKey: 'd7', relocate: 'no', teachAreas: ['binh-duong'] }))
    expect(profileWrite().update).toMatchObject({ currentDistrictKey: null, currentDistrict: null })
    expect(listingData().district).toBeNull()
  })
})

describe('the row it writes — v2 answers, the old columns as mirrors, and the situation version', () => {
  it('writes the v2 answers and the shape version', async () => {
    await edit(body())
    expect(profileWrite().update).toMatchObject({
      livesIn: 'city', currentCity: 'ho-chi-minh-city', currentDistrictKey: 'd7', currentProvince: null,
      teachAreas: ['online', 'd4', 'd7', 'ha-noi'], englishLevel: 'native', experienceBand: '5-10-years',
      situationVersion: TEACHER_SITUATION_VERSION, availableFrom: new Date('2026-11-01T00:00:00Z'),
    })
  })
  it('rewrites every old column as a mirror the old readers and the matcher understand', async () => {
    await edit(body())
    // coverAreas: the derived reach whether cover is on or off (the stale-window stamp compares it — cover.ts coverStamp)
    expect(profileWrite().update).toMatchObject({
      preferredCities: ['ho-chi-minh-city', 'ha-noi', 'online'], openToOnline: true, coverAreas: ['d4', 'd7'], nativeSpeaker: true,
      yearsExperience: 6, currentDistrict: 'Quận 7 (Phú Mỹ Hưng)',
    })
  })
  it('stamps the confirmed places only when the list is new or changed', async () => {
    await edit(body())
    expect(profileWrite().update.teachAreasConfirmedAt).toEqual(new Date('2026-10-08T01:00:00Z'))
    h.profileWrites = []
    await edit(body({ relocate: 'no', teachAreas: ['d7'] }))
    expect(profileWrite().update.teachAreasConfirmedAt.getTime()).toBeGreaterThan(new Date('2026-10-08T01:00:00Z').getTime())
  })
  it('⛔ refuses unconfirmed pre-selected places (B6)', async () => {
    await expect(edit(body({ teachAreasConfirmed: false }))).rejects.toMatchObject({ errors: { teachAreas: 'confirm' } })
  })
  it('stores no phone as none — it is optional unless staff may call', async () => {
    await edit(body({ phone: '' }))
    expect(h.privateWrites[0].update.phone).toBeNull()
    await expect(edit(body({ phone: '', staffContactOptIn: true }))).rejects.toMatchObject({ errors: { phone: 'required' } })
  })
})

describe('the Listing projection (projection.ts)', () => {
  it('HCMC with a district: the curated name and its English location', async () => {
    await edit(body())
    expect(listingData()).toMatchObject({ city: 'Hồ Chí Minh', district: 'Quận 7 (Phú Mỹ Hưng)', location: 'District 7 (Phu My Hung), Ho Chi Minh City' })
  })
  it('⛔ abroad: no city at all (the old `?? "Hồ Chí Minh"` fallback is gone) — "Not in Vietnam yet · Online"', async () => {
    await edit(body({ livesIn: 'abroad', relocate: 'some', teachAreas: ['online', 'ha-noi'] }))
    expect(listingData()).toMatchObject({ city: '', district: null, location: 'Not in Vietnam yet · Online' })
    expect(listingData().facetTokens).not.toContain('|inVietnam:')
  })
  it('somewhere else: the province', async () => {
    await edit(body({ livesIn: 'elsewhere', currentCity: '', currentProvince: '52', relocate: 'no', teachAreas: ['p-52'] }))
    expect(listingData()).toMatchObject({ city: 'Gia Lai', district: null, location: 'Gia Lai' })
    expect(listingData().facetTokens).toContain('|inVietnam:yes|')
  })
})

describe('D6 — nothing left to be found for', () => {
  const noGoal = { jobTypes: [], relocate: '', teachAreas: ['d7'], expectedSalaryM: null, availableFrom: null }
  it('a CREATE with no job goal and no cover is refused', async () => {
    h.existing = null
    await expect(create(body(noGoal))).rejects.toBeInstanceOf(TeacherValidationError)
    expect(h.profileWrites).toEqual([])
  })
  it('⛔ an EDIT saves anyway and HIDES the profile — switching cover off never needs an invented goal', async () => {
    h.existing = existing({ coverOpen: true, coverSlots: ['mon-am'], coverAreas: ['d7'], coverRateVnd: 300_000, coverConsentAt: new Date(), coverConsentVersion: COVER_CONSENT_VERSION })
    const r = await edit(body({ ...noGoal, coverOpen: false, coverSlots: ['mon-am'], coverRateVnd: 300_000, coverConsent: false, coverBase: '1|mon-am|d7|300000' }))
    expect(r.noGoal).toBe(true)
    expect(listingData().status).toBe('hidden')
    expect(listingData()).not.toHaveProperty('verified')
    expect(profileWrite().update).toMatchObject({ status: 'hidden', coverOpen: false })
    expect(profileWrite().update.coverWithdrawnAt).toBeInstanceOf(Date)
  })
  it('moving abroad switches cover off with it — a withdrawal on record, and the listing stays up for the job goal', async () => {
    h.existing = existing({ coverOpen: true, coverSlots: ['mon-am'], coverAreas: ['d7'], coverRateVnd: 300_000, coverConsentAt: new Date(), coverConsentVersion: COVER_CONSENT_VERSION })
    const r = await edit(body({ livesIn: 'abroad', relocate: 'some', teachAreas: ['ha-noi'], coverOpen: true, coverSlots: ['mon-am'], coverRateVnd: 300_000, coverConsent: true, coverBase: '1|mon-am|d7|300000' }))
    expect(r.noGoal).toBe(false)
    expect(profileWrite().update).toMatchObject({ coverOpen: false, coverAreas: [] })
    expect(profileWrite().update.coverWithdrawnAt).toBeInstanceOf(Date)
    expect(listingData()).not.toHaveProperty('status')
  })
})

// A teacher who moves district leaves the old /c/teachers/<district> page and joins the new one: both are revalidated,
// or the old page kept showing them for its ISR window (integration, 2026-10-08).
describe('district pages follow a move', () => {
  it('a District 7 → District 4 save revalidates both district pages; an unchanged district revalidates its own', async () => {
    const { revalidatePublicPath } = await import('@/lib/revalidate-lang')
    const spy = vi.mocked(revalidatePublicPath)
    spy.mockClear()
    h.existing = existing({ currentDistrictKey: 'd7' })
    await edit(body({ currentDistrictKey: 'd4' }))
    const paths = spy.mock.calls.map(([p]) => p)
    expect(paths).toEqual(expect.arrayContaining(['/c/teachers/d7', '/c/teachers/d4', '/c/teachers']))
    // …and the home page, whose "Find a teacher" shelf bakes the card into its ISR HTML (owner, 2026-10-13).
    expect(paths).toContain('/')
    spy.mockClear()
    h.existing = existing({ currentDistrictKey: 'd7' })
    h.profileWrites = []; h.listingWrites = []; h.privateWrites = []
    await edit(body({ currentDistrictKey: 'd7' }))
    expect(spy.mock.calls.map(([p]) => p).filter((p) => /^\/c\/teachers\/./.test(p))).toEqual(['/c/teachers/d7'])
  })
})

describe('the card\'s price — written onto the Listing at every save (owner, 2026-10-11)', () => {
  it('a full-time job seeker with a 40m salary: 40.000.000 ₫ a month, never negotiable (no offers on a person)', async () => {
    await edit(body())
    expect(listingData()).toMatchObject({ price: 40_000_000, priceUnit: 'VND/month', negotiable: false })
  })
  it('no salary, cover lessons shown: the hourly rate', async () => {
    await edit(body({ expectedSalaryM: null, coverOpen: true, coverSlots: ['mon-am'], coverRateVnd: 300_000, coverConsent: true }))
    expect(listingData()).toMatchObject({ price: 300_000, priceUnit: 'VND/hour' })
  })
  it('neither: 0 ("Teacher profile")', async () => {
    await edit(body({ jobTypes: ['private'], expectedSalaryM: null }))
    expect(listingData()).toMatchObject({ price: 0, priceUnit: 'VND/month' })
  })
})

// ── The one-time account step of a new account (owner, 2026-10-11; commit gate, codex: never a live profile on an untyped
// account with no Terms record) ─────────────────────────────────────────────────────────────────────────────────────
describe('`onboard` — written in the save\'s own transaction, conditionally', () => {
  const data = { accountType: 'individual' as const, tosAcceptedAt: new Date('2026-10-11'), tosVersion: 'v3' }
  const onboard = { data, nameIfNone: true }
  it('⛔ inside the transaction, only while the account is untyped — and the save says it wrote', async () => {
    h.existing = null
    const r = await saveTeacherProfile({ id: 'p1', email: 'jane@example.com' }, body(), { expectTeacherProfileId: null, onboard })
    // the display name is the name this save publishes (normalized, validated, screened) — never the raw body
    expect(h.accountWrites).toEqual([{ where: { id: 'p1', accountType: null }, data: { ...data, displayName: 'Jane Doe' } }])
    expect(r.onboarded).toBe(true)
  })
  it('an account that has a display name keeps it', async () => {
    h.existing = null
    await saveTeacherProfile({ id: 'p1', email: 'jane@example.com' }, body({ fullName: '  Jane   Doe ' }), { expectTeacherProfileId: null, onboard: { data, nameIfNone: false } })
    expect(h.accountWrites[0].data.displayName).toBeUndefined()
  })
  it('a type chosen meanwhile is never overwritten: nothing matched, onboarded false, the profile still saved', async () => {
    h.existing = null; h.accountCount = 0
    const r = await saveTeacherProfile({ id: 'p1', email: 'jane@example.com' }, body(), { expectTeacherProfileId: null, onboard })
    expect(r.onboarded).toBe(false)
    expect(h.listingWrites).toHaveLength(1)
  })
  it('without `onboard` the account is never touched', async () => {
    const r = await edit(body())
    expect(h.accountWrites).toEqual([])
    expect(r.onboarded).toBe(false)
  })
})

describe('the unfinished profile goes with the publish (2026-10-11 — src/lib/teachers/draft.ts)', () => {
  it('⛔ every save deletes the account\'s draft IN its transaction — a late autosave cannot bring it back beside the profile', async () => {
    h.existing = null
    await create(body())
    expect(h.draftDeletes).toEqual([{ where: { profileId: 'p1' } }])
  })
  it('a refused save deletes nothing', async () => {
    await expect(edit(body({ publishNotice: undefined }))).rejects.toBeTruthy()
    expect(h.draftDeletes).toEqual([])
  })
})

// ── "Identity verified" (owner, 2026-10-15; AUTOMATIC since 2026-10-16) — ⛔ THE SWITCH HAS ITS OWN ENDPOINT (R2) ────────
// An EDIT never carries or changes the hide: no body field reaches TeacherInput, and no identityMark* column is written.
// The one exception is the join form's CREATE-ONLY `identityMarkHidden: true`, recorded as a hide by the save that creates
// the profile. And every save writes the NAME the card's tick vouches for, so the card cache is re-derived LIVE in the
// save's transaction — a first Publish of a verified teacher writes the tick, a rename the ID does not carry takes it
// off. Zero identity reads only for a hidden mark.
describe('⛔ the "Identity verified" hide is never an edit\'s — and the card\'s tick is judged LIVE by every save', () => {
  const VERIFIED = {
    id: 'iv-1', profileId: 'p1', tier: 'B', method: 'passport_mrz', status: 'verified', decidedAt: new Date('2026-09-01T00:00:00+07:00'),
    documentExpiresAt: new Date('2030-01-01T00:00:00+07:00'), assuranceLevel: 'manual_review',
    evidence: { decisionInput: { surname: 'DOE', givenNames: 'JANE' } },
  }
  const HID = new Date('2026-10-12T02:00:00.000Z')
  const TICK = [IDENTITY_MARK_NOTICE_VERSION, 'L1', IDENTITY_MARK_NOTICE_VERSION, IDENTITY_MARK_NOTICE_VERSION, 'removed']
  const cardValues = () => tx.$executeRaw.mock.calls
    .map(([q]) => q as { values?: unknown[]; strings?: unknown })
    .filter((q) => q && typeof q === 'object' && 'strings' in q && !Array.isArray(q))
    .map((q) => q.values)
  const markCols = (half: Row) => Object.fromEntries(Object.entries(half).filter(([k]) => k.startsWith('identityMark')))

  it('⛔ an EDIT whose body carries the old switch, its notice, a base — or the create-only hide — writes NO identityMark* column', async () => {
    // A LIVE verification whose name is the body's ("Jane Doe" ↔ DOE / JANE), stored not hidden: the edit shows the tick
    // whatever the body says — it is not the body's to hide or show.
    h.identity = [VERIFIED]
    const sneaky = { identityMarkOn: false, identityMarkHidden: true, identityNotice: IDENTITY_MARK_NOTICE_VERSION, identityMarkAt: new Date().toISOString(), identityMarkNoticeVersion: IDENTITY_MARK_NOTICE_VERSION, identityMarkWithdrawnAt: new Date().toISOString() }
    await edit(body(sneaky))
    expect(markCols(profileWrite().update)).toEqual({})
    expect(markCols(profileWrite().create)).toEqual({}) // the upsert's create half — unused by an edit — carries none either
    expect(cardValues()).toEqual([TICK])
  })
  it('⛔ a CREATE whose body carries the old switch fields writes none of them — only the create-only hide is ever honoured', async () => {
    h.existing = null
    h.identity = [VERIFIED]
    await create(body({ identityMarkOn: true, identityMarkAt: new Date().toISOString(), identityMarkNoticeVersion: '2026-10-16', identityMarkWithdrawnAt: null }))
    expect(markCols(profileWrite().create)).toEqual({})
    expect(markCols(profileWrite().update)).toEqual({})
  })
  it('⛔ AUTOMATIC: a FIRST Publish of a teacher verified before they had a profile writes the tick on the new listing — one read, on the transaction', async () => {
    h.existing = null
    h.identity = [VERIFIED]
    await create(body())
    expect(cardValues()).toEqual([[IDENTITY_MARK_NOTICE_VERSION, 'L-new', IDENTITY_MARK_NOTICE_VERSION, IDENTITY_MARK_NOTICE_VERSION, 'removed']])
    expect(tx.identityVerification.findMany).toHaveBeenCalledTimes(1)
  })
  it('⛔ CREATE-ONLY HIDE: `identityMarkHidden: true` on the first Publish is written in the create (switch off, the hide\'s time) — and judged: zero reads, the card NULL', async () => {
    h.existing = null
    h.identity = [VERIFIED]
    const before = Date.now()
    await create(body({ identityMarkHidden: true }))
    const cols = markCols(profileWrite().create)
    expect(cols).toEqual({ identityMarkOn: false, identityMarkWithdrawnAt: expect.any(Date) })
    expect((cols.identityMarkWithdrawnAt as Date).getTime()).toBeGreaterThanOrEqual(before)
    expect(markCols(profileWrite().update)).toEqual({})
    // in the SAME transaction, before the card is derived: never shown for a moment
    expect(cardValues()).toEqual([[null, 'L-new', null, null, 'removed']])
    expect(tx.identityVerification.findMany).not.toHaveBeenCalled()
  })
  it.each([false, 'true', 1, null, {}])('a create with `identityMarkHidden: %j` is NOT a hide — only exactly `true` is', async (v) => {
    h.existing = null
    h.identity = [VERIFIED]
    await create(body({ identityMarkHidden: v }))
    expect(markCols(profileWrite().create)).toEqual({})
    expect(cardValues()).toEqual([[IDENTITY_MARK_NOTICE_VERSION, 'L-new', IDENTITY_MARK_NOTICE_VERSION, IDENTITY_MARK_NOTICE_VERSION, 'removed']])
  })
  it('⛔ never echoed: the save\'s answer carries no identityMark* field', async () => {
    h.existing = null
    const r = await create(body({ identityMarkHidden: true }))
    expect(JSON.stringify(r)).not.toMatch(/identityMark/)
  })
  it('an untouched teacher\'s EDIT, the name within the ID: the tick — judged AFTER the profile write, written on the transaction', async () => {
    h.identity = [VERIFIED]
    await edit(body())
    expect(cardValues()).toEqual([TICK])
    expect(h.order.indexOf('teacherProfile.upsert')).toBeLessThan(h.order.indexOf('identityVerification.findMany'))
    expect(h.order.indexOf('identityVerification.findMany')).toBeLessThan(h.order.indexOf('card UPDATE'))
    expect(h.order[0]).toBe('lock') // all of it under the saves' lock, taken first
  })
  it('a switch-on under the old opt-in, or a show-again, is a show: the tick', async () => {
    h.identity = [VERIFIED]
    for (const stored of [{ identityMarkOn: true }, { identityMarkOn: true, identityMarkWithdrawnAt: HID }]) {
      h.existing = existing(stored); tx.$executeRaw.mockClear()
      await edit(body())
      expect(cardValues(), JSON.stringify(stored)).toEqual([TICK])
    }
  })
  it('⛔ HIDDEN (stored): zero identity reads, and the guarded UPDATE of NULL', async () => {
    h.existing = existing({ identityMarkWithdrawnAt: HID })
    h.identity = [VERIFIED]
    await edit(body())
    expect(tx.identityVerification.findMany).not.toHaveBeenCalled()
    expect(cardValues()).toEqual([[null, 'L1', null, null, 'removed']])
  })
  it('not verified: one read, and NULL — the tick only ever follows a live identity', async () => {
    h.identity = []
    await edit(body())
    expect(tx.identityVerification.findMany).toHaveBeenCalledTimes(1)
    expect(cardValues()).toEqual([[null, 'L1', null, null, 'removed']])
  })
  // Commit gate, 2026-10-16: an ordinary edit used to fail whenever the identity read failed.
  it('⛔ the identity read FAILING hides the tick (fail closed) — and never fails the save', async () => {
    tx.identityVerification.findMany.mockRejectedValueOnce(new Error('identity read down'))
    await expect(edit(body())).resolves.toBeTruthy()
    expect(cardValues()).toEqual([[null, 'L1', null, null, 'removed']])
    // On THIS transaction, inside its savepoint — rolled back to it, so the save's later statements still run.
    expect(h.order.filter((o) => o.startsWith('savepoint'))).toEqual(['savepoint: SAVEPOINT identity_mark', 'savepoint: ROLLBACK TO SAVEPOINT identity_mark'])
  })
  it('⛔ a RENAME the ID does not carry takes the tick off the card IN THE SAME SAVE — and the hide itself stays as stored', async () => {
    h.identity = [VERIFIED]
    await edit(body({ fullName: 'Dr Jane Doe' }))
    expect(cardValues()).toEqual([[null, 'L1', null, null, 'removed']])
    expect(markCols(profileWrite().update)).toEqual({})
  })
  // ⚖️ THE NAME THE TICK VOUCHES FOR (2026-10-16): a card prints its listing's `title` beside the tick (serialize.ts), and
  // this save is the ONE writer of a teacher row's title (every generic editor refuses it — core/listings.ts
  // updateListingCore, listings.teacher-edit.test.ts). So the title it writes must BE the name it judged the tick on.
  it('⚖️ the listing title written IS the profile name the tick was judged on — shown, and after a rename the ID carries', async () => {
    h.identity = [{ ...VERIFIED, evidence: { decisionInput: { surname: 'DOE', givenNames: 'JANE MARY' } } }]
    for (const fullName of ['Jane Doe', 'Jane Mary Doe']) {
      h.listingWrites = []; h.profileWrites = []; tx.$executeRaw.mockClear()
      await edit(body({ fullName }))
      expect(listingData().title, fullName).toBe(fullName)
      expect(profileWrite().update.fullName, fullName).toBe(fullName)
      expect(cardValues(), fullName).toEqual([TICK])
    }
  })
})
