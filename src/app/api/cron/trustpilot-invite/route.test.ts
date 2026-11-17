import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// GET /api/cron/trustpilot-invite (owner, 2026-11-17). Pinned: cron auth; marketplace only; a dry run counts and sends
// nothing; the excluded addresses carry ADMIN_EMAILS and both desk operators; the answer stays under 200 bytes. Who and
// when — the SQL itself — runs in Postgres in src/lib/trustpilot-invite.sql.test.ts; here the lib is a stand-in.
const h = vi.hoisted(() => ({
  eligible: 0,
  invited: 0,
  counts: [] as string[][],
  sends: [] as string[][],
}))
vi.mock('@/lib/trustpilot-invite', () => ({
  TRUSTPILOT_INVITE: { maxPerRun: 200 },
  countTrustpilotInvites: async (excluded: string[]) => { h.counts.push(excluded); return h.eligible },
  sendTrustpilotInvites: async (excluded: string[]) => { h.sends.push(excluded); return h.invited },
}))
vi.mock('@/lib/db', () => ({ db: {} }))

vi.stubEnv('NEXT_PUBLIC_ENO_EDITION', 'marketplace')
const { GET } = await import('./route')

const req = (qs = '', auth: string | null = 'Bearer cron-secret') =>
  new Request(`https://eno.vn/api/cron/trustpilot-invite${qs}`, { headers: auth ? { authorization: auth } : {} })
const run = async (qs = '') => {
  const res = await GET(req(qs) as never, {} as never)
  const text = await res.text()
  return { status: res.status, body: JSON.parse(text) as Record<string, unknown>, bytes: Buffer.byteLength(text) }
}

beforeEach(() => {
  process.env.CRON_SECRET = 'cron-secret'
  vi.stubEnv('ADMIN_EMAILS', ' Boss@Example.com , ops@example.com')
  vi.stubEnv('RENTAL_CHECK_OPERATOR_EMAIL', 'Rentals@Example.com')
  vi.stubEnv('JOBS_DESK_OPERATOR_EMAIL', 'jobs@example.com')
  h.eligible = 0; h.invited = 0; h.counts = []; h.sends = []
})
afterEach(() => { vi.unstubAllEnvs(); vi.stubEnv('NEXT_PUBLIC_ENO_EDITION', 'marketplace') })

describe('GET /api/cron/trustpilot-invite', () => {
  it('401 without the cron secret — nothing counted, nothing sent', async () => {
    for (const a of [null, 'Bearer nope']) expect((await GET(req('', a) as never, {} as never)).status).toBe(401)
    expect(h.counts).toEqual([])
    expect(h.sends).toEqual([])
  })

  it('a dry run counts who is due and sends nothing', async () => {
    h.eligible = 250
    expect(await run('?dryRun=1')).toMatchObject({ status: 200, body: { ok: true, dryRun: true, eligible: 250, wouldInvite: 200 } })
    expect(h.sends).toEqual([])
  })

  it('a run sends and answers how many were invited', async () => {
    h.invited = 3
    expect(await run()).toMatchObject({ status: 200, body: { ok: true, invited: 3 } })
    expect(h.sends).toHaveLength(1)
  })

  it('⛔ the excluded addresses carry ADMIN_EMAILS and both desk operators, lower-cased', async () => {
    await run()
    expect(h.sends[0]).toEqual(expect.arrayContaining(['boss@example.com', 'ops@example.com', 'rentals@example.com', 'jobs@example.com']))
  })

  it('the answer stays under 200 bytes (eno-cron.sh prints only the first 200)', async () => {
    h.eligible = 123_456
    expect((await run('?dryRun=1')).bytes).toBeLessThan(200)
    h.invited = 200
    expect((await run()).bytes).toBeLessThan(200)
  })

  it('services edition: nothing to do', async () => {
    vi.stubEnv('NEXT_PUBLIC_ENO_EDITION', 'services')
    vi.resetModules()
    const { GET: forumGet } = await import('./route')
    const res = await forumGet(req() as never, {} as never)
    expect(await res.json()).toEqual({ ok: true, skipped: 'marketplace_only' })
    expect(h.counts).toEqual([])
    expect(h.sends).toEqual([])
  })
})
