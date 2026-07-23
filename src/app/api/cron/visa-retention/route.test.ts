import { beforeEach, describe, expect, it, vi } from 'vitest'

// The PDPD retention sweep. The three review-driven invariants under test (dual plan
// review 2026-07-23): fail-CLOSED object removal (a storage failure must keep the row so
// the case stays re-sweepable), the terminal-status gate (a live case with a mistakenly
// expired retention_until is skipped + counted, never deleted), and drain-the-backlog
// batching. Auth is probed first with every data call counted, result.test.ts-style.

const h = vi.hoisted(() => ({
  state: {
    secret: 'cron-secret' as string | undefined,
    /** Batches the expired-case query returns, consumed one per call. */
    expiredBatches: [] as Array<Array<{ id: string }>>,
    /** storage_paths per application id. */
    docs: {} as Record<string, string[]>,
    docListError: null as { code?: string } | null,
    removeFailsFor: null as string | null, // a storage_path that makes strict removal throw
    counts: { skippedNonTerminal: 0, remaining: 0 },
    // recorders
    queries: 0,
    removed: [] as string[][],
    rowDeletes: [] as string[],
    deleteGate: null as unknown, // the .in() filter carried by the DELETE itself
    events: [] as string[], // interleaved remove/delete order
    statusFilter: null as unknown,
  },
}))

vi.mock('@/lib/visa/db', () => ({
  getVisaDb: () => ({
    from: (table: string) => {
      const ctx: { head?: boolean; nonTerminal?: boolean; appId?: string } = {}
      const api = {
        select: (_cols: string, opts?: { count?: string; head?: boolean }) => {
          ctx.head = opts?.head
          return api
        },
        in: (_col: string, values: unknown) => {
          h.state.statusFilter = values
          return api
        },
        not: (col: string, _op: string, val: unknown) => {
          // The drift-alarm count NEGATES the status filter via .not('status','in',...)
          if (col === 'status') ctx.nonTerminal = true
          void val
          return api
        },
        lt: () => api,
        order: () => api,
        eq: (_col: string, value: string) => {
          ctx.appId = value
          return api
        },
        limit: async () => {
          h.state.queries += 1
          return { data: h.state.expiredBatches.shift() ?? [], error: null }
        },
        delete: () => ({
          eq: (_col: string, id: string) => ({
            in: async (_c: string, statuses: unknown) => {
              h.state.deleteGate = statuses
              h.state.rowDeletes.push(id)
              h.state.events.push(`delete:${id}`)
              return { error: null }
            },
          }),
        }),
        // Awaiting the builder itself terminates the two head-count queries and the
        // visa_documents list (which ends on .eq without .limit).
        then: (resolve: (v: unknown) => unknown) => {
          if (table === 'visa_documents') {
            h.state.queries += 1
            if (h.state.docListError) return resolve({ data: null, error: h.state.docListError })
            return resolve({ data: (h.state.docs[ctx.appId ?? ''] ?? []).map((p) => ({ storage_path: p })), error: null })
          }
          h.state.queries += 1
          return resolve({ count: ctx.nonTerminal ? h.state.counts.skippedNonTerminal : h.state.counts.remaining, error: null })
        },
      }
      return api
    },
  }),
}))
vi.mock('@/lib/visa/storage', () => ({
  removeVisaFiles: async (paths: string[], opts?: { strict?: boolean }) => {
    if (h.state.removeFailsFor && paths.includes(h.state.removeFailsFor)) {
      if (opts?.strict) throw new Error('visa_storage_remove_failed')
      return false
    }
    h.state.removed.push(paths)
    h.state.events.push(`remove:${paths.join(',')}`)
    return true
  },
}))

import { GET } from './route'

const req = (auth?: string) =>
  new Request('https://eno.vn/api/cron/visa-retention', { headers: auth ? { authorization: auth } : {} })

beforeEach(() => {
  const s = h.state
  s.secret = 'cron-secret'
  process.env.CRON_SECRET = 'cron-secret'
  s.expiredBatches = []
  s.docs = {}
  s.docListError = null
  s.removeFailsFor = null
  s.counts = { skippedNonTerminal: 0, remaining: 0 }
  s.queries = 0
  s.removed = []
  s.rowDeletes = []
  s.deleteGate = null
  s.events = []
  s.statusFilter = null
})

