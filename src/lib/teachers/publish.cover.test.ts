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
  listing: { update: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
}
/** The reads outside the transaction (setTeacherStatus). */
const outside = { teacherProfile: { findUnique: vi.fn() } }
vi.mock('@/lib/db', () => ({
  db: {
    category: { findUnique: async () => ({ id: 'cat-teachers', name: 'Teachers', nameVi: 'Giáo viên' }) },
    seller: { findUnique: async () => ({ trustTier: 'standard' }) },
    teacherProfile: { findUnique: (...a: unknown[]) => outside.teacherProfile.findUnique(...a) },
    $transaction: async (cb: (t: typeof tx) => unknown) => cb(tx),
  },
}))

const {
  saveTeacherCover, saveTeacherProfile, setTeacherStatus, coverWrites, coverPartOf, isLegacyCoverBody,
  TeacherValidationError, TeacherCoverConflictError, TeacherNoticeChangedError, TeacherNoGoalError,
} = await import('./publish')
const { COVER_CONSENT_VERSION, coverStamp } = await import('./cover')
const { PUBLISH_NOTICE_VERSION, normalizeTeacherInput } = await import('./profile')
const { revalidatePublicPath } = await import('@/lib/revalidate-lang')
const purged = () => vi.mocked(revalidatePublicPath).mock.calls.map(([p]) => p)

/** A stored, MIGRATED TeacherProfile row, as Prisma returns it: an HCMC teacher who can teach in District 7. */
const stored = (over: Record<string, unknown> = {}) => ({
  id: 'tp1', profileId: 'p1', listingId: 'l1', status: 'live',
  fullName: 'Jane Doe', headline: 'CELTA-certified English teacher, 6 years with kids', bio: '', photoUrl: 'https://x/a.webp', videoUrl: null,
  nationality: 'GB', nativeSpeaker: true, languages: [], currentCity: 'ho-chi-minh-city', currentDistrict: null,
  preferredCities: ['ho-chi-minh-city'], openToOnline: false, availableFrom: null, jobTypes: ['parttime'], ageGroups: ['kids'],
  subjects: ['ielts'], yearsExperience: 6, experience: [], degreeLevel: null, degreeMajor: null, degreeInstitution: null,
  degreeYear: null, certificates: [], expectedSalaryM: null,
  livesIn: 'city', currentProvince: null, currentDistrictKey: null, teachAreas: ['d7', 'ha-noi'], teachAreasConfirmedAt: new Date('2026-10-08'),
  teachLanguages: [], englishLevel: 'native', experienceBand: '5-10-years', situationVersion: 1,
  coverOpen: false, coverSlots: [], coverAreas: [], coverRateVnd: null,
  coverConfirmedAt: null, coverConsentAt: null, coverConsentVersion: null, coverWithdrawnAt: null,
  ...over,
})
// The switch is the consent (coverConsent follows it); `coverNotice`: the notice the page showed. No areas: derived.
const on = { coverOpen: true, coverSlots: ['mon-am'], coverRateVnd: 300_000, coverConsent: true, coverNotice: COVER_CONSENT_VERSION }
const off = { ...on, coverOpen: false, coverConsent: false }
const wasOn = { coverOpen: true, coverSlots: ['mon-am'], coverAreas: ['d7'], coverRateVnd: 300_000, coverConsentAt: new Date('2026-10-08'), coverConsentVersion: COVER_CONSENT_VERSION }

beforeEach(() => { vi.clearAllMocks() })

