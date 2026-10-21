import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The job-messages switch (owner, 2026-10-20) — src/lib/teachers/job-dms/consent.ts. Pinned: the evidence each act writes
// (an ON: when + the notice; an OFF: when, the last grant kept as history; a repeat writes nothing); an ON only under the
// notice the page SHOWED and only with a teacher profile (live or hidden), refused before anything is read or written; an
// OFF never refused; every write under the teacher's job-DM lock, taken FIRST; and the server's withdrawal (STOP) as a
// compare-and-set that answers true once. The database is an in-memory fake — nothing reaches a real one.
type Row = { optIn: boolean; optInAt: Date | null; noticeVersion: string | null; withdrawnAt: Date | null; invitedAt: Date | null; updatedAt?: Date }
const h = vi.hoisted(() => ({
  rows: new Map<string, Row>(),
  teachers: new Map<string, { status: string; listingId?: string | null; listing?: { status: string; verified: boolean } | null }>(),
  /** what enrolDefaultOn's selection returns (the fake cannot evaluate a Prisma where) */
  candidates: [] as string[],
  wheres: [] as unknown[],
  /** Every database step, in order: 'begin', 'lock_timeout', 'lock', 'teacher', 'read', 'create', 'update', 'updateMany', 'commit'. */
  calls: [] as string[],
  lockKeys: [] as string[],
}))
vi.mock('@/lib/db', () => {
  const tx = {
    $executeRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join('?')
      if (sql.includes('pg_advisory_xact_lock')) { h.calls.push('lock'); h.lockKeys.push(String(values[0])) }
      else if (sql.includes('lock_timeout')) h.calls.push('lock_timeout')
      else h.calls.push('sql')
      return 1
    },
    teacherProfile: {
      findUnique: async ({ where }: { where: { profileId: string } }) => { h.calls.push('teacher'); return h.teachers.get(where.profileId) ?? null },
      findMany: async ({ where }: { where: unknown }) => { h.calls.push('select'); h.wheres.push(where); return h.candidates.map((profileId) => ({ profileId })) },
    },
    teacherJobDmConsent: {
      findUnique: async ({ where }: { where: { profileId: string } }) => {
        h.calls.push('read')
        const r = h.rows.get(where.profileId)
        return r ? { ...r } : null
      },
      create: async ({ data }: { data: Partial<Row> & { profileId: string } }) => {
        h.calls.push('create')
        if (h.rows.has(data.profileId)) throw Object.assign(new Error('unique'), { code: 'P2002' })
        const { profileId, ...rest } = data
        const row: Row = { optIn: false, optInAt: null, noticeVersion: null, withdrawnAt: null, invitedAt: null, ...rest }
        h.rows.set(profileId, row)
        return { ...row }
      },
      update: async ({ where, data }: { where: { profileId: string }; data: Partial<Row> }) => {
        h.calls.push('update')
        const r = h.rows.get(where.profileId)
        if (!r) throw Object.assign(new Error('missing'), { code: 'P2025' })
        Object.assign(r, data)
        return { ...r }
      },
      upsert: async ({ where, create, update }: { where: { profileId: string }; create: Partial<Row> & { profileId: string }; update: Partial<Row> }) => {
        h.calls.push('upsert')
        const r = h.rows.get(where.profileId)
        if (r) { Object.assign(r, update); return { ...r } }
        const { profileId, ...rest } = create
        const fresh: Row = { optIn: false, optInAt: null, noticeVersion: null, withdrawnAt: null, invitedAt: null, ...rest }
        h.rows.set(profileId, fresh)
        return { ...fresh }
      },
      createMany: async ({ data, skipDuplicates }: { data: (Partial<Row> & { profileId: string })[]; skipDuplicates?: boolean }) => {
        h.calls.push('createMany')
        let count = 0
        for (const { profileId, ...rest } of data) {
          if (h.rows.has(profileId)) { if (skipDuplicates) continue; throw Object.assign(new Error('unique'), { code: 'P2002' }) }
          h.rows.set(profileId, { optIn: false, optInAt: null, noticeVersion: null, withdrawnAt: null, invitedAt: null, ...rest })
          count++
        }
        return { count }
      },
      updateMany: async ({ where, data }: { where: Record<string, unknown> & { profileId: string | { in: string[] } }; data: Partial<Row> }) => {
        h.calls.push('updateMany')
        const ids = typeof where.profileId === 'string' ? [where.profileId] : where.profileId.in
        let count = 0
        for (const id of ids) {
          const r = h.rows.get(id) as Record<string, unknown> | undefined
          if (!r || Object.entries(where).some(([k, v]) => k !== 'profileId' && r[k] !== v)) continue
          Object.assign(r, data)
          count++
        }
        return { count }
      },
    },
  }
  return {
    db: {
      ...tx,
      $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => {
        h.calls.push('begin')
        const out = await fn(tx)
        h.calls.push('commit')
        return out
      },
    },
  }
})

