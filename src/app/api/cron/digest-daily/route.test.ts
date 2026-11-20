import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The digest cron (daily since 2026-11-19, /api/cron/digest-daily). What this file pins is the 2026-09-24 failure and everything built to stop
// it recurring: that run fired 20 sends at once into Resend's 10/s limit, 11 of 21 recipients got a
// 429, nothing retried, and the route still answered 200. Now: one batch request per 100, retried on
// a retryable error with the SAME idempotency key, and any failure turns the timer red. Plus the
// trial path, which must never reach the list.
type Msg = { to: string; subject: string; headers?: Record<string, string> }
type Batch = { ok: boolean[]; retryable: boolean; retryAfterMs: number | null; error: string | null }
const h = vi.hoisted(() => ({
  recipients: [] as { id: string; email: string; displayName: string | null; unsubscribeToken: string; seller?: { officialPartner: boolean } | null }[],
  /** false (default) = today's share is the whole eligible list, so the batch/retry tests below read as before. */
  realPlan: false,
  batches: [] as { msgs: Msg[]; key: string }[],
  batchAnswers: [] as ((msgs: Msg[]) => Batch)[],
  singles: [] as Msg[],
  findManyWhere: null as unknown,
  contentCalls: 0,
  admins: ['support@eno.vn'],
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => ({ success: true }) }))
vi.mock('@/lib/admin', () => ({ isAdminEmail: (e: string) => h.admins.includes(e) }))
vi.mock('@/lib/unsubscribe-token', () => ({ mintUnsubscribeToken: (id: string) => `signed-${id}` }))
// The schools ask's share of today's quota (src/lib/teachers/schools-ask.ts) — none in these runs; planDigestDay's own test covers it.
vi.mock('@/lib/teachers/schools-ask', () => ({ SCHOOLS_ASK: { emailsPerDay: 50 }, schoolsAskEmailsToday: async () => 0 }))
vi.mock('@/lib/digest', () => ({
  getDigestContent: async () => {
    h.contentCalls++
    return {
      apartments: [{ id: 'h1', heading: 'Apartment · 1 bed', price: 9_000_000, currency: '₫', image: 'https://sb.eno.vn/i.webp', area: 'District 1' }],
      teachers: [{ id: 't1', name: 'Jane Doe', headline: 'IELTS 8.0', image: 'https://sb.eno.vn/t.webp' }],
    }
  },
}))
vi.mock('@/lib/mail', () => ({
  mailEnabled: () => true,
  sendMail: async (m: Msg) => { h.singles.push(m); return true },
  sendMailBatch: async (msgs: Msg[], opts: { idempotencyKey: string }) => {
    h.batches.push({ msgs, key: opts.idempotencyKey })
    const answer = h.batchAnswers.shift()
    return answer ? answer(msgs) : { ok: msgs.map(() => true), retryable: false, retryAfterMs: null, error: null }
  },
}))
// The day's share (src/lib/digest-schedule.ts has its own tests). Off by default so the send mechanics below are pinned
// against the whole list; `h.realPlan` runs the real schedule.
vi.mock('@/lib/digest-schedule', async (orig) => {
  const real = await orig<typeof import('@/lib/digest-schedule')>()
  return {
    ...real,
    planDigestDay: <T extends { id: string }>(rows: T[], now: Date) =>
      h.realPlan ? real.planDigestDay(rows, now) : { started: true as const, cycleDays: 7, slot: 0, due: [...rows], skippedOverCapacity: 0, overCapacity: false },
  }
})
vi.mock('@/lib/db', () => ({
  db: {
    profile: {
      findMany: async (args: { where: unknown }) => { h.findManyWhere = args.where; return h.recipients },
      findFirst: async () => ({ id: 'admin-profile', displayName: 'Shan', unsubscribeToken: 'u' }),
    },
  },
}))