describe('saveTeacherCover', () => {
  it('writes ONLY facetTokens and searchText on the listing — never status or verified', async () => {
    tx.teacherProfile.findUnique.mockResolvedValue(stored())
    await saveTeacherCover('p1', on)
    expect(tx.listing.update).toHaveBeenCalledTimes(1)
    const { data } = tx.listing.update.mock.calls[0][0]
    expect(Object.keys(data).sort()).toEqual(['facetTokens', 'searchText'])
  })

  it('rebuilds the tokens from the WHOLE stored profile, so the subject and place facets survive', async () => {
    tx.teacherProfile.findUnique.mockResolvedValue(stored())
    await saveTeacherCover('p1', on)
    const { facetTokens } = tx.listing.update.mock.calls[0][0].data
    expect(facetTokens).toContain('|subject:ielts|')
    expect(facetTokens).toContain('|workIn:d7|')
    expect(facetTokens).toContain('|workIn:ha-noi|')
    expect(facetTokens).toContain('|cover:open|')
    expect(facetTokens).toContain('|coverArea:d7|')
  })

  it('derives the reach from the STORED teach areas near home — never a relocation city, never the body', async () => {
    tx.teacherProfile.findUnique.mockResolvedValue(stored())
    const saved = await saveTeacherCover('p1', { ...on, coverAreas: ['d1', 'ha-noi'] }) // an old field: ignored
    expect(saved?.coverAreas).toEqual(['d7'])
    expect(tx.teacherProfile.update.mock.calls[0][0].data.coverAreas).toEqual(['d7'])
    expect(tx.listing.update.mock.calls[0][0].data.facetTokens).not.toContain('|coverArea:ha-noi|')
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
    tx.teacherProfile.findUnique.mockResolvedValue(stored({ ...wasOn, coverConsentAt: consentAt }))
    const r = await saveTeacherCover('p1', { ...off, coverBase: coverStamp(wasOn) })
    const { data } = tx.teacherProfile.update.mock.calls[0][0]
    expect(data.coverOpen).toBe(false)
    expect(data.coverWithdrawnAt).toBeInstanceOf(Date)
    expect(data.coverConsentAt).toEqual(consentAt) // the past grant stays on record
    expect(data.coverSlots).toEqual(['mon-am'])
    expect(tx.listing.update.mock.calls[0][0].data.facetTokens).not.toContain('|cover')
    expect(r?.hidden).toBe(false) // still a part-time job seeker
  })

  it('⛔ D6: switching off ALWAYS saves — with no job goal left the profile is HIDDEN, never the withdrawal refused', async () => {
    tx.teacherProfile.findUnique.mockResolvedValue(stored({ ...wasOn, jobTypes: [] }))
    const r = await saveTeacherCover('p1', { ...off, coverBase: coverStamp(wasOn) })
    expect(r?.hidden).toBe(true)
    const profileWrite = tx.teacherProfile.update.mock.calls[0][0].data
    expect(profileWrite).toMatchObject({ coverOpen: false, status: 'hidden' })
    expect(profileWrite.coverWithdrawnAt).toBeInstanceOf(Date)
    expect(tx.listing.update.mock.calls[0][0].data.status).toBe('hidden')
    expect(tx.listing.update.mock.calls[0][0].data).not.toHaveProperty('verified')
  })

  it('refuses an incomplete or unconsented cover and writes nothing', async () => {
    tx.teacherProfile.findUnique.mockResolvedValue(stored())
    await expect(saveTeacherCover('p1', { ...on, coverConsent: false })).rejects.toBeInstanceOf(TeacherValidationError)
    await expect(saveTeacherCover('p1', { ...on, coverRateVnd: 10 })).rejects.toBeInstanceOf(TeacherValidationError)
    await expect(saveTeacherCover('p1', { ...on, coverSlots: [] })).rejects.toBeInstanceOf(TeacherValidationError)
    expect(tx.teacherProfile.update).not.toHaveBeenCalled()
    expect(tx.listing.update).not.toHaveBeenCalled()
  })

  it('refuses cover ON with nowhere near home to cover — the panel cannot widen the reach', async () => {
    tx.teacherProfile.findUnique.mockResolvedValue(stored({ teachAreas: ['online', 'ha-noi'] }))
    await expect(saveTeacherCover('p1', on)).rejects.toMatchObject({ errors: { coverOpen: 'reach_required' } })
    expect(tx.teacherProfile.update).not.toHaveBeenCalled()
  })

  it('⛔ a row the backfill has not migrated has no places: cover cannot go ON (no adapter re-reads the mirrors) — but OFF saves', async () => {
    const legacy = stored({ situationVersion: null, livesIn: null, teachAreas: [], preferredCities: ['ho-chi-minh-city'] })
    tx.teacherProfile.findUnique.mockResolvedValue(legacy)
    tx.listing.findUnique.mockResolvedValue({ facetTokens: null, searchText: 'jane doe' })
    await expect(saveTeacherCover('p1', on)).rejects.toBeInstanceOf(TeacherValidationError)
    await expect(saveTeacherCover('p1', off)).resolves.toMatchObject({ coverOpen: false })
  })

  it('⛔ switching cover OFF on a row the backfill has not migrated strips ONLY the cover part of its listing — never its place, native or experience facets (gate review, 2026-10-09)', async () => {
    // What the OLD code wrote for this teacher: places, native, experience, job types — and cover, under the old notice.
    const oldTokens = '|cover:open|coverSlot:mon-am|coverArea:d7|workIn:ho-chi-minh-city|workIn:online|native:native|experience:5-10-years|subject:ielts|jobType:parttime|'
    const oldText = 'jane doe celta-certified english teacher ielts ho chi minh city teachers giao vien cover lessons cover teacher substitute teacher day thay giao vien day thay'
    tx.teacherProfile.findUnique.mockResolvedValue(stored({
      ...wasOn, coverConsentVersion: '2026-10-07', situationVersion: null, livesIn: null, teachAreas: [], englishLevel: null, experienceBand: null,
    }))
    tx.listing.findUnique.mockResolvedValue({ facetTokens: oldTokens, searchText: oldText })
    const r = await saveTeacherCover('p1', { ...off, coverBase: coverStamp(wasOn), coverAreas: ['d7'] }) // an old panel's switch-off
    expect(r).toMatchObject({ coverOpen: false, hidden: false })
    const { data } = tx.listing.update.mock.calls[0][0]
    expect(data.facetTokens).toBe('|workIn:ho-chi-minh-city|workIn:online|native:native|experience:5-10-years|subject:ielts|jobType:parttime|')
    expect(data.searchText).toBe('jane doe celta-certified english teacher ielts ho chi minh city teachers giao vien')
    expect(tx.teacherProfile.update.mock.calls[0][0].data.coverWithdrawnAt).toBeInstanceOf(Date) // the withdrawal is still on record
  })

  it('⛔ purges the teacher\'s DISTRICT page too — a cover save that hides the profile must not leave it there for 24 hours', async () => {
    tx.teacherProfile.findUnique.mockResolvedValue(stored({ ...wasOn, jobTypes: [], currentDistrictKey: 'd7', currentDistrict: 'Quận 7 (Phú Mỹ Hưng)' }))
    await saveTeacherCover('p1', { ...off, coverBase: coverStamp(wasOn) })
    expect(purged()).toEqual(expect.arrayContaining(['/listings/l1', '/c/teachers', '/c/teachers/d7']))
    // …and a row the backfill has not reached: the district its old free text names.
    vi.mocked(revalidatePublicPath).mockClear()
    tx.teacherProfile.findUnique.mockResolvedValue(stored({ situationVersion: null, livesIn: null, teachAreas: [], currentDistrict: 'Thủ Đức' }))
    tx.listing.findUnique.mockResolvedValue({ facetTokens: null, searchText: '' })
    await saveTeacherCover('p1', off)
    expect(purged()).toContain('/c/teachers/thu-duc')
  })

  it('says whether schools see the profile after the save — a re-confirm over a HIDDEN profile is `live: false`, never a silent re-show', async () => {
    tx.teacherProfile.findUnique.mockResolvedValue(stored({ ...wasOn, status: 'hidden' }))
    tx.listing.update.mockResolvedValue({ status: 'hidden', verified: true })
    const r = await saveTeacherCover('p1', { ...on, coverBase: coverStamp(wasOn) })
    expect(r).toMatchObject({ coverOpen: true, hidden: false, live: false })
    expect(tx.listing.update.mock.calls[0][0].data).not.toHaveProperty('status')
    tx.listing.update.mockResolvedValue({ status: 'active', verified: true })
    expect(await saveTeacherCover('p1', { ...on, coverBase: coverStamp(wasOn) })).toMatchObject({ live: true })
  })

  it('refuses a stale window: "Still available" from a tab that loaded cover ON cannot re-enable it after a withdrawal', async () => {
    tx.teacherProfile.findUnique.mockResolvedValue(stored({ coverOpen: false, coverWithdrawnAt: new Date('2026-10-07') }))
    await expect(saveTeacherCover('p1', { ...on, coverBase: coverStamp(wasOn) })).rejects.toBeInstanceOf(TeacherCoverConflictError)
    expect(tx.teacherProfile.update).not.toHaveBeenCalled()
    expect(tx.listing.update).not.toHaveBeenCalled()
  })

  it('refuses a stale window whose loaded reach is not the stored one (the teach areas moved in another window)', async () => {
    tx.teacherProfile.findUnique.mockResolvedValue(stored(wasOn))
    const staleBase = coverStamp({ ...wasOn, coverAreas: ['d7', 'd1'] }) // that tab still had District 1 in reach
    await expect(saveTeacherCover('p1', { ...on, coverBase: staleBase })).rejects.toBeInstanceOf(TeacherCoverConflictError)
    // …and the same window with the current state saves
    await expect(saveTeacherCover('p1', { ...on, coverBase: coverStamp(wasOn) })).resolves.toMatchObject({ coverOpen: true })
  })

  it('refuses a body with only part of the cover — periods sent without the switch never read as "off"', async () => {
    tx.teacherProfile.findUnique.mockResolvedValue(stored(wasOn))
    await expect(saveTeacherCover('p1', { coverSlots: ['tue-pm'] })).rejects.toBeInstanceOf(TeacherValidationError)
    expect(tx.teacherProfile.update).not.toHaveBeenCalled()
  })

  it('lets a client with no base (the join form) fill an OFF cover, but never overwrite one that is ON', async () => {
    tx.teacherProfile.findUnique.mockResolvedValue(stored(wasOn))
    await expect(saveTeacherCover('p1', off)).rejects.toBeInstanceOf(TeacherCoverConflictError)
    expect(tx.teacherProfile.update).not.toHaveBeenCalled()
    // Switched off earlier, periods kept: a form that loaded nothing may set it up again.
    tx.teacherProfile.findUnique.mockResolvedValue(stored({ ...wasOn, coverOpen: false, coverWithdrawnAt: new Date('2026-10-05') }))
    await expect(saveTeacherCover('p1', on)).resolves.toMatchObject({ coverOpen: true })
  })

  it('⛔ the switch counts as consent only under the notice in force — an older page must reload (409 notice_changed)', async () => {
    tx.teacherProfile.findUnique.mockResolvedValue(stored())
    await expect(saveTeacherCover('p1', { ...on, coverNotice: '2026-10-07' })).rejects.toBeInstanceOf(TeacherNoticeChangedError)
    const { coverNotice: _n, ...unsaid } = on
    await expect(saveTeacherCover('p1', unsaid)).rejects.toBeInstanceOf(TeacherNoticeChangedError)
    expect(tx.teacherProfile.update).not.toHaveBeenCalled()
    // …while a switch-off needs no notice at all
    await expect(saveTeacherCover('p1', { ...off, coverNotice: undefined })).resolves.toMatchObject({ coverOpen: false })
  })

  it('answers null when the account has no teacher profile', async () => {
    tx.teacherProfile.findUnique.mockResolvedValue(null)
    expect(await saveTeacherCover('p1', on)).toBeNull()
    expect(tx.listing.update).not.toHaveBeenCalled()
  })
})

