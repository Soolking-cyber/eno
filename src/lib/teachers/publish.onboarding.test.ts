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
  $executeRaw: vi.fn(),
  teacherProfile: {
    findUnique: async () => h.existing,
    upsert: async (args: Row) => {
      h.profileWrites.push(args)
      return { id: h.existing?.id ?? 'tp-new', coverOpen: false, coverSlots: [], coverAreas: [], coverRateVnd: null, coverConfirmedAt: null, coverConsentVersion: null, videoVersion: 0, videoOnRequest: false }
    },
  },
  teacherPrivate: { upsert: async (args: Row) => { h.privateWrites.push(args) } },
  listing: { update: async (args: Row) => { h.listingWrites.push(args) }, create: async (args: Row) => { h.listingWrites.push(args); return { id: 'L-new' } } },
  storageTombstone: { deleteMany: async () => ({ count: 0 }) },
  teacherVideoShare: { updateMany: async () => ({ count: 0 }) },
}
vi.mock('@/lib/db', () => ({
  db: {
    teacherProfile: { findUnique: async ({ select }: Row) => (select?.videoVersion ? (h.existing ? { videoOnRequest: false, videoUrl: null, videoVersion: 0, private: { videoPath: null } } : null) : h.existing) },
    seller: { findUnique: async () => ({ id: 's1', trustTier: 'standard', trustScore: 50 }) },
    category: { findUnique: async () => ({ id: 'cat-teachers', name: 'Teachers', nameVi: 'Giáo viên' }) },
    listing: { findUnique: async () => ({ status: 'active', verified: true }) },
    $transaction: async (cb: (t: typeof tx) => unknown) => cb(tx),
  },
}))

const { saveTeacherProfile, TeacherNoticeChangedError, TeacherProfileChangedError, TeacherValidationError } = await import('./publish')
const { AI_NOTICE_VERSION, PUBLISH_NOTICE_VERSION, TEACHER_SITUATION_VERSION } = await import('./profile')
const { COVER_CONSENT_VERSION } = await import('./cover')

/** A complete v2 body: an HCMC full-time job seeker (District 7) who can teach in two districts, Online, and Hanoi. */
const body = (o: Row = {}) => ({
  livesIn: 'city', currentCity: 'ho-chi-minh-city', currentDistrictKey: 'd7', currentProvince: '', jobTypes: ['fulltime'], relocate: 'some',
  teachAreas: ['online', 'd7', 'd4', 'ha-noi'], teachAreasConfirmed: true, availableFrom: '2026-11-01', expectedSalaryM: 40,
  subjects: ['general-english'], teachLanguages: [], ageGroups: ['kids'], experienceBand: '5-10-years', experience: [],
  degreeLevel: null, degreeMajor: '', degreeInstitution: '', degreeYear: null, certificates: [],
  fullName: 'Jane Doe', nationality: 'GB', englishLevel: 'native', languages: [], headline: 'CELTA-certified English teacher', bio: '',
  coverOpen: false, coverSlots: [], coverRateVnd: null, coverConsent: false, coverNotice: COVER_CONSENT_VERSION,
  photoUrl: 'https://sb.eno.vn/storage/v1/object/public/listings/a.webp', videoUrl: null, videoOnRequest: false, videoBase: 0,
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
  ...o,
})
const edit = (b: Row) => saveTeacherProfile({ id: 'p1', email: 'jane@example.com' }, b, { expectTeacherProfileId: 'tp1' })
const create = (b: Row) => saveTeacherProfile({ id: 'p1', email: 'jane@example.com' }, b, { expectTeacherProfileId: null })
const profileWrite = () => h.profileWrites[0]
const listingData = () => h.listingWrites[0].data

beforeEach(() => {
  h.existing = existing(); h.profileWrites = []; h.listingWrites = []; h.privateWrites = []; h.copies = []
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
    spy.mockClear()
    h.existing = existing({ currentDistrictKey: 'd7' })
    h.profileWrites = []; h.listingWrites = []; h.privateWrites = []
    await edit(body({ currentDistrictKey: 'd7' }))
    expect(spy.mock.calls.map(([p]) => p).filter((p) => /^\/c\/teachers\/./.test(p))).toEqual(['/c/teachers/d7'])
  })
})
