import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The server-saved teacher draft (owner, 2026-10-11: "every step they input should be saved and able to resume when they
 * want to") — src/lib/teachers/draft.ts. An in-memory TeacherDraft table stands in for Postgres; the transaction runs its
 * callback, so these test the RULES: what a draft may hold, the revision every save compares and bumps, the publish's
 * lock, the 90-day retention and the dashboard's metadata.
 */
type Row = { profileId: string; data: unknown; step: string; rev: number; gen?: string; createdAt: Date; updatedAt: Date }
const h = vi.hoisted(() => ({ rows: new Map<string, Row>(), teacher: false, locks: [] as unknown[] }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/log', () => ({ logError: () => {} }))
vi.mock('@/lib/db', () => {
  const draft = {
    findUnique: async ({ where }: { where: { profileId: string } }) => h.rows.get(where.profileId) ?? null,
    createMany: async ({ data: [row] }: { data: Row[]; skipDuplicates: boolean }) => {
      if (h.rows.has(row.profileId)) return { count: 0 }
      h.rows.set(row.profileId, { ...row })
      return { count: 1 }
    },
    updateMany: async ({ where, data }: { where: { profileId: string; rev: number; gen?: string }; data: Partial<Row> }) => {
      const r = h.rows.get(where.profileId)
      if (!r || r.rev !== where.rev || (where.gen !== undefined && r.gen !== where.gen)) return { count: 0 }
      Object.assign(r, data)
      return { count: 1 }
    },
    deleteMany: async ({ where }: { where: { profileId?: string; rev?: number; gen?: string; updatedAt?: { lt: Date } } }) => {
      let count = 0
      for (const [k, r] of h.rows) {
        const byProfile = where.profileId !== undefined && k === where.profileId && (where.rev === undefined || r.rev === where.rev)
          && (where.gen === undefined || r.gen === where.gen)
        if (byProfile || (where.updatedAt && r.updatedAt < where.updatedAt.lt)) { h.rows.delete(k); count++ }
      }
      return { count }
    },
  }
  const tx = {
    $executeRaw: async (...a: unknown[]) => { h.locks.push(a); return 1 },
    teacherProfile: { findUnique: async () => (h.teacher ? { id: 'tp1' } : null) },
    teacherDraft: draft,
  }
  return { db: { teacherDraft: draft, $transaction: async (cb: (t: typeof tx) => unknown) => cb(tx) } }
})

const { draftDataOf, saveTeacherDraft, readTeacherDraft, deleteTeacherDraft, purgeStaleTeacherDrafts, teacherDraftProgress, teacherDraftExportOf, TEACHER_DRAFT_MAX_BYTES } = await import('./draft')

/** An HCMC full-time job seeker, steps 1–4 answered — and every field a draft must NEVER keep, set. */
const answers = (o: Record<string, unknown> = {}) => ({
  livesIn: 'city', currentCity: 'ho-chi-minh-city', currentDistrictKey: 'd7', currentProvince: '', jobTypes: ['fulltime'], relocate: 'no',
  teachAreas: ['d7'], teachAreasConfirmed: true, availableFrom: null, expectedSalaryM: 40,
  subjects: ['general-english'], teachLanguages: [], ageGroups: ['kids'], experienceBand: '5-10-years', experience: [],
  degreeLevel: null, degreeMajor: '', degreeInstitution: '', degreeYear: null, certificates: [],
  fullName: 'Jane Doe', nationality: 'GB', englishLevel: 'native', languages: [], headline: 'CELTA-certified English teacher', bio: '',
  coverOpen: true, coverSlots: ['mon-am'], coverRateVnd: 300_000, coverConsent: true,
  photoUrl: 'https://sb.eno.vn/storage/v1/object/public/listings/a.webp', videoUrl: 'https://x/v.mp4', videoOnRequest: false,
  phone: '+84 901 234 567', matchEmailOptIn: true, staffContactOptIn: true,
  ...o,
})

beforeEach(() => { h.rows.clear(); h.teacher = false; h.locks = [] })

describe('what a draft may hold', () => {
  it('⛔ never a consent, an upload, the cover switch or the phone — the rest of the answers stay', () => {
    const d = draftDataOf(answers())
    expect([d.coverOpen, d.coverConsent, d.matchEmailOptIn, d.staffContactOptIn]).toEqual([false, false, false, false])
    expect([d.photoUrl, d.videoUrl, d.phone]).toEqual([null, null, ''])
    expect([d.fullName, d.expectedSalaryM, d.coverRateVnd, d.coverSlots]).toEqual(['Jane Doe', 40, 300_000, ['mon-am']])
  })
  it('a stored row is re-cleaned on every read', async () => {
    h.rows.set('p1', { profileId: 'p1', data: answers(), step: 'teaching', rev: 3, createdAt: new Date(), updatedAt: new Date() })
    const d = await readTeacherDraft('p1')
    expect(d?.t.phone).toBe('')
    expect(d?.t.coverConsent).toBe(false)
    expect(d?.rev).toBe(3)
  })
})

describe('the revision — two tabs or devices never overwrite each other, a late save never resurrects', () => {
  const first = async (p = 'p1', step = 'where') => {
    const r = await saveTeacherDraft(p, { t: answers(), step, rev: 0 })
    if (!r.ok) throw new Error('first save refused')
    return r
  }
  it('first save (rev 0) creates rev 1 with its generation; the next names both and gets rev 2', async () => {
    const r1 = await first()
    expect(r1).toMatchObject({ ok: true, rev: 1 })
    expect(await saveTeacherDraft('p1', { t: answers(), step: 'teaching', rev: 1, gen: r1.gen })).toMatchObject({ ok: true, rev: 2, gen: r1.gen })
    expect(h.rows.get('p1')?.step).toBe('teaching')
  })
  it('⛔ a second device\'s FIRST save, after another one got there: stale — never an overwrite', async () => {
    await first()
    expect(await saveTeacherDraft('p1', { t: answers({ fullName: 'Other' }), step: 'plans', rev: 0 })).toEqual({ ok: false, reason: 'stale' })
    expect((h.rows.get('p1')?.data as { fullName: string }).fullName).toBe('Jane Doe')
  })
  it('⛔ a save based on an older revision: stale', async () => {
    const r1 = await first()
    await saveTeacherDraft('p1', { t: answers(), step: 'teaching', rev: 1, gen: r1.gen })
    expect(await saveTeacherDraft('p1', { t: answers(), step: 'where', rev: 1, gen: r1.gen })).toEqual({ ok: false, reason: 'stale' })
  })
  it('⛔ ABA: the same revision number of a draft made AGAIN (after a Start over elsewhere) is not the old one — stale', async () => {
    const old = await first()
    await saveTeacherDraft('p1', { t: answers(), step: 'teaching', rev: 1, gen: old.gen }) // the laptop saw rev 2 of the old draft
    await deleteTeacherDraft('p1')
    const fresh = await first('p1', 'plans') // the phone starts over …
    await saveTeacherDraft('p1', { t: answers({ fullName: 'Phone' }), step: 'where', rev: 1, gen: fresh.gen }) // … and is at rev 2 too
    expect(await saveTeacherDraft('p1', { t: answers({ fullName: 'Laptop' }), step: 'about', rev: 2, gen: old.gen })).toEqual({ ok: false, reason: 'stale' })
    expect((h.rows.get('p1')?.data as { fullName: string }).fullName).toBe('Phone')
    expect(fresh.gen).not.toBe(old.gen) // a random id: never a clock's millisecond
    expect(await deleteTeacherDraft('p1', { rev: 2, gen: old.gen })).toBe('stale')
  })
  it('⛔ a save after Start over (or publish, or retention): gone — the draft is not brought back', async () => {
    const r1 = await first()
    await deleteTeacherDraft('p1')
    expect(await saveTeacherDraft('p1', { t: answers(), step: 'teaching', rev: 1, gen: r1.gen })).toEqual({ ok: false, reason: 'gone' })
    expect(h.rows.has('p1')).toBe(false)
  })
  it('⛔ under the publish\'s lock: once a profile exists, refused — nothing written', async () => {
    h.teacher = true
    expect(await saveTeacherDraft('p1', { t: answers(), step: 'where', rev: 0 })).toEqual({ ok: false, reason: 'teacher_exists' })
    expect(h.rows.size).toBe(0)
    expect(JSON.stringify(h.locks[0])).toContain('teacher:p1')
  })
  it('refuses a body with no revision, no generation on top of a draft, no answers — and an empty answer set', async () => {
    expect(await saveTeacherDraft('p1', { t: answers(), step: 'where' })).toEqual({ ok: false, reason: 'bad_request' })
    expect(await saveTeacherDraft('p1', { t: answers(), step: 'where', rev: 1 })).toEqual({ ok: false, reason: 'bad_request' })
    expect(await saveTeacherDraft('p1', { t: answers(), step: 'where', rev: 1, gen: 'yesterday' })).toEqual({ ok: false, reason: 'bad_request' })
    expect(await saveTeacherDraft('p1', { t: answers(), step: 'where', rev: 1, gen: '2026-10-10T08:00:00.000Z' })).toEqual({ ok: false, reason: 'bad_request' })
    expect(await saveTeacherDraft('p1', { step: 'where', rev: 0 })).toEqual({ ok: false, reason: 'bad_request' })
    expect(await saveTeacherDraft('p1', { t: {}, step: 'plans', rev: 0 })).toEqual({ ok: false, reason: 'bad_request' })
    expect(h.rows.size).toBe(0)
  })
  it('the byte cap is a backstop a real teacher never meets: every field is capped first, the fullest answer set fits', async () => {
    const huge = answers({
      bio: 'Ừ'.repeat(10_000), headline: 'Ừ'.repeat(500), fullName: 'Ừ'.repeat(500),
      experience: Array.from({ length: 50 }, () => ({ role: 'Ừ'.repeat(300), employer: 'Ừ'.repeat(300), city: 'Ừ'.repeat(300), from: '2020-01', to: '2024-06' })),
      certificates: Array.from({ length: 50 }, () => ({ type: 'celta', hours: 120, provider: 'Ừ'.repeat(300), year: 2019 })),
    })
    expect(Buffer.byteLength(JSON.stringify(draftDataOf(huge)), 'utf8')).toBeLessThan(TEACHER_DRAFT_MAX_BYTES)
    expect(await saveTeacherDraft('p1', { t: huge, step: 'about', rev: 0 })).toMatchObject({ ok: true })
  })
  it('⛔ Start over takes the save\'s lock — a first save holding it lands before the delete, never after', async () => {
    await first()
    h.locks = []
    await deleteTeacherDraft('p1')
    expect(JSON.stringify(h.locks[0])).toContain('teacher:p1')
    expect(h.rows.has('p1')).toBe(false)
  })
})

describe('retention, the dashboard and the export', () => {
  it('deletes drafts untouched for 90 days — and only those', async () => {
    const now = new Date('2026-12-31T00:00:00Z')
    h.rows.set('old', { profileId: 'old', data: {}, step: 'plans', rev: 1, createdAt: now, updatedAt: new Date('2026-10-01T00:00:00Z') })
    h.rows.set('new', { profileId: 'new', data: {}, step: 'plans', rev: 1, createdAt: now, updatedAt: new Date('2026-10-03T00:00:00Z') })
    expect(await purgeStaleTeacherDrafts(now)).toBe(1)
    expect([...h.rows.keys()]).toEqual(['new'])
  })
  it('the dashboard gets "Step X of Y" only — where the form will reopen (never past the first failing step)', async () => {
    // saved on Photo & publish, but a draft has no photo: it reopens there, the last of the six steps
    await saveTeacherDraft('p1', { t: answers(), step: 'finish', rev: 0 })
    expect(await teacherDraftProgress('p1')).toEqual({ index: 6, total: 6 })
    // a draft whose "Where you teach" is incomplete reopens on it, wherever it was left
    await saveTeacherDraft('p2', { t: answers({ teachAreas: [], teachAreasConfirmed: false }), step: 'about', rev: 0 })
    expect(await teacherDraftProgress('p2')).toEqual({ index: 2, total: 6 })
    expect(await teacherDraftProgress('none')).toBeNull()
  })
  it('the export carries the draft as stored', async () => {
    await saveTeacherDraft('p1', { t: answers(), step: 'teaching', rev: 0 })
    const e = await teacherDraftExportOf('p1')
    expect(e?.step).toBe('teaching')
    expect(e?.answers.fullName).toBe('Jane Doe')
    expect(e?.answers.phone).toBe('')
  })
})

describe('the dashboard never fails on a draft', () => {
  it('an unreadable draft (no table yet, a bad row) costs only the Continue row', async () => {
    const { db } = await import('@/lib/db')
    const spy = vi.spyOn(db.teacherDraft, 'findUnique').mockRejectedValueOnce(new Error('relation "TeacherDraft" does not exist'))
    expect(await teacherDraftProgress('p1')).toBeNull()
    spy.mockRestore()
  })
})

describe('Start over deletes only the revision the tab saw (commit gate, 2026-10-11)', () => {
  it('⛔ a newer revision saved elsewhere is not deleted unseen: stale', async () => {
    const r1 = await saveTeacherDraft('p1', { t: answers(), step: 'where', rev: 0 })
    if (!r1.ok) throw new Error('refused')
    await saveTeacherDraft('p1', { t: answers(), step: 'teaching', rev: 1, gen: r1.gen }) // another device: rev 2
    expect(await deleteTeacherDraft('p1', { rev: 1, gen: r1.gen })).toBe('stale')
    expect(h.rows.get('p1')?.rev).toBe(2)
    expect(await deleteTeacherDraft('p1', { rev: 2, gen: r1.gen })).toBe('deleted')
    expect(h.rows.has('p1')).toBe(false)
  })
  it('nothing there is nothing to refuse; no revision deletes whatever is there', async () => {
    expect(await deleteTeacherDraft('p1', { rev: 3, gen: '00000000-0000-4000-8000-000000000000' })).toBe('deleted')
    await saveTeacherDraft('p1', { t: answers(), step: 'where', rev: 0 })
    expect(await deleteTeacherDraft('p1')).toBe('deleted')
    expect(h.rows.has('p1')).toBe(false)
  })
})
