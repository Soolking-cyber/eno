import { beforeEach, describe, expect, it, vi } from 'vitest'
// Zalo for urgent cover (zalo.ts) runs on a real database in zalo.it.test.ts; here only that the save calls it.
vi.mock('./zalo', () => ({ withdrawZaloForCoverOff: vi.fn(async () => false) }))

/**
 * saveTeacherProfile — THE PHONE "ON NEXT SAVE" AND THE OPT-INS' DEFAULT ON RECORD (owner, 2026-10-22: "also phone number
 * is mandatory and all toggles should be on by default"; phone = "Everyone, on next save", toggles = "On by default
 * everywhere", the legal risk accepted and recorded in the dossier). Pinned:
 *   · a body that claims a CREATE without a phone is refused with the other answers, before anything is read under the
 *     lock ({ phone: 'required' }); one that claims nothing (a caller outside the PUT route) is judged on the saved row —
 *     none there is a create, refused; a saved profile's withdrawal is waived as for an edit;
 *   · an EDIT is judged on the SAVED profile (publish.ts, phoneWaived): a profile with a phone can never clear it, and one
 *     with none adds it on its next save — unless that save only withdraws: job emails, staff calls or cover switched off,
 *     or the profile hidden for having no goal left (D6). "Hiding a profile or switching things off is NEVER blocked";
 *   · a waived edit whose profile vanished before the lock answers profile_changed — never a phone-less create;
 *   · the save that CREATES the profile with a switch stored ON at its default (`optInDefaults`; a body that does not
 *     say is recorded as defaults — "unreported") writes one 'teacher.optins.default' compliance row IN ITS TRANSACTION
 *     — never on an edit, never for a switch saved off, and a row that cannot be written fails the create.
 */
type Row = Record<string, any>
const TOKEN = 'eeeeeeee-0000-4000-8000-000000000006'
const h = vi.hoisted(() => ({
  existing: null as Row | null, // the TeacherProfile the read BEFORE the lock finds
  locked: undefined as Row | null | undefined, // …and the one under the lock (undefined: the same as `existing`)
  privateWrites: [] as Row[],
  profileWrites: [] as Row[],
  listingWrites: [] as Row[],
  /** The statements the save's transaction ran, by name — empty means it was never entered. */
  order: [] as string[],
  /** Every db.$transaction call's options (the save's own has none). */
  txOpts: [] as unknown[],
  /** appendAudit calls. */
  audits: [] as Row[],
  auditRaw: [] as string[],
  auditFails: false,
  warns: [] as [string, unknown][],
  /** The CV upload's PENDING tombstone (cvUploadOf's token) — cleared by the create that attaches it, back on a rollback. */
  cvPending: true,
}))

vi.mock('server-only', () => ({}))
vi.mock('next/server', () => ({ after: () => {} }))
vi.mock('@/lib/revalidate-lang', () => ({ revalidatePublicPath: vi.fn() }))
vi.mock('@/lib/ai-moderation', () => ({ moderateListingById: vi.fn() }))
vi.mock('@/lib/translate', () => ({ warmTranslations: vi.fn() }))
vi.mock('@/lib/compliance/seller-publish-gate', () => ({ assertSellerMayPublish: vi.fn() }))
vi.mock('@/lib/trust', () => ({ initialSellerTrust: async () => ({}) }))
vi.mock('@/lib/log', () => ({ logError: vi.fn(), logWarn: (m: string, ctx: unknown) => { h.warns.push([m, ctx]) } }))
vi.mock('@/lib/compliance/audit', () => ({
  appendAudit: async (_tx: unknown, input: Row) => {
    if (h.auditFails) throw Object.assign(new Error('lock timeout on compliance_audit — Jane Doe +84 901 234 567'), { name: 'PrismaClientKnownRequestError' })
    h.audits.push(input)
  },
}))
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