describe('isLegacyCoverBody', () => {
  it('is a body that still sends picked areas — the panel from before the redesign', () => {
    expect(isLegacyCoverBody({ ...on, coverAreas: ['d7'] })).toBe(true)
    expect(isLegacyCoverBody(on)).toBe(false)
    expect(isLegacyCoverBody(null)).toBe(false)
  })
})

describe('saveTeacherProfile — the cover part of the body', () => {
  const body = (o: Record<string, unknown> = {}) => ({
    ...stored(), relocate: 'some', teachAreasConfirmed: true, phone: '', publishNotice: PUBLISH_NOTICE_VERSION, ...on, ...o,
  })
  /** The validation errors a save throws (it never reaches the database in these cases). */
  const errorsOf = async (b: unknown): Promise<Record<string, string>> => {
    try { await saveTeacherProfile({ id: 'p1', email: 'jane@example.com' }, b) } catch (e) { if (e instanceof TeacherValidationError) return e.errors as Record<string, string> }
    return {}
  }
  it('refuses a body with only some cover fields, before anything is read or written', async () => {
    const { coverOpen: _o, ...partial } = body()
    expect(await errorsOf(partial)).toEqual({ coverOpen: 'incomplete' })
  })
  it('⛔ refuses a body with NO cover field too — every v2 client sends its whole cover, and absence is never "off" (gate review, 2026-10-09)', async () => {
    const { coverOpen: _o, coverSlots: _s, coverRateVnd: _r, coverConsent: _c, coverNotice: _n, ...none } = body()
    expect(await errorsOf(none)).toEqual({ coverOpen: 'incomplete' })
  })
  it('⛔ counts the switch as consent only under the notice the client showed — 409 notice_changed, never a silent OFF', async () => {
    await expect(saveTeacherProfile({ id: 'p1', email: null }, body({ coverNotice: '2026-10-07' }))).rejects.toBeInstanceOf(TeacherNoticeChangedError)
    const { coverNotice: _n, ...unsaid } = body()
    await expect(saveTeacherProfile({ id: 'p1', email: null }, unsaid)).rejects.toBeInstanceOf(TeacherNoticeChangedError)
    expect((await errorsOf(body())).coverConsent).toBeUndefined()
  })
})