// The digest is marketplace-only (the route gates on IS_MARKETPLACE). Force the marketplace edition so
// the GET under test isn't skipped; the dedicated gate test below re-imports under services.
vi.stubEnv('NEXT_PUBLIC_ENO_EDITION', 'marketplace')
const { GET } = await import('./route')
const { SITE_NAME } = await import('@/lib/edition')
// The route's own rule — a shell that exports the repo .env pins NEXT_PUBLIC_APP_URL, CI does not.
const ORIGIN = process.env.NEXT_PUBLIC_APP_URL || `https://${SITE_NAME}`
// ⚠️ `null`, not `undefined`, means "no bearer": an explicit undefined would take the default below.
const req = (qs = '', auth: string | null = 'Bearer cron-secret') =>
  new Request(`https://${SITE_NAME}/api/cron/digest-daily${qs}`, { headers: auth ? { authorization: auth } : {} })
const people = (k: number) => Array.from({ length: k }, (_, i) => ({ id: `p${String(i).padStart(3, '0')}`, email: `p${i}@example.com`, displayName: 'Minh Tran', unsubscribeToken: `t${i}` }))

beforeEach(() => {
  process.env.CRON_SECRET = 'cron-secret'
  Object.assign(h, { recipients: people(3), batches: [], batchAnswers: [], singles: [], findManyWhere: null, contentCalls: 0, realPlan: false })
})
afterEach(() => { vi.useRealTimers() })
afterAll(() => { vi.unstubAllEnvs() })

