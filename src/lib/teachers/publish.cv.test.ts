import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * saveTeacherProfile — THE CV A NEW PROFILE PUBLISHES WITH (owner, 2026-10-21: "when teacher creates profile it says cv is
 * optional, its not they should include cv"). Enforced by the SERVER at create, the intro video's precedent: the join form
 * uploads the PDF BEFORE the PUT (POST /api/teachers/me/cv?pending=1 — tombstoned first, 'teacher_cv_pending') and the
 * save that CREATES the profile names its token. Pinned: a create with no valid token is refused with the other answers,
 * before anything is read or written ({ cv: 'required' }); under the lock the pending row must still be there, at the path
 * REBUILT from the caller's own id ({ cv: 'expired' } otherwise — another account's token included); a good one is
 * written in the TeacherPrivate create, its name sanitised, and its pending tombstone deleted in the same transaction; an
 * edit ignores both fields entirely; a refusal after the check rolls everything back and leaves the tombstone for the sweep.
 */
type Row = Record<string, any>
const TOKEN = 'eeeeeeee-0000-4000-8000-000000000005'
const PENDING = `p1/${TOKEN}.pdf`
const h = vi.hoisted(() => ({
  existing: null as Row | null, // the TeacherProfile the save finds (pre-read and under the lock)
  /** StorageTombstone rows by `<bucket>\n<path>` → reason. */
  tombstones: new Map<string, string>(),
  /** The pending row's end of grace (null: 55 minutes from now — a fresh upload). */
  notBefore: null as Date | null,
  tombstoneReads: [] as Row[],
  tombstoneDeletes: [] as Row[],
  privateWrites: [] as Row[],
  profileWrites: [] as Row[],
  listingWrites: [] as Row[],
  /** The statements the transaction ran, in order (what was read and written, by name). */
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
vi.mock('@/lib/teachers/photo-verdict', () => ({
  PhotoCheckUnavailable: class extends Error {}, teacherPhotoKey: () => null, recordPhotoRefusal: async () => {},
  teacherPhotoVerdict: async () => ({ ok: true }),
}))
vi.mock('@/lib/teachers/video-store', () => ({
  ownsPublicVideo: async () => true, privateVideoPathFor: () => 'p', publicVideoKeyFor: () => 'k',
  copyPublicVideoToPrivate: async () => true, copyPrivateVideoToPublic: async () => null, removeUnreferencedPrivateVideos: async () => [],
}))

const tx = {
  // The account lock first, then the identity mark's savepoint: anything here means the save reached the transaction.
  $executeRaw: vi.fn(async () => { h.order.push('executeRaw'); return 1 }),
  identityVerification: { findMany: async () => [] },
  teacherProfile: {
    findUnique: async () => { h.order.push('teacherProfile.findUnique (locked)'); return h.existing },
    upsert: async (args: Row) => {
      h.order.push('teacherProfile.upsert')
      h.profileWrites.push(args)
      return { id: h.existing?.id ?? 'tp-new', coverOpen: false, coverSlots: [], coverAreas: [], coverRateVnd: null, coverConfirmedAt: null, coverConsentVersion: null, videoVersion: 0, videoOnRequest: false }
    },
  },
  teacherPrivate: { upsert: async (args: Row) => { h.order.push('teacherPrivate.upsert'); h.privateWrites.push(args) } },
  teacherDraft: { deleteMany: async () => ({ count: 1 }) },
  profile: { updateMany: async () => ({ count: 1 }) },
  listing: {
    update: async (args: Row) => { h.listingWrites.push(args) },
    create: async (args: Row) => { h.order.push('listing.create'); h.listingWrites.push(args); return { id: 'L-new' } },
    findUnique: async () => ({ status: 'active', verified: true }),
  },
  storageTombstone: {
    findUnique: async ({ where, select }: Row) => {
      h.order.push('storageTombstone.findUnique')
      h.tombstoneReads.push({ where, select })
      const reason = h.tombstones.get(`${where.bucket_path.bucket}\n${where.bucket_path.path}`)
      return reason ? { reason, notBefore: h.notBefore ?? new Date(Date.now() + 55 * 60_000) } : null
    },
    deleteMany: async ({ where }: Row) => { h.order.push('storageTombstone.deleteMany'); h.tombstoneDeletes.push(where); return { count: 1 } },
  },
  teacherVideoShare: { updateMany: async () => ({ count: 0 }) },
}
vi.mock('@/lib/db', () => ({
  db: {
    teacherProfile: { findUnique: async ({ select }: Row) => (select?.videoVersion ? (h.existing ? { videoOnRequest: false, videoUrl: null, videoVersion: 0, private: { videoPath: null } } : null) : h.existing) },
    seller: { findUnique: async () => ({ id: 's1', trustTier: 'standard', trustScore: 50 }) },
    category: { findUnique: async () => ({ id: 'cat-teachers', name: 'Teachers', nameVi: 'Giáo viên' }) },
    listing: { findUnique: async () => ({ status: 'active', verified: true }) },
    // A throw inside the callback undoes every write it made, as the real transaction does — so "nothing written" pins
    // that a refusal is thrown INSIDE the transaction, never after a commit.
    $transaction: async (cb: (t: typeof tx) => unknown) => {
      const logs = [h.tombstoneDeletes, h.privateWrites, h.profileWrites, h.listingWrites]
      const marks = logs.map((l) => l.length)
      try {
        return await cb(tx)
      } catch (e) {
        logs.forEach((l, i) => { l.length = marks[i] })
        throw e
      }
    },
  },
}))

const { saveTeacherProfile, TeacherValidationError } = await import('./publish')
const { PUBLISH_NOTICE_VERSION } = await import('./profile')
const { COVER_CONSENT_VERSION } = await import('./cover')
const { isCvUploadToken } = await import('./constants')

/** A complete v2 body of a new profile — photo, a public intro video, and the CV's pending upload. */
const body = (o: Row = {}) => ({
  livesIn: 'city', currentCity: 'ho-chi-minh-city', currentDistrictKey: 'd7', currentProvince: '', jobTypes: ['fulltime'], relocate: 'no',
  teachAreas: ['d7'], teachAreasConfirmed: true, availableFrom: null, expectedSalaryM: 40,
  subjects: ['general-english'], teachLanguages: [], ageGroups: ['kids'], experienceBand: '5-10-years', experience: [],
  degreeLevel: null, degreeMajor: '', degreeInstitution: '', degreeYear: null, certificates: [],
  fullName: 'Jane Doe', nationality: 'GB', englishLevel: 'native', languages: [], headline: 'CELTA-certified English teacher', bio: '',
  coverOpen: false, coverSlots: [], coverRateVnd: null, coverConsent: false, coverNotice: COVER_CONSENT_VERSION,
  photoUrl: 'https://sb.eno.vn/storage/v1/object/public/listings/a.webp', videoUrl: 'https://sb.eno.vn/storage/v1/object/public/listing-videos/1700000000001-abcd12.mp4', videoOnRequest: false, videoBase: 0,
  phone: '+84 901 234 567', matchEmailOptIn: false, staffContactOptIn: false, publishNotice: PUBLISH_NOTICE_VERSION,
  cvUpload: TOKEN, cvFileName: 'Jane Doe CV.pdf',
  ...o,
})
const existing = (o: Row = {}): Row => ({
  id: 'tp1', listingId: 'L1', status: 'live', createdAt: new Date('2026-10-24T00:00:00Z'), coverOpen: false, coverSlots: [], coverAreas: [], coverRateVnd: null,
  coverConsentAt: null, coverConsentVersion: null, coverConfirmedAt: null, coverWithdrawnAt: null, videoVersion: 0,
  yearsExperience: 6, teachAreas: ['d7'], teachAreasConfirmedAt: new Date('2026-10-08T01:00:00Z'),
  consentPublicVersion: PUBLISH_NOTICE_VERSION, consentPublicAt: new Date('2026-10-08T01:00:00Z'),
  matchEmailOptIn: false, matchEmailOptInAt: null, matchEmailNoticeVersion: null, matchEmailWithdrawnAt: null,
  staffContactOptIn: false, staffContactOptInAt: null, staffContactNoticeVersion: null, staffContactWithdrawnAt: null,
  identityMarkOn: false, identityMarkWithdrawnAt: null,
  ...o,
})
const create = (b: Row, profileId = 'p1') => saveTeacherProfile({ id: profileId, email: 'jane@example.com' }, b, { expectTeacherProfileId: null })
const edit = (b: Row) => saveTeacherProfile({ id: 'p1', email: 'jane@example.com' }, b, { expectTeacherProfileId: 'tp1' })
const errorsOf = async (p: Promise<unknown>): Promise<Record<string, string> | null> => {
  try { await p } catch (e) { if (e instanceof TeacherValidationError) return e.errors as Record<string, string>; throw e }
  return null
}
const nothingWritten = () => {
  expect(h.privateWrites).toEqual([])
  expect(h.profileWrites).toEqual([])
  expect(h.listingWrites).toEqual([])
  expect(h.tombstoneDeletes).toEqual([])
}

beforeEach(() => {
  h.existing = null
  h.notBefore = null
  h.tombstones = new Map([[`teacher-cvs\n${PENDING}`, 'teacher_cv_pending']])
  h.tombstoneReads = []; h.tombstoneDeletes = []; h.privateWrites = []; h.profileWrites = []; h.listingWrites = []; h.order = []
})

describe('⛔ a CREATE needs the CV it uploaded first', () => {
  it('⛔ a create with NO `cvUpload` key at all — a tab opened before the deploy, whose form cannot show a CV refusal — is stale wording: 409 notice_changed, nothing read or written', async () => {
    const { cvUpload: _t, ...oldTab } = body()
    await expect(create(oldTab)).rejects.toMatchObject({ name: 'TeacherNoticeChangedError', notice: 'publish' })
    expect(h.order).toEqual([])
    nothingWritten()
  })
  it('no token: { cv: "required" } — before anything is read under the lock or written', async () => {
    const noCv = body({ cvUpload: null })
    expect(await errorsOf(create(noCv))).toEqual({ cv: 'required' })
    expect(h.order).toEqual([]) // refused before the transaction — no lock taken, nothing read under it, nothing written
    nothingWritten()
  })
  it('…joined with the other refusals, so the form shows them together', async () => {
    const errs = await errorsOf(create(body({ cvUpload: undefined, photoUrl: null, subjects: [] })))
    expect(errs).toMatchObject({ cv: 'required', photoUrl: 'required', subjects: 'required' })
    nothingWritten()
  })
  it('anything that is not exactly a pending upload\'s token is no token — never a path, never another shape', async () => {
    for (const v of [TOKEN.toUpperCase(), `${TOKEN}.pdf`, PENDING, `../${TOKEN}`, 'aaaaaaaa-0000-1000-8000-000000000000', '', 42, null, { token: TOKEN }, [TOKEN]]) {
      expect(isCvUploadToken(v), JSON.stringify(v)).toBe(false)
      expect(await errorsOf(create(body({ cvUpload: v }))), JSON.stringify(v)).toEqual({ cv: 'required' })
    }
    nothingWritten()
  })
  it('a caller outside the PUT route (no expected profile) is held to it UNDER THE LOCK — no row, no create', async () => {
    const { cvUpload: _t, ...noCv } = body()
    expect(await errorsOf(saveTeacherProfile({ id: 'p1', email: 'jane@example.com' }, noCv))).toEqual({ cv: 'required' })
    nothingWritten()
  })
})

describe('⛔ under the lock: the pending upload must still be there, at the path rebuilt from THIS account', () => {
  it('a token whose pending row is gone (swept after its hour) → { cv: "expired" }, nothing written', async () => {
    h.tombstones.clear()
    expect(await errorsOf(create(body()))).toEqual({ cv: 'expired' })
    expect(h.tombstoneReads).toEqual([{ where: { bucket_path: { bucket: 'teacher-cvs', path: PENDING } }, select: { reason: true, notBefore: true } }])
    nothingWritten()
  })
  it('a pending upload near the end of its grace hour (under 10 minutes left — a replayed token) is "expired": the sweep may be about to take it', async () => {
    h.notBefore = new Date(Date.now() + 9 * 60_000)
    expect(await errorsOf(create(body()))).toEqual({ cv: 'expired' })
    nothingWritten()
    h.notBefore = new Date(Date.now() + 11 * 60_000)
    expect(await errorsOf(create(body()))).toBeNull()
  })
  it('a row there for another reason (the object is meant to go — replaced, erased) is no pending upload: "expired"', async () => {
    h.tombstones.set(`teacher-cvs\n${PENDING}`, 'teacher_cv_replaced')
    expect(await errorsOf(create(body()))).toEqual({ cv: 'expired' })
    h.tombstones.set(`teacher-cvs\n${PENDING}`, 'account_deleted')
    expect(await errorsOf(create(body()))).toEqual({ cv: 'expired' })
    nothingWritten()
  })
  it('⛔ another account\'s token cannot be used: its pending upload sits under ITS id, and this account\'s path holds none', async () => {
    // p2 uploaded it; p1 names it in its own create.
    h.tombstones = new Map([[`teacher-cvs\np2/${TOKEN}.pdf`, 'teacher_cv_pending']])
    expect(await errorsOf(create(body(), 'p1'))).toEqual({ cv: 'expired' })
    expect(h.tombstoneReads.map((r) => r.where.bucket_path.path)).toEqual([PENDING])
    nothingWritten()
  })
})

describe('a good token: the create attaches the CV in its own transaction', () => {
  it('writes the SERVER-BUILT path and the sanitised name in the TeacherPrivate create, and deletes the pending tombstone with it', async () => {
    const r = await create(body({ cvFileName: 'C:\\Users\\jane\\My CV <final>\r\n.pdf', cvPath: 'p2/stolen.pdf' }))
    expect(r.created).toBe(true)
    expect(h.privateWrites).toHaveLength(1)
    const { create: c, update: u } = h.privateWrites[0]
    expect(c.cvPath).toBe(PENDING) // `<the caller's id>/<token>.pdf` — never the body's
    expect(c.cvFileName).toBe('My CV final.pdf') // safeCvFileName: no path, no markup, no line break
    expect(u).not.toHaveProperty('cvPath')
    expect(u).not.toHaveProperty('cvFileName')
    expect(h.tombstoneDeletes).toEqual([{ bucket: 'teacher-cvs', path: PENDING }])
    // In the transaction that creates the profile — checked under the lock, before the row is written.
    expect(h.order.indexOf('storageTombstone.findUnique')).toBeLessThan(h.order.indexOf('listing.create'))
    expect(h.order).toContain('teacherPrivate.upsert')
  })
  it('no name sent: "cv.pdf"', async () => {
    await create(body({ cvFileName: undefined }))
    expect(h.privateWrites[0].create).toMatchObject({ cvPath: PENDING, cvFileName: 'cv.pdf' })
  })
  it('⛔ never echoed: the save\'s answer carries no CV field', async () => {
    const r = await create(body())
    expect(JSON.stringify(r)).not.toMatch(/cvUpload|cvPath|cvFileName|\.pdf/)
  })
  it('a refusal AFTER the check (no work wanted, cover off — judged under the lock for a caller with no expected profile) rolls the whole create back, the pending tombstone kept for the sweep', async () => {
    const goalless = body({ jobTypes: [], relocate: '', expectedSalaryM: null })
    const errs = await errorsOf(saveTeacherProfile({ id: 'p1', email: 'jane@example.com' }, goalless))
    expect(errs).toBeTruthy()
    expect(errs).not.toHaveProperty('cv')
    expect(h.order.indexOf('storageTombstone.findUnique')).toBeGreaterThanOrEqual(0) // the CV was found, then the goal refused
    nothingWritten()
    expect(h.tombstones.has(`teacher-cvs\n${PENDING}`)).toBe(true)
  })
})

describe('an EDIT ignores cvUpload and cvFileName entirely (its CV is the CV route\'s, attached after its save)', () => {
  it('a token on an edit: no pending read, no tombstone deleted, no CV column written — create half included', async () => {
    h.existing = existing()
    await edit(body())
    expect(h.tombstoneReads).toEqual([])
    expect(h.tombstoneDeletes).toEqual([])
    const { create: c, update: u } = h.privateWrites[0]
    for (const half of [c, u]) {
      expect(half).not.toHaveProperty('cvPath')
      expect(half).not.toHaveProperty('cvFileName')
    }
  })
  it('an edit with no token at all saves — even for a profile created since the cutoff (an edit never re-asks)', async () => {
    h.existing = existing({ createdAt: new Date('2026-10-30T00:00:00Z') })
    const { cvUpload: _t, cvFileName: _n, ...noCv } = body()
    await expect(edit(noCv)).resolves.toBeTruthy()
    expect(h.tombstoneReads).toEqual([])
  })
})