describe('coverPartOf', () => {
  it('is all or nothing — over the four fields the body still carries (no areas)', () => {
    expect(coverPartOf({ bio: 'x' })).toBe('none')
    expect(coverPartOf({ coverOpen: false, coverSlots: [], coverRateVnd: null, coverConsent: false })).toBe('all')
    expect(coverPartOf({ coverSlots: ['mon-am'] })).toBe('partial')
    expect(coverPartOf(null)).toBe('none')
  })
})

describe('coverWrites', () => {
  const now = new Date('2026-10-08T10:00:00Z')
  const t = (o: Record<string, unknown> = {}) => normalizeTeacherInput({ ...stored(), ...on, ...o })
  const savedOn = { coverOpen: true, coverSlots: ['mon-am'], coverAreas: ['d7'], coverRateVnd: 300_000, coverConfirmedAt: new Date('2026-10-01'), coverWithdrawnAt: null }
  it('asks for a fresh consent when the notice version moved since the last grant (the 2026-10-08 bump)', () => {
    const w = coverWrites(t(), { ...savedOn, coverConsentAt: new Date('2026-10-07'), coverConsentVersion: '2026-10-07' }, now)
    expect(w.coverConsentAt).toEqual(now)
    expect(w.coverConsentVersion).toBe(COVER_CONSENT_VERSION)
  })
  it('keeps the existing grant while cover stays on under the same version', () => {
    const at = new Date('2026-10-08T01:00:00Z')
    const w = coverWrites(t(), { ...savedOn, coverConsentAt: at, coverConsentVersion: COVER_CONSENT_VERSION }, now)
    expect(w.coverConsentAt).toEqual(at)
  })
  it('moves "confirmed on" only when the teacher confirmed — a save that left cover untouched keeps the old date', () => {
    const s = { ...savedOn, coverConsentAt: new Date('2026-10-01'), coverConsentVersion: COVER_CONSENT_VERSION }
    expect(coverWrites(t(), s, now).coverConfirmedAt).toEqual(savedOn.coverConfirmedAt) // e.g. only the bio changed
    expect(coverWrites(t(), s, now, { confirm: true }).coverConfirmedAt).toEqual(now) // "Still available"
    expect(coverWrites(t({ coverSlots: ['mon-am', 'tue-am'] }), s, now).coverConfirmedAt).toEqual(now) // periods changed
    expect(coverWrites(t({ teachAreas: ['d7', 'd1'] }), s, now).coverConfirmedAt).toEqual(now) // the reach changed
  })
  it('⛔ writes the DERIVED reach, and never ON without one — the cover CHECK demands areas on an ON row', () => {
    expect(coverWrites(t(), null, now).coverAreas).toEqual(['d7'])
    const w = coverWrites(t({ teachAreas: ['ha-noi'] }), { ...savedOn, coverConsentAt: now, coverConsentVersion: COVER_CONSENT_VERSION }, now)
    expect(w).toMatchObject({ coverOpen: false, coverAreas: [] })
    expect(w.coverWithdrawnAt).toEqual(now) // the reach went, so cover went: a withdrawal on record
  })
})

