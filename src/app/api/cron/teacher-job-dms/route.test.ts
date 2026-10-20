import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// GET /api/cron/teacher-job-dms — the answer's STATUS. eno-cron.sh fails the systemd unit only on a non-200, so a run that
// did not do its job (no operator, the run lock held, out of time, a failure) must answer 500 — with the same short body —
// and a run that did (or stopped for the quiet hours or a ceiling) 200. The run itself is run.ts's (run.test.ts).
const h = vi.hoisted(() => ({ result: {} as Record<string, unknown>, calls: [] as Array<{ dryRun: boolean }> }))
vi.mock('@/lib/teachers/job-dms/run', () => ({
  runJobDms: async (opts: { dryRun: boolean }) => { h.calls.push(opts); return h.result },
}))

vi.stubEnv('NEXT_PUBLIC_ENO_EDITION', 'marketplace')
const { GET } = await import('./route')

const BASE = { mode: 'shadow', stops: 0, read: 3, ready: 2, held: 1, dropped: 0, expired: 0, teachers: 4, sent: 0, shadow: 2, skipped: 0, failed: 0 }
const run = async (qs = '') => {
  const res = await GET(new Request(`https://eno.vn/api/cron/teacher-job-dms${qs}`, { headers: { authorization: 'Bearer cron-secret' } }) as never, {} as never)
  return { status: res.status, body: JSON.parse(await res.text()) as Record<string, unknown> }
}

beforeEach(() => { process.env.CRON_SECRET = 'cron-secret'; h.calls = [] })
afterEach(() => { vi.restoreAllMocks() })

describe('GET /api/cron/teacher-job-dms — the status the unit reads', () => {
  it('a run that did its job — or stopped for the quiet hours or a ceiling — is a 200', async () => {
    for (const stopped of [undefined, 'quiet', 'ceiling']) {
      h.result = { ...BASE, ...(stopped ? { stopped } : {}) }
      const { status, body } = await run()
      expect(status, String(stopped)).toBe(200)
      expect(body.ok).toBe(true)
    }
  })

  it('⛔ no operator, the lock held, out of time, or a failure: a 500, with the body (stop first) for the journal', async () => {
    for (const [extra, stop] of [[{ stopped: 'no-operator' }, 'no-operator'], [{ stopped: 'busy' }, 'busy'], [{ stopped: 'deadline' }, 'deadline'], [{ failed: 2 }, undefined], [{ stopped: 'lock-error', failed: 1 }, 'lock-error'], [{ stopped: 'lock-error' }, 'lock-error'], [{ stopped: 'something-new' }, 'something-new']] as const) {
      h.result = { ...BASE, ...extra }
      const { status, body } = await run()
      expect(status, JSON.stringify(extra)).toBe(500)
      expect(body.ok).toBe(false)
      expect(body.stop).toBe(stop)
      expect(Object.keys(body)[1]).toBe(stop ? 'stop' : 'm')
    }
  })

  it('passes ?dryRun=1 through — and a busy dry run is a 500 too (the installer waits it out)', async () => {
    h.result = { ...BASE, mode: 'dry', stopped: 'busy' }
    const { status } = await run('?dryRun=1')
    expect(status).toBe(500)
    expect(h.calls).toEqual([{ dryRun: true }])
  })
})
