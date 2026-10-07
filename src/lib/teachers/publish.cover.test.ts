import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('next/server', () => ({ after: () => {} }))
vi.mock('@/lib/revalidate-lang', () => ({ revalidatePublicPath: vi.fn() }))
vi.mock('@/lib/core/listings', () => ({ deleteListingCore: vi.fn(), parseVideoField: () => ({ action: 'ignore' }) }))
vi.mock('@/lib/ai-moderation', () => ({ moderateListingById: vi.fn() }))
vi.mock('@/lib/translate', () => ({ warmTranslations: vi.fn() }))
vi.mock('@/lib/compliance/seller-publish-gate', () => ({ assertSellerMayPublish: vi.fn() }))
vi.mock('@/lib/trust', () => ({ initialSellerTrust: async () => ({}) }))

const tx = {
  $executeRaw: vi.fn(),
  teacherProfile: { findUnique: vi.fn(), update: vi.fn() },
  listing: { update: vi.fn() },
}
vi.mock('@/lib/db', () => ({
  db: {
    category: { findUnique: async () => ({ id: 'cat-teachers', name: 'Teachers', nameVi: 'Giáo viên' }) },
    seller: { findUnique: async () => ({ trustTier: 'standard' }) },
    $transaction: async (cb: (t: typeof tx) => unknown) => cb(tx),
  },
}))

const { saveTeacherCover, saveTeacherProfile, coverWrites, coverPartOf, withStoredCover, TeacherValidationError, TeacherCoverConflictError } = await import('./publish')
const { COVER_CONSENT_VERSION, coverStamp } = await import('./cover')
const { normalizeTeacherInput } = await import('./profile')

/** A stored TeacherProfile row, as Prisma returns it. */
const stored = (over: Record<string, unknown> = {}) => ({
  id: 'tp1', profileId: 'p1', listingId: 'l1', status: 'live',
  fullName: 'Jane Doe', headline: 'CELTA-certified English teacher, 6 years with kids', bio: '', photoUrl: 'https://x/a.webp', videoUrl: null,
  nationality: 'GB', nativeSpeaker: true, languages: [], currentCity: 'ho-chi-minh-city', currentDistrict: null,
  preferredCities: ['ho-chi-minh-city'], openToOnline: false, availableFrom: null, jobTypes: ['parttime'], ageGroups: ['kids'],
  subjects: ['ielts'], yearsExperience: 6, experience: [], degreeLevel: null, degreeMajor: null, degreeInstitution: null,
  degreeYear: null, certificates: [], expectedSalaryM: null,
  coverOpen: false, coverSlots: [], coverAreas: [], coverRateVnd: null,
  coverConfirmedAt: null, coverConsentAt: null, coverConsentVersion: null, coverWithdrawnAt: null,
  ...over,
})
// `coverNotice`: the client says which cover notice it showed — a tick counts only under the one in force.
const on = { coverOpen: true, coverSlots: ['mon-am'], coverAreas: ['d7'], coverRateVnd: 300_000, coverConsent: true, coverNotice: COVER_CONSENT_VERSION }

beforeEach(() => { vi.clearAllMocks() })