// Hide and show (the Visibility switch — the one way a hidden profile comes back): every page the teacher is on is
// purged, their district page included (gate review, 2026-10-09).
describe('setTeacherStatus', () => {
  const tpOutside = { id: 'tp1', listingId: 'l1', currentDistrictKey: 'd4', currentDistrict: 'Quận 4' }

  it('purges the listing, /c/teachers and the teacher\'s district page, both ways', async () => {
    outside.teacherProfile.findUnique.mockResolvedValue(tpOutside)
    tx.teacherProfile.findUnique.mockResolvedValue(stored()) // a part-time job seeker: something to be found for
    tx.listing.updateMany.mockResolvedValue({ count: 1 })
    for (const status of ['hidden', 'live'] as const) {
      vi.mocked(revalidatePublicPath).mockClear()
      expect(await setTeacherStatus('p1', status)).toBe(true)
      expect(purged()).toEqual(expect.arrayContaining(['/listings/l1', '/c/teachers', '/c/teachers/d4']))
    }
  })

  // ⛔ D6 HOLDS PAST THE NEXT TAP (gate review, 2026-10-09): an edit save with no job goal and no public cover hides the
  // profile, and the Visibility switch re-showed it at once. Showing is refused by the saves' own rule (hasTeachingGoal
  // over the stored row), read under their per-account lock — and nothing is written.
  it('⛔ refuses to SHOW a profile with no job goal and no public cover — under the account lock, writing nothing', async () => {
    outside.teacherProfile.findUnique.mockResolvedValue(tpOutside)
    tx.teacherProfile.findUnique.mockResolvedValue(stored({ status: 'hidden', jobTypes: [] }))
    tx.listing.updateMany.mockResolvedValue({ count: 1 })
    await expect(setTeacherStatus('p1', 'live')).rejects.toBeInstanceOf(TeacherNoGoalError)
    expect(tx.listing.updateMany).not.toHaveBeenCalled()
    expect(tx.teacherProfile.update).not.toHaveBeenCalled()
    expect(tx.$executeRaw.mock.calls[0][1]).toBe('teacher:p1') // the saves' lock key…
    expect(tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.teacherProfile.findUnique.mock.invocationCallOrder[0]) // …taken before the read
    expect(purged()).toEqual([])
  })

  it('a cover kept ON under an OLDER notice is no goal either — not public until switched on again (the form loads it off)', async () => {
    outside.teacherProfile.findUnique.mockResolvedValue(tpOutside)
    tx.teacherProfile.findUnique.mockResolvedValue(stored({ ...wasOn, coverConsentVersion: '2026-10-07', status: 'hidden', jobTypes: [] }))
    await expect(setTeacherStatus('p1', 'live')).rejects.toBeInstanceOf(TeacherNoGoalError)
    expect(tx.listing.updateMany).not.toHaveBeenCalled()
  })

  it('shows a cover-only teacher whose cover is public, and a job seeker with cover off', async () => {
    outside.teacherProfile.findUnique.mockResolvedValue(tpOutside)
    tx.listing.updateMany.mockResolvedValue({ count: 1 })
    for (const row of [stored({ ...wasOn, status: 'hidden', jobTypes: [] }), stored({ status: 'hidden' })]) {
      tx.teacherProfile.findUnique.mockResolvedValue(row)
      expect(await setTeacherStatus('p1', 'live')).toBe(true)
    }
    expect(tx.listing.updateMany.mock.calls.map(([a]) => a.data)).toEqual([{ status: 'active' }, { status: 'active' }])
    expect(tx.teacherProfile.update.mock.calls.map(([a]) => a.data)).toEqual([{ status: 'live' }, { status: 'live' }])
  })

  it('hiding is never refused — not even with no goal left', async () => {
    outside.teacherProfile.findUnique.mockResolvedValue(tpOutside)
    tx.teacherProfile.findUnique.mockResolvedValue(stored({ jobTypes: [] }))
    tx.listing.updateMany.mockResolvedValue({ count: 1 })
    expect(await setTeacherStatus('p1', 'hidden')).toBe(true)
    expect(tx.listing.updateMany.mock.calls[0][0].data).toEqual({ status: 'hidden' })
  })
})
