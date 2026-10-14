import { beforeEach, describe, expect, it, vi } from 'vitest'

// The cron that runs the licence check's daily backstop (src/lib/core/licence-check.ts sweepLicenceHolds — its own
// rules are tested there). Pinned here: it runs only behind the cron secret; ?dryRun=1 and ?max=N reach the sweep as
// asked (and a bad ?max= is refused before it runs); every refusal is a 500 the timer's unit shows as FAILED — an
// unresolved desk, an unresolved grandfather, a mass pull — with the reason first in the body; a clean run is a 200
// carrying the counts. ⚠️ Only the desk refusal writes nothing: a grandfather or mass-pull refusal holds back the rows it
// names (wouldPull) and still pulls the rest (pulled) — the body carries both.
type Row = Record<string, any>
const DESK_ERROR = 'licence sweep: desk unresolved'
const h = vi.hoisted(() => ({
  calls: [] as Array<Record<string, any>>,
  result: null as Record<string, any> | null,
  throws: null as Error | null,
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/core/licence-check', () => ({
  LICENCE_SWEEP_MAX_PULL: 50,
  LICENCE_SWEEP_DESK_UNRESOLVED: 'licence sweep: desk unresolved',
  sweepLicenceHolds: async (opts: Record<string, any>) => {
    h.calls.push(opts)
    if (h.throws) throw h.throws
    return h.result
  },
}))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => ({ success: true }) }))
vi.mock('@/lib/log', () => ({ logError: () => {} }))

const { GET } = await import('./route')
const req = (query = '', auth: string | undefined = 'Bearer cron-secret') =>
  new Request(`https://eno.vn/api/cron/licence-holds${query}`, { headers: auth ? { authorization: auth } : {} })
const run = async (query = '', auth?: string) => {
  const res = await GET(req(query, auth))
  return { status: res.status, body: (await res.json()) as Row }
}
const CLEAN = { checked: 30, deskExempt: 15, grandfathered: 14, grandfatherUntil: '2026-10-21', pulled: 1, pulledIds: ['l9'] }

beforeEach(() => {
  h.calls = []
  h.result = { ...CLEAN }
  h.throws = null
  process.env.CRON_SECRET = 'cron-secret'
})

describe('GET /api/cron/licence-holds', () => {
  it('refuses without the bearer or with the wrong one — and never runs the sweep', async () => {
    for (const a of [undefined, 'Bearer nope']) {
      const res = await GET(new Request('https://eno.vn/api/cron/licence-holds', { headers: a ? { authorization: a } : {} }))
      expect(res.status).toBe(401)
    }
    expect(h.calls).toEqual([])
  })

  it('a clean run is a 200 carrying the counts — the timer runs it with no parameters: a real run, the default cap', async () => {
    const r = await run()
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ ok: true, ...CLEAN })
    expect(h.calls).toEqual([{ dryRun: false, maxPull: 50 }])
  })

  it('the counts come before the ids — the journal keeps only the first 200 bytes (eno-cron.sh)', async () => {
    h.result = { ...CLEAN, pulled: 40, pulledIds: Array.from({ length: 40 }, (_, i) => `listing-id-${i}`) }
    const text = await (await GET(req())).text()
    expect(text.slice(0, 200)).toContain('"pulled":40')
  })

  it('?dryRun=1 asks the sweep for a dry run, and its answer is passed through (dryRun: true)', async () => {
    h.result = { ...CLEAN, dryRun: true }
    const r = await run('?dryRun=1')
    expect(r.status).toBe(200)
    expect(h.calls).toEqual([{ dryRun: true, maxPull: 50 }])
    expect(r.body).toMatchObject({ ok: true, dryRun: true, pulled: 1 })
  })

  // Fails safe (commit gate, 2026-10-14): a typo never turns the deploy-day check into a real pull.
  it.each(['?dryRun=true', '?dryRun=yes', '?dryrun=1', '?dryRun=', '?dryRun=2', '?DryRun=1', '?dry_run=1', '?DRY-RUN=1'])('%s is a dry run too — any value but 0 / false / no', async (q) => {
    await run(q)
    expect(h.calls).toEqual([{ dryRun: true, maxPull: 50 }])
  })

  it.each(['?dryRun=0', '?dryRun=false', '?dryRun=no'])('%s is a real run', async (q) => {
    await run(q)
    expect(h.calls).toEqual([{ dryRun: false, maxPull: 50 }])
  })

  it('?max=N raises the cap for one run (1..500); anything else is a 400 and the sweep never runs', async () => {
    await run('?max=120')
    expect(h.calls).toEqual([{ dryRun: false, maxPull: 120 }])
    h.calls = []
    for (const bad of ['0', '501', '-3', '2.5', 'abc', '']) {
      const r = await run(`?max=${bad}`)
      expect(r.status, bad).toBe(400)
      expect(r.body, bad).toEqual({ ok: false, error: 'bad_request' })
    }
    expect(h.calls).toEqual([])
  })

  it('⛔ an unresolved desk is a 500 desk_unresolved — eno’s own e-Visa rows would read as anyone’s', async () => {
    h.throws = new Error(DESK_ERROR)
    const r = await run()
    expect(r.status).toBe(500)
    expect(r.body).toEqual({ ok: false, error: 'desk_unresolved' })
  })

  it('any other failure is the generic 500, never the exception text', async () => {
    h.throws = new Error('connection string postgres://secret@db')
    const res = await GET(req())
    expect(res.status).toBe(500)
    const text = await res.text()
    expect(text).toBe('{"error":"internal_error"}')
  })

  it('⛔ an unresolved grandfather is a 500 grandfather_unresolved, the reason and the would-pull count first', async () => {
    h.result = { checked: 30, deskExempt: 15, grandfathered: 0, grandfatherUntil: '2026-10-21', refused: 'grandfather_unresolved', grandfatherProblem: 'storefront x: its handle is not "vietkite"', pulled: 0, pulledIds: [], wouldPull: 15 }
    const res = await GET(req())
    expect(res.status).toBe(500)
    const text = await res.text()
    const body = JSON.parse(text)
    expect(body).toMatchObject({ ok: false, error: 'grandfather_unresolved', grandfatherProblem: 'storefront x: its handle is not "vietkite"', wouldPull: 15, pulled: 0, refused: 'grandfather_unresolved' })
    expect(Object.keys(body).slice(0, 4)).toEqual(['ok', 'error', 'grandfatherProblem', 'wouldPull'])
  })

  it('⛔ a mass pull is a 500 with refused: mass_pull, how many and the cap — nothing was written', async () => {
    h.result = { checked: 90, deskExempt: 15, grandfathered: 14, grandfatherUntil: '2026-10-21', refused: 'mass_pull', pulled: 0, pulledIds: [], wouldPull: 61 }
    const res = await GET(req())
    expect(res.status).toBe(500)
    const body = JSON.parse(await res.text())
    expect(body).toMatchObject({ ok: false, refused: 'mass_pull', wouldPull: 61, maxPull: 50, pulled: 0 })
    expect(Object.keys(body).slice(0, 4)).toEqual(['ok', 'refused', 'wouldPull', 'maxPull'])
  })
})
