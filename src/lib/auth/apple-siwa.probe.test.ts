// @vitest-environment node
import { generateKeyPairSync } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * ⛔ THE APPLE TOKEN SQL AGAINST A REAL POSTGRES (commit-gate C1–C4, 2026-10-08) — BECAUSE A MOCK CANNOT SAY ANY OF THIS:
 * that the advisory lock really holds a store back while a settle is at Apple; that Prisma 7's interactive transaction
 * (pg adapter) survives ROLLBACK TO SAVEPOINT and still commits the erasure's own writes; that UPDATE … RETURNING
 * hands back the queued rows; that the orphan anti-join, the live-account check and the flow-state lookup mean what
 * they say on real rows.
 *
 * ⛔ OPT-IN, AND ONLY ON A DATABASE THAT SAYS IT IS DISPOSABLE. It CREATES schema `auth` (stand-ins for GoTrue's
 * auth.users, auth.flow_state and auth.identities — the columns these queries read, not GoTrue's DDL — with row-level
 * security ENABLED and no policy, as GoTrue v2.189.0 leaves them), a one-column public."Profile",
 * public.apple_siwa_token (from scripts/apple-siwa-ddl.mjs itself), and empties them between tests. So beyond the race
 * probe's guards (RACE_DB_TESTS=1, a loopback host, never port 5433 — the SSH tunnel to production) the database name
 * must contain probe, throwaway or scratch.
 * The row-level-security cases also create three NOLOGIN roles (siwa_probe_*) and drop them afterwards — they need a
 * user with CREATEROLE (a private cluster's initdb user is a superuser) and skip themselves without one.
 *
 * Run (a private cluster, e.g. `initdb -D <dir> -U probe` + `pg_ctl … -o "-p 55439"` + `createdb siwa_probe`):
 *   DATABASE_URL=postgresql://probe@127.0.0.1:55439/siwa_probe RACE_DB_TESTS=1 npx vitest run src/lib/auth/apple-siwa.probe.test.ts
 */
const url = process.env.DATABASE_URL || ''
const parsed = (() => { try { return new URL(url) } catch { return null } })()
const loopback = ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(parsed?.hostname ?? '')
const disposable = /probe|throwaway|scratch/i.test(parsed?.pathname ?? '')
const live = process.env.RACE_DB_TESTS === '1' && loopback && parsed?.port !== '5433' && disposable

const SERVICES = 'vn.eno.web'
const BUNDLE = 'vn.eno.app'
const SUB = '001.probe'
const OLD = '11111111-0000-4000-8000-0000000000a1'
const NEW = '22222222-0000-4000-8000-0000000000a2'
const FAIL = '33333333-0000-4000-8000-0000000000a3'
const GONE = '44444444-0000-4000-8000-0000000000a4'
const STAYS = '55555555-0000-4000-8000-0000000000a5'
/** NOLOGIN roles for the row-level-security cases: no BYPASSRLS / BYPASSRLS / no USAGE on schema auth. */
const ROLES = ['siwa_probe_norls', 'siwa_probe_bypass', 'siwa_probe_nousage'] as const

describe.skipIf(!live)('the Apple token SQL against a real Postgres', () => {
  let db: typeof import('@/lib/db').db
  let lib: typeof import('./apple-siwa')
  const exec = (sql: string) => db.$executeRawUnsafe(sql)
  const rows = async () => db.$queryRawUnsafe<Array<{ user_id: string; client_id: string; apple_sub: string; queued_at: Date | null; next_attempt_at: Date | null; attempts: number; last_error: string | null }>>(
    `SELECT user_id::text AS user_id, client_id, apple_sub, queued_at, next_attempt_at, attempts, last_error FROM public.apple_siwa_token ORDER BY user_id, client_id`)

  beforeAll(async () => {
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
    vi.stubEnv('APPLE_SIWA_TEAM_ID', 'TEAM123456')
    vi.stubEnv('APPLE_SIWA_KEY_ID', 'KEY1234567')
    vi.stubEnv('APPLE_SIWA_PRIVATE_KEY', Buffer.from(privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()).toString('base64'))
    vi.stubEnv('APPLE_TOKEN_ENC_KEY', 'cd'.repeat(32))
    db = (await import('@/lib/db')).db
    lib = await import('./apple-siwa')
    // The table exactly as the DDL script creates it (its CREATE TABLE / CREATE INDEX statements, read from the file).
    const ddl = readFileSync('scripts/apple-siwa-ddl.mjs', 'utf8')
    const creates = [...ddl.matchAll(/`(CREATE (?:TABLE|INDEX) IF NOT EXISTS [\s\S]*?)`/g)].map((m) => m[1])
    expect(creates.length).toBeGreaterThanOrEqual(2)
    await exec('DROP TABLE IF EXISTS public.apple_siwa_token_away')
    for (const sql of creates) await exec(sql)
    await exec('CREATE TABLE IF NOT EXISTS public."Profile" (id uuid PRIMARY KEY)')
    await exec('CREATE TABLE IF NOT EXISTS public.probe_marker (n int)')
    await exec('CREATE SCHEMA IF NOT EXISTS auth')
    await exec('CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY)')
    await exec('CREATE TABLE IF NOT EXISTS auth.flow_state (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), auth_code text NOT NULL, provider_type text NOT NULL, user_id uuid)')
    // GoTrue's identities since 20231117164230: provider_id (Apple's `sub`), unique per provider.
    await exec('CREATE TABLE IF NOT EXISTS auth.identities (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), provider_id text NOT NULL, user_id uuid NOT NULL, provider text NOT NULL, UNIQUE (provider_id, provider))')
    // …and, as GoTrue's 20240612123726 leaves every auth table: RLS on, no policy (this superuser bypasses it).
    for (const t of ['users', 'flow_state', 'identities']) await exec(`ALTER TABLE auth.${t} ENABLE ROW LEVEL SECURITY`)
    // C1's savepoint path: an UPDATE of FAIL's rows fails, as a lock timeout or any error would.
    await exec(`CREATE OR REPLACE FUNCTION public.probe_refuse() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'probe: update refused'; END $$ LANGUAGE plpgsql`)
    await exec('DROP TRIGGER IF EXISTS probe_refuse ON public.apple_siwa_token')
    await exec(`CREATE TRIGGER probe_refuse BEFORE UPDATE ON public.apple_siwa_token FOR EACH ROW WHEN (OLD.user_id = '${FAIL}'::uuid) EXECUTE FUNCTION public.probe_refuse()`)
  })
  beforeEach(async () => {
    await exec('TRUNCATE public.apple_siwa_token, public."Profile", public.probe_marker, auth.users, auth.flow_state, auth.identities')
  })
  afterEach(() => vi.unstubAllGlobals())
  afterAll(async () => {
    await exec('TRUNCATE public.apple_siwa_token, public."Profile", public.probe_marker, auth.users, auth.flow_state, auth.identities').catch(() => {})
    for (const r of ROLES) await exec(`DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${r}') THEN DROP OWNED BY ${r}; DROP ROLE ${r}; END IF; END $$`).catch(() => {})
    vi.unstubAllEnvs()
    await db.$disconnect()
  })

  /** A row as storeAppleToken writes it, then optionally queued as an erasure leaves it. */
  async function put(userId: string, clientId: string, o: { queued?: boolean; sub?: string } = {}) {
    expect(await lib.storeAppleToken({ userId, clientId, appleSub: o.sub ?? SUB, refreshToken: `r-${clientId}` })).toBe('stored')
    if (o.queued) await exec(`UPDATE public.apple_siwa_token SET queued_at = now() - interval '1 day', next_attempt_at = now() WHERE user_id = '${userId}' AND client_id = '${clientId}'`)
  }
  /** Apple, answering 200 to everything — optionally held until released. */
  function apple(gate?: Promise<void>) {
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (u: string) => {
      calls.push(u.endsWith('/revoke') ? 'revoke' : 'validate')
      if (gate) await gate
      return new Response(u.endsWith('/revoke') ? '' : '{}', { status: 200 })
    }))
    return calls
  }

  it('⛔ C3: a store for the same Apple ID waits on the advisory lock while a settle is at Apple; another Apple ID does not', async () => {
    await put(OLD, BUNDLE, { queued: true })
    let release!: () => void
    const calls = apple(new Promise<void>((r) => { release = r }))
    const settling = lib.settleQueuedTokens({ userId: OLD, appleSub: SUB, clientIds: [BUNDLE] }, { liveCheck: true })
    for (let i = 0; i < 100 && !calls.length; i++) await new Promise((r) => setTimeout(r, 20))
    expect(calls).toEqual(['validate']) // the settle is inside Apple's call, holding the lock

    const storing = lib.storeAppleToken({ userId: NEW, clientId: SERVICES, appleSub: SUB, refreshToken: 'r-new' })
    try {
      expect(await lib.storeAppleToken({ userId: STAYS, clientId: SERVICES, appleSub: '002.other', refreshToken: 'r-x' })).toBe('stored')
      await new Promise((r) => setTimeout(r, 400))
      expect((await rows()).some((r) => r.user_id === NEW)).toBe(false) // ⛔ still waiting on the lock
    } finally {
      release() // even on a failure: an open settle would hold its locks into the next test
    }
    expect(await settling).toEqual([{ clientId: BUNDLE, outcome: 'revoked' }])
    expect(await storing).toBe('stored')
    expect((await rows()).map((r) => [r.user_id, r.client_id, r.queued_at])).toEqual([[NEW, SERVICES, null], [STAYS, SERVICES, null]])
  })

  it('the live-account check on real rows: an active row WITH a profile drops; WITHOUT one defers; none revokes', async () => {
    await put(OLD, BUNDLE, { queued: true })
    await put(NEW, SERVICES)
    let calls = apple()
    expect(await lib.settleQueuedTokens({ userId: OLD, appleSub: SUB, clientIds: [BUNDLE] }, { liveCheck: true })).toEqual([{ clientId: BUNDLE, outcome: 'deferred' }])
    expect(calls).toEqual([])
    expect((await rows()).find((r) => r.user_id === OLD)).toMatchObject({ attempts: 0, last_error: 'deferred_active' })
    await exec(`INSERT INTO public."Profile" (id) VALUES ('${NEW}')`)
    expect(await lib.settleQueuedTokens({ userId: OLD, appleSub: SUB, clientIds: [BUNDLE] }, { liveCheck: true })).toEqual([{ clientId: BUNDLE, outcome: 'dropped' }])
    expect((await rows()).map((r) => r.user_id)).toEqual([NEW])
    await put(OLD, BUNDLE, { queued: true })
    await exec(`DELETE FROM public.apple_siwa_token WHERE user_id = '${NEW}'`)
    calls = apple()
    expect(await lib.settleQueuedTokens({ userId: OLD, appleSub: SUB, clientIds: [BUNDLE] }, { liveCheck: true })).toEqual([{ clientId: BUNDLE, outcome: 'revoked' }])
    expect(calls).toEqual(['validate', 'revoke'])
    expect(await rows()).toEqual([])
  })

  describe('⛔ C1 — queueTokensForErasure inside a real Prisma interactive transaction', () => {
    it('queues the account\'s active rows in the transaction and answers them (RETURNING); due a day out', async () => {
      await put(OLD, SERVICES)
      await put(OLD, BUNDLE)
      await put(STAYS, SERVICES)
      const out = await db.$transaction(async (tx) => {
        const r = await lib.queueTokensForErasure(tx, OLD)
        await tx.$executeRawUnsafe('INSERT INTO public.probe_marker VALUES (1)')
        return r
      })
      expect(out.missingTable).toBe(false)
      expect(out.failed).toBe(false)
      expect(out.keys.map((k) => k.clientId).sort()).toEqual([BUNDLE, SERVICES])
      // Time is compared IN POSTGRES: the pg adapter shifts a timestamptz read in a non-UTC session by its offset
      // (measured here, TimeZone Asia/Ho_Chi_Minh), so a JS-side delta would test the adapter, not the SQL.
      expect(await db.$queryRawUnsafe(`SELECT client_id, queued_at IS NOT NULL AS queued,
          next_attempt_at - now() BETWEEN interval '23 hours 59 minutes' AND interval '1 day' AS due_in_a_day
        FROM public.apple_siwa_token WHERE user_id = '${OLD}' ORDER BY client_id`)).toEqual([
        { client_id: BUNDLE, queued: true, due_in_a_day: true },
        { client_id: SERVICES, queued: true, due_in_a_day: true },
      ])
      expect((await rows()).find((x) => x.user_id === STAYS)!.queued_at).toBeNull()
      // …and the daily retry sees them a day later (dueRevocations' own slack), not before
      expect((await lib.dueRevocations()).length).toBe(0)
      await exec(`UPDATE public.apple_siwa_token SET next_attempt_at = next_attempt_at - interval '1 day' WHERE user_id = '${OLD}'`)
      expect((await lib.dueRevocations()).map((r) => r.userId)).toEqual([OLD, OLD])
    })

    it('a ROLLED BACK erasure leaves the rows active (the queue is part of the transaction)', async () => {
      await put(OLD, SERVICES)
      await expect(db.$transaction(async (tx) => {
        await lib.queueTokensForErasure(tx, OLD)
        throw new Error('erasure failed later')
      })).rejects.toThrow('erasure failed later')
      expect((await rows())[0].queued_at).toBeNull()
    })

    it('⛔ a failing UPDATE is rolled back to its savepoint — and the SAME transaction still commits the erasure\'s other writes', async () => {
      await put(FAIL, SERVICES)
      const out = await db.$transaction(async (tx) => {
        await tx.$executeRawUnsafe('INSERT INTO public.probe_marker VALUES (1)')
        const r = await lib.queueTokensForErasure(tx, FAIL)
        await tx.$executeRawUnsafe('INSERT INTO public.probe_marker VALUES (2)')
        return r
      })
      expect(out).toEqual({ keys: [], missingTable: false, failed: true })
      expect(await db.$queryRawUnsafe<Array<{ n: number }>>('SELECT n FROM public.probe_marker ORDER BY n')).toEqual([{ n: 1 }, { n: 2 }])
      expect((await rows())[0].queued_at).toBeNull() // not queued: the caller hands it over after the commit
    })

    it('no table at all: nothing fails inside the transaction, which commits', async () => {
      await exec('ALTER TABLE public.apple_siwa_token RENAME TO apple_siwa_token_away')
      try {
        const out = await db.$transaction(async (tx) => {
          const r = await lib.queueTokensForErasure(tx, OLD)
          await tx.$executeRawUnsafe('INSERT INTO public.probe_marker VALUES (7)')
          return r
        })
        expect(out).toEqual({ keys: [], missingTable: true, failed: false })
        expect(await db.$queryRawUnsafe('SELECT n FROM public.probe_marker')).toEqual([{ n: 7 }])
      } finally {
        await exec('ALTER TABLE public.apple_siwa_token_away RENAME TO apple_siwa_token')
      }
    })
  })

  it('⛔ C2: queueUnsettledTokens answers the rows it queued; queueOrphanedTokens queues only active rows with no Profile AND no auth user', async () => {
    await put(OLD, SERVICES)
    expect(await lib.queueUnsettledTokens(OLD)).toEqual([{ userId: OLD, clientId: SERVICES, appleSub: SUB }])
    expect(await lib.queueUnsettledTokens(OLD)).toEqual([]) // already queued

    await put(GONE, SERVICES)                         // no profile, no auth user: an orphan
    await put(NEW, SERVICES)                          // no profile yet, but the auth user exists: a live sign-up
    await put(STAYS, BUNDLE)                          // a profile (and so an auth user)
    await exec(`INSERT INTO auth.users (id) VALUES ('${NEW}'), ('${STAYS}')`)
    await exec(`INSERT INTO public."Profile" (id) VALUES ('${STAYS}')`)
    expect(await lib.authUserState(GONE)).toBe('gone')
    expect(await lib.authUserState(NEW)).toBe('present')
    expect(await lib.queueOrphanedTokens()).toEqual({ candidates: 2, queued: 1, unconfirmed: 0 })
    const all = await rows()
    expect(all.find((r) => r.user_id === GONE)).toMatchObject({ last_error: 'orphaned' })
    expect(await db.$queryRawUnsafe(`SELECT next_attempt_at <= now() AS due_now FROM public.apple_siwa_token WHERE user_id = '${GONE}'`)).toEqual([{ due_now: true }])
    expect(all.find((r) => r.user_id === NEW)!.queued_at).toBeNull()
    expect(all.find((r) => r.user_id === STAYS)!.queued_at).toBeNull()
  })

  /** GoTrue's identity row for an Apple sign-in, as both its web flow and its native id_token grant write it. */
  const identity = (userId: string, sub = SUB, provider = 'apple') =>
    exec(`INSERT INTO auth.identities (provider_id, user_id, provider) VALUES ('${sub}', '${userId}', '${provider}')`)

  describe('⛔ the retry\'s second live check: GoTrue\'s own identities (verifier, 2026-10-09)', () => {
    it('a re-sign-up whose token was NEVER KEPT — its Apple identity, no token row, no profile yet → dropped; Apple never asked', async () => {
      await put(OLD, BUNDLE, { queued: true })
      await identity(NEW)
      const calls = apple()
      expect(await lib.settleQueuedTokens({ userId: OLD, appleSub: SUB, clientIds: [BUNDLE] }, { liveCheck: true })).toEqual([{ clientId: BUNDLE, outcome: 'dropped' }])
      expect(calls).toEqual([])
      expect(await rows()).toEqual([])
    })

    it('another Apple ID, another provider, or "Apple" spelled as an authorize request may spell it', async () => {
      await put(OLD, BUNDLE, { queued: true })
      await identity(NEW, '002.other')
      await identity(NEW, SUB, 'google')
      let calls = apple()
      expect(await lib.settleQueuedTokens({ userId: OLD, appleSub: SUB, clientIds: [BUNDLE] }, { liveCheck: true })).toEqual([{ clientId: BUNDLE, outcome: 'revoked' }])
      expect(calls).toEqual(['validate', 'revoke'])
      await put(OLD, BUNDLE, { queued: true })
      await identity(STAYS, SUB, 'Apple') // GoTrue keeps the provider as the authorize request spelled it
      calls = apple()
      expect(await lib.settleQueuedTokens({ userId: OLD, appleSub: SUB, clientIds: [BUNDLE] }, { liveCheck: true })).toEqual([{ clientId: BUNDLE, outcome: 'dropped' }])
      expect(calls).toEqual([])
    })

    it('the erased account\'s OWN identity (auth user kept): with a Profile again → dropped; without → revoked', async () => {
      await put(OLD, BUNDLE, { queued: true })
      await identity(OLD)
      let calls = apple()
      expect(await lib.settleQueuedTokens({ userId: OLD, appleSub: SUB, clientIds: [BUNDLE] }, { liveCheck: true })).toEqual([{ clientId: BUNDLE, outcome: 'revoked' }])
      expect(calls).toEqual(['validate', 'revoke'])
      await put(OLD, BUNDLE, { queued: true })
      await exec(`INSERT INTO public."Profile" (id) VALUES ('${OLD}')`)
      calls = apple()
      expect(await lib.settleQueuedTokens({ userId: OLD, appleSub: SUB, clientIds: [BUNDLE] }, { liveCheck: true })).toEqual([{ clientId: BUNDLE, outcome: 'dropped' }])
      expect(calls).toEqual([])
    })

    it('⛔ no auth.identities at all: the failed read is rolled back to its savepoint INSIDE the settle, which goes on (token table alone) and commits', async () => {
      await put(OLD, BUNDLE, { queued: true })
      await exec('ALTER TABLE auth.identities RENAME TO identities_away')
      try {
        const calls = apple()
        expect(await lib.settleQueuedTokens({ userId: OLD, appleSub: SUB, clientIds: [BUNDLE] }, { liveCheck: true })).toEqual([{ clientId: BUNDLE, outcome: 'revoked' }])
        expect(calls).toEqual(['validate', 'revoke'])
        expect(await rows()).toEqual([]) // the DELETE after the failed statement committed
      } finally {
        await exec('ALTER TABLE auth.identities_away RENAME TO identities')
      }
    })
  })

  describe('⛔ row-level security: the grant alone reads nothing (verifier, 2026-10-09)', () => {
    /** The roles, once; false when this user cannot create roles (the cases then skip themselves). */
    let roles: Promise<boolean> | null = null
    const ensureRoles = () => (roles ??= (async () => {
      const [me] = await db.$queryRawUnsafe<Array<{ can: boolean }>>('SELECT rolsuper OR rolcreaterole AS can FROM pg_roles WHERE rolname = current_user')
      if (!me?.can) return false
      await exec(`DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'siwa_probe_norls') THEN CREATE ROLE siwa_probe_norls NOLOGIN NOBYPASSRLS; END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'siwa_probe_bypass') THEN CREATE ROLE siwa_probe_bypass NOLOGIN BYPASSRLS; END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'siwa_probe_nousage') THEN CREATE ROLE siwa_probe_nousage NOLOGIN BYPASSRLS; END IF;
      END $$`)
      // What GoTrue grants postgres — SELECT on its tables — to the first two; the third gets the grants but no USAGE.
      await exec('GRANT USAGE ON SCHEMA auth TO siwa_probe_norls, siwa_probe_bypass')
      await exec('GRANT SELECT ON auth.users, auth.flow_state, auth.identities TO siwa_probe_norls, siwa_probe_bypass, siwa_probe_nousage')
      await exec('GRANT SELECT ON public."Profile" TO siwa_probe_norls, siwa_probe_bypass, siwa_probe_nousage')
      return true
    })())
    /** Run `fn` inside a transaction AS `role` (SET LOCAL ROLE), rolled back afterwards. */
    async function as<T>(role: string, fn: (tx: Parameters<Parameters<typeof db.$transaction>[0]>[0]) => Promise<T>): Promise<T> {
      let out!: T
      await db.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL ROLE ${role}`)
        out = await fn(tx)
        throw new Error('probe: roll back')
      }).catch((e: unknown) => { if ((e as Error).message !== 'probe: roll back') throw e })
      return out
    }

    it('probeAuthTables: this superuser reads all three; a role holding the grant WITHOUT BYPASSRLS reads none; BYPASSRLS reads all; no USAGE → all unreadable, 42501', async (ctx) => {
      if (!(await ensureRoles())) return ctx.skip()
      expect(await lib.probeAuthTables()).toEqual({ flowState: 'readable', identities: 'readable', users: 'readable' })
      expect(await as('siwa_probe_norls', (tx) => lib.probeAuthTables(tx))).toEqual({ flowState: 'unreadable', identities: 'unreadable', users: 'unreadable' })
      expect(await as('siwa_probe_bypass', (tx) => lib.probeAuthTables(tx))).toEqual({ flowState: 'readable', identities: 'readable', users: 'readable' })
      expect(await as('siwa_probe_nousage', (tx) => lib.probeAuthTables(tx))).toEqual({ flowState: 'unreadable', identities: 'unreadable', users: 'unreadable', error: '42501' })
      // and a table that is not there is unreadable, the others unaffected
      await exec('ALTER TABLE auth.flow_state RENAME TO flow_state_away')
      try {
        expect(await lib.probeAuthTables()).toEqual({ flowState: 'unreadable', identities: 'readable', users: 'readable' })
      } finally {
        await exec('ALTER TABLE auth.flow_state_away RENAME TO flow_state')
      }
    })

    it('appleIdHeldElsewhere: rows hidden by RLS read as "cannot tell" (null), never as "nobody holds it"; BYPASSRLS sees the holder', async (ctx) => {
      if (!(await ensureRoles())) return ctx.skip()
      await identity(NEW)
      expect(await db.$transaction((tx) => lib.appleIdHeldElsewhere(tx, SUB, OLD))).toBe(true)
      expect(await as('siwa_probe_norls', (tx) => lib.appleIdHeldElsewhere(tx, SUB, OLD))).toBeNull()
      expect(await as('siwa_probe_bypass', (tx) => lib.appleIdHeldElsewhere(tx, SUB, OLD))).toBe(true)
      expect(await as('siwa_probe_bypass', (tx) => lib.appleIdHeldElsewhere(tx, '002.other', OLD))).toBe(false)
      expect(await as('siwa_probe_nousage', (tx) => lib.appleIdHeldElsewhere(tx, SUB, OLD))).toBeNull() // permission denied, rolled back
    })
  })

  it('⛔ the orphan sweep\'s window ROTATES: least recently touched first, and what it could not confirm gone goes to the back', async () => {
    const [A, B, C] = ['aaaaaaaa-0000-4000-8000-0000000000b1', 'bbbbbbbb-0000-4000-8000-0000000000b2', 'cccccccc-0000-4000-8000-0000000000b3']
    for (const u of [A, B, C]) await put(u, SERVICES)
    await exec(`INSERT INTO auth.users (id) VALUES ('${A}'), ('${B}'), ('${C}')`) // all live: never confirmed gone
    await exec(`UPDATE public.apple_siwa_token SET updated_at = now() - CASE user_id WHEN '${A}' THEN interval '3 days' WHEN '${B}' THEN interval '2 days' ELSE interval '1 day' END`)
    const stale = async () => (await db.$queryRawUnsafe<Array<{ user_id: string }>>(
      `SELECT user_id::text AS user_id FROM public.apple_siwa_token WHERE updated_at < now() - interval '1 hour' ORDER BY user_id`)).map((r) => r.user_id)
    expect(await lib.queueOrphanedTokens(2)).toEqual({ candidates: 2, queued: 0, unconfirmed: 0 })
    expect(await stale()).toEqual([C]) // A and B were looked at and touched; C, behind the window, was not
    expect(await lib.queueOrphanedTokens(2)).toEqual({ candidates: 2, queued: 0, unconfirmed: 0 })
    expect(await stale()).toEqual([]) // …and the next run reached it
    expect((await rows()).every((r) => r.queued_at === null)).toBe(true)
  })

  // ⛔ C4 (codex, commit gate round 2): LIMIT applied to ROWS could fall between one unit's two rows — one client settled
  // today, the other left to validate dead tomorrow. The limit counts units now, and each comes back whole.
  it('⛔ C4: dueRevocations\' limit counts (account, Apple ID) units — a boundary inside a unit brings all of it', async () => {
    const [X, Y, Z] = ['aaaaaaaa-0000-4000-8000-0000000000c1', 'bbbbbbbb-0000-4000-8000-0000000000c2', 'cccccccc-0000-4000-8000-0000000000c3']
    await put(X, SERVICES, { queued: true, sub: '001.x' })
    await put(Y, SERVICES, { queued: true })
    await put(Y, BUNDLE, { queued: true })
    await put(Z, SERVICES, { queued: true, sub: '001.z' })
    await exec(`UPDATE public.apple_siwa_token SET next_attempt_at = now() - CASE user_id WHEN '${X}' THEN interval '3 hours' WHEN '${Y}' THEN interval '2 hours' ELSE interval '1 hour' END`)
    // What a row LIMIT of 2 returned: X's row and ONE of Y's two — the unit cut in two.
    expect((await db.$queryRawUnsafe<Array<{ user_id: string }>>(
      `SELECT user_id::text AS user_id FROM public.apple_siwa_token WHERE queued_at IS NOT NULL ORDER BY next_attempt_at LIMIT 2`)).map((r) => r.user_id)).toEqual([X, Y])
    const pairs = async (limit: number) => (await lib.dueRevocations(limit)).map((r) => [r.userId, r.clientId])
    expect(await pairs(2)).toEqual([[X, SERVICES], [Y, BUNDLE], [Y, SERVICES]])
    // a sibling not yet due rides with its unit — they share one grouped authorization
    await exec(`UPDATE public.apple_siwa_token SET next_attempt_at = now() + interval '1 day' WHERE user_id = '${Y}' AND client_id = '${BUNDLE}'`)
    expect(await pairs(2)).toEqual([[X, SERVICES], [Y, BUNDLE], [Y, SERVICES]])
    // …and a unit with nothing due is not chosen
    await exec(`UPDATE public.apple_siwa_token SET next_attempt_at = now() + interval '1 day' WHERE user_id = '${Y}'`)
    expect(await pairs(2)).toEqual([[X, SERVICES], [Z, SERVICES]])
  })

  // ⛔ O3 (opus, commit gate round 2): on the deletion request the settle could wait 25 s for the Apple ID's lock.
  it('⛔ O3: handed the erasure\'s deadline, a settle waits ≤ 3 s for a HELD Apple ID lock (55P03), then throws — the rows untouched', async () => {
    await put(OLD, BUNDLE, { queued: true })
    const calls = apple()
    let release!: () => void
    const released = new Promise<void>((r) => { release = r })
    let locked!: () => void
    const isLocked = new Promise<void>((r) => { locked = r })
    // the daily retry (or a store) holding the lock — for 10 s at most, so a failure here cannot hang the suite
    const holder = db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lib.appleSubLockKey(SUB)}))`
      locked()
      await Promise.race([released, new Promise((r) => setTimeout(r, 10_000))])
    }, { timeout: 20_000 })
    await isLocked
    const started = Date.now()
    let err: unknown = null
    try {
      await lib.settleQueuedTokens({ userId: OLD, appleSub: SUB, clientIds: [BUNDLE] }, { liveCheck: false, deadline: started + 9_000 })
    } catch (e) {
      err = e
    } finally {
      release()
    }
    const took = Date.now() - started
    await holder
    expect(String((err as Error | null)?.message ?? err)).toMatch(/55P03|lock timeout/i)
    expect(took).toBeGreaterThanOrEqual(2_500)
    expect(took).toBeLessThan(6_000)
    expect(calls).toEqual([])
    expect(await rows()).toMatchObject([{ user_id: OLD, client_id: BUNDLE, attempts: 0, last_error: null }]) // still queued, the retry's
    expect((await rows())[0].queued_at).not.toBeNull()
  })

  // ⛔ Verifier, commit gate round 2: the lock wait was fixed at entry, so a pool busy for most of the budget AND a held
  // lock ended the settle a full lock wait past its deadline (55P03 at 5429 ms against 3000 ms). The wait for a pooled
  // connection now comes off the lock wait.
  it('⛔ O3: a busy pool comes off the lock wait — a held lock times out by the deadline, not 3 s after it', async () => {
    await put(OLD, BUNDLE, { queued: true })
    const calls = apple()
    let released = false
    let locked!: () => void
    const isLocked = new Promise<void>((r) => { locked = r })
    /** When the settle first waited on the Apple ID's lock — after its BEGIN, so after it got a pooled connection. */
    let lockWaitFrom = 0
    // the holder of the lock watches for the settle's wait from its own connection, the one the pool cannot lend out
    const holder = db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lib.appleSubLockKey(SUB)}))`
      locked()
      for (const until = Date.now() + 10_000; !released && Date.now() < until;) {
        if (!lockWaitFrom) {
          // pg_stat_activity is read once per transaction and cached: drop the snapshot before each look
          await tx.$executeRaw`SELECT pg_stat_clear_snapshot()`
          const [w] = await tx.$queryRaw<Array<{ n: number }>>`
            SELECT count(*)::int AS n FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND wait_event = 'advisory'`
          if (w?.n) lockWaitFrom = Date.now()
        }
        await new Promise((r) => setTimeout(r, 20))
      }
    }, { timeout: 20_000 })
    await isLocked
    // node-postgres' pool holds 10: the holder has one, these take the other nine for about 2.2 s of the settle's 3 s
    // (`.then` starts each: a Prisma promise is lazy, and runs only once something awaits it)
    const busy = Array.from({ length: 9 }, () => db.$executeRawUnsafe('SELECT pg_sleep(2.4)').then(() => undefined))
    await new Promise((r) => setTimeout(r, 200))
    const started = Date.now()
    let err: unknown = null
    try {
      await lib.settleQueuedTokens({ userId: OLD, appleSub: SUB, clientIds: [BUNDLE] }, { liveCheck: false, deadline: started + 3_000 })
    } catch (e) {
      err = e
    } finally {
      released = true
    }
    const took = Date.now() - started
    await Promise.all(busy)
    await holder
    expect(String((err as Error | null)?.message ?? err)).toMatch(/55P03|lock timeout/i)
    expect(lockWaitFrom - started).toBeGreaterThanOrEqual(1_800) // it did wait about 2.2 s for a connection…
    expect(took).toBeLessThan(3_600) // …and then only what the deadline left for the lock (fixed at entry: about 5.2 s)
    expect(calls).toEqual([])
    expect(await rows()).toMatchObject([{ user_id: OLD, client_id: BUNDLE, attempts: 0, last_error: null }])
    expect((await rows())[0].queued_at).not.toBeNull()
  }, 15_000)

  // ⛔ O4 (opus, commit gate round 2): the daily retry, installed before the DDL, threw 42P01 every day.
  it('⛔ O4: appleTokenTablePresent and hasQueuedTokens answer — with the table and without it — where dueRevocations throws', async () => {
    await put(OLD, SERVICES, { queued: true })
    await put(NEW, SERVICES)
    expect(await lib.appleTokenTablePresent()).toBe(true)
    expect(await lib.hasQueuedTokens(OLD)).toBe(true)
    expect(await lib.hasQueuedTokens(NEW)).toBe(false) // active, not queued
    await exec('ALTER TABLE public.apple_siwa_token RENAME TO apple_siwa_token_away')
    try {
      expect(await lib.appleTokenTablePresent()).toBe(false)
      expect(await lib.hasQueuedTokens(OLD)).toBe(false)
      await expect(lib.dueRevocations()).rejects.toThrow() // what every daily run hit before the check
    } finally {
      await exec('ALTER TABLE public.apple_siwa_token_away RENAME TO apple_siwa_token')
    }
  })

  it('⛔ C4: pkceCodeProvider reads auth.flow_state by the code — Apple\'s, Google\'s, nobody\'s', async () => {
    await exec(`INSERT INTO auth.flow_state (auth_code, provider_type, user_id) VALUES ('code-apple', 'apple', '${NEW}'), ('code-google', 'google', '${NEW}')`)
    expect(await lib.pkceCodeProvider('code-apple')).toEqual({ provider: 'apple', userId: NEW })
    expect(await lib.pkceCodeProvider('code-google')).toEqual({ provider: 'google', userId: NEW })
    expect(await lib.pkceCodeProvider('code-unknown')).toBeNull()
    expect(await lib.pkceCodeProvider("x' OR '1'='1")).toBeNull() // a parameter, never SQL
  })
})
