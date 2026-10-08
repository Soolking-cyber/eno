import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * saveTeacherProfile + deleteTeacherVideo — the intro video's storage side (owner, 2026-10-07). The state table itself
 * is video.test.ts; this pins what a save DOES with a plan: the copy runs before the transaction behind a pending
 * tombstone, the version is re-checked under the lock, displaced objects are tombstoned with the row change, the copy's
 * pending tombstone goes in the same commit, tokens read the FINAL state, and grants end when the private video changes.
 */

type Row = Record<string, any>
const U = 'https://sb.eno.vn/storage/v1/object/public/listing-videos/1700000000000-abcd12.mp4'
const V = 'https://sb.eno.vn/storage/v1/object/public/listing-videos/1700000000001-efgh34.mp4'
const P = 'p1/aaaaaaaa-0000-4000-8000-000000000000.mp4'

const h = vi.hoisted(() => ({
  pre: null as Row | null, // the pre-read (VIDEO_STATE_SELECT) and the locked read
  lockedVersion: null as number | null,
  owned: true,
  copyOk: true,
  tombstones: [] as Row[],
  deletedPending: [] as Row[],
  revoked: [] as Row[],
  privateWrites: [] as Row[],
  profileWrites: [] as Row[],
  listingWrites: [] as Row[],
  copies: [] as Row[],
}))

vi.mock('server-only', () => ({}))
vi.mock('next/server', () => ({ after: (fn: () => unknown) => { void fn() } }))
vi.mock('@/lib/revalidate-lang', () => ({ revalidatePublicPath: vi.fn() }))
vi.mock('@/lib/ai-moderation', () => ({ moderateListingById: vi.fn() }))
vi.mock('@/lib/translate', () => ({ warmTranslations: vi.fn() }))
vi.mock('@/lib/compliance/seller-publish-gate', () => ({ assertSellerMayPublish: vi.fn() }))
vi.mock('@/lib/trust', () => ({ initialSellerTrust: async () => ({}) }))
vi.mock('@/lib/log', () => ({ logError: vi.fn() }))
vi.mock('@/lib/core/listings', () => ({ deleteListingCore: vi.fn(), parseVideoField: (u: string | null) => (u ? { action: 'set', url: u } : { action: 'clear' }) }))
vi.mock('@/lib/listing-image', () => ({
  isListingImageUrl: () => true,
  listingObjectKey: (url: string) => (url.includes('/listing-videos/') ? { bucket: 'listing-videos', key: url.split('/').pop(), url } : null),
}))
vi.mock('@/lib/core/storage-purge', () => ({ purgeStorageObjects: async () => ({ settled: [] }) }))
vi.mock('@/lib/core/storage-tombstones', () => ({
  writeTombstones: async (_tx: unknown, refs: Row[], reason: string) => { h.tombstones.push(...refs.map((r) => ({ ...r, reason }))); return refs.length },
  clearTombstones: async () => 0,
}))
vi.mock('@/lib/teachers/video-store', () => ({
  ownsPublicVideo: async () => h.owned,
  privateVideoPathFor: () => P,
  publicVideoKeyFor: () => '1700000000009-pub999.mp4',
  copyPublicVideoToPrivate: async (url: string, path: string) => { h.copies.push({ url, path }); return h.copyOk },
  copyPrivateVideoToPublic: async (path: string, key: string) => { h.copies.push({ path, key }); return h.copyOk ? `https://sb.eno.vn/storage/v1/object/public/listing-videos/${key}` : null },
  removeUnreferencedPrivateVideos: async () => [],
}))