const lockedRow = () => (h.locked === undefined ? h.existing : h.locked)
const saveTx = {
  $executeRaw: vi.fn(async () => { h.order.push('executeRaw'); return 1 }),
  identityVerification: { findMany: async () => [] },
  teacherProfile: {
    findUnique: async () => { h.order.push('teacherProfile.findUnique (locked)'); return lockedRow() },
    upsert: async (args: Row) => {
      h.profileWrites.push(args)
      return { id: lockedRow()?.id ?? 'tp-new', coverOpen: false, coverSlots: [], coverAreas: [], coverRateVnd: null, coverConfirmedAt: null, coverConsentVersion: null, videoVersion: 0, videoOnRequest: false }
    },
  },
  teacherPrivate: { upsert: async (args: Row) => { h.privateWrites.push(args) } },
  teacherDraft: { deleteMany: async () => ({ count: 1 }) },
  profile: { updateMany: async () => ({ count: 1 }) },
  listing: {
    update: async (args: Row) => { h.listingWrites.push(args) },
    create: async (args: Row) => { h.listingWrites.push(args); return { id: 'L-new' } },
    findUnique: async () => ({ status: 'active', verified: true }),
  },
  storageTombstone: {
    findUnique: async () => (h.cvPending ? { reason: 'teacher_cv_pending', notBefore: new Date(Date.now() + 55 * 60_000) } : null),
    deleteMany: async () => { h.cvPending = false; return { count: 1 } },
  },
  teacherVideoShare: { updateMany: async () => ({ count: 0 }) },
}
/** The compliance row's own short transaction: only the bounded wait runs on it here (appendAudit is mocked). */
const auditTx = {
  $executeRaw: async (q: unknown) => { h.auditRaw.push(Array.isArray(q) ? (q as string[]).join('?') : String(q)); return 1 },
}
vi.mock('@/lib/db', () => ({
  db: {
    teacherProfile: { findUnique: async ({ select }: Row) => (select?.videoVersion ? (h.existing ? { videoOnRequest: false, videoUrl: h.existing.videoUrl ?? null, videoVersion: 0, private: { videoPath: null } } : null) : h.existing) },
    seller: { findUnique: async () => ({ id: 's1', trustTier: 'standard', trustScore: 50 }) },
    category: { findUnique: async () => ({ id: 'cat-teachers', name: 'Teachers', nameVi: 'Giáo viên' }) },
    listing: { findUnique: async () => ({ status: 'active', verified: true }) },
    // The save's transaction (no options) undoes its writes on a throw, as the real one does; the audit's (with its
    // bounded wait) gets a client of its own, so a test sees which is which.
    $transaction: async (cb: (t: any) => unknown, opts?: unknown) => {
      h.txOpts.push(opts)
      if (opts) return cb(auditTx)
      const logs = [h.privateWrites, h.profileWrites, h.listingWrites]
      const marks = logs.map((l) => l.length)
      const cvPending = h.cvPending
      try {
        return await cb(saveTx)
      } catch (e) {
        logs.forEach((l, i) => { l.length = marks[i] })
        h.cvPending = cvPending
        throw e
      }
    },
  },
}))

const { saveTeacherProfile, TeacherProfileChangedError, TeacherValidationError } = await import('./publish')
const { AI_NOTICE_VERSION, PUBLISH_NOTICE_VERSION } = await import('./profile')
const { COVER_CONSENT_VERSION, coverStamp } = await import('./cover')