const { JOB_DM_DEFAULT_ON, JOB_DM_NOTICE_VERSION } = await import('./constants')
const {
  JobDmNoTeacherProfileError, JobDmNoticeChangedError, enrolDefaultOn, jobDmConsentWrites, jobDmConsented, jobDmLockKey, jobDmStateOf,
  readJobDmState, setJobDmConsent, withdrawJobDms,
} = await import('./consent')

const NOW = new Date('2026-10-20T03:00:00.000Z')
const EARLIER = new Date('2026-10-10T03:00:00.000Z')
const OLD_NOTICE = '2026-10-01'
const row = (o: Partial<Row> = {}): Row => ({ optIn: false, optInAt: null, noticeVersion: null, withdrawnAt: null, invitedAt: null, ...o })

beforeEach(() => {
  h.rows.clear(); h.teachers.clear(); h.calls = []; h.lockKeys = []; h.candidates = []; h.wheres = []
  h.teachers.set('p1', { status: 'live' })
})
afterEach(() => { vi.restoreAllMocks() })

describe('jobDmConsentWrites — the evidence each act writes (pure)', () => {
  it('an ON over nothing: the switch, its time and the notice it was given under', () => {
    expect(jobDmConsentWrites(true, null, NOW)).toEqual({ optIn: true, optInAt: NOW, noticeVersion: JOB_DM_NOTICE_VERSION, pausedAt: null, updatedAt: NOW })
  })
  it('an ON over an ON under today’s notice writes NOTHING — the grant on record stays the first one', () => {
    expect(jobDmConsentWrites(true, row({ optIn: true, optInAt: EARLIER, noticeVersion: JOB_DM_NOTICE_VERSION }), NOW)).toBeNull()
  })
  it('an ON over an older notice’s ON, or over an OFF, is a FRESH grant: both stamps move', () => {
    for (const stored of [row({ optIn: true, optInAt: EARLIER, noticeVersion: OLD_NOTICE }), row({ optIn: false, optInAt: EARLIER, noticeVersion: JOB_DM_NOTICE_VERSION, withdrawnAt: EARLIER })]) {
      expect(jobDmConsentWrites(true, stored, NOW)).toEqual({ optIn: true, optInAt: NOW, noticeVersion: JOB_DM_NOTICE_VERSION, pausedAt: null, updatedAt: NOW })
    }
  })
  it('⛔ an OFF over an ON stamps the withdrawal and KEEPS the last grant (its time and notice are history)', () => {
    const w = jobDmConsentWrites(false, row({ optIn: true, optInAt: EARLIER, noticeVersion: JOB_DM_NOTICE_VERSION }), NOW)
    expect(w).toEqual({ optIn: false, withdrawnAt: NOW, updatedAt: NOW })
    expect(w).not.toHaveProperty('optInAt')
    expect(w).not.toHaveProperty('noticeVersion')
  })
  it('an OFF over an OFF writes nothing (no second withdrawal time)', () => {
    expect(jobDmConsentWrites(false, row({ withdrawnAt: EARLIER, optInAt: EARLIER, noticeVersion: JOB_DM_NOTICE_VERSION }), NOW)).toBeNull()
  })
  it('⛔ an OFF over no row, or over the invite\'s row, writes an OFF — default-on would switch "never chose" on', () => {
    expect(jobDmConsentWrites(false, null, NOW)).toEqual({ optIn: false, withdrawnAt: NOW, updatedAt: NOW })
    expect(jobDmConsentWrites(false, row({ invitedAt: EARLIER }), NOW)).toEqual({ optIn: false, withdrawnAt: NOW, updatedAt: NOW })
  })
  it('an OFF over eno\'s default-on withdraws it; an ON over it is the teacher\'s own grant, recorded as such', () => {
    const enrolled = row({ optIn: true, optInAt: EARLIER, noticeVersion: JOB_DM_DEFAULT_ON })
    expect(jobDmConsentWrites(false, enrolled, NOW)).toEqual({ optIn: false, withdrawnAt: NOW, updatedAt: NOW })
    expect(jobDmConsentWrites(true, enrolled, NOW)).toEqual({ optIn: true, optInAt: NOW, noticeVersion: JOB_DM_NOTICE_VERSION, pausedAt: null, updatedAt: NOW })
  })
  it('an ON over an ON under today\'s notice lifts a PAUSE, and writes nothing else', () => {
    expect(jobDmConsentWrites(true, { optIn: true, noticeVersion: JOB_DM_NOTICE_VERSION, pausedAt: NOW }, NOW)).toEqual({ optInAt: NOW, pausedAt: null, updatedAt: NOW })
    expect(jobDmConsentWrites(true, { optIn: true, noticeVersion: JOB_DM_NOTICE_VERSION, pausedAt: null }, NOW)).toBeNull()
  })
})