describe('GET /api/cron/weekly-digest', () => {
  it('refuses without the cron bearer and sends nothing', async () => {
    for (const a of [null, 'Bearer nope']) expect((await GET(req('', a))).status).toBe(401)
    expect(h.batches).toHaveLength(0)
    expect(h.contentCalls).toBe(0)
  })

  it('sends the whole list as ONE batch request, not one request per person', async () => {
    const res = await GET(req())
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, recipients: 3, truncated: false, sent: 3, failed: 0 })
    expect(h.batches).toHaveLength(1)
    expect(h.batches[0].msgs.map((m) => m.to)).toEqual(['p0@example.com', 'p1@example.com', 'p2@example.com'])
    expect(h.batches[0].key).toMatch(/^weekly-digest:[a-z.]+:\d{4}-\d{2}-\d{2}:[0-9a-f]{32}$/) // the Saigon date
    // Each message keeps its own one-click unsubscribe.
    expect(h.batches[0].msgs[1].headers?.['List-Unsubscribe']).toBe(`<${ORIGIN}/api/unsubscribe?token=signed-p001>`)
  })

  it('splits more than 100 recipients into batches of 100', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    h.recipients = people(150)
    const pending = GET(req())
    await vi.advanceTimersByTimeAsync(5000)
    const res = await pending
    expect(res.status).toBe(200)
    expect(h.batches.map((b) => b.msgs.length)).toEqual([100, 50])
    expect(new Set(h.batches.map((b) => b.key)).size).toBe(2)
  })

  it('skips a blank or malformed address instead of failing on it every week', async () => {
    h.recipients = [...people(2), { id: 'blank', email: '', displayName: null, unsubscribeToken: 'x' }, { id: 'junk', email: 'no-at-sign', displayName: null, unsubscribeToken: 'y' }]
    const res = await GET(req())
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, recipients: 4, sent: 2, failed: 0, skippedInvalid: 2 })
    expect(h.batches[0].msgs.map((m) => m.to)).toEqual(['p0@example.com', 'p1@example.com'])
  })

  it('keys each batch by site as well as week, so the two editions never share a key', async () => {
    await GET(req())
    expect(h.batches[0].key.startsWith(`weekly-digest:${SITE_NAME}:`)).toBe(true)
  })

  it('never sleeps longer than 10 s for a retry-after, whatever Resend asks', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    h.batchAnswers = [(msgs) => ({ ok: msgs.map(() => false), retryable: true, retryAfterMs: 600_000, error: 'rate_limit_exceeded' })]
    const pending = GET(req())
    await vi.advanceTimersByTimeAsync(10_001)
    const res = await pending
    expect(res.status).toBe(200)
    expect(h.batches).toHaveLength(2)
  })

  it('retries a rate-limited batch with the SAME idempotency key, so a retry can never double-send', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    h.batchAnswers = [(msgs) => ({ ok: msgs.map(() => false), retryable: true, retryAfterMs: null, error: 'rate_limit_exceeded' })]
    const pending = GET(req())
    await vi.advanceTimersByTimeAsync(10_000)
    const res = await pending
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ sent: 3, failed: 0, retried: 1 })
    expect(h.batches).toHaveLength(2)
    expect(h.batches[1].key).toBe(h.batches[0].key)
  })

  it('a run with ANY failure is a 500 carrying the counts', async () => {
    h.batchAnswers = [(msgs) => ({ ok: msgs.map((_, i) => i !== 1), retryable: false, retryAfterMs: null, error: 'rows_refused' })]
    const res = await GET(req())
    expect(res.status).toBe(500)
    expect(await res.json()).toMatchObject({ ok: false, sent: 2, failed: 1, errors: ['rows_refused'] })
  })

  it('gives up after two retries and reports the failure instead of hiding it', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    const down = (msgs: Msg[]) => ({ ok: msgs.map(() => false), retryable: true, retryAfterMs: null, error: 'internal_server_error' })
    h.batchAnswers = [down, down, down]
    const pending = GET(req())
    await vi.advanceTimersByTimeAsync(20_000)
    const res = await pending
    expect(res.status).toBe(500)
    expect(await res.json()).toMatchObject({ sent: 0, failed: 3, retried: 2 })
    expect(h.batches).toHaveLength(3)
  })

  it('a 409 (our key, a different body) counts as FAILED, never as sent — it proves a record, not a delivery', async () => {
    h.batchAnswers = [(msgs) => ({ ok: msgs.map(() => false), retryable: false, retryAfterMs: null, error: 'invalid_idempotent_request' })]
    const res = await GET(req())
    expect(res.status).toBe(500)
    expect(await res.json()).toMatchObject({ ok: false, sent: 0, failed: 3, errors: ['invalid_idempotent_request'] })
    expect(h.batches).toHaveLength(1) // and it is not retried
  })

  it('keeps the same key for the same recipients on the same day, so a rerun is recognised', async () => {
    await GET(req())
    await GET(req())
    expect(h.batches[1].key).toBe(h.batches[0].key)
  })

  it('stops starting batches at its deadline and reports the rest as failed', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] })
    h.recipients = people(250)
    // The first batch "takes" 13 minutes (a Resend outage's worth of retries), then succeeds.
    h.batchAnswers = [(msgs) => { vi.setSystemTime(Date.now() + 13 * 60 * 1000); return { ok: msgs.map(() => true), retryable: false, retryAfterMs: null, error: null } }]
    const pending = GET(req())
    await vi.advanceTimersByTimeAsync(5000)
    const res = await pending
    expect(res.status).toBe(500)
    expect(await res.json()).toMatchObject({ ok: false, sent: 100, failed: 150, errors: ['deadline'] })
    expect(h.batches).toHaveLength(1) // no batch started after the deadline
  })
})