const PHONE = '+84 901 234 567'
/** A complete v2 body — an HCMC full-time job seeker, photo, public intro video, the CV's pending upload, and a phone. */
const body = (o: Row = {}) => ({
  livesIn: 'city', currentCity: 'ho-chi-minh-city', currentDistrictKey: 'd7', currentProvince: '', jobTypes: ['fulltime'], relocate: 'no',
  teachAreas: ['d7'], teachAreasConfirmed: true, availableFrom: null, expectedSalaryM: 40,
  subjects: ['general-english'], teachLanguages: [], ageGroups: ['kids'], experienceBand: '5-10-years', experience: [],
  degreeLevel: null, degreeMajor: '', degreeInstitution: '', degreeYear: null, certificates: [],
  fullName: 'Jane Doe', nationality: 'GB', englishLevel: 'native', languages: [], headline: 'CELTA-certified English teacher', bio: '',
  coverOpen: false, coverSlots: [], coverRateVnd: null, coverConsent: false, coverNotice: COVER_CONSENT_VERSION,
  photoUrl: 'https://sb.eno.vn/storage/v1/object/public/listings/a.webp', videoUrl: 'https://sb.eno.vn/storage/v1/object/public/listing-videos/1700000000001-abcd12.mp4', videoOnRequest: false, videoBase: 0,
  phone: PHONE, matchEmailOptIn: true, staffContactOptIn: true, publishNotice: PUBLISH_NOTICE_VERSION, aiNotice: AI_NOTICE_VERSION,
  cvUpload: TOKEN, cvFileName: 'cv.pdf',
  ...o,
})
/** A saved profile from before the phone was mandatory: no phone, job emails on, staff calls and cover off. */
const existing = (o: Row = {}): Row => ({
  id: 'tp1', listingId: 'L1', status: 'active', photoUrl: 'https://sb.eno.vn/storage/v1/object/public/listings/a.webp',
  createdAt: new Date('2026-10-12T00:00:00Z'), coverOpen: false, coverSlots: [], coverAreas: [], coverRateVnd: null,
  coverConsentAt: null, coverConsentVersion: null, coverConfirmedAt: null, coverWithdrawnAt: null, videoVersion: 0,
  yearsExperience: 6, teachAreas: ['d7'], teachAreasConfirmedAt: new Date('2026-10-12T00:00:00Z'),
  consentPublicVersion: PUBLISH_NOTICE_VERSION, consentPublicAt: new Date('2026-10-12T00:00:00Z'),
  matchEmailOptIn: true, matchEmailOptInAt: new Date('2026-10-12T00:00:00Z'), matchEmailNoticeVersion: AI_NOTICE_VERSION, matchEmailWithdrawnAt: null,
  // Staff calls off: since 2026-10-08 they needed a phone, so a saved profile without one never had them on.
  staffContactOptIn: false, staffContactOptInAt: null, staffContactNoticeVersion: null, staffContactWithdrawnAt: null,
  identityMarkOn: false, identityMarkWithdrawnAt: null,
  private: { phone: null },
  ...o,
})
const ME = { id: 'p1', email: 'jane@example.com' }
const create = (b: Row) => saveTeacherProfile(ME, b, { expectTeacherProfileId: null })
const edit = (b: Row) => saveTeacherProfile(ME, b, { expectTeacherProfileId: 'tp1' })
const errorsOf = async (p: Promise<unknown>): Promise<Record<string, string> | null> => {
  try { await p } catch (e) { if (e instanceof TeacherValidationError) return e.errors as Record<string, string>; throw e }
  return null
}
const nothingWritten = () => expect([h.privateWrites, h.profileWrites, h.listingWrites]).toEqual([[], [], []])

beforeEach(() => {
  h.existing = existing(); h.locked = undefined
  h.privateWrites = []; h.profileWrites = []; h.listingWrites = []; h.order = []; h.txOpts = []
  h.audits = []; h.auditRaw = []; h.auditFails = false; h.warns = []; h.cvPending = true
  saveTx.$executeRaw.mockClear()
})

describe('⛔ a NEW profile always has a phone (owner, 2026-10-22)', () => {
  beforeEach(() => { h.existing = null })

  it('a create without one: { phone: "required" } TOGETHER with the other answers — before anything is read under the lock', async () => {
    expect(await errorsOf(create(body({ phone: '', fullName: '' })))).toEqual({ phone: 'required', fullName: 'required' })
    expect(await errorsOf(create(body({ phone: '   ' })))).toEqual({ phone: 'required' })
    expect(h.order).toEqual([])
    nothingWritten()
  })

  it('junk is "invalid" on a create — fewer than 8 digits, or no digits at all', async () => {
    for (const junk of ['1234567', '........', '()()()()']) expect(await errorsOf(create(body({ phone: junk }))), junk).toEqual({ phone: 'invalid' })
    nothingWritten()
  })

  it('a caller that claims nothing (outside the PUT route) is held to it too — no row, no create', async () => {
    expect(await errorsOf(saveTeacherProfile(ME, body({ phone: '' })))).toEqual({ phone: 'required' })
    expect(h.order).toEqual([])
    nothingWritten()
  })

  it('…while ITS withdrawal on a saved no-phone profile is waived like an edit\'s — judged on the saved row, whoever sends it (commit gate, 2026-10-22)', async () => {
    h.existing = existing()
    const r = await saveTeacherProfile(ME, body({ phone: '', matchEmailOptIn: false, staffContactOptIn: false }))
    expect(r.created).toBe(false)
    expect(h.profileWrites[0].update).toMatchObject({ matchEmailOptIn: false })
    expect(h.privateWrites[0].update.phone).toBeNull()
    // …and a bio edit by it still asks for the phone
    h.profileWrites = []; h.privateWrites = []; h.listingWrites = []
    expect(await errorsOf(saveTeacherProfile(ME, body({ phone: '', bio: 'I love phonics.' })))).toEqual({ phone: 'required' })
    nothingWritten()
  })

  it('a create with one saves it, in the TeacherPrivate create', async () => {
    const r = await create(body())
    expect(r.created).toBe(true)
    expect(h.privateWrites[0].create.phone).toBe(PHONE)
  })
})

