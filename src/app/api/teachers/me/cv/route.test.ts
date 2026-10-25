import { beforeEach, describe, expect, it, vi } from 'vitest'

// The signed-in teacher's CV (2026-09-30; required for a new profile 2026-10-22..25, optional since — constants.ts history):
//   · POST `?pending=1` — the join form's upload BEFORE its first Publish: no profile read, TeacherPrivate never written,
//     the object TOMBSTONED FIRST ('teacher_cv_pending') and then uploaded, the answer its token (publish.ts attaches it);
//   · POST — the edit form's upload after its save: attached at once, the replaced CV tombstoned — as before;
//   · DELETE — removes the saved CV, whenever the profile was created (owner, 2026-10-25: "Allow removal").
type Row = Record<string, any>
const h = vi.hoisted(() => ({
  tp: null as Row | null,
  order: [] as string[],
  tombstones: [] as Array<{ refs: Row[]; reason: string }>,
  uploads: [] as Array<{ path: string; bytes: number }>,
  uploadOk: true,
  privateWrites: [] as Row[],
  profileReads: 0,
  /** The rate-limit buckets asked, in order, and the ones that refuse. */
  limits: [] as string[],
  deny: [] as string[],
  /** TeacherPrivate under the lock when it differs from the profile read before (another tab's commit); undefined: the same. */
  current: undefined as Row | null | undefined,
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/admin', () => ({ getCurrentProfile: async () => ({ id: 'p1', email: 't@example.com' }), getCurrentProfileId: async () => 'p1', getAdmin: async () => null, isAdminEmail: () => false }))
vi.mock('@/lib/ratelimit', () => ({
  rateLimit: async (bucket: string) => { h.limits.push(bucket); return { success: !h.deny.includes(bucket), resetSec: 0 } },
  kv: { set: async () => 'OK', get: async () => null },
}))
vi.mock('@/lib/log', () => ({ logError: vi.fn() }))
vi.mock('@/lib/core/storage-tombstones', () => ({
  writeTombstones: async (_tx: unknown, refs: Row[], reason: string) => { h.order.push(`tombstone ${reason}`); h.tombstones.push({ refs, reason }); return refs.length },
}))
// The real checks (the %PDF- sniff, the file name, the path); only the storage is stood in for.
vi.mock('@/lib/teachers/cv-store', async (orig) => ({
  ...(await orig<typeof import('@/lib/teachers/cv-store')>()),
  uploadTeacherCv: async (path: string, bytes: Buffer) => { h.order.push('upload'); h.uploads.push({ path, bytes: bytes.length }); return h.uploadOk },
}))
const tx = {
  $executeRaw: async () => { h.order.push('lock') },
  storageTombstone: { deleteMany: async ({ where }: Row) => { h.order.push(`untombstone ${where.path}`); return { count: 1 } } },
  teacherPrivate: {
    // The row AS IT IS under the lock — another tab's commit can have moved it since the read before the transaction.
    findUnique: async () => { h.order.push('teacherPrivate.read'); return h.current !== undefined ? h.current : (h.tp?.private ?? null) },
    upsert: async (a: Row) => { h.order.push('teacherPrivate.upsert'); h.privateWrites.push(a) },
    update: async (a: Row) => { h.order.push('teacherPrivate.update'); h.privateWrites.push(a) },
  },
}
vi.mock('@/lib/db', () => ({
  db: {
    teacherProfile: { findUnique: async ({ where }: Row) => { h.profileReads++; return where.profileId === 'p1' ? h.tp : null } },
    $transaction: async (cb: (t: typeof tx) => unknown) => cb(tx),
  },
}))

const { POST, DELETE } = await import('./route')
const { isCvUploadToken } = await import('@/lib/teachers/constants')

const PDF = new Uint8Array(Buffer.from('%PDF-1.7\n1 0 obj << /Type /Page >> endobj\n%%EOF', 'latin1'))
const post = (qs: string, file: Uint8Array | null = PDF, name = 'Jane CV <final>.pdf') => {
  const fd = new FormData()
  if (file) fd.set('file', new File([new Uint8Array(file)], name, { type: 'application/pdf' }))
  return POST(new Request(`https://eno.vn/api/teachers/me/cv${qs}`, { method: 'POST', body: fd }) as never, {} as never)
}
const del = () => DELETE(new Request('https://eno.vn/api/teachers/me/cv', { method: 'DELETE' }) as never, {} as never)
const profile = (o: Row = {}) => ({ id: 'tp1', createdAt: new Date('2026-10-01T00:00:00Z'), private: { cvPath: 'p1/old.pdf' }, ...o })

beforeEach(() => {
  h.tp = null; h.order = []; h.tombstones = []; h.uploads = []; h.uploadOk = true; h.privateWrites = []; h.profileReads = 0; h.limits = []; h.deny = []; h.current = undefined
})

describe('POST ?pending=1 — the join form\'s CV, before its first Publish', () => {
  it('⛔ needs no profile, TOMBSTONES the object BEFORE uploading it, writes no TeacherPrivate, and answers its token', async () => {
    const res = await post('?pending=1')
    expect(res.status).toBe(200)
    const d = await res.json() as Row
    expect(d).toMatchObject({ ok: true, cvFileName: 'Jane CV final.pdf' })
    expect(isCvUploadToken(d.cvUpload)).toBe(true)
    const path = `p1/${d.cvUpload}.pdf` // under the caller's own Profile id — the ownership proof
    expect(h.order).toEqual(['tombstone teacher_cv_pending', 'upload'])
    expect(h.tombstones).toEqual([{ refs: [{ bucket: 'teacher-cvs', path }], reason: 'teacher_cv_pending' }])
    expect(h.uploads).toEqual([{ path, bytes: PDF.length }])
    expect(h.profileReads).toBe(0)
    expect(h.privateWrites).toEqual([])
    // Only the token leaves — never the path.
    expect(JSON.stringify(d)).not.toContain('p1/')
  })
  it('⛔ open to any signed-in account, so it has limits of its own — the account\'s six an hour, then the connection\'s day — before anything is read', async () => {
    await post('?pending=1')
    expect(h.limits).toEqual(['teacher-cv', 'teacher-cv-pending', 'teacher-cv-pending-ip'])
    // The account's own limit is "you" (429); the connection's day cap is "busy on this network" (503) — a school's Wi-Fi
    // or a carrier's shared address must never read as the teacher's fault.
    for (const [bucket, status, error] of [['teacher-cv-pending', 429, 'rate_limited'], ['teacher-cv-pending-ip', 503, 'cv_capacity']] as const) {
      h.limits = []; h.deny = [bucket]; h.order = []; h.uploads = []
      const res = await post('?pending=1')
      expect(res.status, bucket).toBe(status)
      expect(await res.json()).toEqual({ error })
      expect(h.order, bucket).toEqual([]) // nothing tombstoned, nothing stored
      expect(h.uploads).toEqual([])
    }
    // The edit form's attach-at-once upload keeps its one bucket.
    h.limits = []; h.deny = []; h.tp = profile()
    await post('')
    expect(h.limits).toEqual(['teacher-cv'])
  })
  it('a fresh token every time', async () => {
    const a = (await (await post('?pending=1')).json() as Row).cvUpload
    const b = (await (await post('?pending=1')).json() as Row).cvUpload
    expect(a).not.toBe(b)
  })
  it('⛔ never attaches to a profile that exists (another tab published meanwhile): still no profile read, no TeacherPrivate', async () => {
    h.tp = profile()
    expect((await post('?pending=1')).status).toBe(200)
    expect(h.profileReads).toBe(0)
    expect(h.privateWrites).toEqual([])
    expect(h.tombstones.map((t) => t.reason)).toEqual(['teacher_cv_pending'])
  })
  it('a storage failure: 502 cv_store_failed — and the tombstone STAYS, so the sweep collects whatever was stored', async () => {
    h.uploadOk = false
    const res = await post('?pending=1')
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: 'cv_store_failed' })
    expect(h.order).toEqual(['tombstone teacher_cv_pending', 'upload'])
    expect(h.privateWrites).toEqual([])
  })
  it('the same checks as every upload — not a PDF 415, too big 413, no file 400 — and NOTHING tombstoned or stored', async () => {
    const notPdf = await post('?pending=1', new Uint8Array(Buffer.from('PK\u0003\u0004 word document')), 'cv.pdf')
    expect(notPdf.status).toBe(415)
    expect(await notPdf.json()).toEqual({ error: 'cv_type' })
    const big = new Uint8Array(10 * 1024 * 1024 + 1)
    big.set(PDF)
    const tooBig = await post('?pending=1', big)
    expect(tooBig.status).toBe(413)
    expect(await tooBig.json()).toEqual({ error: 'cv_size' })
    const none = await post('?pending=1', null)
    expect(none.status).toBe(400)
    expect(await none.json()).toEqual({ error: 'bad_request' })
    expect(h.order).toEqual([])
  })
})

describe('POST — the edit form\'s CV, after its save (unchanged)', () => {
  it('attaches at once: TOMBSTONED FIRST, uploaded, then — in one transaction — the replaced CV tombstoned, TeacherPrivate pointed at the new one and its pending row deleted; no token', async () => {
    h.tp = profile()
    const res = await post('')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, cvFileName: 'Jane CV final.pdf' })
    const path = h.uploads[0].path
    expect(path).toMatch(/^p1\/[0-9a-f-]{36}\.pdf$/)
    expect(h.order).toEqual(['tombstone teacher_cv_pending', 'upload', 'lock', 'teacherPrivate.read', 'tombstone teacher_cv_replaced', 'teacherPrivate.upsert', `untombstone ${path}`])
    expect(h.tombstones).toEqual([
      { refs: [{ bucket: 'teacher-cvs', path }], reason: 'teacher_cv_pending' },
      { refs: [{ bucket: 'teacher-cvs', path: 'p1/old.pdf' }], reason: 'teacher_cv_replaced' },
    ])
    expect(h.privateWrites[0]).toMatchObject({ update: { cvPath: path, cvFileName: 'Jane CV final.pdf' } })
  })
  it('⛔ two tabs replacing at once: the CV displaced is the one there UNDER THE LOCK — never the older one read before, which would leave the other tab\'s new file with no record', async () => {
    h.tp = profile() // read before: p1/old.pdf
    h.current = { cvPath: 'p1/from-the-other-tab.pdf' } // committed meanwhile by the other tab
    expect((await post('')).status).toBe(200)
    expect(h.tombstones.filter((t) => t.reason === 'teacher_cv_replaced')).toEqual([{ refs: [{ bucket: 'teacher-cvs', path: 'p1/from-the-other-tab.pdf' }], reason: 'teacher_cv_replaced' }])
  })
  it('⛔ a storage failure on the edit upload leaves its pending row for the sweep — never an object with no record', async () => {
    h.tp = profile(); h.uploadOk = false
    const res = await post('')
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: 'cv_store_failed' })
    expect(h.order).toEqual(['tombstone teacher_cv_pending', 'upload'])
    expect(h.privateWrites).toEqual([])
  })
  it('⛔ a profile created since the cutoff REPLACES its CV here — never blocked', async () => {
    h.tp = profile({ createdAt: new Date('2026-10-30T00:00:00Z') })
    expect((await post('')).status).toBe(200)
    expect(h.privateWrites).toHaveLength(1)
  })
  it('no profile and no `pending=1` (any other value included): 404 teacher_profile_missing, before the body is read', async () => {
    for (const qs of ['', '?pending=0', '?pending=true']) {
      const res = await post(qs)
      expect(res.status, qs).toBe(404)
      expect(await res.json()).toEqual({ error: 'teacher_profile_missing' })
    }
    expect(h.order).toEqual([])
  })
})

