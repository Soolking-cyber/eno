import { beforeEach, describe, expect, it, vi } from 'vitest'

// The weekly second-hand showcase route (owner, 2026-10-17): cron-authenticated; `?dryRun` fails SAFE (any value but an
// explicit 0 / false / no is a dry run, like licence-holds); `?store=` limits it to one shop; a refused or errored run
// answers 500 so the box unit shows FAILED; ok and totals lead the body (eno-cron.sh keeps 200 bytes in the journal).

const h = vi.hoisted(() => ({ calls: [] as Array<{ apply: boolean; stores?: string[] }>, ok: true }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => ({ success: true }) }))
vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/revalidate-lang', () => ({ revalidatePublicPath: () => {} }))
vi.mock('@/lib/secondhand-showcase-run', () => ({
  runShowcase: async (_deps: unknown, opts: { apply: boolean; stores?: string[] }) => {
    h.calls.push(opts)
    return { ok: h.ok, apply: h.ok && opts.apply, refused: h.ok ? undefined : 'mass_retire: 3 of 5', writeErrors: h.ok ? [] : ['caps: connection lost'], totals: { live: 5, shelves: 1, retire: 0, trim: 0, reprice: 0, restore: 0, unknown: 0, short: 0, capTrim: 0 }, notReached: [], unmatchedRetire: [], stamp: 's', shelves: [], shops: [], caps: [], journal: [] }
  },
  fetchPageHonest: vi.fn(), fetchFeedFacts: vi.fn(), fetchApiHonest: vi.fn(),
}))

const { GET } = await import('./route')
const call = (q = '', auth = 'Bearer cron-secret') => GET(new Request(`https://eno.vn/api/cron/secondhand-showcase${q}`, { headers: { authorization: auth } }))

beforeEach(() => { process.env.CRON_SECRET = 'cron-secret'; h.calls = []; h.ok = true })

describe('GET /api/cron/secondhand-showcase', () => {
  it('needs the cron secret', async () => {
    expect((await call('', 'Bearer wrong')).status).toBe(401)
    expect(h.calls).toEqual([])
  })
  it('the timer’s plain call applies; ?dryRun fails safe — any value but 0 / false / no is a dry run', async () => {
    await call()
    for (const q of ['?dryRun=1', '?dryRun=true', '?dry_run=yes', '?dryrun=', '?dryRun=0', '?dryRun=false']) await call(q)
    expect(h.calls.map((c) => c.apply)).toEqual([true, false, false, false, false, true, true])
  })
  it('?store limits the run to one shop', async () => {
    await call('?store=minhtuanmobile.com&dryRun=1')
    expect(h.calls[0]).toMatchObject({ apply: false, stores: ['minhtuanmobile.com'] })
  })
  it('a refused run answers 500 with ok and totals first', async () => {
    h.ok = false
    const res = await call()
    expect(res.status).toBe(500)
    const text = await res.text()
    expect(text.startsWith('{"ok":false,"apply":false,"refused":"mass_retire')).toBe(true)
    expect(text.slice(0, 200)).toContain('"writeErrors":["caps: connection lost"]') // why, inside the bytes the unit keeps
  })
})