describe('⛔ an EDIT: the phone on its next save — a withdrawal never blocked (phoneWaived)', () => {
  it('a profile WITH a stored phone can never clear it — not even while switching something off', async () => {
    h.existing = existing({ private: { phone: '0901 234 567' } })
    expect(await errorsOf(edit(body({ phone: '' })))).toEqual({ phone: 'required' })
    expect(await errorsOf(edit(body({ phone: '', matchEmailOptIn: false })))).toEqual({ phone: 'required' })
    expect(h.order).toEqual([])
    nothingWritten()
  })

  it('a profile with none, saved with none and nothing withdrawn (a bio edit), is asked for it — refused before the lock', async () => {
    expect(await errorsOf(edit(body({ phone: '', bio: 'I love phonics.' })))).toEqual({ phone: 'required' })
    // switching something ON is no withdrawal
    h.existing = existing({ matchEmailOptIn: false })
    expect(await errorsOf(edit(body({ phone: '' })))).toEqual({ phone: 'required' })
    expect(h.order).toEqual([])
    nothingWritten()
  })

  it('…and saves once it carries one', async () => {
    await edit(body())
    expect(h.privateWrites[0].update.phone).toBe(PHONE)
  })

  it('a no-phone profile switching job emails OFF saves — the withdrawal stamped, no phone stored', async () => {
    const r = await edit(body({ phone: '', matchEmailOptIn: false, staffContactOptIn: false }))
    expect(r.created).toBe(false)
    expect(h.profileWrites[0].update).toMatchObject({ matchEmailOptIn: false, staffContactOptIn: false })
    expect(h.profileWrites[0].update.matchEmailWithdrawnAt).toBeInstanceOf(Date)
    expect(h.privateWrites[0].update.phone).toBeNull()
  })

  it('⛔ a no-phone profile REMOVING its public intro video saves — a withdrawal (owner, 2026-10-25: "Allow removal"); replacing it still asks for the phone', async () => {
    const STORED = 'https://sb.eno.vn/storage/v1/object/public/listing-videos/1700000000000-stored.mp4'
    h.existing = existing({ videoUrl: STORED })
    // (staff calls off, as stored — staff calls on is never waived)
    expect(await errorsOf(edit(body({ phone: '', staffContactOptIn: false })))).toEqual({ phone: 'required' }) // the body's new video replaces it
    nothingWritten()
    expect(await errorsOf(edit(body({ phone: '', staffContactOptIn: false, videoUrl: STORED })))).toEqual({ phone: 'required' }) // kept: nothing withdrawn
    const r = await edit(body({ phone: '', staffContactOptIn: false, videoUrl: null }))
    expect(r.created).toBe(false)
    expect(h.profileWrites[0].update.videoUrl).toBeNull()
    expect(h.privateWrites[0].update.phone).toBeNull()
  })

  it('a no-phone profile switching staff calls OFF saves too (one from before 2026-10-08, when they needed no number)', async () => {
    h.existing = existing({ staffContactOptIn: true, staffContactOptInAt: new Date('2026-10-01T00:00:00Z'), staffContactNoticeVersion: AI_NOTICE_VERSION })
    await edit(body({ phone: '', staffContactOptIn: false }))
    expect(h.profileWrites[0].update.staffContactWithdrawnAt).toBeInstanceOf(Date)
    expect(h.privateWrites[0].update.phone).toBeNull()
  })

  it('a no-phone profile that HIDES (no job type, cover off — D6) saves, and is hidden', async () => {
    // Nothing on to switch off (both opt-ins already off): the hide alone is the withdrawal.
    h.existing = existing({ matchEmailOptIn: false, staffContactOptIn: false })
    const r = await edit(body({ phone: '', jobTypes: [], relocate: '', expectedSalaryM: null, matchEmailOptIn: false, staffContactOptIn: false }))
    expect(r.noGoal).toBe(true)
    expect(h.profileWrites[0].update.status).toBe('hidden')
    expect(h.privateWrites[0].update.phone).toBeNull()
  })

  it('⛔ a WITHDRAWAL only: staff calls on — kept, or switched on beside a switch-off — need the number (commit gate, 2026-10-22)', async () => {
    // switched on in the same save as job emails off
    expect(await errorsOf(edit(body({ phone: '', matchEmailOptIn: false, staffContactOptIn: true })))).toEqual({ phone: 'required' })
    // kept on by a profile that had them (from before 2026-10-08) while job emails go off
    h.existing = existing({ staffContactOptIn: true, staffContactOptInAt: new Date('2026-10-01T00:00:00Z'), staffContactNoticeVersion: AI_NOTICE_VERSION })
    expect(await errorsOf(edit(body({ phone: '', matchEmailOptIn: false, staffContactOptIn: true })))).toEqual({ phone: 'required' })
    nothingWritten()
  })

  it('junk is never waived: a withdrawal with an "invalid" phone is refused with it', async () => {
    expect(await errorsOf(edit(body({ phone: '1234567', matchEmailOptIn: false })))).toEqual({ phone: 'invalid' })
    nothingWritten()
  })

  it('a no-phone profile switching cover lessons OFF saves — both job switches still on (checker, 2026-10-22)', async () => {
    const cover = { coverOpen: true, coverSlots: ['mon-am'], coverAreas: ['d7'], coverRateVnd: 350_000 }
    h.existing = existing({ ...cover, coverConsentAt: new Date('2026-10-12T00:00:00Z'), coverConsentVersion: COVER_CONSENT_VERSION, coverConfirmedAt: new Date('2026-10-12T00:00:00Z') })
    const r = await edit(body({ phone: '', staffContactOptIn: false, coverBase: coverStamp(cover) }))
    expect(r.created).toBe(false)
    expect(h.profileWrites[0].update).toMatchObject({ coverOpen: false, matchEmailOptIn: true, staffContactOptIn: false })
    expect(h.privateWrites[0].update.phone).toBeNull()
  })

  it('⛔ the waiver is judged AGAIN under the lock: a phone another tab added since the read is never wiped by a "withdrawal" with none', async () => {
    h.locked = existing({ private: { phone: '0901 234 567' } }) // committed between the read and the lock
    expect(await errorsOf(edit(body({ phone: '', matchEmailOptIn: false, staffContactOptIn: false })))).toEqual({ phone: 'required' })
    nothingWritten()
  })

  it('⛔ a waived edit whose profile vanished before the lock answers profile_changed — never a phone-less create', async () => {
    h.locked = null
    await expect(edit(body({ phone: '', matchEmailOptIn: false, staffContactOptIn: false }))).rejects.toBeInstanceOf(TeacherProfileChangedError)
    nothingWritten()
  })

  it('…and one whose profile was gone before the first read answers profile_changed too — "reload", not a phone error (commit gate, opus 2026-10-22)', async () => {
    h.existing = null
    await expect(edit(body({ phone: '', matchEmailOptIn: false, staffContactOptIn: false }))).rejects.toBeInstanceOf(TeacherProfileChangedError)
    nothingWritten()
  })
})