describe('jobDmConsented — the one gate', () => {
  it('true ONLY for an ON under the notice in force — the teacher\'s own, or eno\'s default-on — and not paused', () => {
    expect(jobDmConsented({ optIn: true, noticeVersion: JOB_DM_NOTICE_VERSION })).toBe(true)
    expect(jobDmConsented({ optIn: true, noticeVersion: JOB_DM_DEFAULT_ON })).toBe(true)
    // ⚠️ default-on did not bump the notice: a teacher who switched on under it stays on (codex + opus, gate 11a)
    expect(JOB_DM_NOTICE_VERSION).toBe('2026-10-20')
    expect(jobDmConsented({ optIn: true, noticeVersion: '2026-10-20' })).toBe(true)
    expect(jobDmConsented({ optIn: true, noticeVersion: JOB_DM_DEFAULT_ON, pausedAt: NOW })).toBe(false)
    expect(jobDmConsented({ optIn: false, noticeVersion: JOB_DM_DEFAULT_ON })).toBe(false)
    expect(jobDmConsented({ optIn: true, noticeVersion: OLD_NOTICE })).toBe(false)
    expect(jobDmConsented({ optIn: true, noticeVersion: null })).toBe(false)
    expect(jobDmConsented({ optIn: false, noticeVersion: JOB_DM_NOTICE_VERSION })).toBe(false)
    expect(jobDmConsented(null)).toBe(false)
    expect(jobDmConsented(undefined)).toBe(false)
  })
  it('the page’s state says ON-but-lapsed apart from ON', () => {
    expect(jobDmStateOf({ optIn: true, noticeVersion: OLD_NOTICE }, true)).toEqual({ on: true, noticeVersion: OLD_NOTICE, current: false, teacher: true, paused: false })
    expect(jobDmStateOf(null, false)).toEqual({ on: false, noticeVersion: null, current: false, teacher: false, paused: false })
  })
  it('a default-on teacher who never chose is drawn ON; their own OFF, or a teacher not default-on, is not', () => {
    const on = { on: true, noticeVersion: null, current: true, teacher: true, paused: false }
    expect(jobDmStateOf(null, true, true)).toEqual(on)
    expect(jobDmStateOf(row({ invitedAt: EARLIER }), true, true)).toEqual(on)
    expect(jobDmStateOf(row({ withdrawnAt: EARLIER }), true, true)).toEqual({ on: false, noticeVersion: null, current: false, teacher: true, paused: false })
    expect(jobDmStateOf(null, true, false)).toEqual({ on: false, noticeVersion: null, current: false, teacher: true, paused: false })
  })
  it('⚠️ the lock key is the one desk.ts sendJobDm takes first in its batch — `teacher-job-dm:` + the profile id', () => {
    expect(jobDmLockKey('p1')).toBe('teacher-job-dm:p1')
  })
})

