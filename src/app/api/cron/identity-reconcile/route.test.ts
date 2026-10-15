import { beforeEach, describe, expect, it, vi } from 'vitest'

// The cron that runs the nightly identity reconcile (src/lib/compliance/identity-reconcile.ts — its own rules are
// tested there). Pinned here: it runs only behind the cron secret; ?dryRun reaches the reconcile as asked and FAILS SAFE
// (any value but 0 / false / no is a dry run); there is no ?all mode — unknown parameters change nothing; a profile that
// failed is a 500 partial_failure the timer's unit shows as FAILED, with `failed` right after the error; a clean run is
// a 200 whose first 200 bytes — all the journal keeps (eno-cron.sh) — carry the counts.
type Row = Record<string, any>
const h = vi.hoisted(() => ({
  calls: [] as Array<Record<string, any>>,
  result: null as Record<string, any> | null,
  throws: null as Error | null,
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/compliance/identity-reconcile', () => ({
  reconcileIdentities: async (opts: Record<string, any>) => {
    h.calls.push(opts)
    if (h.throws) throw h.throws
    return h.result
  },
}))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => ({ success: true }) }))
vi.mock('@/lib/log', () => ({ logError: () => {} }))

const { GET } = await import('./route')
const req = (query = '', auth: string | undefined = 'Bearer cron-secret') =>
  new Request(`https://eno.vn/api/cron/identity-reconcile${query}`, { headers: auth ? { authorization: auth } : {} })
const run = async (query = '', auth?: string) => {
  const res = await GET(req(query, auth))
  return { status: res.status, body: (await res.json()) as Row }
}
const CLEAN = { checked: 3, recomputed: 3, changed: 1, failed: 0, illegal: 0, trustMoved: 2, purged: 1 }

beforeEach(() => {
  h.calls = []
  h.result = { ...CLEAN }
  h.throws = null
  process.env.CRON_SECRET = 'cron-secret'
})

describe('GET /api/cron/identity-reconcile', () => {
  it('refuses without the bearer or with the wrong one — and never runs the reconcile', async () => {
    for (const a of [undefined, 'Bearer nope']) {
      const res = await GET(new Request('https://eno.vn/api/cron/identity-reconcile', { headers: a ? { authorization: a } : {} }))
      expect(res.status).toBe(401)
    }
    expect(h.calls).toEqual([])
  })

  it('a clean run is a 200 carrying the counts — the timer runs it with no parameters: a real run', async () => {
    const r = await run()
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ ok: true, ...CLEAN, checkedAt: expect.any(String) })
    expect(h.calls).toEqual([{ dryRun: false }])
  })

  it('the counts lead the body — the journal keeps only the first 200 bytes (eno-cron.sh)', async () => {
    h.result = {
      ...CLEAN, dryRun: true, mismatched: 1, teachers: 1,
      profiles: Array.from({ length: 30 }, (_, i) => ({ profileId: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, derived: 'verified', cached: 'verified', mismatch: false, illegal: false, teacher: false })),
    }
    const text = await (await GET(req('?dryRun=1'))).text()
    const head = text.slice(0, 200)
    for (const k of ['"checked":3', '"failed":0', '"changed":1', '"illegal":0', '"purged":1']) expect(head).toContain(k)
  })

  it('?dryRun=1 asks for a dry run, and its answer is passed through', async () => {
    h.result = { ...CLEAN, recomputed: 0, changed: 0, trustMoved: 0, purged: 0, dryRun: true, mismatched: 1, teachers: 0, profiles: [] }
    const r = await run('?dryRun=1')
    expect(r.status).toBe(200)
    expect(h.calls).toEqual([{ dryRun: true }])
    expect(r.body).toMatchObject({ ok: true, dryRun: true, mismatched: 1, recomputed: 0 })
  })

  // Fails safe, as licence-holds does: a typo never turns the deploy-day check into a real run.
  it.each(['?dryRun=true', '?dryRun=yes', '?dryrun=1', '?dryRun=', '?dryRun=2', '?DryRun=1', '?dry_run=1', '?DRY-RUN=1'])('%s is a dry run too — any value but 0 / false / no', async (q) => {
    await run(q)
    expect(h.calls).toEqual([{ dryRun: true }])
  })

  it.each(['?dryRun=0', '?dryRun=false', '?dryRun=no'])('%s is a real run', async (q) => {
    await run(q)
    expect(h.calls).toEqual([{ dryRun: false }])
  })

  it('⛔ there is no ?all mode: unknown parameters change nothing — every run is the full reconcile', async () => {
    for (const q of ['?all=1', '?all=true', '?max=5']) {
      h.calls = []
      const r = await run(q)
      expect(r.status, q).toBe(200)
      expect(h.calls, q).toEqual([{ dryRun: false }])
    }
  })

  it('⛔ a failed profile is a 500 partial_failure — `failed` right after the error, then the other counts', async () => {
    h.result = { ...CLEAN, failed: 2 }
    const res = await GET(req())
    expect(res.status).toBe(500)
    const text = await res.text()
    const body = JSON.parse(text)
    expect(body).toEqual({ ok: false, error: 'partial_failure', failed: 2, checked: 3, recomputed: 3, changed: 1, illegal: 0, trustMoved: 2, purged: 1 })
    expect(Object.keys(body).slice(0, 4)).toEqual(['ok', 'error', 'failed', 'checked'])
    expect(text.slice(0, 200)).toContain('"failed":2')
  })

  it('an illegal cache move alone is NOT a failure: 200', async () => {
    h.result = { ...CLEAN, illegal: 1 }
    const r = await run()
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ ok: true, illegal: 1, failed: 0 })
  })

  it('anything thrown is the generic 500, never the exception text', async () => {
    h.throws = new Error('connection string postgres://secret@db')
    const res = await GET(req())
    expect(res.status).toBe(500)
    expect(await res.text()).toBe('{"error":"internal_error"}')
  })
})