const tx = {
  $executeRaw: vi.fn(),
  teacherProfile: {
    findUnique: async () => (h.pre ? { listingId: 'L1', coverOpen: false, coverSlots: [], coverAreas: [], coverRateVnd: null, coverConsentAt: null, coverConsentVersion: null, coverConfirmedAt: null, coverWithdrawnAt: null, videoVersion: h.lockedVersion ?? h.pre.videoVersion, id: 'tp1', videoOnRequest: h.pre.videoOnRequest, private: h.pre.private } : null),
    upsert: async (args: Row) => { h.profileWrites.push(args); return { id: 'tp1', coverOpen: false, coverSlots: [], coverAreas: [], coverRateVnd: null, coverConfirmedAt: null, coverConsentVersion: null, videoVersion: 4, videoOnRequest: true } },
    update: async (args: Row) => { h.profileWrites.push(args); return { videoVersion: 4, videoOnRequest: true } },
  },
  teacherPrivate: {
    upsert: async (args: Row) => { h.privateWrites.push(args) },
    update: async (args: Row) => { h.privateWrites.push(args) },
  },
  listing: { update: async (args: Row) => { h.listingWrites.push(args) }, create: async (args: Row) => { h.listingWrites.push(args); return { id: 'L1' } } },
  storageTombstone: { deleteMany: async ({ where }: Row) => { h.deletedPending.push(where); return { count: 1 } } },
  teacherVideoShare: { updateMany: async ({ where }: Row) => { h.revoked.push(where); return { count: 2 } } },
}
vi.mock('@/lib/db', () => ({
  db: {
    teacherProfile: { findUnique: async ({ select }: Row) => (select?.videoVersion ? h.pre : h.pre ? { id: 'tp1', listingId: 'L1', status: 'live' } : null) },
    seller: { findUnique: async () => ({ id: 's1', trustTier: 'standard', trustScore: 50 }) },
    category: { findUnique: async () => ({ id: 'cat-teachers', name: 'Teachers', nameVi: 'Giáo viên' }) },
    listing: { findUnique: async () => ({ status: 'active', verified: true }) },
    $transaction: async (cb: (t: typeof tx) => unknown) => cb(tx),
  },
}))

const { saveTeacherProfile, deleteTeacherVideo, TeacherVideoConflictError, TeacherVideoStoreError, TeacherValidationError } = await import('./publish')

const body = (o: Row = {}) => ({
  fullName: 'Jane Doe', headline: 'CELTA-certified English teacher, 6 years with kids', bio: 'I teach English to young learners and adults in Ho Chi Minh City.',
  nationality: 'GB', nativeSpeaker: true, languages: ['en'], currentCity: 'ho-chi-minh-city', currentDistrict: '', preferredCities: ['ho-chi-minh-city'],
  openToOnline: false, availableFrom: null, jobTypes: ['parttime'], ageGroups: ['kids'], subjects: ['ielts'], yearsExperience: 6, experience: [],
  degreeLevel: 'bachelor', degreeMajor: 'English', degreeInstitution: 'Uni', degreeYear: 2015, certificates: [], expectedSalaryM: null,
  photoUrl: 'https://sb.eno.vn/storage/v1/object/public/listings/1700000000000-abcd12.webp', phone: '+84901234567',
  staffContactOptIn: false, matchEmailOptIn: false, consentPublic: true,
  coverOpen: false, coverSlots: [], coverAreas: [], coverRateVnd: null, coverConsent: false, coverNotice: '2026-10-07',
  videoOnRequest: false, videoUrl: null, videoBase: 3,
  ...o,
})
const save = (b: Row) => saveTeacherProfile({ id: 'p1', email: 'jane@example.com' }, b)
const stored = (o: Row = {}) => ({ videoOnRequest: false, videoUrl: null, videoVersion: 3, private: { videoPath: null }, ...o })

beforeEach(() => {
  h.pre = stored(); h.lockedVersion = null; h.owned = true; h.copyOk = true
  h.tombstones = []; h.deletedPending = []; h.revoked = []; h.privateWrites = []; h.profileWrites = []; h.listingWrites = []; h.copies = []
})

