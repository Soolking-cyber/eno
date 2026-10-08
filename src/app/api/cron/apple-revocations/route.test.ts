import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The daily Apple revocation retry + client probe (plan §7.12, §8). Pinned: the probe makes the run red on
 * invalid_client — and, once either client is configured, on anything but ok or unreachable; ORPHANED active rows are
 * queued first (C2); the due rows are settled one locked unit per account and Apple ID, with the live-account check and
 * the 14-day give-up (C3 — the unit itself is tested in apple-siwa.test.ts); a give-up is logged and the run is red; so
 * is any unit or sweep the database failed — and, once configured, a role that cannot READ auth.flow_state or
 * auth.identities (verifier, 2026-10-09).
 */
type Row = { userId: string; clientId: string; appleSub: string; tokenEnc: string; queuedAt: Date | null; attempts: number; lastError: string | null }
type Outcome = { clientId: string; outcome: string; error?: string; attempts?: number }
const DAY = 24 * 60 * 60 * 1000
const h = vi.hoisted(() => ({
  /** The two client ids as the env gives them (null: unset — the dark deploy). */
  ids: { services: 'vn.eno.web', bundle: 'vn.eno.app' } as { services: string | null; bundle: string | null },
  probe: { 'vn.eno.web': 'ok', 'vn.eno.app': 'ok' } as Record<string, string>,
  /** probeAuthTables' answer: can the app's role read GoTrue's tables (granted AND not hidden by row-level security)? */
  authTables: { flowState: 'readable', identities: 'readable', users: 'readable' } as Record<string, string>,
  oldestMs: null as number | null | 'throw',
  orphanDeadline: null as number | null,
  stale: [] as Array<{ userId: string; clientId: string; attempts: number }>,
  rows: [] as Row[],
  orphans: { candidates: 0, queued: 0, unconfirmed: 0 } as { candidates: number; queued: number; unconfirmed: number } | 'throw',
  /** settleQueuedTokens' answer per erased account (default: every client revoked); 'throw' = the database failed. */
  settle: new Map<string, Outcome[] | 'throw'>(),
  settleCalls: [] as Array<{ target: { userId: string; appleSub: string; clientIds: string[] }; opts: { liveCheck: boolean; refusedClients?: Set<string>; giveUpAfterMs?: number } }>,
  events: [] as string[],
  logs: [] as string[],
  /** public.apple_siwa_token exists (to_regclass) — false until scripts/apple-siwa-ddl.mjs has run. */
  table: true,
}))
/** What Postgres answers a statement on a table that does not exist, through Prisma 7's raw query. */
const noTable = () => Object.assign(new Error('relation "public.apple_siwa_token" does not exist'), { code: 'P2010', meta: { driverAdapterError: { cause: { originalCode: '42P01' } } } })
vi.mock('server-only', () => ({}))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => ({ success: true }) }))
vi.mock('@/lib/log', () => ({
  logWarn: (m: string, c?: unknown) => { h.logs.push(`${m} ${JSON.stringify(c ?? {})}`) },
  logError: (e: unknown, c?: unknown) => { h.logs.push(`${String(e)} ${JSON.stringify(c ?? {})}`) },
  logInfo: () => {},
}))
vi.mock('@/lib/auth/apple-siwa', () => ({
  APPLE_REVOKE_GIVE_UP_MS: 14 * 24 * 60 * 60 * 1000,
  appleServicesId: () => h.ids.services,
  appleBundleId: () => h.ids.bundle,
  probeClient: async (id: string | null) => (id ? h.probe[id] : 'unconfigured'),
  probeAuthTables: async () => { h.events.push('auth-tables'); return h.authTables },
  queueOrphanedTokens: async (_limit?: number, deadline?: number) => {
    h.orphanDeadline = deadline ?? null
    h.events.push('orphans')
    if (!h.table) throw noTable()
    if (h.orphans === 'throw') throw new Error('db down')
    return h.orphans
  },
  appleTokenTablePresent: async () => h.table,
  dueRevocations: async () => { h.events.push('due'); if (!h.table) throw noTable(); return h.rows },
  oldestQueuedMs: async () => { if (h.oldestMs === 'throw') throw Object.assign(new Error('terminating connection'), { code: '57P01' }); return h.oldestMs },
  dropStaleQueued: async (_ms: number) => { h.events.push('drop-stale'); return h.stale },
  settleQueuedTokens: async (target: { userId: string; appleSub: string; clientIds: string[] }, opts: never) => {
    h.events.push(`settle:${target.userId}`)
    h.settleCalls.push({ target, opts })
    const a = h.settle.get(target.userId)
    if (a === 'throw') throw new Error('lock timeout')
    return a ?? target.clientIds.map((clientId) => ({ clientId, outcome: 'revoked' }))
  },
}))