describe('saveTeacherCover', () => {
  it('writes ONLY facetTokens and searchText on the listing — never status or verified', async () => {
    tx.teacherProfile.findUnique.mockResolvedValue(stored())
    await saveTeacherCover('p1', on)
    expect(tx.listing.update).toHaveBeenCalledTimes(1)
    const { data } = tx.listing.update.mock.calls[0][0]
    expect(Object.keys(data).sort()).toEqual(['facetTokens', 'searchText'])
  })

  it('rebuilds the tokens from the WHOLE stored profile, so the subject and city facets survive', async () => {
    tx.teacherProfile.findUnique.mockResolvedValue(stored())
    await saveTeacherCover('p1', on)
    const { facetTokens } = tx.listing.update.mock.calls[0][0].data
    expect(facetTokens).toContain('|subject:ielts|')
    expect(facetTokens).toContain('|workIn:ho-chi-minh-city|')
    expect(facetTokens).toContain('|cover:open|')
    expect(facetTokens).toContain('|coverArea:d7|')
  })

  it('records the consent with its version, and the confirmation, when cover goes on', async () => {
    tx.teacherProfile.findUnique.mockResolvedValue(stored())
    await saveTeacherCover('p1', on)
    const { data } = tx.teacherProfile.update.mock.calls[0][0]
    expect(data.coverOpen).toBe(true)
    expect(data.coverConsentAt).toBeInstanceOf(Date)
    expect(data.coverConsentVersion).toBe(COVER_CONSENT_VERSION)
    expect(data.coverConfirmedAt).toBeInstanceOf(Date)
    expect(data.coverWithdrawnAt).toBeNull()
  })

  it('records a withdrawal when cover goes off, keeps the saved periods, and drops every cover token', async () => {
    const consentAt = new Date('2026-10-01T00:00:00Z')
    const was = { coverOpen: true, coverSlots: ['mon-am'], coverAreas: ['d7'], coverRateVnd: 300_000 }
    tx.teacherProfile.findUnique.mockResolvedValue(stored({ ...was, coverConsentAt: consentAt, coverConsentVersion: COVER_CONSENT_VERSION }))
    await saveTeacherCover('p1', { ...on, coverOpen: false, coverBase: coverStamp(was) })
    const { data } = tx.teacherProfile.update.mock.calls[0][0]
    expect(data.coverOpen).toBe(false)
    expect(data.coverWithdrawnAt).toBeInstanceOf(Date)
    expect(data.coverConsentAt).toEqual(consentAt) // the past grant stays on record
    expect(data.coverSlots).toEqual(['mon-am'])
    expect(tx.listing.update.mock.calls[0][0].data.facetTokens).not.toContain('|cover')
  })

  it('refuses an incomplete or unconsented cover and writes nothing', async () => {
    tx.teacherProfile.findUnique.mockResolvedValue(stored())
    await expect(saveTeacherCover('p1', { ...on, coverConsent: false })).rejects.toBeInstanceOf(TeacherValidationError)
    await expect(saveTeacherCover('p1', { ...on, coverRateVnd: 10 })).rejects.toBeInstanceOf(TeacherValidationError)
    expect(tx.teacherProfile.update).not.toHaveBeenCalled()
    expect(tx.listing.update).not.toHaveBeenCalled()
  })

  it('keeps an area outside the stored profile\'s cities — what the teacher sees is what is saved and searched', async () => {
    tx.teacherProfile.findUnique.mockResolvedValue(stored()) // preferredCities: HCMC only
    const saved = await saveTeacherCover('p1', { ...on, coverAreas: ['d7', 'ha-noi'] })
    expect(saved?.coverAreas).toEqual(['d7', 'ha-noi'])
    expect(tx.listing.update.mock.calls[0][0].data.facetTokens).toContain('|coverArea:ha-noi|')
  })

  it('refuses a stale window: "Still available" from a tab that loaded cover ON cannot re-enable it after a withdrawal', async () => {
    tx.teacherProfile.findUnique.mockResolvedValue(stored({ coverOpen: false, coverWithdrawnAt: new Date('2026-10-07') }))
    const loadedOn = coverStamp({ coverOpen: true, coverSlots: ['mon-am'], coverAreas: ['d7'], coverRateVnd: 300_000 })
    await expect(saveTeacherCover('p1', { ...on, coverBase: loadedOn })).rejects.toBeInstanceOf(TeacherCoverConflictError)
    expect(tx.teacherProfile.update).not.toHaveBeenCalled()
    expect(tx.listing.update).not.toHaveBeenCalled()
  })

  it('refuses a stale window that would write back periods or areas the teacher removed elsewhere', async () => {
    const now = { coverOpen: true, coverSlots: ['mon-am'], coverAreas: ['d7'], coverRateVnd: 300_000 }
    tx.teacherProfile.findUnique.mockResolvedValue(stored({ ...now, coverConsentAt: new Date(), coverConsentVersion: COVER_CONSENT_VERSION }))
    const staleBase = coverStamp({ ...now, coverAreas: ['d7', 'd1'] }) // that tab still had District 1
    await expect(saveTeacherCover('p1', { ...on, coverAreas: ['d7', 'd1'], coverBase: staleBase })).rejects.toBeInstanceOf(TeacherCoverConflictError)
    // …and the same window with the current state saves
    await expect(saveTeacherCover('p1', { ...on, coverBase: coverStamp(now) })).resolves.toMatchObject({ coverOpen: true })
  })

  it('refuses a body with only part of the cover — periods sent without the switch never read as "off"', async () => {
    tx.teacherProfile.findUnique.mockResolvedValue(stored({ coverOpen: true, coverSlots: ['mon-am'], coverAreas: ['d7'], coverRateVnd: 300_000, coverConsentVersion: COVER_CONSENT_VERSION }))
    await expect(saveTeacherCover('p1', { coverSlots: ['tue-pm'] })).rejects.toBeInstanceOf(TeacherValidationError)
    expect(tx.teacherProfile.update).not.toHaveBeenCalled()
  })

  it('lets a client with no base (the join form) fill an OFF cover, but never overwrite one that is ON', async () => {
    const live = { coverOpen: true, coverSlots: ['mon-am'], coverAreas: ['d7'], coverRateVnd: 300_000 }
    tx.teacherProfile.findUnique.mockResolvedValue(stored({ ...live, coverConsentAt: new Date(), coverConsentVersion: COVER_CONSENT_VERSION }))
    await expect(saveTeacherCover('p1', { ...on, coverOpen: false })).rejects.toBeInstanceOf(TeacherCoverConflictError)
    expect(tx.teacherProfile.update).not.toHaveBeenCalled()
    // Switched off earlier, periods kept: a form that loaded nothing may set it up again.
    tx.teacherProfile.findUnique.mockResolvedValue(stored({ ...live, coverOpen: false, coverWithdrawnAt: new Date('2026-10-05') }))
    await expect(saveTeacherCover('p1', on)).resolves.toMatchObject({ coverOpen: true })
  })

  it('counts the tick only under the notice in force — a tab from before a notice change records no consent', async () => {
    tx.teacherProfile.findUnique.mockResolvedValue(stored())
    await expect(saveTeacherCover('p1', { ...on, coverNotice: 'an-older-notice' })).rejects.toBeInstanceOf(TeacherValidationError)
    const { coverNotice: _n, ...unsaid } = on
    await expect(saveTeacherCover('p1', unsaid)).rejects.toBeInstanceOf(TeacherValidationError)
    expect(tx.teacherProfile.update).not.toHaveBeenCalled()
  })

  it('answers null when the account has no teacher profile', async () => {
    tx.teacherProfile.findUnique.mockResolvedValue(null)
    expect(await saveTeacherCover('p1', on)).toBeNull()
    expect(tx.listing.update).not.toHaveBeenCalled()
  })
})