describe('saving a video kept private', () => {
  it('copies the upload in BEHIND a pending tombstone, then writes one home and tombstones the public upload', async () => {
    const r = await save(body({ videoOnRequest: true, videoUrl: V }))
    expect(h.tombstones[0]).toEqual({ bucket: 'teacher-videos', path: P, reason: 'teacher_video_pending' }) // written before the copy
    expect(h.copies).toEqual([{ url: V, path: P }])
    expect(h.tombstones).toContainEqual({ bucket: 'listing-videos', path: '1700000000001-efgh34.mp4', reason: 'teacher_video_replaced' })
    expect(h.deletedPending).toEqual([{ bucket: 'teacher-videos', path: P }]) // referenced now
    expect(h.privateWrites[0].update.videoPath).toBe(P)
    const listing = h.listingWrites[0].data
    expect(listing.video).toBeNull()
    expect(listing.facetTokens ?? '').not.toContain('has-video') // a private video is not "has a video"
    expect(h.profileWrites[0].update.videoVersion).toEqual({ increment: 1 })
    // ONE home: the profile row's public URL goes with the listing's — a private video is shown nowhere (gate review).
    expect(h.profileWrites[0].update.videoUrl).toBeNull()
    expect(h.profileWrites[0].create.videoUrl).toBeNull()
    expect(r.video).toEqual({ onRequest: true, version: 4, hasPrivate: true, url: null })
  })
  it('refuses an upload that is not this teacher\'s own — nothing copied', async () => {
    h.owned = false
    await expect(save(body({ videoOnRequest: true, videoUrl: V }))).rejects.toBeInstanceOf(TeacherValidationError)
    expect(h.copies).toEqual([])
  })
  it('refuses a stale base before any copy', async () => {
    await expect(save(body({ videoOnRequest: true, videoUrl: V, videoBase: 2 }))).rejects.toBeInstanceOf(TeacherVideoConflictError)
    expect(h.copies).toEqual([])
  })
  it('a failed copy writes nothing (its pending tombstone collects any half-made object)', async () => {
    h.copyOk = false
    await expect(save(body({ videoOnRequest: true, videoUrl: V }))).rejects.toBeInstanceOf(TeacherVideoStoreError)
    expect(h.listingWrites).toEqual([])
    expect(h.tombstones).toEqual([{ bucket: 'teacher-videos', path: P, reason: 'teacher_video_pending' }])
  })
  it('a version that moved between the pre-read and the lock refuses — the copy stays tombstoned for the sweep', async () => {
    h.lockedVersion = 4
    await expect(save(body({ videoOnRequest: true, videoUrl: V }))).rejects.toBeInstanceOf(TeacherVideoConflictError)
    expect(h.listingWrites).toEqual([])
    expect(h.deletedPending).toEqual([])
  })
})

describe('publishing a private video', () => {
  it('copies it out, tombstones the private object, and ends every school\'s grant to it', async () => {
    h.pre = stored({ videoOnRequest: true, private: { videoPath: P } })
    await save(body({ videoOnRequest: false, videoUrl: null }))
    expect(h.copies).toEqual([{ path: P, key: '1700000000009-pub999.mp4' }])
    expect(h.listingWrites[0].data.video).toBe('https://sb.eno.vn/storage/v1/object/public/listing-videos/1700000000009-pub999.mp4')
    expect(h.tombstones).toContainEqual({ bucket: 'teacher-videos', path: P, reason: 'teacher_video_replaced' })
    expect(h.privateWrites[0].update.videoPath).toBeNull()
    expect(h.profileWrites[0].update.videoUrl).toBe('https://sb.eno.vn/storage/v1/object/public/listing-videos/1700000000009-pub999.mp4')
    // Sent grants only: a school's pending ask survives a replacement (gate review).
    expect(h.revoked).toEqual([{ sharedAt: { not: null }, revokedAt: null, conversation: { listingId: 'L1', sellerProfileId: 'p1' } }])
  })
})

describe('a save that leaves the video as stored', () => {
  it('needs no base and does no storage work (a bio edit by an old tab)', async () => {
    h.pre = stored({ videoUrl: U })
    await save(body({ videoUrl: U, videoBase: undefined, videoOnRequest: undefined }))
    expect(h.copies).toEqual([])
    expect(h.tombstones).toEqual([])
    expect(h.profileWrites[0].update.videoVersion).toBeUndefined()
  })
})

describe('deleteTeacherVideo', () => {
  it('removes the private video under the lock: tombstoned, path cleared, version bumped, grants ended', async () => {
    h.pre = stored({ videoOnRequest: true, private: { videoPath: P } })
    const v = await deleteTeacherVideo('p1', 3)
    expect(v).toEqual({ onRequest: true, version: 4, hasPrivate: false, url: null })
    expect(h.tombstones).toEqual([{ bucket: 'teacher-videos', path: P, reason: 'teacher_video_replaced' }])
    expect(h.privateWrites[0]).toMatchObject({ data: { videoPath: null } })
    expect(h.revoked).toEqual([{ sharedAt: { not: null }, revokedAt: null, conversation: { listingId: 'L1', sellerProfileId: 'p1' } }])
  })
  it('refuses a stale base, and answers null when there is nothing to remove', async () => {
    h.pre = stored({ videoOnRequest: true, private: { videoPath: P } })
    await expect(deleteTeacherVideo('p1', 2)).rejects.toBeInstanceOf(TeacherVideoConflictError)
    h.pre = stored()
    expect(await deleteTeacherVideo('p1', 3)).toBeNull()
  })
})