describe('DELETE — the saved CV', () => {
  it('⛔ any profile removes it — created after the old 23 October cutoff, before it, or with no creation time: tombstoned, both columns cleared', async () => {
    for (const createdAt of [new Date('2026-10-23T00:00:00+07:00'), new Date('2026-10-25T09:00:00+07:00'), new Date('2026-10-22T23:59:59+07:00'), null]) {
      h.tp = profile({ createdAt }); h.tombstones = []; h.privateWrites = []
      const res = await del()
      expect(res.status, String(createdAt)).toBe(200)
      expect(h.tombstones).toEqual([{ refs: [{ bucket: 'teacher-cvs', path: 'p1/old.pdf' }], reason: 'teacher_cv_replaced' }])
      expect(h.privateWrites).toEqual([{ where: { teacherProfileId: 'tp1' }, data: { cvPath: null, cvFileName: null } }])
    }
  })
  it('⛔ removes the CV there UNDER THE LOCK — a newer one another tab attached meanwhile is the one tombstoned, never cleared with only the older recorded', async () => {
    h.tp = profile() // read before: p1/old.pdf
    h.current = { cvPath: 'p1/newer.pdf' }
    expect((await del()).status).toBe(200)
    expect(h.tombstones).toEqual([{ refs: [{ bucket: 'teacher-cvs', path: 'p1/newer.pdf' }], reason: 'teacher_cv_replaced' }])
    expect(h.order).toEqual(['lock', 'teacherPrivate.read', 'tombstone teacher_cv_replaced', 'teacherPrivate.update'])
    // …and one removed meanwhile is already gone: 404 cv_missing, nothing written.
    h.tombstones = []; h.privateWrites = []; h.order = []
    h.current = { cvPath: null }
    const gone = await del()
    expect(gone.status).toBe(404)
    expect(await gone.json()).toEqual({ error: 'cv_missing' })
    expect(h.tombstones).toEqual([])
    expect(h.privateWrites).toEqual([])
  })
  it('no CV: 404 cv_missing (before the cutoff rule — there is nothing to keep); no profile: 404 teacher_profile_missing', async () => {
    h.tp = profile({ createdAt: new Date('2026-10-30T00:00:00Z'), private: { cvPath: null } })
    const missing = await del()
    expect(missing.status).toBe(404)
    expect(await missing.json()).toEqual({ error: 'cv_missing' })
    h.tp = null
    const none = await del()
    expect(none.status).toBe(404)
    expect(await none.json()).toEqual({ error: 'teacher_profile_missing' })
  })
})