describe('cron/visa-retention', () => {
  it('refuses a missing or wrong bearer BEFORE any data call', async () => {
    for (const auth of [undefined, 'Bearer wrong', 'cron-secret']) {
      const res = await GET(req(auth))
      expect(res.status).toBe(401)
    }
    expect(h.state.queries).toBe(0)
  })

  it('refuses when CRON_SECRET is unset — never an open cron', async () => {
    delete process.env.CRON_SECRET
    const res = await GET(req('Bearer cron-secret'))
    expect(res.status).toBe(401)
    expect(h.state.queries).toBe(0)
  })

  it('deletes an expired terminal case: objects FIRST, then the row', async () => {
    h.state.expiredBatches = [[{ id: 'case-1' }]]
    h.state.docs['case-1'] = ['u1/case-1/passport.jpg', 'u1/case-1/result.pdf']
    const res = await GET(req('Bearer cron-secret'))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, deleted: 1, failed: 0 })
    expect(h.state.removed).toEqual([['u1/case-1/passport.jpg', 'u1/case-1/result.pdf']])
    expect(h.state.rowDeletes).toEqual(['case-1'])
    // ORDER is the invariant: objects verified gone BEFORE the row (fail-closed).
    expect(h.state.events).toEqual(['remove:u1/case-1/passport.jpg,u1/case-1/result.pdf', 'delete:case-1'])
    // Both the SELECT and the DELETE itself carry the terminal gate (TOCTOU lock).
    expect(h.state.statusFilter).toEqual(['approved', 'rejected', 'cancelled'])
    expect(h.state.deleteGate).toEqual(['approved', 'rejected', 'cancelled'])
  })

  it('keeps the row when object removal fails — the case stays re-sweepable', async () => {
    h.state.expiredBatches = [[{ id: 'case-1' }]]
    h.state.docs['case-1'] = ['u1/case-1/passport.jpg']
    h.state.removeFailsFor = 'u1/case-1/passport.jpg'
    const res = await GET(req('Bearer cron-secret'))
    expect(await res.json()).toMatchObject({ ok: true, deleted: 0, failed: 1 })
    expect(h.state.rowDeletes).toEqual([]) // ⚠️ fail-CLOSED: no row delete after a storage failure
  })

  it('keeps the row when the document LIST fails — "could not look" is not "none"', async () => {
    h.state.expiredBatches = [[{ id: 'case-1' }]]
    h.state.docListError = { code: '500' }
    const res = await GET(req('Bearer cron-secret'))
    expect(await res.json()).toMatchObject({ deleted: 0, failed: 1 })
    expect(h.state.rowDeletes).toEqual([])
  })

  it('drains multiple full batches instead of starving at the first 100', async () => {
    const batchOf = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => ({ id: `${prefix}-${i}` }))
    h.state.expiredBatches = [batchOf('a', 100), batchOf('b', 40)]
    const res = await GET(req('Bearer cron-secret'))
    expect(await res.json()).toMatchObject({ deleted: 140, failed: 0 })
    expect(h.state.rowDeletes).toHaveLength(140)
  })

  it('stops at a zero-progress batch instead of churning the same failing heads to the cap', async () => {
    // Failed rows are KEPT and stay at the head of oldest-first order — a full-batch
    // failure must break the loop, not re-query the same heads MAX_BATCHES times.
    h.state.expiredBatches = Array.from({ length: 20 }, () => [{ id: 'stuck-1' }, { id: 'stuck-2' }])
    h.state.docs['stuck-1'] = ['u/stuck-1/p.jpg']
    h.state.docs['stuck-2'] = ['u/stuck-2/p.jpg']
    h.state.removeFailsFor = 'u/stuck-1/p.jpg'
    h.state.docListError = null
    // Make BOTH cases fail: the second via list error is not possible per-case here, so
    // fail both removals by pointing at a shared path prefix — simplest: fail stuck-2 too.
    const origRemoveFailsFor = h.state.removeFailsFor
    void origRemoveFailsFor
    h.state.removeFailsFor = 'u/stuck-1/p.jpg'
    h.state.docs['stuck-2'] = ['u/stuck-1/p.jpg'] // same failing path
    const res = await GET(req('Bearer cron-secret'))
    expect(await res.json()).toMatchObject({ deleted: 0, failed: 2 })
    // ONE batch consumed (19 canned batches left) — no churn to MAX_BATCHES.
    expect(h.state.expiredBatches).toHaveLength(19)
    expect(h.state.rowDeletes).toEqual([])
  })

  it('reports the drift alarm and the leftover backlog without acting on either', async () => {
    h.state.counts = { skippedNonTerminal: 3, remaining: 7 }
    const res = await GET(req('Bearer cron-secret'))
    expect(await res.json()).toMatchObject({ deleted: 0, skippedNonTerminal: 3, remaining: 7 })
    expect(h.state.rowDeletes).toEqual([])
  })
})