describe('saveTeacherProfile — the cover part of the body', () => {
  const body = (o: Record<string, unknown> = {}) => ({ ...stored(), consentPublic: true, ...on, ...o })
  /** The validation errors a save throws (it never reaches the database in these cases). */
  const errorsOf = async (b: unknown): Promise<Record<string, string>> => {
    try { await saveTeacherProfile({ id: 'p1', email: 'jane@example.com' }, b) } catch (e) { if (e instanceof TeacherValidationError) return e.errors as Record<string, string> }
    return {}
  }
  it('refuses a body with only some cover fields, before anything is read or written', async () => {
    const { coverOpen: _o, ...partial } = body()
    expect(await errorsOf(partial)).toEqual({ coverOpen: 'incomplete' })
  })
  it('counts the consent tick only under the notice the client showed', async () => {
    expect((await errorsOf(body({ coverNotice: 'an-older-notice' }))).coverConsent).toBe('required')
    const { coverNotice: _n, ...unsaid } = body()
    expect((await errorsOf(unsaid)).coverConsent).toBe('required')
    expect((await errorsOf(body())).coverConsent).toBeUndefined()
  })
})

describe('coverPartOf', () => {
  it('is all or nothing', () => {
    expect(coverPartOf({ bio: 'x' })).toBe('none')
    expect(coverPartOf({ coverOpen: false, coverSlots: [], coverAreas: [], coverRateVnd: null, coverConsent: false })).toBe('all')
    expect(coverPartOf({ coverSlots: ['mon-am'] })).toBe('partial')
    expect(coverPartOf(null)).toBe('none')
  })
})