/** Owner, 2026-11-19: never a partner's address; at most 90 a day, each person once a cycle. */
describe('partners and the daily share', () => {
  const START = Date.UTC(2026, 10, 26) + 2 * 3_600_000 // 2026-11-26 09:00 in Saigon

  it('never sends to an official-partner account or an address on our own domains, and counts them', async () => {
    h.recipients = [
      ...people(2),
      { id: 'partner', email: 'contact@goplus.com.vn', displayName: null, unsubscribeToken: 'a', seller: { officialPartner: true } },
      { id: 'placeholder', email: 'support+dienthoaivui@eno.vn', displayName: null, unsubscribeToken: 'b', seller: { officialPartner: false } },
      { id: 'team', email: 'support@eno.forum', displayName: null, unsubscribeToken: 'c', seller: null },
      { id: 'shop', email: 'shop@example.com', displayName: null, unsubscribeToken: 'd', seller: { officialPartner: false } },
    ]
    const res = await GET(req())
    expect(await res.json()).toMatchObject({ ok: true, recipients: 6, eligible: 3, excludedPartner: 1, excludedOwnDomain: 2, sent: 3 })
    expect(h.batches[0].msgs.map((m) => m.to)).toEqual(['p0@example.com', 'p1@example.com', 'shop@example.com'])
  })

  it('before 2026-11-26 it sends nothing (the old weekly run went to everyone on 2026-11-19)', async () => {
    h.realPlan = true
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(START - 86_400_000)
    const res = await GET(req())
    expect(await res.json()).toMatchObject({ ok: true, skipped: 'not_started', startsOn: '2026-11-26', eligible: 3 })
    expect(h.batches).toHaveLength(0)
  })

  it('a week of daily runs reaches every eligible person exactly once, never more than 90 on a day', async () => {
    h.realPlan = true
    h.recipients = people(384)
    vi.useFakeTimers({ toFake: ['Date'] })
    const sent: string[] = []
    for (let d = 0; d < 7; d++) {
      vi.setSystemTime(START + d * 86_400_000)
      h.batches = []
      const body = await (await GET(req())).json()
      expect(body).toMatchObject({ ok: true, cycleDays: 7, slot: d, overCapacity: false, skippedOverCapacity: 0 })
      const today = h.batches.flatMap((b) => b.msgs.map((m) => m.to))
      expect(today.length).toBeLessThanOrEqual(90)
      expect(body.sent).toBe(today.length)
      sent.push(...today)
    }
    expect(sent).toHaveLength(384)
    expect(new Set(sent).size).toBe(384)
  })
})

describe('over capacity', () => {
  it('sends today\'s 90 but answers 500, so the timer goes red: people are being skipped (time to upgrade)', async () => {
    h.realPlan = true
    h.recipients = people(2000)
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.UTC(2026, 10, 26) + 2 * 3_600_000)
    const res = await GET(req())
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body).toMatchObject({ ok: true, overCapacity: true, cycleDays: 15, sent: 90, failed: 0 })
    expect(body.skippedOverCapacity).toBeGreaterThan(0)
  })
})

describe('?trial=', () => {
  it('refuses an address outside ADMIN_EMAILS before reading anything — never falls through to the list', async () => {
    const res = await GET(req('?trial=someone@gmail.com'))
    expect(res.status).toBe(400)
    expect(h.contentCalls).toBe(0)
    expect(h.batches).toHaveLength(0)
    expect(h.singles).toHaveLength(0)
    expect(h.findManyWhere).toBeNull()
  })

  it('sends this week’s real email to that one admin address, marked [Trial], and reads no list', async () => {
    const res = await GET(req('?trial=Support@eno.vn'))
    expect(res.status).toBe(200)
    // Through the SAME batch path as the real run, so a trial proves it against the live API.
    expect(h.batches).toHaveLength(1)
    expect(h.batches[0].msgs).toHaveLength(1)
    expect(h.batches[0].msgs[0].to).toBe('support@eno.vn')
    expect(h.batches[0].msgs[0].subject).toBe(`[Trial] 1 new apartment & 1 new teacher on ${SITE_NAME} this week`)
    expect(h.batches[0].key.startsWith(`weekly-digest-trial:${SITE_NAME}:`)).toBe(true)
    expect(h.findManyWhere).toBeNull()
  })

  it('gives every trial a fresh key, so a second trial after a copy change is not a replay', async () => {
    await GET(req('?trial=support@eno.vn'))
    await GET(req('?trial=support@eno.vn'))
    expect(h.batches[0].key).not.toBe(h.batches[1].key)
  })
})

describe('edition gate', () => {
  it('eno.forum (services edition) sends NO digest — skipped before reading content', async () => {
    vi.resetModules()
    vi.stubEnv('NEXT_PUBLIC_ENO_EDITION', 'services')
    try {
      const { GET: ForumGET } = await import('./route')
      const res = await ForumGET(req())
      expect(res.status).toBe(200)
      expect(await res.json()).toMatchObject({ ok: true, skipped: 'not_marketplace' })
      expect(h.contentCalls).toBe(0)
      expect(h.batches).toHaveLength(0)
    } finally {
      vi.stubEnv('NEXT_PUBLIC_ENO_EDITION', 'marketplace')
      vi.resetModules()
    }
  })
})
