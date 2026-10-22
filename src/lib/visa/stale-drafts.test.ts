import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

// The abandoned-draft expiry (security review 2026-10-22, item 30). What must hold: only an UNPAID DRAFT idle by every
// measure is cancelled — a recent upload (which bumps no application timestamp), a recent event, a paid payment row or
// a row that moved under the cancel all keep it; "could not look" keeps it too; and drafts kept for activity do not
// starve the ones behind them. The fake below EVALUATES the filters the code sends, over in-memory tables, so the tests
// assert outcomes rather than the shape of a query chain.

type Row = Record<string, unknown>

const h = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  selectErrors: {} as Record<string, { code: string } | undefined>,
  updateError: undefined as { code: string } | undefined,
  /** Runs just before an UPDATE executes — a concurrent writer landing between the read and the cancel. */
  beforeUpdate: null as null | (() => void),
  recorded: [] as Row[],
  eventThrows: false,
  logged: [] as unknown[],
}))

vi.mock('@/lib/visa/records', () => ({
  recordVisaEvent: async (applicationId: string, actorType: string, event: string, actorRef?: string, metadata?: Row) => {
    if (h.eventThrows) throw new Error('visa_event_failed:down')
    h.recorded.push({ applicationId, actorType, event, actorRef, metadata })
  },
}))
vi.mock('@/lib/log', () => ({ logError: (...args: unknown[]) => { h.logged.push(args) } }))

const { expireStaleVisaDrafts, STALE_DRAFT_DAYS } = await import('./stale-drafts')

const time = (v: unknown) => Date.parse(String(v))

function fakeDb(): SupabaseClient {
  return {
    from(table: string) {
      const filters: Array<(r: Row) => boolean> = []
      let op: 'select' | 'update' = 'select'
      let patch: Row = {}
      let orderBy: string | null = null
      let limit = Infinity
      const run = () => {
        if (op === 'update') h.beforeUpdate?.()
        const error = op === 'select' ? h.selectErrors[table] : h.updateError
        if (error) return { data: null, error }
        let rows = (h.tables[table] ?? []).filter((r) => filters.every((f) => f(r)))
        if (orderBy) rows = [...rows].sort((a, b) => time(a[orderBy!]) - time(b[orderBy!]))
        rows = rows.slice(0, limit)
        if (op === 'update') for (const r of rows) Object.assign(r, patch)
        return { data: rows.map((r) => ({ ...r })), error: null }
      }
      const b = {
        select: () => b,
        update: (p: Row) => { op = 'update'; patch = p; return b },
        eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return b },
        is: (c: string, v: unknown) => { filters.push((r) => (r[c] ?? null) === v); return b },
        in: (c: string, vs: unknown[]) => { filters.push((r) => vs.includes(r[c])); return b },
        lt: (c: string, v: unknown) => { filters.push((r) => r[c] != null && time(r[c]) < time(v)); return b },
        gt: (c: string, v: unknown) => { filters.push((r) => r[c] != null && time(r[c]) > time(v)); return b },
        gte: (c: string, v: unknown) => { filters.push((r) => r[c] != null && time(r[c]) >= time(v)); return b },
        order: (c: string) => { orderBy = c; return b },
        limit: async (n: number) => { limit = n; return run() },
        maybeSingle: async () => { const r = run(); return { data: r.data?.[0] ?? null, error: r.error } },
        then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(run()).then(resolve, reject),
      }
      return b
    },
  } as unknown as SupabaseClient
}

const NOW = new Date('2026-10-22T00:00:00.000Z')
const ago = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString()

function draft(id: string, over: Row = {}): Row {
  return { id, status: 'draft', paid_at: null, updated_at: ago(40), last_applicant_action_at: ago(40), resolved_at: null, retention_until: null, ...over }
}
const app = (id: string) => h.tables.visa_applications.find((r) => r.id === id)!

beforeEach(() => {
  h.tables = { visa_applications: [], visa_documents: [], visa_events: [], visa_payments: [] }
  h.selectErrors = {}
  h.updateError = undefined
  h.beforeUpdate = null
  h.recorded = []
  h.eventThrows = false
  h.logged = []
})