describe('setJobDmConsent — the switch', () => {
  it('⛔ an ON under any notice but the one in force is refused BEFORE anything is read or written', async () => {
    for (const shown of [OLD_NOTICE, '', null, undefined, 20261020, { v: JOB_DM_NOTICE_VERSION }]) {
      await expect(setJobDmConsent('p1', true, shown), String(shown)).rejects.toBeInstanceOf(JobDmNoticeChangedError)
    }
    expect(h.calls).toEqual([])
    expect(h.rows.size).toBe(0)
  })

  it('⛔ an ON needs a teacher profile — none: refused, nothing written', async () => {
    h.teachers.clear()
    await expect(setJobDmConsent('p1', true, JOB_DM_NOTICE_VERSION)).rejects.toBeInstanceOf(JobDmNoTeacherProfileError)
    expect(h.rows.size).toBe(0)
    expect(h.calls).not.toContain('create')
  })

  it('a first ON records the evidence — under the teacher’s job-DM lock, taken FIRST in the transaction', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    try {
      const s = await setJobDmConsent('p1', true, JOB_DM_NOTICE_VERSION)
      expect(s).toEqual({ on: true, noticeVersion: JOB_DM_NOTICE_VERSION, current: true, teacher: true, paused: false })
      expect(h.rows.get('p1')).toMatchObject({ optIn: true, optInAt: NOW, noticeVersion: JOB_DM_NOTICE_VERSION, withdrawnAt: null })
      expect(h.calls).toEqual(['begin', 'lock_timeout', 'lock', 'teacher', 'read', 'upsert', 'commit'])
      expect(h.lockKeys).toEqual(['teacher-job-dm:p1'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('a HIDDEN profile may switch it on too (hidden by the teacher, not gone)', async () => {
    h.teachers.set('p1', { status: 'hidden' })
    expect((await setJobDmConsent('p1', true, JOB_DM_NOTICE_VERSION)).current).toBe(true)
  })

  it('an ON over an ON under today’s notice writes nothing — the first grant’s time stays', async () => {
    h.rows.set('p1', row({ optIn: true, optInAt: EARLIER, noticeVersion: JOB_DM_NOTICE_VERSION }))
    const s = await setJobDmConsent('p1', true, JOB_DM_NOTICE_VERSION)
    expect(s.current).toBe(true)
    expect(h.rows.get('p1')?.optInAt).toEqual(EARLIER)
    expect(h.calls).not.toContain('update')
  })

  it('an ON over an older notice re-stamps it under today’s; the last withdrawal stays as history', async () => {
    h.rows.set('p1', row({ optIn: false, optInAt: EARLIER, noticeVersion: OLD_NOTICE, withdrawnAt: EARLIER, invitedAt: EARLIER }))
    const s = await setJobDmConsent('p1', true, JOB_DM_NOTICE_VERSION)
    expect(s).toEqual({ on: true, noticeVersion: JOB_DM_NOTICE_VERSION, current: true, teacher: true, paused: false })
    const r = h.rows.get('p1')!
    expect(r.noticeVersion).toBe(JOB_DM_NOTICE_VERSION)
    expect(r.optInAt!.getTime()).toBeGreaterThan(EARLIER.getTime())
    expect(r.withdrawnAt).toEqual(EARLIER)
    expect(r.invitedAt).toEqual(EARLIER)
  })

  it('⛔ an OFF stamps the withdrawal and keeps the grant as history', async () => {
    h.rows.set('p1', row({ optIn: true, optInAt: EARLIER, noticeVersion: JOB_DM_NOTICE_VERSION }))
    const s = await setJobDmConsent('p1', false, null)
    expect(s).toEqual({ on: false, noticeVersion: JOB_DM_NOTICE_VERSION, current: false, teacher: true, paused: false })
    const r = h.rows.get('p1')!
    expect(r.optIn).toBe(false)
    expect(r.withdrawnAt).toBeInstanceOf(Date)
    expect(r.optInAt).toEqual(EARLIER)
    expect(r.noticeVersion).toBe(JOB_DM_NOTICE_VERSION)
    expect(h.calls.indexOf('lock')).toBeLessThan(h.calls.indexOf('update'))
  })

  it('⛔ an OFF is NEVER refused — whatever notice it carries, and with no teacher profile left', async () => {
    for (const shown of [OLD_NOTICE, null, undefined, 42]) {
      h.rows.set('p1', row({ optIn: true, optInAt: EARLIER, noticeVersion: JOB_DM_NOTICE_VERSION }))
      expect((await setJobDmConsent('p1', false, shown)).on, String(shown)).toBe(false)
    }
    h.teachers.clear()
    h.rows.set('p1', row({ optIn: true, optInAt: EARLIER, noticeVersion: JOB_DM_NOTICE_VERSION }))
    expect(await setJobDmConsent('p1', false, undefined)).toEqual({ on: false, noticeVersion: JOB_DM_NOTICE_VERSION, current: false, teacher: false, paused: false })
    expect(h.rows.get('p1')?.optIn).toBe(false)
  })

  it('⛔ an OFF from a teacher with no row writes an OFF row — so no later run switches them on (default-on)', async () => {
    h.teachers.set('p1', { status: 'live', listingId: 'l1', listing: { status: 'active', verified: true } })
    expect((await readJobDmState('p1')).current).toBe(true)
    const s = await setJobDmConsent('p1', false, null)
    expect(s).toEqual({ on: false, noticeVersion: null, current: false, teacher: true, paused: false })
    expect(h.rows.get('p1')).toMatchObject({ optIn: false, withdrawnAt: expect.any(Date), optInAt: null })
    expect(h.calls.indexOf('lock')).toBeLessThan(h.calls.indexOf('upsert'))
  })

  it('an OFF over an OFF writes nothing more', async () => {
    h.rows.set('p1', row({ withdrawnAt: EARLIER }))
    await setJobDmConsent('p1', false, null)
    expect(h.rows.get('p1')?.withdrawnAt).toEqual(EARLIER)
    expect(h.calls.filter((c) => ['upsert', 'update'].includes(c))).toEqual([])
  })

  it('readJobDmState reads only', async () => {
    h.rows.set('p1', row({ optIn: true, optInAt: EARLIER, noticeVersion: OLD_NOTICE }))
    expect(await readJobDmState('p1')).toEqual({ on: true, noticeVersion: OLD_NOTICE, current: false, teacher: true, paused: false })
    expect(h.calls.filter((c) => ['create', 'update', 'updateMany'].includes(c))).toEqual([])
  })
})

describe('withdrawJobDms — the server’s withdrawal (a STOP reply)', () => {
  it('⛔ a compare-and-set: true for the call that flipped it, false for every later one — the same evidence as an OFF', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    h.rows.set('p1', row({ optIn: true, optInAt: EARLIER, noticeVersion: JOB_DM_NOTICE_VERSION }))
    expect(await withdrawJobDms('p1', 'stop_reply')).toBe(true)
    expect(await withdrawJobDms('p1', 'stop_reply')).toBe(false)
    const r = h.rows.get('p1')!
    expect(r).toMatchObject({ optIn: false, optInAt: EARLIER, noticeVersion: JOB_DM_NOTICE_VERSION })
    expect(r.withdrawnAt).toBeInstanceOf(Date)
    // Logged with the id and the reason only — once.
    expect(info).toHaveBeenCalledTimes(1)
    expect(info.mock.calls[0]).toEqual(['[job-dms] withdrawn', { profileId: 'p1', why: 'stop_reply' }])
  })

  it('an OFF row, or none, is left as it is', async () => {
    expect(await withdrawJobDms('p1', 'quick_reply')).toBe(false)
    h.rows.set('p1', row({ withdrawnAt: EARLIER }))
    expect(await withdrawJobDms('p1', 'quick_reply')).toBe(false)
    expect(h.rows.get('p1')?.withdrawnAt).toEqual(EARLIER)
  })

  it('takes the teacher’s lock first — unless the caller passes the transaction that already holds it', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {})
    h.rows.set('p1', row({ optIn: true, optInAt: EARLIER, noticeVersion: JOB_DM_NOTICE_VERSION }))
    await withdrawJobDms('p1', 'support')
    expect(h.calls).toEqual(['begin', 'lock_timeout', 'lock', 'updateMany', 'commit'])
    h.calls = []
    h.rows.set('p1', row({ optIn: true, optInAt: EARLIER, noticeVersion: JOB_DM_NOTICE_VERSION }))
    const { db } = await import('@/lib/db')
    expect(await withdrawJobDms('p1', 'stop_reply', { tx: db as never, now: NOW })).toBe(true)
    expect(h.calls).toEqual(['updateMany'])
    expect(h.rows.get('p1')?.withdrawnAt).toEqual(NOW)
  })
})

describe('enrolDefaultOn — eno switches job messages on for who never chose (owner, 2026-10-21)', () => {
  it('an ON row stamped now + JOB_DM_DEFAULT_ON over no row and over the invite\'s row; an OFF and an own ON stay', async () => {
    h.rows.set('invited', row({ invitedAt: EARLIER }))
    h.rows.set('off', row({ optIn: false, withdrawnAt: EARLIER }))
    h.rows.set('own', row({ optIn: true, optInAt: EARLIER, noticeVersion: JOB_DM_NOTICE_VERSION }))
    // 'off' and 'own' in the selection too: a switch made between the selection and the writes (the writes re-check)
    h.candidates = ['new', 'invited', 'off', 'own']
    expect(await enrolDefaultOn(NOW)).toBe(2)
    for (const id of ['new', 'invited']) expect(h.rows.get(id)).toMatchObject({ optIn: true, optInAt: NOW, noticeVersion: JOB_DM_DEFAULT_ON, withdrawnAt: null })
    expect(h.rows.get('off')).toMatchObject({ optIn: false, withdrawnAt: EARLIER, optInAt: null })
    expect(h.rows.get('own')).toMatchObject({ optIn: true, optInAt: EARLIER, noticeVersion: JOB_DM_NOTICE_VERSION })
  })
  it('selects live default-on teachers with no row or the invite\'s row; nobody → no write', async () => {
    expect(await enrolDefaultOn(NOW)).toBe(0)
    expect(h.wheres[0]).toMatchObject({
      status: 'live', listing: { status: 'active', verified: true },
      profile: { OR: [{ teacherJobDmConsent: { is: null } }, { teacherJobDmConsent: { is: { optIn: false, optInAt: null, withdrawnAt: null } } }] },
    })
    expect(h.calls).toEqual(['select'])
  })
})