const { GET } = await import('./route')
const run = (auth = 'Bearer cron-secret') => GET(new Request('https://eno.vn/api/cron/apple-revocations', { headers: { authorization: auth } }))
const row = (userId: string, ageDays: number, clientId = 'vn.eno.web', appleSub = `sub-${userId}`): Row =>
  ({ userId, clientId, appleSub, tokenEnc: 'v1.x.y.z', queuedAt: new Date(Date.now() - ageDays * DAY), attempts: ageDays, lastError: 'network' })

beforeEach(() => {
  process.env.CRON_SECRET = 'cron-secret'
  h.ids = { services: 'vn.eno.web', bundle: 'vn.eno.app' }
  h.probe = { 'vn.eno.web': 'ok', 'vn.eno.app': 'ok' }
  h.authTables = { flowState: 'readable', identities: 'readable', users: 'readable' }
  h.oldestMs = null; h.stale = []; h.rows = []; h.orphans = { candidates: 0, queued: 0, unconfirmed: 0 }; h.settle = new Map(); h.settleCalls = []; h.events = []; h.logs = []
  h.table = true
})

describe('GET /api/cron/apple-revocations', () => {
  it('only behind the cron secret', async () => {
    expect((await run('Bearer nope')).status).toBe(401)
    expect(h.events).toEqual([])
  })

  it('a quiet day: both clients probe ok, GoTrue\'s tables readable, nothing due → 200 with both probes', async () => {
    const res = await run()
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      ok: true, probe: { services: 'ok', bundle: 'ok' }, authTables: { flowState: 'readable', identities: 'readable', users: 'readable' }, due: 0, orphaned: 0,
    })
  })

  // ⛔ Verifier, 2026-10-09: every reader of GoTrue's tables turns "cannot read" into "cannot tell" and carries on — no web
  // Apple token kept (flow_state), the retry's live check back to the token table alone (identities) — so nothing said
  // the role had lost its read. Once configured, this run says so — and I11's run (it expects 200) stops the web flip.
  describe('⛔ GoTrue\'s tables, as this role reads them', () => {
    it('flowState unreadable once configured (no web Apple sign-in keeps its token) → logged and 500 — the rows are still settled', async () => {
      h.authTables = { ...h.authTables, flowState: 'unreadable' }
      h.rows = [row('u1', 2)]
      const res = await run()
      expect(res.status).toBe(500)
      expect(await res.json()).toMatchObject({ ok: false, authTables: { flowState: 'unreadable' }, revoked: 1 })
      expect(h.logs.filter((l) => l.startsWith('[auth] apple_auth_table_unreadable'))).toEqual(['[auth] apple_auth_table_unreadable {"table":"flowState","error":null}'])
    })
    it('⛔ identities unreadable once configured → logged, 500, and NO unit settled: the live check cannot see a re-sign-up (round 7)', async () => {
      h.authTables = { ...h.authTables, identities: 'unreadable' }
      h.rows = [row('u1', 2)]
      const res = await run()
      expect(res.status).toBe(500)
      expect(await res.json()).toMatchObject({ ok: false, skipped: 'identities_unreadable', revoked: 0 })
      expect(h.settleCalls).toEqual([])
    })
    it('a probe that could not run carries its SQLSTATE into the log', async () => {
      h.authTables = { flowState: 'unreadable', identities: 'unreadable', users: 'unreadable', error: '42501' }
      const res = await run()
      expect(res.status).toBe(500)
      const lines = h.logs.filter((l) => l.startsWith('[auth] apple_auth_table_unreadable'))
      expect(lines).toHaveLength(2) // flowState and identities; users is only reported
      expect(lines.every((l) => l.includes('"error":"42501"'))).toBe(true)
    })
    it('auth.users unreadable is only reported — the orphan sweep asks GoTrue\'s admin API instead', async () => {
      h.authTables = { ...h.authTables, users: 'unreadable' }
      const res = await run()
      expect(res.status).toBe(200)
      expect(await res.json()).toMatchObject({ ok: true, authTables: { users: 'unreadable' } })
      expect(h.logs).toEqual([])
    })
    it('the dark deploy (neither id set) reports them and stays green, silent', async () => {
      h.ids = { services: null, bundle: null }
      h.authTables = { flowState: 'unreadable', identities: 'unreadable', users: 'unreadable' }
      const res = await run()
      expect(res.status).toBe(200)
      expect(await res.json()).toMatchObject({ ok: true, authTables: { flowState: 'unreadable' } })
      expect(h.logs).toEqual([])
    })
  })

  it('the due rows are settled ONE unit per erased account and Apple ID — both clients together — with the live-account check and the 14-day give-up', async () => {
    h.rows = [row('u1', 2, 'vn.eno.web', 'sub-1'), row('u1', 2, 'vn.eno.app', 'sub-1'), row('u2', 3)]
    const res = await run()
    expect(res.status).toBe(200)
    expect(h.settleCalls.map((c) => c.target)).toEqual([
      { userId: 'u1', appleSub: 'sub-1', clientIds: ['vn.eno.web', 'vn.eno.app'] },
      { userId: 'u2', appleSub: 'sub-u2', clientIds: ['vn.eno.web'] },
    ])
    for (const c of h.settleCalls) {
      expect(c.opts.liveCheck).toBe(true)
      expect(c.opts.giveUpAfterMs).toBe(14 * DAY)
    }
    expect(await res.json()).toMatchObject({ ok: true, due: 3, revoked: 3 })
  })

  it('invalid_client on a probe → logged, that client handed to the units as REFUSED (never sent to Apple), and 500', async () => {
    h.probe['vn.eno.web'] = 'invalid_client'
    h.rows = [row('u1', 2), row('u2', 2, 'vn.eno.app')]
    h.settle.set('u1', [{ clientId: 'vn.eno.web', outcome: 'retried', error: 'invalid_client' }])
    const res = await run()
    expect(res.status).toBe(500)
    expect(await res.json()).toMatchObject({ ok: false, probe: { services: 'invalid_client', bundle: 'ok' }, revoked: 1, retried: 1 })
    expect(h.logs.some((l) => l.startsWith('[auth] apple_client_invalid') && l.includes('services'))).toBe(true)
    for (const c of h.settleCalls) expect([...(c.opts.refusedClients ?? [])]).toEqual(['vn.eno.web'])
  })

  it('every outcome is counted: revoked, manual, retried, dropped (a live account holds the Apple ID), deferred', async () => {
    h.rows = [row('a', 1), row('b', 1), row('c', 1), row('d', 1), row('e', 1)]
    h.settle.set('b', [{ clientId: 'vn.eno.web', outcome: 'manual' }])
    h.settle.set('c', [{ clientId: 'vn.eno.web', outcome: 'retried', error: 'server' }])
    h.settle.set('d', [{ clientId: 'vn.eno.web', outcome: 'dropped' }])
    h.settle.set('e', [{ clientId: 'vn.eno.web', outcome: 'deferred' }])
    const res = await run()
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, due: 5, revoked: 1, manual: 1, retried: 1, dropped: 1, deferred: 1, gaveUp: 0, failed: 0 })
  })

  it('a give-up is logged with the erased account\'s bare id — never the token, never the Apple ID — and the run is red', async () => {
    h.rows = [row('stale', 14.1), row('young', 13)]
    h.settle.set('stale', [{ clientId: 'vn.eno.web', outcome: 'gave_up', error: 'network', attempts: 15 }])
    h.settle.set('young', [{ clientId: 'vn.eno.web', outcome: 'retried', error: 'network' }])
    const res = await run()
    expect(res.status).toBe(500)
    expect(await res.json()).toMatchObject({ ok: false, gaveUp: 1, retried: 1 })
    const gaveUp = h.logs.find((l) => l.startsWith('[auth] apple_revoke_gave_up'))
    expect(gaveUp).toContain('"user":"stale"')
    expect(gaveUp).toContain('"attempts":15')
    expect(gaveUp).not.toContain('v1.x.y.z')
    expect(gaveUp).not.toContain('sub-stale')
  })

  it('a unit the database failed (a lock timeout) leaves its rows queued: counted, red — and the other units still run', async () => {
    h.rows = [row('x', 2), row('y', 2)]
    h.settle.set('x', 'throw')
    const res = await run()
    expect(res.status).toBe(500)
    expect(await res.json()).toMatchObject({ ok: false, failed: 1, revoked: 1 })
    expect(h.events).toEqual(['auth-tables', 'orphans', 'due', 'settle:x', 'settle:y'])
  })

  // ⛔ C2 (codex, commit gate 2026-10-08): a token stored while its account was being deleted stays ACTIVE with no
  // account behind it — invisible to a retry that only reads queued rows. The retry sweeps for them FIRST, so they are
  // due in the same run.
  describe('⛔ C2 — orphaned active rows are queued before the due rows are read', () => {
    it('the sweep runs first, and what it queued is counted', async () => {
      h.orphans = { candidates: 3, queued: 2, unconfirmed: 0 }
      const res = await run()
      expect(h.events.slice(1, 3)).toEqual(['orphans', 'due'])
      expect(await res.json()).toMatchObject({ ok: true, orphaned: 2 })
    })
    it('candidates it could not confirm gone are not queued, and are logged — not an alarm', async () => {
      h.orphans = { candidates: 2, queued: 0, unconfirmed: 2 }
      const res = await run()
      expect(res.status).toBe(200)
      expect(h.logs.some((l) => l.startsWith('[auth] apple_orphan_unconfirmed') && l.includes('"count":2'))).toBe(true)
    })
    it('a sweep the database failed is red, and the due rows are still settled', async () => {
      h.orphans = 'throw'
      h.rows = [row('u1', 2)]
      const res = await run()
      expect(res.status).toBe(500)
      expect(await res.json()).toMatchObject({ ok: false, failed: 1, revoked: 1 })
    })
  })

  it('unconfigured (the dark deploy — neither id set): 200 and the probe says so', async () => {
    h.ids = { services: null, bundle: null }
    const res = await run()
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, probe: { services: 'unconfigured', bundle: 'unconfigured' } })
    expect(h.logs).toEqual([])
  })

  // ⛔ Review, 2026-10-08: the probe only went red on invalid_client, so a deploy that lost APPLE_SIWA_* from the
  // container (`unconfigured` with an id set) or a client Apple refuses another way (`unexpected`) stayed green while
  // every native code exchange failed and every deletion ended `manual`. The box's own check counts those as failures.
  it.each([
    ['unconfigured', 'the key, team or key id gone from the container'],
    ['unexpected', 'Apple refusing the client another way'],
  ])('once configured, `%s` (%s) on a probe → logged and 500', async (word) => {
    h.probe['vn.eno.app'] = word
    const res = await run()
    expect(res.status).toBe(500)
    expect(await res.json()).toMatchObject({ ok: false, probe: { services: 'ok', bundle: word } })
    expect(h.logs.some((l) => l.startsWith('[auth] apple_client_invalid') && l.includes('bundle') && l.includes(word))).toBe(true)
  })

  it('one id set, the other missing: the missing one is a failure too (a half-written env)', async () => {
    h.ids = { services: 'vn.eno.web', bundle: null }
    const res = await run()
    expect(res.status).toBe(500)
    expect(await res.json()).toMatchObject({ ok: false, probe: { services: 'ok', bundle: 'unconfigured' } })
  })

  // ⛔ O4 (opus, commit gate round 2): the timer is in SAFE, so it can be enabled before the DDL — and every run then
  // threw 42P01 on the orphan sweep and the due rows: the unit red every day for a table not yet created.
  describe('⛔ O4 — no token table yet', () => {
    it('the dark deploy before the DDL: 200 { ok, skipped: no_table } — nothing swept or settled, a warning logged', async () => {
      h.ids = { services: null, bundle: null }
      h.table = false
      const res = await run()
      expect(res.status).toBe(200)
      expect(await res.json()).toMatchObject({ ok: true, skipped: 'no_table', due: 0, orphaned: 0, failed: 0 })
      expect(h.events).toEqual(['auth-tables'])
      expect(h.logs).toEqual(['[auth] apple_token_table_missing {}'])
    })
    it('⛔ configured, healthy, NO table: 500 — every Apple sign-in would keep no token (round 12, codex; was 200 under O4)', async () => {
      h.table = false
      const res = await run()
      expect(res.status).toBe(500)
      expect(await res.json()).toMatchObject({ ok: false, skipped: 'no_table', probe: { services: 'ok', bundle: 'ok' } })
      expect(h.logs).toContain('[auth] apple_token_table_missing {"configured":true}')
    })
    it('…but a red probe stays red, table or not', async () => {
      h.table = false
      h.probe['vn.eno.web'] = 'invalid_client'
      const res = await run()
      expect(res.status).toBe(500)
      expect(await res.json()).toMatchObject({ ok: false, skipped: 'no_table', probe: { services: 'invalid_client' } })
    })
  })

  it('⛔ `unreachable` (Apple down — no fault of ours): 200, and NO unit is tried today — the rows wait, queued (round 5)', async () => {
    h.probe = { 'vn.eno.web': 'unreachable', 'vn.eno.app': 'unreachable' }
    h.rows = [row('u1', 2)]
    h.settle.set('u1', [{ clientId: 'vn.eno.web', outcome: 'retried', error: 'network' }])
    const res = await run()
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, skipped: 'apple_unreachable', retried: 0 })
    expect(h.settleCalls).toEqual([])
  })

  it('⛔ skipping is red days BEFORE the drop: a row queued 4 days → 500, logged, nothing dropped (round 11)', async () => {
    h.probe = { 'vn.eno.web': 'unreachable', 'vn.eno.app': 'unreachable' }
    h.oldestMs = 4 * 86_400_000
    const res = await run()
    expect(res.status).toBe(500)
    expect(await res.json()).toMatchObject({ ok: false, skipped: 'apple_unreachable', gaveUp: 0 })
    expect(h.logs.some((l) => l.startsWith('[auth] apple_revocation_stalled') && l.includes('"days":4'))).toBe(true)
    expect(h.events).not.toContain('drop-stale')
  })
  it('⛔ the queue\'s age unreadable while skipping → 500, logged — "cannot tell" is never "nothing waiting" (round 12)', async () => {
    h.probe = { 'vn.eno.web': 'unreachable', 'vn.eno.app': 'unreachable' }
    h.oldestMs = 'throw'
    const res = await run()
    expect(res.status).toBe(500)
    expect(await res.json()).toMatchObject({ ok: false, skipped: 'apple_unreachable' })
    expect(h.logs.some((l) => l.startsWith('[auth] apple_queue_age_unreadable') && l.includes('"code":"57P01"'))).toBe(true)
  })
  it('a short outage stays green: a row queued 1 day → 200, skipped, nothing dropped', async () => {
    h.probe = { 'vn.eno.web': 'unreachable', 'vn.eno.app': 'unreachable' }
    h.oldestMs = 86_400_000
    const res = await run()
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, skipped: 'apple_unreachable' })
    expect(h.events).not.toContain('drop-stale')
  })

  it('⛔ skipping cannot go on silently: Apple unreachable while a queued row is past 14 days → red, logged (round 7)', async () => {
    h.probe = { 'vn.eno.web': 'unreachable', 'vn.eno.app': 'unreachable' }
    h.oldestMs = 15 * 86_400_000
    h.stale = [{ userId: 'u9', clientId: 'vn.eno.web', attempts: 0 }]
    const res = await run()
    expect(res.status).toBe(500)
    expect(await res.json()).toMatchObject({ ok: false, skipped: 'apple_unreachable', gaveUp: 1 })
    expect(h.logs.some((l) => l.startsWith('[auth] apple_revocation_stalled') && l.includes('"days":15'))).toBe(true)
    // ⛔ round 9: the 14-day promise holds through the outage — the stale rows are dropped and each give-up logged
    expect(h.events).toContain('drop-stale')
    expect(h.logs.some((l) => l.startsWith('[auth] apple_revoke_gave_up') && l.includes('"reason":"stalled"'))).toBe(true)
  })

  it('⛔ the orphan sweep runs inside the run\'s budget: it is handed a deadline (round 9)', async () => {
    const before = Date.now()
    await run()
    expect(h.orphanDeadline).not.toBeNull()
    expect(h.orphanDeadline!).toBeGreaterThan(before)
    expect(h.orphanDeadline!).toBeLessThanOrEqual(Date.now() + 120_000)
  })

  it('⛔ a run is bounded: past the budget no new unit starts, the rest is deferred (still queued)', async () => {
    h.rows = [row('u1', 1), row('u2', 1)]
    h.settle.set('u1', [{ clientId: 'vn.eno.web', outcome: 'revoked' }])
    h.settle.set('u2', [{ clientId: 'vn.eno.web', outcome: 'revoked' }])
    const t0 = 1_800_000_000_000
    let calls = 0
    const now = vi.spyOn(Date, 'now').mockImplementation(() => (calls++ < 2 ? t0 : t0 + 121_000))
    try {
      const res = await run()
      expect(await res.json()).toMatchObject({ revoked: 1, deferred: 1 })
      expect(h.settleCalls.map((c) => c.target.userId)).toEqual(['u1'])
    } finally {
      now.mockRestore()
    }
  })
})