describe('⚖️ a default left on, on record — "teacher.optins.default" (owner, 2026-10-22)', () => {
  beforeEach(() => { h.existing = null })

  it('a CREATE that kept a switch at its default ON writes ONE row IN the save\'s transaction: which, under which AI notice, and that the form said so', async () => {
    const r = await create(body({ staffContactOptIn: false, optInDefaults: { matchEmail: true, staffCall: true } }))
    expect(r.created).toBe(true)
    expect(h.audits).toEqual([{
      actorType: 'user', actorId: 'p1', action: 'teacher.optins.default', subjectType: 'profile', subjectId: 'p1',
      detail: { matchEmail: true, staffCall: false, aiNotice: AI_NOTICE_VERSION, teacherProfileId: 'tp-new', source: 'form' },
    }])
    // ⛔ one transaction — the save's own (commit gate, 2026-10-22): no profile without its record
    expect(h.txOpts).toEqual([undefined])
  })

  it('both left on: both said', async () => {
    await create(body({ optInDefaults: { matchEmail: true, staffCall: true } }))
    expect(h.audits[0].detail).toMatchObject({ matchEmail: true, staffCall: true, source: 'form' })
  })

  it('⛔ CONSERVATIVE: a body that does not say (an older tab, another client) is recorded as defaults — "unreported" — never as deliberate opt-ins', async () => {
    await create(body())
    expect(h.audits[0].detail).toMatchObject({ matchEmail: true, staffCall: true, source: 'unreported' })
    h.audits = []; h.cvPending = true // another account's own upload, as it were
    await create(body({ optInDefaults: true }))
    expect(h.audits[0].detail).toMatchObject({ matchEmail: true, staffCall: true, source: 'unreported' })
  })

  it('NOT for a switch saved OFF, nor for one the form says the teacher touched (exactly false)', async () => {
    // (each create attaches a CV upload of its own: the pending token is set again before the next)
    await create(body({ matchEmailOptIn: false, staffContactOptIn: false, optInDefaults: { matchEmail: true, staffCall: true } }))
    h.cvPending = true
    await create(body({ optInDefaults: { matchEmail: false, staffCall: false } }))
    expect(h.audits).toEqual([])
    // anything but exactly false is no word that it was touched: still a default
    h.cvPending = true
    await create(body({ optInDefaults: { matchEmail: 'no', staffCall: 0 } }))
    expect(h.audits[0].detail).toMatchObject({ matchEmail: true, staffCall: true, source: 'form' })
  })

  it('NOT on an edit — the body field is ignored there (an existing profile was never flipped by a default)', async () => {
    h.existing = existing({ private: { phone: PHONE } })
    const r = await edit(body({ optInDefaults: { matchEmail: true, staffCall: true } }))
    expect(r.created).toBe(false)
    expect(h.audits).toEqual([])
  })

  it('NOT when the create is refused', async () => {
    await errorsOf(create(body({ phone: '', optInDefaults: { matchEmail: true, staffCall: true } })))
    expect(h.audits).toEqual([])
  })

  it('⛔ a record that cannot be written FAILS the create — rolled back, nothing saved (never a default stamp that reads as a deliberate opt-in)', async () => {
    h.auditFails = true
    await expect(create(body({ optInDefaults: { matchEmail: true, staffCall: false } }))).rejects.toThrow()
    nothingWritten()
  })

  it('…and the retry (the same Publish again) creates it with the SAME CV upload — its pending token outlived the rollback (commit gate, opus 2026-10-22)', async () => {
    h.auditFails = true
    await expect(create(body({ optInDefaults: { matchEmail: true, staffCall: false } }))).rejects.toThrow()
    expect(h.cvPending).toBe(true)
    h.auditFails = false
    const r = await create(body({ optInDefaults: { matchEmail: true, staffCall: false } }))
    expect(r.created).toBe(true)
    expect(h.privateWrites[0].create).toMatchObject({ cvFileName: 'cv.pdf', phone: PHONE })
    expect(h.privateWrites[0].create.cvPath).toEqual(expect.stringContaining(TOKEN))
    expect(h.cvPending).toBe(false)
    expect(h.audits).toEqual([expect.objectContaining({ action: 'teacher.optins.default' })])
  })
})
