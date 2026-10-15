import { beforeEach, describe, expect, it, vi } from 'vitest'

// The cron that re-derives the teacher card's "Identity verified" tick at 00:05 ICT — the reconcile's card-tick pass run
// ALONE (src/lib/compliance/identity-reconcile.ts reconcileIdentityMarks — its own rules are tested there). Pinned here:
// it runs only behind the cron secret; it calls the marks pass and NOTHING ELSE (never the full reconcile, whose trust and
// enforcement steps can send a notice); ?dryRun reaches it as asked and FAILS SAFE; a failure is a 500 partial_failure
// with `failed` right after the error; a clean run is a 200 whose first 200 bytes carry the counts.
type Row = Record<string, any>
const h = vi.hoisted(() => ({
  calls: [] as Array<{ fn: string; opts: Record<string, any> }>,
  result: null as Record<string, any> | null,
  throws: null as Error | null,
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/compliance/identity-reconcile', () => ({
  reconcileIdentityMarks: async (opts: Record<string, any>) => {
    h.calls.push({ fn: 'reconcileIdentityMarks', opts })
    if (h.throws) throw h.throws
    return h.result
  },
  reconcileIdentities: async (opts: Record<string, any>) => {
    h.calls.push({ fn: 'reconcileIdentities', opts })
    return { checked: 0, recomputed: 0, changed: 0, failed: 0, illegal: 0, trustMoved: 0, purged: 0, marks: { checked: 0, changed: 0, purged: 0, failed: 0 } }
  },
}))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => ({ success: true }) }))
vi.mock('@/lib/log', () => ({ logError: () => {} }))

const { GET } = await import('./route')
const req = (query = '', auth: string | undefined = 'Bearer cron-secret') =>
  new Request(`https://eno.vn/api/cron/identity-marks${query}`, { headers: auth ? { authorization: auth } : {} })
const run = async (query = '', auth?: string) => {
  const res = await GET(req(query, auth))
  return { status: res.status, body: (await res.json()) as Row }
}
const CLEAN = { checked: 3, changed: 1, purged: 1, failed: 0 }
const asked = () => h.calls.map((c) => c.opts)

beforeEach(() => {
  h.calls = []
  h.result = { ...CLEAN }
  h.throws = null
  process.env.CRON_SECRET = 'cron-secret'
})

describe('GET /api/cron/identity-marks', () => {
  it('refuses without the bearer or with the wrong one — and never runs the pass', async () => {
    for (const a of [undefined, 'Bearer nope']) {
      const res = await GET(new Request('https://eno.vn/api/cron/identity-marks', { headers: a ? { authorization: a } : {} }))
      expect(res.status).toBe(401)
    }
    expect(h.calls).toEqual([])
  })

  it('⛔ a clean run is a 200 carrying the counts — the marks pass alone, never the full reconcile (nothing that can notify at night)', async () => {
    const r = await run()
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ ok: true, ...CLEAN, checkedAt: expect.any(String) })
    expect(h.calls).toEqual([{ fn: 'reconcileIdentityMarks', opts: { dryRun: false } }])
  })

  it('the counts lead the body — the journal keeps only the first 200 bytes (eno-cron.sh)', async () => {
    const text = await (await GET(req())).text()
    expect(Object.keys(JSON.parse(text))).toEqual(['ok', 'checked', 'changed', 'purged', 'failed', 'checkedAt'])
    expect(text.slice(0, 200)).toContain('"checked":3,"changed":1,"purged":1,"failed":0')
  })

  it('?dryRun=1 asks for a dry run, and its answer is passed through', async () => {
    h.result = { checked: 2, changed: 1, purged: 1, failed: 0, shown: 1, dryRun: true }
    const r = await run('?dryRun=1')
    expect(r.status).toBe(200)
    expect(asked()).toEqual([{ dryRun: true }])
    expect(r.body).toMatchObject({ ok: true, dryRun: true, shown: 1, changed: 1 })
  })

  it.each(['?dryRun=true', '?dryRun=yes', '?dryrun=1', '?dryRun=', '?dryRun=2', '?DryRun=1', '?dry_run=1', '?DRY-RUN=1'])('%s is a dry run too — any value but 0 / false / no', async (q) => {
    await run(q)
    expect(asked()).toEqual([{ dryRun: true }])
  })

  it.each(['?dryRun=0', '?dryRun=false', '?dryRun=no', '?all=1'])('%s is a real run', async (q) => {
    await run(q)
    expect(asked()).toEqual([{ dryRun: false }])
  })

  it('⛔ a failure is a 500 partial_failure — `failed` right after the error, then the other counts', async () => {
    h.result = { ...CLEAN, failed: 1 }
    const res = await GET(req())
    expect(res.status).toBe(500)
    const text = await res.text()
    const body = JSON.parse(text)
    expect(body).toEqual({ ok: false, error: 'partial_failure', failed: 1, checked: 3, changed: 1, purged: 1 })
    expect(Object.keys(body).slice(0, 3)).toEqual(['ok', 'error', 'failed'])
  })

  it('anything thrown is the generic 500, never the exception text', async () => {
    h.throws = new Error('connection string postgres://secret@db')
    const res = await GET(req())
    expect(res.status).toBe(500)
    expect(await res.text()).toBe('{"error":"internal_error"}')
  })
})