describe('expireStaleVisaDrafts', () => {
  it('cancels an unpaid draft idle by every measure, retention now — the sweep deletes it next run', async () => {
    h.tables.visa_applications.push(draft('idle'))
    h.tables.visa_documents.push({ application_id: 'idle', created_at: ago(39) }) // the passport scan, uploaded long ago
    const r = await expireStaleVisaDrafts(fakeDb(), NOW)
    expect(r).toEqual({ expired: 1, failed: 0 })
    expect(app('idle')).toMatchObject({ status: 'cancelled', retention_until: NOW.toISOString(), resolved_at: NOW.toISOString() })
    expect(h.recorded).toEqual([
      { applicationId: 'idle', actorType: 'system', event: 'application_cancelled', actorRef: undefined, metadata: { reason: 'idle', idleDays: STALE_DRAFT_DAYS } },
    ])
  })

  it('leaves a draft inside the window by updated_at or by the last applicant action', async () => {
    h.tables.visa_applications.push(
      draft('edited', { updated_at: ago(STALE_DRAFT_DAYS - 1) }),
      draft('acted', { last_applicant_action_at: ago(5) }),
    )
    expect(await expireStaleVisaDrafts(fakeDb(), NOW)).toEqual({ expired: 0, failed: 0 })
    expect(app('edited').status).toBe('draft')
    expect(app('acted').status).toBe('draft')
  })

  it('a recent UPLOAD keeps a draft whose application timestamps are old — the upload commit bumps neither', async () => {
    h.tables.visa_applications.push(draft('uploading'))
    h.tables.visa_documents.push({ application_id: 'uploading', created_at: ago(2) })
    expect(await expireStaleVisaDrafts(fakeDb(), NOW)).toEqual({ expired: 0, failed: 0 })
    expect(app('uploading').status).toBe('draft')
  })

  it('a recent event of either side keeps it (a refused upload counts as activity)', async () => {
    h.tables.visa_applications.push(draft('trying'))
    h.tables.visa_events.push({ application_id: 'trying', created_at: ago(10) })
    expect((await expireStaleVisaDrafts(fakeDb(), NOW)).expired).toBe(0)
    expect(app('trying').status).toBe('draft')
  })

  it('never touches a paid case — by paid_at or by a paid payment row', async () => {
    h.tables.visa_applications.push(draft('paid-flag', { paid_at: ago(35) }), draft('paid-row'))
    h.tables.visa_payments.push({ application_id: 'paid-row', status: 'paid' })
    expect((await expireStaleVisaDrafts(fakeDb(), NOW)).expired).toBe(0)
    expect(app('paid-flag').status).toBe('draft')
    expect(app('paid-row').status).toBe('draft')
  })

  it('an abandoned UNPAID checkout row does not keep a draft alive', async () => {
    h.tables.visa_applications.push(draft('abandoned-checkout'))
    h.tables.visa_payments.push({ application_id: 'abandoned-checkout', status: 'created' })
    expect((await expireStaleVisaDrafts(fakeDb(), NOW)).expired).toBe(1)
  })

  it('only drafts: a stale case in any other status is the desk\'s, not this job\'s', async () => {
    for (const status of ['needs_changes', 'ready_for_review', 'under_review', 'processing', 'cancelled']) {
      h.tables.visa_applications.push(draft(`s-${status}`, { status }))
    }
    expect((await expireStaleVisaDrafts(fakeDb(), NOW)).expired).toBe(0)
    expect(h.tables.visa_applications.every((r) => r.retention_until === null)).toBe(true)
  })

  it('a row edited between the read and the cancel is left alone (CAS on updated_at)', async () => {
    h.tables.visa_applications.push(draft('raced'))
    h.beforeUpdate = () => { app('raced').updated_at = NOW.toISOString() }
    expect(await expireStaleVisaDrafts(fakeDb(), NOW)).toEqual({ expired: 0, failed: 0 })
    expect(app('raced').status).toBe('draft')
    expect(h.recorded).toEqual([])
  })

  it('"could not look" keeps the page: an activity lookup error cancels nothing and is counted', async () => {
    h.tables.visa_applications.push(draft('a'), draft('b'))
    h.selectErrors.visa_documents = { code: '500' }
    expect(await expireStaleVisaDrafts(fakeDb(), NOW)).toEqual({ expired: 0, failed: 2 })
    expect(app('a').status).toBe('draft')
  })

  it('a failed candidate query throws (the cron answers a loud 500)', async () => {
    h.selectErrors.visa_applications = { code: '57014' }
    await expect(expireStaleVisaDrafts(fakeDb(), NOW)).rejects.toThrow('stale_draft_query_failed:57014')
  })

  it('a failed cancel write is counted, not fatal', async () => {
    h.tables.visa_applications.push(draft('a'))
    h.updateError = { code: '40001' }
    expect(await expireStaleVisaDrafts(fakeDb(), NOW)).toEqual({ expired: 0, failed: 1 })
  })

  it('an audit-event failure does not undo or hide the cancel', async () => {
    h.tables.visa_applications.push(draft('a'))
    h.eventThrows = true
    expect(await expireStaleVisaDrafts(fakeDb(), NOW)).toEqual({ expired: 1, failed: 0 })
    expect(app('a').status).toBe('cancelled')
    expect(h.logged).toHaveLength(1)
  })

  it('drafts kept for activity do not starve the idle ones behind them (keyset, not re-reading the head)', async () => {
    // 150 active drafts with the OLDEST updated_at — they fill the first page and stay drafts — then one idle draft.
    for (let i = 0; i < 150; i++) {
      const id = `busy-${i}`
      h.tables.visa_applications.push(draft(id, { updated_at: new Date(NOW.getTime() - 300 * 86_400_000 + i * 1000).toISOString() }))
      h.tables.visa_documents.push({ application_id: id, created_at: ago(1) })
    }
    h.tables.visa_applications.push(draft('behind', { updated_at: ago(60), last_applicant_action_at: ago(60) }))
    expect(await expireStaleVisaDrafts(fakeDb(), NOW)).toEqual({ expired: 1, failed: 0 })
    expect(app('behind').status).toBe('cancelled')
    expect(h.tables.visa_applications.filter((r) => r.status === 'draft')).toHaveLength(150)
  })
})