describe('coverWrites', () => {
  const now = new Date('2026-10-07T10:00:00Z')
  const t = (o: Record<string, unknown> = {}) => normalizeTeacherInput({ currentCity: 'ho-chi-minh-city', preferredCities: ['ho-chi-minh-city'], ...on, ...o })
  const savedOn = { coverOpen: true, coverSlots: ['mon-am'], coverAreas: ['d7'], coverRateVnd: 300_000, coverConfirmedAt: new Date('2026-10-01'), coverWithdrawnAt: null }
  it('asks for a fresh consent when the notice version moved since the last grant', () => {
    const w = coverWrites(t(), { ...savedOn, coverConsentAt: new Date('2026-01-01'), coverConsentVersion: 'old' }, now)
    expect(w.coverConsentAt).toEqual(now)
    expect(w.coverConsentVersion).toBe(COVER_CONSENT_VERSION)
  })
  it('keeps the existing grant while cover stays on under the same version', () => {
    const at = new Date('2026-10-01')
    const w = coverWrites(t(), { ...savedOn, coverConsentAt: at, coverConsentVersion: COVER_CONSENT_VERSION }, now)
    expect(w.coverConsentAt).toEqual(at)
  })
  it('moves "confirmed on" only when the teacher confirmed — a save that left cover untouched keeps the old date', () => {
    const stored = { ...savedOn, coverConsentAt: new Date('2026-10-01'), coverConsentVersion: COVER_CONSENT_VERSION }
    expect(coverWrites(t(), stored, now).coverConfirmedAt).toEqual(savedOn.coverConfirmedAt) // e.g. only the bio changed
    expect(coverWrites(t(), stored, now, { confirm: true }).coverConfirmedAt).toEqual(now) // "Still available"
    expect(coverWrites(t({ coverSlots: ['mon-am', 'tue-am'] }), stored, now).coverConfirmedAt).toEqual(now) // periods changed
  })
})

describe('withStoredCover — a client from before cover lessons', () => {
  const prev = { coverOpen: true, coverSlots: ['mon-am'], coverAreas: ['d7'], coverRateVnd: 300_000, coverConsentVersion: COVER_CONSENT_VERSION }
  it('keeps the stored cover when the body sends no cover field at all (never a silent switch-off)', () => {
    const t = normalizeTeacherInput(withStoredCover({ currentCity: 'ho-chi-minh-city', preferredCities: ['ho-chi-minh-city'], bio: 'new bio' }, prev))
    expect(t).toMatchObject({ coverOpen: true, coverSlots: ['mon-am'], coverAreas: ['d7'], coverRateVnd: 300_000, coverConsent: true })
  })
  it('takes the body as written once it carries any cover field', () => {
    const t = normalizeTeacherInput(withStoredCover({ currentCity: 'ho-chi-minh-city', coverOpen: false }, prev))
    expect(t.coverOpen).toBe(false)
  })
  it('never invents consent for a grant under an older notice', () => {
    const t = normalizeTeacherInput(withStoredCover({ currentCity: 'ho-chi-minh-city', preferredCities: ['ho-chi-minh-city'] }, { ...prev, coverConsentVersion: 'old' }))
    expect(t.coverConsent).toBe(false)
  })
})
