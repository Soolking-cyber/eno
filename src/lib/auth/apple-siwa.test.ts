import { createVerify, generateKeyPairSync } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The Apple server library (plan §7.8, §8): the client secret's header and claims, the AES-GCM seal bound to
 * its row, the exact bodies sent to Apple's token and revoke endpoints, 'unconfigured' instead of a throw, the
 * validate-then-revoke settle, the erasure's hand-over (C1, C2), the orphan sweep (C2) and its rotating window, the
 * Apple ID lock (C3), the PKCE provider lookup (C4), the retry's second live check against GoTrue's own identities,
 * GoTrue's 404 that alone means "gone", the auth-table probe (verifier, 2026-10-09), and a grep guard against the
 * AASA's team-id variable.
 */
const h = vi.hoisted(() => ({
  exec: [] as Array<{ sql: string; values: unknown[]; tx: number }>,
  query: [] as Array<{ sql: string; values: unknown[]; tx: number }>,
  execImpl: null as null | ((sql: string, values: unknown[]) => Promise<number>),
  queryImpl: null as null | ((sql: string, values: unknown[]) => Promise<unknown[]>),
  logs: [] as string[],
  events: [] as string[],
  /** One mutex PER LOCK KEY, standing in for pg_advisory_xact_lock. */
  locks: {} as Record<string, Promise<void>>,
  /** Every statement, in order, with the transaction it ran in (0: the client itself). */
  stmts: [] as Array<{ tx: number; sql: string }>,
  txSeq: 0,
  txOptions: [] as unknown[],
  /** Runs before a transaction's callback: the wait for a pooled connection, then BEGIN (O3's slow-BEGIN test). */
  onBegin: null as null | (() => void | Promise<void>),
  /** The build's edition (a build-time constant — a getter, the aasa route.test.ts pattern). */
  marketplace: false,
}))
vi.mock('@/lib/edition', async (orig) => ({
  ...(await orig<typeof import('@/lib/edition')>()),
  get IS_MARKETPLACE() { return h.marketplace },
}))
vi.mock('@/lib/db', () => {
  /** Raw SQL on the client (tx 0) or inside a transaction; `onLock` is the transaction's advisory-lock hook. */
  const raw = (tx: number, onLock?: (key: string) => Promise<void>) => ({
    $executeRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join('?')
      h.exec.push({ sql, values, tx })
      h.stmts.push({ tx, sql })
      if (onLock && sql.includes('pg_advisory_xact_lock')) await onLock(String(values[0]))
      return h.execImpl ? h.execImpl(sql, values) : 1
    },
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join('?')
      h.query.push({ sql, values, tx })
      h.stmts.push({ tx, sql })
      return h.queryImpl ? h.queryImpl(sql, values) : []
    },
  })
  return {
    db: {
      ...raw(0),
      /**
       * ⛔ THE TRANSACTION ALONE DOES NOT SERIALISE — ONLY THE ADVISORY LOCK DOES, as under READ COMMITTED (the
       * messages.offer-action.test.ts lesson: a mock that serialised every transaction would leave the lock line dead
       * weight). The keyed mutex is taken when THIS transaction runs pg_advisory_xact_lock(hashtext(key)), and released
       * when its callback settles — commit or rollback, as a transaction-scoped lock is.
       */
      $transaction: async (fn: (tx: unknown) => Promise<unknown>, options?: unknown) => {
        const id = ++h.txSeq
        h.txOptions.push(options)
        if (h.onBegin) await h.onBegin()
        const releases: Array<() => void> = []
        const tx = raw(id, async (key) => {
          const prev = h.locks[key] ?? Promise.resolve()
          let release!: () => void
          const mine = new Promise<void>((r) => { release = r })
          h.locks[key] = prev.then(() => mine)
          releases.push(release)
          await prev
          h.events.push(`locked:${key}`)
        })
        try {
          return await fn(tx)
        } finally {
          for (const r of releases) r()
        }
      },
    },
  }
})
vi.mock('@/lib/log', () => ({
  logWarn: (m: string, ctx?: unknown) => { h.logs.push(`${m} ${JSON.stringify(ctx ?? {})}`) },
  logError: (e: unknown, ctx?: unknown) => { h.logs.push(`${String(e)} ${JSON.stringify(ctx ?? {})}`) },
}))

const lib = await import('./apple-siwa')

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
const P8 = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
const ENC_KEY = 'ab'.repeat(32)
const SERVICES = 'vn.eno.web'
const BUNDLE = 'vn.eno.app'
const USER = '11111111-2222-4333-8444-555555555555'

const configure = () => {
  vi.stubEnv('APPLE_SIWA_TEAM_ID', 'TEAM123456')
  vi.stubEnv('APPLE_SIWA_KEY_ID', 'KEY1234567')
  vi.stubEnv('APPLE_SIWA_PRIVATE_KEY', Buffer.from(P8).toString('base64'))
  vi.stubEnv('APPLE_SIWA_SERVICES_ID', SERVICES)
  vi.stubEnv('APPLE_SIWA_BUNDLE_ID', BUNDLE)
  vi.stubEnv('APPLE_TOKEN_ENC_KEY', ENC_KEY)
}
const decode = (part: string) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'))
const idToken = (claims: Record<string, unknown>) => `${Buffer.from('{"alg":"RS256"}').toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`

type Sent = { url: string; form: Record<string, string> }
const sent: Sent[] = []
const appleAnswers = (...answers: Array<{ status: number; body?: unknown } | 'throw'>) => {
  sent.length = 0
  let i = 0
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    sent.push({ url, form: Object.fromEntries(new URLSearchParams(String(init.body))) })
    const a = answers[Math.min(i++, answers.length - 1)]
    if (a === 'throw') throw new TypeError('fetch failed')
    return new Response(a.body === undefined ? '' : JSON.stringify(a.body), { status: a.status })
  }))
}

beforeEach(() => {
  h.exec = []; h.query = []; h.execImpl = null; h.queryImpl = null; h.logs = []
  h.events = []; h.locks = {}; h.txSeq = 0; h.txOptions = []; h.stmts = []; h.onBegin = null
  h.marketplace = false
  configure()
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('mintClientSecret', () => {
  it('signs an ES256 JWT with kid, and iss/aud/sub/iat/exp ≤ iat+300 — verifiable with the public key', () => {
    const now = Date.UTC(2026, 9, 8, 12, 0, 0)
    const jwt = lib.mintClientSecret(BUNDLE, now)
    expect(jwt).not.toBe('unconfigured')
    const [header, claims, sig] = String(jwt).split('.')
    expect(decode(header)).toEqual({ alg: 'ES256', kid: 'KEY1234567' })
    const c = decode(claims)
    expect(c).toEqual({ iss: 'TEAM123456', iat: now / 1000, exp: now / 1000 + 300, aud: 'https://appleid.apple.com', sub: BUNDLE })
    const ok = createVerify('SHA256').update(`${header}.${claims}`).verify({ key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url'))
    expect(ok).toBe(true)
  })

  it('accepts a raw PEM — even with escaped newlines — as well as base64', () => {
    vi.stubEnv('APPLE_SIWA_PRIVATE_KEY', P8)
    expect(lib.mintClientSecret(SERVICES)).not.toBe('unconfigured')
    vi.stubEnv('APPLE_SIWA_PRIVATE_KEY', P8.trim().replace(/\n/g, '\\n'))
    expect(lib.mintClientSecret(SERVICES)).not.toBe('unconfigured')
  })

  it("is 'unconfigured' — never a throw — for any missing or unreadable piece", () => {
    for (const name of ['APPLE_SIWA_TEAM_ID', 'APPLE_SIWA_KEY_ID', 'APPLE_SIWA_PRIVATE_KEY']) {
      configure()
      vi.stubEnv(name, '')
      expect(lib.mintClientSecret(BUNDLE), name).toBe('unconfigured')
    }
    configure()
    vi.stubEnv('APPLE_SIWA_PRIVATE_KEY', Buffer.from('not a key').toString('base64'))
    expect(lib.mintClientSecret(BUNDLE)).toBe('unconfigured')
    expect(h.logs.some((l) => l.startsWith('[auth] apple_key_invalid'))).toBe(true)
  })
})

describe('the sealed token (AES-256-GCM, the row as associated data)', () => {
  it('round-trips', () => {
    const sealed = lib.sealAppleToken('r.refresh-token', USER, SERVICES)!
    expect(sealed).toMatch(/^v1\.[\w-]+\.[\w-]+\.[\w-]+$/)
    expect(sealed).not.toContain('refresh-token')
    expect(lib.openAppleToken(sealed, USER, SERVICES)).toBe('r.refresh-token')
  })
  it('fails to open on another user, another client, or any tampering', () => {
    const sealed = lib.sealAppleToken('r.refresh-token', USER, SERVICES)!
    expect(lib.openAppleToken(sealed, '99999999-2222-4333-8444-555555555555', SERVICES)).toBeNull()
    expect(lib.openAppleToken(sealed, USER, BUNDLE)).toBeNull()
    const [v, iv, tag, ct] = sealed.split('.')
    const flipped = Buffer.from(ct, 'base64url'); flipped[0] ^= 1
    expect(lib.openAppleToken([v, iv, tag, flipped.toString('base64url')].join('.'), USER, SERVICES)).toBeNull()
    expect(lib.openAppleToken('garbage', USER, SERVICES)).toBeNull()
  })
  // ⛔ Review, 2026-10-08: without authTagLength Node's GCM decipher accepts a tag cut short (only a deprecation
  // warning) — and a 4-byte tag is a 2^32 forgery. Exactly 16 bytes of tag and 12 of IV, or nothing opens.
  it('refuses a tag cut short, and an IV of any other length — even when the rest is genuine', () => {
    const sealed = lib.sealAppleToken('r.refresh-token', USER, SERVICES)!
    const [v, iv, tag, ct] = sealed.split('.')
    const tagBytes = Buffer.from(tag, 'base64url')
    expect(tagBytes).toHaveLength(16)
    for (const n of [15, 12, 8, 4]) {
      expect(lib.openAppleToken([v, iv, tagBytes.subarray(0, n).toString('base64url'), ct].join('.'), USER, SERVICES), `${n}-byte tag`).toBeNull()
    }
    expect(lib.openAppleToken([v, Buffer.concat([Buffer.from(iv, 'base64url'), Buffer.alloc(4)]).toString('base64url'), tag, ct].join('.'), USER, SERVICES)).toBeNull()
    expect(lib.openAppleToken([v, iv, tag, ct].join('.'), USER, SERVICES)).toBe('r.refresh-token')
  })
  it('without a usable key: nothing is sealed, nothing opens', () => {
    const sealed = lib.sealAppleToken('t', USER, SERVICES)!
    vi.stubEnv('APPLE_TOKEN_ENC_KEY', '')
    expect(lib.sealAppleToken('t', USER, SERVICES)).toBeNull()
    expect(lib.openAppleToken(sealed, USER, SERVICES)).toBeNull()
    vi.stubEnv('APPLE_TOKEN_ENC_KEY', Buffer.alloc(16).toString('base64')) // 16 bytes: not AES-256
    expect(lib.sealAppleToken('t', USER, SERVICES)).toBeNull()
  })
})

describe('what is sent to Apple', () => {
  it('exchangeCode: authorization_code for the bundle, NO redirect_uri, sub read off the id_token', async () => {
    appleAnswers({ status: 200, body: { access_token: 'a', refresh_token: 'r1', id_token: idToken({ sub: '001.abc' }) } })
    const r = await lib.exchangeCode(BUNDLE, 'c.code')
    expect(r).toEqual({ ok: true, refreshToken: 'r1', sub: '001.abc' })
    expect(sent[0].url).toBe('https://appleid.apple.com/auth/token')
    expect(Object.keys(sent[0].form).sort()).toEqual(['client_id', 'client_secret', 'code', 'grant_type'])
    expect(sent[0].form).toMatchObject({ client_id: BUNDLE, code: 'c.code', grant_type: 'authorization_code' })
    expect(decode(sent[0].form.client_secret.split('.')[1]).sub).toBe(BUNDLE)
  })
  it('validateRefresh: grant_type=refresh_token with the token', async () => {
    appleAnswers({ status: 200, body: { access_token: 'a', id_token: idToken({ sub: '001.abc' }) } })
    expect(await lib.validateRefresh(SERVICES, 'r1')).toEqual({ ok: true })
    expect(sent[0].form).toMatchObject({ client_id: SERVICES, grant_type: 'refresh_token', refresh_token: 'r1' })
    expect(decode(sent[0].form.client_secret.split('.')[1]).sub).toBe(SERVICES)
  })
  it('revoke: the revoke endpoint, token + token_type_hint=refresh_token', async () => {
    appleAnswers({ status: 200 })
    expect(await lib.revoke(SERVICES, 'r1')).toEqual({ ok: true })
    expect(sent[0].url).toBe('https://appleid.apple.com/auth/revoke')
    expect(Object.keys(sent[0].form).sort()).toEqual(['client_id', 'client_secret', 'token', 'token_type_hint'])
    expect(sent[0].form).toMatchObject({ client_id: SERVICES, token: 'r1', token_type_hint: 'refresh_token' })
  })
  it('maps Apple\'s answers to error words', async () => {
    appleAnswers({ status: 400, body: { error: 'invalid_grant' } })
    expect(await lib.validateRefresh(SERVICES, 'r')).toEqual({ ok: false, error: 'invalid_grant' })
    appleAnswers({ status: 400, body: { error: 'invalid_client' } })
    expect(await lib.validateRefresh(SERVICES, 'r')).toEqual({ ok: false, error: 'invalid_client' })
    appleAnswers({ status: 400, body: { error: 'invalid_request' } })
    expect(await lib.validateRefresh(SERVICES, 'r')).toEqual({ ok: false, error: 'rejected' })
    appleAnswers({ status: 503 })
    expect(await lib.revoke(SERVICES, 'r')).toEqual({ ok: false, error: 'server' })
    appleAnswers({ status: 429 })
    expect(await lib.revoke(SERVICES, 'r')).toEqual({ ok: false, error: 'server' })
    appleAnswers('throw')
    expect(await lib.exchangeCode(BUNDLE, 'c')).toEqual({ ok: false, error: 'network' })
  })
  it("'unconfigured' sends nothing", async () => {
    appleAnswers({ status: 200 })
    vi.stubEnv('APPLE_SIWA_KEY_ID', '')
    expect(await lib.exchangeCode(BUNDLE, 'c')).toEqual({ ok: false, error: 'unconfigured' })
    expect(await lib.validateRefresh(BUNDLE, 'r')).toEqual({ ok: false, error: 'unconfigured' })
    expect(await lib.revoke(BUNDLE, 'r')).toEqual({ ok: false, error: 'unconfigured' })
    expect(await lib.probeClient(BUNDLE)).toBe('unconfigured')
    expect(await lib.probeClient(null)).toBe('unconfigured')
    expect(sent).toEqual([])
  })
  it('probeClient: code=probe must answer invalid_grant; invalid_client is the alarm', async () => {
    appleAnswers({ status: 400, body: { error: 'invalid_grant' } })
    expect(await lib.probeClient(SERVICES)).toBe('ok')
    expect(sent[0].form).toMatchObject({ client_id: SERVICES, code: 'probe', grant_type: 'authorization_code' })
    expect(sent[0].form.redirect_uri).toBeUndefined()
    appleAnswers({ status: 400, body: { error: 'invalid_client' } })
    expect(await lib.probeClient(SERVICES)).toBe('invalid_client')
    appleAnswers('throw')
    expect(await lib.probeClient(SERVICES)).toBe('unreachable')
    appleAnswers({ status: 200, body: {} })
    expect(await lib.probeClient(SERVICES)).toBe('unexpected')
  })
})

describe('checkStoredToken + revokeCheckedToken: validate, then revoke', () => {
  const row = () => ({ userId: USER, clientId: SERVICES, appleSub: '001.abc', tokenEnc: lib.sealAppleToken('r1', USER, SERVICES)!, queuedAt: null, attempts: 0, lastError: null })
  it('the check sends only the refresh grant; valid / dead / retry', async () => {
    appleAnswers({ status: 200, body: {} })
    expect(await lib.checkStoredToken(row())).toEqual({ state: 'valid', token: 'r1' })
    expect(sent.map((x) => x.url)).toEqual(['https://appleid.apple.com/auth/token'])
    appleAnswers({ status: 400, body: { error: 'invalid_grant' } })
    expect(await lib.checkStoredToken(row())).toEqual({ state: 'dead' })
    appleAnswers({ status: 502 })
    expect(await lib.checkStoredToken(row())).toEqual({ state: 'retry', error: 'server' })
    appleAnswers('throw')
    expect(await lib.checkStoredToken(row())).toEqual({ state: 'retry', error: 'network' })
    appleAnswers({ status: 400, body: { error: 'invalid_client' } })
    expect(await lib.checkStoredToken(row())).toEqual({ state: 'retry', error: 'invalid_client' })
  })
  it('a token that cannot be opened is retried, never sent', async () => {
    appleAnswers({ status: 200 })
    expect(await lib.checkStoredToken({ ...row(), userId: '99999999-2222-4333-8444-555555555555' })).toEqual({ state: 'retry', error: 'undecryptable' })
    expect(sent).toEqual([])
  })
  it('the revoke: the revoke endpoint with the opened token', async () => {
    appleAnswers({ status: 200 })
    expect(await lib.revokeCheckedToken(row(), 'r1')).toEqual({ outcome: 'revoked' })
    expect(sent[0]).toMatchObject({ url: 'https://appleid.apple.com/auth/revoke', form: { token: 'r1' } })
    appleAnswers('throw')
    expect(await lib.revokeCheckedToken(row(), 'r1')).toEqual({ outcome: 'retry', error: 'network' })
  })
})

// ── The table, in memory ─────────────────────────────────────────────────────────────────────────────

const DAY = 24 * 60 * 60 * 1000
const OLD = '11111111-0000-4000-8000-000000000001' // an erased account
const NEW = '22222222-0000-4000-8000-000000000002' // a later account of the same Apple ID
const SUB = '001.abc'
type Mem = { user_id: string; client_id: string; apple_sub: string; token_enc: string; queued_at: Date | null; next_attempt_at: Date | null; attempts: number; last_error: string | null }
const mem = (userId: string, clientId: string, o: Partial<Mem> = {}): Mem => ({
  user_id: userId, client_id: clientId, apple_sub: SUB, token_enc: lib.sealAppleToken(`r-${clientId}`, userId, clientId)!,
  queued_at: new Date(Date.now() - DAY), next_attempt_at: new Date(), attempts: 1, last_error: 'network', ...o,
})
const active = (userId: string, clientId: string, o: Partial<Mem> = {}) => mem(userId, clientId, { queued_at: null, next_attempt_at: null, attempts: 0, last_error: null, ...o })

/** One of GoTrue's auth.identities rows, as appleIdHeldElsewhere reads them (sub defaults to SUB, provider to apple). */
type Ident = { userId: string; sub?: string; provider?: string }
/**
 * public.apple_siwa_token (and which accounts have a public."Profile", and GoTrue's auth.identities), in memory,
 * answering exactly the statements this module sends — so the settle, the store and the lock act on ONE shared state,
 * as they would on Postgres. `identityRead`: 'visible' (a role that sees every row — production's BYPASSRLS postgres),
 * 'hidden' (row-level security: no row visible), 'refused' (no privilege: the read throws).
 */
function memTable(
  initial: Mem[],
  profiles = new Set<string>(),
  o: { insert?: Promise<void>; identities?: Ident[]; identityRead?: 'visible' | 'hidden' | 'refused' } = {},
) {
  const rows = initial.map((r) => ({ ...r }))
  h.queryImpl = async (sql, v) => {
    if (sql.includes('AS live')) {
      const act = rows.filter((r) => r.apple_sub === v[0] && !r.queued_at)
      return [{ live: act.some((r) => profiles.has(r.user_id)), active: act.length > 0 }]
    }
    if (sql.includes('FROM auth.identities')) {
      if (o.identityRead === 'refused') throw Object.assign(new Error('permission denied for table identities'), { code: 'P2010', meta: { driverAdapterError: { cause: { originalCode: '42501' } } } })
      if (o.identityRead === 'hidden') return [{ visible: false, held: false }]
      const [sub, userId] = v as string[]
      const held = (o.identities ?? []).some((i) => (i.sub ?? SUB) === sub && (i.provider ?? 'apple').toLowerCase() === 'apple' && (i.userId !== userId || profiles.has(i.userId)))
      return [{ visible: true, held }]
    }
    if (sql.includes('FROM public.apple_siwa_token') && sql.includes('apple_sub = ?') && sql.includes('queued_at IS NOT NULL')) {
      return rows.filter((r) => r.user_id === v[0] && r.apple_sub === v[1] && r.queued_at).map((r) => ({ ...r }))
    }
    return []
  }
  h.execImpl = async (sql, v) => {
    if (sql.includes('INSERT INTO public.apple_siwa_token')) {
      if (o.insert) await o.insert
      const [u, c, sub, tok] = v as string[]
      const r = rows.find((x) => x.user_id === u && x.client_id === c)
      const fresh = { apple_sub: sub, token_enc: tok, queued_at: null, next_attempt_at: null, attempts: 0, last_error: null }
      if (r) Object.assign(r, fresh)
      else rows.push({ user_id: u, client_id: c, ...fresh })
      h.events.push(`insert:${sub}:${u.slice(0, 8)}`)
      return 1
    }
    if (sql.includes('DELETE FROM public.apple_siwa_token')) {
      const i = rows.findIndex((r) => r.user_id === v[0] && r.client_id === v[1] && r.token_enc === v[2] && r.queued_at)
      if (i < 0) return 0
      rows.splice(i, 1)
      h.events.push(`delete:${String(v[1])}`)
      return 1
    }
    if (sql.includes('attempts = attempts + ?')) {
      const r = rows.find((x) => x.user_id === v[2] && x.client_id === v[3] && x.token_enc === v[4] && x.queued_at)
      if (!r) return 0
      r.attempts += Number(v[0])
      r.last_error = String(v[1])
      r.next_attempt_at = new Date(Date.now() + DAY)
      h.events.push(`requeue:${String(v[3])}`)
      return 1
    }
    return 1
  }
  return rows
}

/**
 * Apple, answering per call kind and client — and, like the real thing, ONE grouped authorization per Apple ID: once a
 * token of it is revoked, every token of it validates dead. `gate` holds every answer until released.
 */
function appleGrouped(o: { validate?: (client: string) => { status: number; body?: unknown } | 'throw'; revoke?: (client: string) => { status: number; body?: unknown } | 'throw'; gate?: Promise<void> } = {}) {
  sent.length = 0
  let revoked = false
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    const form = Object.fromEntries(new URLSearchParams(String(init.body)))
    const kind = url.endsWith('/revoke') ? 'revoke' : 'validate'
    sent.push({ url, form })
    h.events.push(`apple:${kind}:${form.client_id}`)
    if (o.gate) await o.gate
    const a = kind === 'revoke'
      ? (o.revoke?.(form.client_id) ?? { status: 200 })
      : revoked ? { status: 400, body: { error: 'invalid_grant' } } : (o.validate?.(form.client_id) ?? { status: 200, body: {} })
    if (a === 'throw') throw new TypeError('fetch failed')
    if (kind === 'revoke' && a.status === 200) revoked = true
    return new Response(a.body === undefined ? '' : JSON.stringify(a.body), { status: a.status })
  }))
}
/** Let every pending microtask and timer-free continuation run. */
const settle = () => new Promise((r) => setTimeout(r, 0))

describe('settleQueuedTokens — the unit the erasure and the daily retry both run', () => {
  const target = (...clientIds: string[]) => ({ userId: OLD, appleSub: SUB, clientIds })

  it('one transaction holding the Apple ID\'s lock: lock_timeout, then the lock, BEFORE the rows are read', async () => {
    memTable([mem(OLD, SERVICES)])
    appleGrouped()
    await lib.settleQueuedTokens(target(SERVICES), { liveCheck: false })
    expect(h.exec.find((x) => x.sql.includes('pg_advisory_xact_lock'))?.values).toEqual([lib.appleSubLockKey(SUB)])
    expect(lib.appleSubLockKey(SUB)).toBe('apple-siwa:001.abc')
    // lock_timeout first, the lock second, and only then the rows are read — every statement inside transaction 1
    const seq = h.stmts.filter((x) => x.tx === 1).map((x) => x.sql)
    expect(seq[0]).toContain("set_config('lock_timeout'")
    expect(seq[1]).toContain('pg_advisory_xact_lock(hashtext(')
    expect(seq[2]).toContain('FROM public.apple_siwa_token')
    expect(h.stmts.filter((x) => x.tx === 0)).toEqual([])
    // Prisma's 5 s default would end the transaction inside ONE Apple call; four calls (two rows) + the lock wait fit.
    expect((h.txOptions[0] as { timeout: number }).timeout).toBeGreaterThanOrEqual(4 * lib.APPLE_TIMEOUT_MS + 25_000)
  })

  // ⛔ L1-2, kept: the two clients share ONE grouped authorization — revoking the first kills the second. Checked one
  // row at a time, the second answered invalid_grant and a person eno was removed for was told "remove it yourself".
  it('two rows of one authorization: BOTH validated, THEN both revoked — revoked twice, never manual', async () => {
    const rows = memTable([mem(OLD, SERVICES), mem(OLD, BUNDLE)])
    appleGrouped()
    expect(await lib.settleQueuedTokens(target(SERVICES, BUNDLE), { liveCheck: false })).toEqual([
      { clientId: SERVICES, outcome: 'revoked' },
      { clientId: BUNDLE, outcome: 'revoked' },
    ])
    expect(h.events.filter((e) => e.startsWith('apple:'))).toEqual([
      `apple:validate:${SERVICES}`, `apple:validate:${BUNDLE}`, `apple:revoke:${SERVICES}`, `apple:revoke:${BUNDLE}`,
    ])
    expect(rows).toEqual([])
  })

  it('dead → manual and the row goes; a failure → a day later with one more attempt, the row kept', async () => {
    const rows = memTable([mem(OLD, SERVICES), mem(OLD, BUNDLE)])
    appleGrouped({ validate: (c) => (c === SERVICES ? { status: 400, body: { error: 'invalid_grant' } } : { status: 503 }) })
    expect(await lib.settleQueuedTokens(target(SERVICES, BUNDLE), { liveCheck: false })).toEqual([
      { clientId: SERVICES, outcome: 'manual' },
      { clientId: BUNDLE, outcome: 'retried', error: 'server' },
    ])
    expect(rows.map((r) => [r.client_id, r.attempts, r.last_error])).toEqual([[BUNDLE, 2, 'server']])
    expect(sent.some((x) => x.url.endsWith('/revoke'))).toBe(false)
  })

  it('a client the probe found refused is never sent to Apple: retried as invalid_client', async () => {
    const rows = memTable([mem(OLD, SERVICES), mem(OLD, BUNDLE)])
    appleGrouped()
    const out = await lib.settleQueuedTokens(target(SERVICES, BUNDLE), { liveCheck: false, refusedClients: new Set([SERVICES]) })
    expect(out).toEqual([{ clientId: SERVICES, outcome: 'retried', error: 'invalid_client' }, { clientId: BUNDLE, outcome: 'revoked' }])
    expect(sent.every((x) => x.form.client_id === BUNDLE)).toBe(true)
    expect(rows.map((r) => r.client_id)).toEqual([SERVICES])
  })

  it('past the give-up a failing row goes (gave_up, attempts counted); a success on the last day is still a revocation', async () => {
    const old = new Date(Date.now() - 14.1 * DAY)
    let rows = memTable([mem(OLD, SERVICES, { queued_at: old, attempts: 13 })])
    appleGrouped({ validate: () => 'throw' })
    expect(await lib.settleQueuedTokens(target(SERVICES), { liveCheck: true, giveUpAfterMs: 14 * DAY })).toEqual([
      { clientId: SERVICES, outcome: 'gave_up', error: 'network', attempts: 14 },
    ])
    expect(rows).toEqual([])
    rows = memTable([mem(OLD, SERVICES, { queued_at: old })])
    appleGrouped()
    expect(await lib.settleQueuedTokens(target(SERVICES), { liveCheck: true, giveUpAfterMs: 14 * DAY })).toEqual([{ clientId: SERVICES, outcome: 'revoked' }])
  })

  it('a row no longer queued when the lock is granted — re-activated by a sign-in, or settled elsewhere — is skipped', async () => {
    const rows = memTable([active(OLD, SERVICES)])
    appleGrouped()
    expect(await lib.settleQueuedTokens(target(SERVICES, BUNDLE), { liveCheck: false })).toEqual([
      { clientId: SERVICES, outcome: 'skipped' },
      { clientId: BUNDLE, outcome: 'skipped' },
    ])
    expect(sent).toEqual([])
    expect(rows[0].queued_at).toBeNull()
  })

  it('every write is compare-and-set on the token it read: a token re-stored meanwhile is never deleted or requeued', async () => {
    memTable([mem(OLD, SERVICES), mem(OLD, BUNDLE)])
    appleGrouped({ validate: (c) => (c === BUNDLE ? { status: 503 } : { status: 200, body: {} }) })
    await lib.settleQueuedTokens(target(SERVICES, BUNDLE), { liveCheck: false })
    const del = h.exec.find((x) => x.sql.includes('DELETE FROM public.apple_siwa_token'))!
    expect(del.sql).toMatch(/token_enc = \?/)
    expect(del.sql).toContain('queued_at IS NOT NULL')
    const upd = h.exec.find((x) => x.sql.includes('attempts = attempts + ?'))!
    expect(upd.sql).toMatch(/token_enc = \?/)
    expect(upd.sql).toContain('queued_at IS NOT NULL')
  })

  /**
   * ⛔ O3 (opus, commit gate round 2): the erasure's settle — on the deletion REQUEST — could wait 10 s for a connection,
   * 25 s for the lock and 4 × 5 s for Apple. Handed the erasure's deadline it waits ≤ 3 s for the lock, bounds the
   * transaction and every call by the deadline, and sends nothing with under a second left: queued for the daily retry.
   */
  describe('⛔ O3 — a deadline (the erasure\'s request path)', () => {
    it('the lock waited for at most 3 s, the transaction bounded by the deadline; the daily retry\'s bounds untouched', async () => {
      memTable([mem(OLD, SERVICES)])
      appleGrouped()
      expect(await lib.settleQueuedTokens(target(SERVICES), { liveCheck: false, deadline: Date.now() + 9_000 })).toEqual([{ clientId: SERVICES, outcome: 'revoked' }])
      const waits = () => h.exec.filter((x) => x.sql.includes("set_config('lock_timeout'")).map((x) => String(x.values[0]))
      expect(lib.APPLE_ERASURE_LOCK_WAIT_MS).toBe(3_000)
      expect(waits()[0]).toBe('3000ms')
      const tx = h.txOptions[0] as { maxWait: number; timeout: number }
      expect(tx.maxWait).toBeLessThanOrEqual(9_000)
      expect(tx.timeout).toBeLessThanOrEqual(9_000 + 5_000)
      // under 3 s left, the lock is waited for only that long
      memTable([mem(OLD, SERVICES)])
      await lib.settleQueuedTokens(target(SERVICES), { liveCheck: false, deadline: Date.now() + 2_000 })
      expect(parseInt(waits()[1], 10)).toBeLessThanOrEqual(2_000)
      // no deadline (the daily retry): as before
      memTable([mem(OLD, SERVICES)])
      await lib.settleQueuedTokens(target(SERVICES), { liveCheck: true })
      expect(waits()[2]).toBe('25s')
      expect((h.txOptions[2] as { timeout: number }).timeout).toBe(90_000)
    })

    it('no time left: Apple is never asked — every row deferred, still queued, no attempt counted', async () => {
      const rows = memTable([mem(OLD, SERVICES), mem(OLD, BUNDLE)])
      appleGrouped()
      expect(await lib.settleQueuedTokens(target(SERVICES, BUNDLE), { liveCheck: false, deadline: Date.now() + 500 })).toEqual([
        { clientId: SERVICES, outcome: 'deferred' },
        { clientId: BUNDLE, outcome: 'deferred' },
      ])
      expect(sent).toEqual([])
      expect(rows.map((r) => [r.client_id, r.attempts, r.last_error, r.queued_at !== null])).toEqual([[SERVICES, 1, 'deadline', true], [BUNDLE, 1, 'deadline', true]])
    })

    it('Apple hanging: the call is cut at what is left of the deadline — never a full 5 s — and the next row is not sent', async () => {
      const rows = memTable([mem(OLD, SERVICES), mem(OLD, BUNDLE)])
      sent.length = 0
      vi.stubGlobal('fetch', vi.fn((url: string, init: RequestInit) => {
        sent.push({ url, form: Object.fromEntries(new URLSearchParams(String(init.body))) })
        return new Promise((_, reject) => init.signal!.addEventListener('abort', () => reject(init.signal!.reason)))
      }))
      const started = Date.now()
      const out = await lib.settleQueuedTokens(target(SERVICES, BUNDLE), { liveCheck: false, deadline: started + 1_500 })
      const took = Date.now() - started
      expect(out).toEqual([{ clientId: SERVICES, outcome: 'retried', error: 'network' }, { clientId: BUNDLE, outcome: 'deferred' }])
      expect(took).toBeGreaterThanOrEqual(1_000)
      expect(took).toBeLessThan(lib.APPLE_TIMEOUT_MS) // unbounded, the one hanging call alone took 5 s
      expect(sent).toHaveLength(1)
      expect(rows.map((r) => [r.client_id, r.attempts])).toEqual([[SERVICES, 2], [BUNDLE, 1]])
    })

    it('time running out after the checks: checked, not revoked — retried as `deadline`, the attempt counted', async () => {
      const rows = memTable([mem(OLD, SERVICES)])
      let clock = Date.now()
      const now = vi.spyOn(Date, 'now').mockImplementation(() => clock)
      try {
        sent.length = 0
        vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
          sent.push({ url, form: Object.fromEntries(new URLSearchParams(String(init.body))) })
          clock += 2_500 // Apple took 2.5 s
          return new Response(url.endsWith('/revoke') ? '' : '{}', { status: 200 })
        }))
        expect(await lib.settleQueuedTokens(target(SERVICES), { liveCheck: false, deadline: clock + 3_000 })).toEqual([
          { clientId: SERVICES, outcome: 'retried', error: 'deadline' },
        ])
      } finally {
        now.mockRestore()
      }
      expect(sent.map((x) => x.url)).toEqual(['https://appleid.apple.com/auth/token']) // validated, never revoked
      expect(rows[0]).toMatchObject({ attempts: 2, last_error: 'deadline' })
    })

    // ⛔ Verifier, commit gate round 2: the lock wait was computed at entry, BEFORE the wait for a pooled connection — a
    // pool busy for most of the budget and a held lock ended the settle up to 3 s past its deadline (55P03 at 5429 ms
    // against 3000 ms, measured). It is now what the deadline leaves once the transaction has begun.
    it('a slow BEGIN (a busy pool) comes off the lock wait — and with under a second left after it, Apple is not asked', async () => {
      const waits = () => h.exec.filter((x) => x.sql.includes("set_config('lock_timeout'")).map((x) => String(x.values[0]))
      let clock = Date.now()
      const now = vi.spyOn(Date, 'now').mockImplementation(() => clock)
      try {
        // 2.4 s of a 3 s deadline spent waiting for a connection: 600 ms left for the lock — not the 3 s computed at entry
        let rows = memTable([mem(OLD, SERVICES)])
        appleGrouped()
        h.onBegin = () => { clock += 2_400 }
        expect(await lib.settleQueuedTokens(target(SERVICES), { liveCheck: false, deadline: clock + 3_000 })).toEqual([{ clientId: SERVICES, outcome: 'deferred' }])
        expect(rows[0]).toMatchObject({ attempts: 1, last_error: 'deadline' }) // still queued, no attempt counted
        // the deadline already past at BEGIN: the shortest wait Postgres can be given (0 would mean no timeout at all)
        h.onBegin = () => { clock += 3_500 }
        expect(await lib.settleQueuedTokens(target(SERVICES), { liveCheck: false, deadline: clock + 3_000 })).toEqual([{ clientId: SERVICES, outcome: 'deferred' }])
        expect(sent).toEqual([])
        // 1.5 s spent, 1.5 s left: the lock is waited for that long, and Apple still asked within it
        rows = memTable([mem(OLD, SERVICES)])
        h.onBegin = () => { clock += 1_500 }
        expect(await lib.settleQueuedTokens(target(SERVICES), { liveCheck: false, deadline: clock + 3_000 })).toEqual([{ clientId: SERVICES, outcome: 'revoked' }])
        expect(rows).toEqual([])
      } finally {
        now.mockRestore()
      }
      expect(waits()).toEqual(['600ms', '100ms', '1500ms'])
      // no deadline (the daily retry): its 25 s, however long BEGIN took
      memTable([mem(OLD, SERVICES)])
      h.onBegin = async () => { await new Promise((r) => setTimeout(r, 5)) }
      await lib.settleQueuedTokens(target(SERVICES), { liveCheck: true })
      expect(waits()[3]).toBe('25s')
    })
  })

  describe('liveCheck (the daily retry): who else holds this Apple ID', () => {
    it('a LIVE account (an active row WITH a profile) → dropped: nothing sent, the queued rows go', async () => {
      const rows = memTable([mem(OLD, SERVICES), mem(OLD, BUNDLE), active(NEW, BUNDLE)], new Set([NEW]))
      appleGrouped()
      expect(await lib.settleQueuedTokens(target(SERVICES, BUNDLE), { liveCheck: true })).toEqual([
        { clientId: SERVICES, outcome: 'dropped' },
        { clientId: BUNDLE, outcome: 'dropped' },
      ])
      expect(sent).toEqual([])
      expect(rows.map((r) => r.user_id)).toEqual([NEW])
    })

    // ⛔ C2's second half: an active row with NO account behind it (an orphan) used to count as a live account, so the
    // retry DROPPED another erasure's token without revoking it. It decides nothing now: neither revoke nor drop.
    it('an active row with NO profile (an orphan not yet confirmed, or a profile not yet written) → deferred: nothing sent, no attempt counted', async () => {
      const rows = memTable([mem(OLD, SERVICES, { attempts: 3 }), active(NEW, SERVICES)])
      appleGrouped()
      expect(await lib.settleQueuedTokens(target(SERVICES), { liveCheck: true })).toEqual([{ clientId: SERVICES, outcome: 'deferred' }])
      expect(sent).toEqual([])
      expect(rows.find((r) => r.user_id === OLD)).toMatchObject({ attempts: 3, last_error: 'deferred_active' })
    })

    it('no active row and no Apple identity elsewhere → validated and revoked', async () => {
      memTable([mem(OLD, SERVICES)], new Set(), { identities: [{ userId: NEW, sub: '002.other' }, { userId: NEW, provider: 'google' }, { userId: OLD }] })
      appleGrouped()
      expect(await lib.settleQueuedTokens(target(SERVICES), { liveCheck: true })).toEqual([{ clientId: SERVICES, outcome: 'revoked' }])
    })

    // ⛔ Verifier, 2026-10-09: the live check read ONLY this table, and keeping a token is best effort — Apple's token
    // endpoint down for the native exchange (the very outage that left the old token queued), a web callback whose flow
    // state could not be read, a store that gave up on the lock. A re-sign-up whose token was not kept was invisible: the
    // retry validated the old token (alive — it was never revoked, so Apple asked no consent at re-sign-up) and revoked
    // the new account's grouped authorization with it. GoTrue's identity row is always there.
    it('⛔ a re-sign-up whose token was NEVER KEPT — GoTrue\'s Apple identity on another account, no row here → dropped, Apple never asked', async () => {
      const rows = memTable([mem(OLD, SERVICES), mem(OLD, BUNDLE)], new Set([NEW]), { identities: [{ userId: NEW }] })
      appleGrouped()
      expect(await lib.settleQueuedTokens(target(SERVICES, BUNDLE), { liveCheck: true })).toEqual([
        { clientId: SERVICES, outcome: 'dropped' },
        { clientId: BUNDLE, outcome: 'dropped' },
      ])
      expect(sent).toEqual([])
      expect(rows).toEqual([])
      // asked under the Apple ID's lock, in the settle's own transaction, behind a savepoint — before any Apple call
      const seq = h.stmts.filter((x) => x.tx === 1).map((x) => x.sql.trim().split(/\s+/).slice(0, 2).join(' '))
      const at = (p: string) => seq.findIndex((x) => x.startsWith(p))
      expect(at('SAVEPOINT apple_siwa_identity')).toBeGreaterThan(at('SELECT pg_advisory_xact_lock(hashtext(?))'))
      expect(seq[at('SAVEPOINT apple_siwa_identity') + 2]).toBe('RELEASE SAVEPOINT')
      const q = h.query.find((x) => x.sql.includes('FROM auth.identities'))!
      expect(q.tx).toBe(1)
      expect(q.values).toEqual([SUB, OLD])
      expect(q.sql).toContain("lower(i.provider) = 'apple'")
      expect(q.sql).toContain('i.user_id <> ?::uuid')
      expect(q.sql).toContain("NOT row_security_active('auth.identities'::regclass) AS visible")
    })

    it('…even with no Profile written yet (the identity is GoTrue\'s first write, the profile comes after it)', async () => {
      memTable([mem(OLD, SERVICES)], new Set(), { identities: [{ userId: NEW }] })
      appleGrouped()
      expect(await lib.settleQueuedTokens(target(SERVICES), { liveCheck: true })).toEqual([{ clientId: SERVICES, outcome: 'dropped' }])
      expect(sent).toEqual([])
    })

    it('the erased account\'s OWN identity (its auth user was kept): signed into again — a Profile — → dropped; still erased → revoked', async () => {
      memTable([mem(OLD, SERVICES)], new Set([OLD]), { identities: [{ userId: OLD }] })
      appleGrouped()
      expect(await lib.settleQueuedTokens(target(SERVICES), { liveCheck: true })).toEqual([{ clientId: SERVICES, outcome: 'dropped' }])
      expect(sent).toEqual([])
      memTable([mem(OLD, SERVICES)], new Set(), { identities: [{ userId: OLD }] })
      appleGrouped()
      expect(await lib.settleQueuedTokens(target(SERVICES), { liveCheck: true })).toEqual([{ clientId: SERVICES, outcome: 'revoked' }])
    })

    it('GoTrue\'s table unreadable — row-level security hiding it, or a refused read (rolled back to its savepoint) — the token table alone answers, as before, and it is logged', async () => {
      for (const identityRead of ['hidden', 'refused'] as const) {
        h.logs = []; h.exec = []
        memTable([mem(OLD, SERVICES)], new Set(), { identities: [{ userId: NEW }], identityRead })
        appleGrouped()
        expect(await lib.settleQueuedTokens(target(SERVICES), { liveCheck: true }), identityRead).toEqual([{ clientId: SERVICES, outcome: 'revoked' }])
        expect(h.logs.some((l) => l.startsWith('[auth] apple_identity_unverified')), identityRead).toBe(true)
        const tail = identityRead === 'refused' ? 'ROLLBACK TO SAVEPOINT apple_siwa_identity' : 'RELEASE SAVEPOINT apple_siwa_identity'
        expect(h.exec.some((x) => x.sql.trim() === tail), identityRead).toBe(true)
      }
      // …and an active row without a profile still defers, whatever GoTrue could not say
      memTable([mem(OLD, SERVICES), active(NEW, BUNDLE)], new Set(), { identityRead: 'hidden' })
      appleGrouped()
      expect(await lib.settleQueuedTokens(target(SERVICES), { liveCheck: true })).toEqual([{ clientId: SERVICES, outcome: 'deferred' }])
      expect(sent).toEqual([])
    })

    it('a visible held row is proof even when row-level security is on', async () => {
      const tx = { $executeRaw: async () => 1, $queryRaw: async () => [{ visible: false, held: true }] }
      expect(await lib.appleIdHeldElsewhere(tx as never, SUB, OLD)).toBe(true)
      tx.$queryRaw = async () => [{ visible: false, held: false }]
      expect(await lib.appleIdHeldElsewhere(tx as never, SUB, OLD)).toBeNull()
      tx.$queryRaw = async () => [{ visible: true, held: false }]
      expect(await lib.appleIdHeldElsewhere(tx as never, SUB, OLD)).toBe(false)
    })

    it('the erasure (liveCheck false) revokes even beside an active row of its own — a sign-in racing the deletion', async () => {
      memTable([mem(OLD, SERVICES), active(OLD, BUNDLE)], new Set([OLD]))
      appleGrouped()
      expect(await lib.settleQueuedTokens(target(SERVICES), { liveCheck: false })).toEqual([{ clientId: SERVICES, outcome: 'revoked' }])
      expect(h.query.some((x) => x.sql.includes('AS live'))).toBe(false)
    })
  })
})

/**
 * ⛔ C3 (codex, commit gate 2026-10-08): the retry asked "is there an active row for this Apple ID?" and THEN called
 * Apple, with no lock and no re-check — a re-sign-up that stored its token in between had its grouped authorization
 * revoked behind the answer. The store and the settle now take ONE advisory lock per Apple ID; these two tests fail
 * if either lock line is deleted.
 */
describe('⛔ C3 — one lock per Apple ID, taken by every store and every settle', () => {
  it('a store for the same Apple ID WAITS while a settle is at Apple — its row lands after the revoke, never between; another Apple ID does not wait', async () => {
    const rows = memTable([mem(OLD, BUNDLE)], new Set([NEW]))
    let releaseApple!: () => void
    appleGrouped({ gate: new Promise<void>((r) => { releaseApple = r }) })
    const settling = lib.settleQueuedTokens({ userId: OLD, appleSub: SUB, clientIds: [BUNDLE] }, { liveCheck: true })
    await settle()
    expect(h.events).toContain(`apple:validate:${BUNDLE}`) // the settle is inside Apple's call, holding the lock

    const storing = lib.storeAppleToken({ userId: NEW, clientId: SERVICES, appleSub: SUB, refreshToken: 'r-new' })
    const elsewhere = lib.storeAppleToken({ userId: USER, clientId: SERVICES, appleSub: '002.other', refreshToken: 'r-other' })
    expect(await elsewhere).toBe('stored') // a different Apple ID's lock is free
    await settle()
    expect(h.events.some((e) => e.startsWith(`insert:${SUB}`))).toBe(false) // ⛔ still waiting

    releaseApple()
    expect(await settling).toEqual([{ clientId: BUNDLE, outcome: 'revoked' }])
    expect(await storing).toBe('stored')
    const at = (prefix: string) => h.events.findIndex((e) => e.startsWith(prefix))
    expect(at(`insert:${SUB}`)).toBeGreaterThan(at(`apple:revoke:${BUNDLE}`))
    expect(at(`insert:${SUB}`)).toBeGreaterThan(at(`delete:${BUNDLE}`))
    expect(rows.filter((r) => r.apple_sub === SUB).map((r) => [r.user_id, r.queued_at])).toEqual([[NEW, null]])
  })

  it('the question is asked UNDER the lock: a store holding it when the settle starts is seen — dropped, Apple never asked', async () => {
    // The store takes the lock and is held at its INSERT…
    let releaseInsert!: () => void
    const rows = memTable([mem(OLD, BUNDLE)], new Set([NEW]), { insert: new Promise<void>((r) => { releaseInsert = r }) })
    appleGrouped()
    const storing = lib.storeAppleToken({ userId: NEW, clientId: SERVICES, appleSub: SUB, refreshToken: 'r-new' })
    await settle()
    // …while the retry starts on the old account's queued row of the same Apple ID.
    const settling = lib.settleQueuedTokens({ userId: OLD, appleSub: SUB, clientIds: [BUNDLE] }, { liveCheck: true })
    await settle()
    expect(h.query.some((x) => x.sql.includes('AS live'))).toBe(false) // nothing asked yet: it is waiting for the lock
    releaseInsert()
    expect(await storing).toBe('stored')
    expect(await settling).toEqual([{ clientId: BUNDLE, outcome: 'dropped' }])
    expect(sent).toEqual([])
    expect(rows.map((r) => r.user_id)).toEqual([NEW])
  })

  it('⛔ a store waits at most 2 s for the lock — it is on the sign-in path — in a transaction that outlasts its wait', async () => {
    await lib.storeAppleToken({ userId: USER, clientId: SERVICES, appleSub: SUB, refreshToken: 'r' })
    const wait = String(h.exec.find((x) => x.tx === 1 && x.sql.includes("set_config('lock_timeout'"))!.values[0])
    expect(wait).toBe('2s')
    const tx = h.txOptions[0] as { maxWait: number; timeout: number }
    expect(tx.maxWait).toBeLessThanOrEqual(2_000) // the pooled-connection wait counts against a sign-in too
    expect(tx.timeout).toBeGreaterThan(2_000)
    expect(tx.timeout).toBeLessThanOrEqual(5_000)
  })

  it('a store that cannot get the lock in time fails soft (busy) — the sign-in goes on', async () => {
    h.execImpl = async (sql) => {
      if (sql.includes('pg_advisory_xact_lock')) throw Object.assign(new Error('Raw query failed. Code: `55P03`'), { code: 'P2010', meta: { driverAdapterError: { cause: { originalCode: '55P03' } } } })
      return 1
    }
    expect(await lib.storeAppleToken({ userId: USER, clientId: SERVICES, appleSub: SUB, refreshToken: 'r' })).toBe('failed')
    expect(h.logs.some((l) => l.startsWith('[auth] apple_token_not_kept') && l.includes('"reason":"busy"'))).toBe(true)
  })
})

describe('the table', () => {
  it('stores the SEALED token, never the plaintext, and re-activates the row — under the Apple ID\'s lock', async () => {
    expect(await lib.storeAppleToken({ userId: USER, clientId: SERVICES, appleSub: '001.abc', refreshToken: 'r.secret' })).toBe('stored')
    const inTx = h.exec.filter((x) => x.tx === 1)
    expect(inTx.map((x) => x.sql.trim().split(/\s+/).slice(0, 2).join(' '))).toEqual(['SELECT set_config(\'lock_timeout\',', 'SELECT pg_advisory_xact_lock(hashtext(?))', 'INSERT INTO'])
    expect(inTx[1].values).toEqual(['apple-siwa:001.abc'])
    const insert = inTx[2]
    expect(insert.sql).toContain('ON CONFLICT (user_id, client_id) DO UPDATE')
    expect(insert.sql).toContain('queued_at = NULL')
    expect(insert.values.slice(0, 3)).toEqual([USER, SERVICES, '001.abc'])
    expect(JSON.stringify(h.exec.map((x) => x.values))).not.toContain('r.secret')
    expect(lib.openAppleToken(String(insert.values[3]), USER, SERVICES)).toBe('r.secret')
    expect(h.exec.filter((x) => x.tx === 0)).toEqual([]) // nothing outside the transaction
  })
  it('a store never throws: no key → unconfigured; a missing table → failed', async () => {
    vi.stubEnv('APPLE_TOKEN_ENC_KEY', '')
    expect(await lib.storeAppleToken({ userId: USER, clientId: SERVICES, appleSub: 's', refreshToken: 'r' })).toBe('unconfigured')
    expect(h.exec).toEqual([])
    configure()
    h.execImpl = () => Promise.reject(Object.assign(new Error('Raw query failed. Code: `42P01`'), { code: 'P2010', meta: { driverAdapterError: { cause: { originalCode: '42P01' } } } }))
    expect(await lib.storeAppleToken({ userId: USER, clientId: SERVICES, appleSub: 's', refreshToken: 'r' })).toBe('failed')
    expect(h.logs.some((l) => l.includes('"reason":"no_table"'))).toBe(true)
  })
  it('isMissingTable recognises Prisma 7\'s raw-query and typed shapes, and nothing else', () => {
    expect(lib.isMissingTable({ code: 'P2021' })).toBe(true)
    expect(lib.isMissingTable({ code: 'P2010', meta: { driverAdapterError: { cause: { originalCode: '42P01' } } } })).toBe(true)
    expect(lib.isMissingTable({ code: 'P2010', meta: { code: '42P01' } })).toBe(true)
    expect(lib.isMissingTable({ code: 'P2010', meta: { driverAdapterError: { cause: { originalCode: '23505' } } } })).toBe(false)
    expect(lib.isMissingTable(new Error('timeout'))).toBe(false)
    expect(lib.isMissingTable(null)).toBe(false)
  })
  // ⛔ Review, 2026-10-08: due "to the second" made the daily retry every other day — the timer's random delay is
  // drawn afresh each morning, and a row tried at 09:15:37 was not due at 09:15:10 the next day.
  it('a row is due within the slack, so a daily timer with a random delay never skips a day', async () => {
    await lib.dueRevocations(50)
    expect(h.query[0].sql).toContain('next_attempt_at <= now() + ?::interval')
    expect(h.query[0].values).toEqual([lib.APPLE_DUE_SLACK, 50])
    expect(lib.APPLE_DUE_SLACK).toBe('2 hours')
  })
  // ⛔ C4 (codex, commit gate round 2): a LIMIT on rows could fall between one unit's two rows — one client settled
  // today, the other (dead by then) read `manual` tomorrow. The real-Postgres proof is apple-siwa.probe.test.ts.
  it('⛔ the limit counts UNITS (account, Apple ID) — chosen first — and every queued row of each comes back', async () => {
    await lib.dueRevocations(7)
    const sql = h.query[0].sql.replace(/\s+/g, ' ').trim()
    expect(sql).toMatch(/^WITH due AS \( SELECT user_id, apple_sub, min\(next_attempt_at\) AS first_due FROM public\.apple_siwa_token WHERE queued_at IS NOT NULL AND next_attempt_at <= now\(\) \+ \?::interval GROUP BY user_id, apple_sub ORDER BY first_due, user_id, apple_sub LIMIT \? \)/)
    expect(sql).toContain('JOIN due d ON d.user_id = t.user_id AND d.apple_sub = t.apple_sub WHERE t.queued_at IS NOT NULL')
    expect(sql).toMatch(/ORDER BY d\.first_due, t\.user_id, t\.apple_sub, t\.client_id$/) // no LIMIT on the rows themselves
    expect(h.query[0].values).toEqual([lib.APPLE_DUE_SLACK, 7])
  })
  it('appleTokenTablePresent: to_regclass, so a missing table fails no statement', async () => {
    h.queryImpl = async () => [{ present: false }]
    expect(await lib.appleTokenTablePresent()).toBe(false)
    expect(h.query[0].sql).toBe("SELECT to_regclass('public.apple_siwa_token') IS NOT NULL AS present")
    h.queryImpl = async () => [{ present: true }]
    expect(await lib.appleTokenTablePresent()).toBe(true)
  })
  it('hasQueuedTokens: queued rows of this account → true; none, or no table (never asked) → false; a failed read → null', async () => {
    h.queryImpl = async (sql) => (sql.includes('to_regclass') ? [{ present: true }] : [{ queued: true }])
    expect(await lib.hasQueuedTokens(USER)).toBe(true)
    expect(h.query[1].sql).toContain('WHERE user_id = ?::uuid AND queued_at IS NOT NULL')
    expect(h.query[1].values).toEqual([USER])
    h.queryImpl = async (sql) => (sql.includes('to_regclass') ? [{ present: true }] : [{ queued: false }])
    expect(await lib.hasQueuedTokens(USER)).toBe(false)
    h.query = []
    h.queryImpl = async (sql) => (sql.includes('to_regclass') ? [{ present: false }] : Promise.reject(new Error('must not run')))
    expect(await lib.hasQueuedTokens(USER)).toBe(false)
    expect(h.query).toHaveLength(1)
    h.queryImpl = async () => { throw Object.assign(new Error('timeout'), { code: 'P2010', meta: { driverAdapterError: { cause: { originalCode: '57014' } } } }) }
    expect(await lib.hasQueuedTokens(USER)).toBeNull()
    expect(h.logs.some((l) => l.startsWith('[auth] apple_queue_unreadable') && l.includes('57014'))).toBe(true)
  })
})

/**
 * ⛔ C1 (codex, commit gate 2026-10-08): the erasure committed the profile's deletion BEFORE it queued or revoked the
 * Apple rows, so a crash in between left them active forever (the retry selects queued rows only). They are queued in
 * the erasure's own transaction now. The crash itself is simulated in account-erasure.test.ts; this is the statement.
 */
describe('⛔ C1 — queueTokensForErasure, inside the erasure\'s transaction', () => {
  const tx = () => {
    const calls: string[] = []
    const t = {
      $executeRaw: async (s: TemplateStringsArray, ...v: unknown[]) => { calls.push(`exec ${s.join('?').trim()}`); return h.execImpl ? h.execImpl(s.join('?'), v) : 1 },
      $queryRaw: async (s: TemplateStringsArray, ...v: unknown[]) => { calls.push(`query ${s.join('?').trim()}`); return h.queryImpl ? h.queryImpl(s.join('?'), v) : [] },
    }
    return { t: t as never, calls }
  }

  it('queues every ACTIVE row of the account — due a day out, give-up clock started — and answers which, all on the transaction', async () => {
    h.queryImpl = async (sql) => (sql.includes('to_regclass') ? [{ present: true }] : [{ user_id: USER, client_id: SERVICES, apple_sub: SUB }, { user_id: USER, client_id: BUNDLE, apple_sub: SUB }])
    const { t, calls } = tx()
    expect(await lib.queueTokensForErasure(t, USER)).toEqual({
      keys: [{ userId: USER, clientId: SERVICES, appleSub: SUB }, { userId: USER, clientId: BUNDLE, appleSub: SUB }],
      missingTable: false,
      failed: false,
    })
    expect(calls[0]).toBe('exec SAVEPOINT apple_siwa_erasure')
    expect(calls[1]).toContain("to_regclass('public.apple_siwa_token')")
    expect(calls[2]).toMatch(/^query UPDATE public\.apple_siwa_token\s+SET queued_at = now\(\), next_attempt_at = now\(\) \+ interval '1 day'/)
    expect(calls[2]).toMatch(/WHERE user_id = \?::uuid AND queued_at IS NULL\s+RETURNING user_id::text AS user_id, client_id, apple_sub$/)
    expect(calls[3]).toBe('exec RELEASE SAVEPOINT apple_siwa_erasure')
    expect(h.exec).toEqual([]) // nothing on the client itself — only on the erasure's transaction
  })

  it('no table yet (the DDL not run): nothing is queued and NO statement fails inside the erasure', async () => {
    h.queryImpl = async (sql) => (sql.includes('to_regclass') ? [{ present: false }] : Promise.reject(new Error('must not run')))
    const { t, calls } = tx()
    expect(await lib.queueTokensForErasure(t, USER)).toEqual({ keys: [], missingTable: true, failed: false })
    expect(calls.some((c) => c.includes('UPDATE'))).toBe(false)
    expect(calls.at(-1)).toBe('exec RELEASE SAVEPOINT apple_siwa_erasure')
  })

  it('a failing UPDATE is rolled back to its savepoint and answered — the erasure\'s transaction is never failed by Apple', async () => {
    h.queryImpl = async (sql) => (sql.includes('to_regclass') ? [{ present: true }] : Promise.reject(new Error('lock timeout')))
    const { t, calls } = tx()
    expect(await lib.queueTokensForErasure(t, USER)).toEqual({ keys: [], missingTable: false, failed: true })
    expect(calls.at(-1)).toBe('exec ROLLBACK TO SAVEPOINT apple_siwa_erasure')
  })
})

describe('⛔ C2 — no active row outlives its account', () => {
  it('queueUnsettledTokens: every row of the user still ACTIVE, and only those, queued a day out — answering which', async () => {
    h.queryImpl = async () => [{ user_id: USER, client_id: SERVICES, apple_sub: SUB }]
    expect(await lib.queueUnsettledTokens(USER)).toEqual([{ userId: USER, clientId: SERVICES, appleSub: SUB }])
    expect(h.query[0].sql).toMatch(/WHERE user_id = \?::uuid AND queued_at IS NULL\s+RETURNING/)
    expect(h.query[0].sql).toContain("next_attempt_at = now() + interval '1 day'")
    expect(h.query[0].sql).not.toContain('attempts')
    expect(h.query[0].values).toEqual([USER])
  })

  describe('queueOrphanedTokens — the daily retry\'s sweep', () => {
    const GONE = '33333333-0000-4000-8000-000000000003'
    const LIVE = '44444444-0000-4000-8000-000000000004'
    const LOST = '55555555-0000-4000-8000-000000000005'
    const ROUTE = '66666666-0000-4000-8000-000000000006'
    /** GoTrue's own 404 for a missing user (v2.189.0 admin.go loadUser, default response shape). */
    const NOT_FOUND = { code: 404, error_code: 'user_not_found', msg: 'User not found' }
    /** auth.users: the ids it holds, or a refusal (no privilege), or "readable" but empty (RLS hiding every row). */
    const world = (auth: 'refused' | 'hidden' | string[], candidates: string[]) => {
      h.queryImpl = async (sql, v) => {
        if (sql.includes('NOT EXISTS (SELECT 1 FROM public."Profile"')) return candidates.map((user_id) => ({ user_id }))
        if (sql.includes('FROM auth.users')) {
          if (auth === 'refused') throw Object.assign(new Error('permission denied for table users'), { code: 'P2010', meta: { driverAdapterError: { cause: { originalCode: '42501' } } } })
          if (auth === 'hidden') return [{ readable: false, present: false }]
          return [{ readable: true, present: auth.includes(String(v[0])) }]
        }
        return []
      }
      h.execImpl = async () => 1
    }
    /** GoTrue's admin API per user id: a status (404 = its own user_not_found), a raw answer, or a throw. */
    const gotrue = (byId: Record<string, number | 'throw' | { status: number; body: string }>) => {
      vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://sb.example')
      vi.stubEnv('SUPABASE_SECRET_KEY', 'service')
      vi.stubGlobal('fetch', vi.fn(async (url: string) => {
        const a = byId[url.split('/').pop()!] ?? 500
        if (a === 'throw') throw new Error('timeout')
        if (typeof a === 'object') return new Response(a.body, { status: a.status })
        return new Response(a === 200 ? '{"id":"x"}' : a === 404 ? JSON.stringify(NOT_FOUND) : '', { status: a })
      }))
    }
    const queues = () => h.exec.filter((x) => x.sql.includes('SET queued_at = now()'))
    const touches = () => h.exec.filter((x) => x.sql.includes('SET updated_at = now()') && !x.sql.includes('queued_at = now()'))

    it('candidates are ACTIVE rows with no Profile; only those auth.users confirms gone are queued — due now', async () => {
      world([LIVE], [GONE, LIVE])
      expect(await lib.queueOrphanedTokens()).toEqual({ candidates: 2, queued: 1, unconfirmed: 0 })
      const cand = h.query[0]
      expect(cand.sql).toContain('WHERE t.queued_at IS NULL')
      expect(cand.sql).toContain('NOT EXISTS (SELECT 1 FROM public."Profile" p WHERE p.id = t.user_id)')
      expect(cand.values).toEqual([50])
      const upd = queues()
      expect(upd).toHaveLength(1)
      expect(upd[0].values[0]).toBe(GONE)
      expect(upd[0].sql).toContain('next_attempt_at = now(),')
      expect(upd[0].sql).toContain('WHERE user_id = ?::uuid AND queued_at IS NULL')
      expect(upd[0].sql).toContain('NOT EXISTS (SELECT 1 FROM public."Profile" p WHERE p.id = ?::uuid)')
    })

    it('auth.users not readable by this role → GoTrue\'s admin API decides: its own 404 gone, 200 present, anything else unconfirmed', async () => {
      world('refused', [GONE, LIVE, LOST])
      gotrue({ [GONE]: 404, [LIVE]: 200, [LOST]: 'throw' })
      expect(await lib.queueOrphanedTokens()).toEqual({ candidates: 3, queued: 1, unconfirmed: 1 })
      expect(queues().map((x) => x.values[0])).toEqual([GONE])
    })

    // ⛔ Verifier, 2026-10-09: ANY 404 read as "gone". Kong's "no Route matched" (or a wrong base URL) answers 404 for
    // every user — and a live account whose profile is not written yet would have been queued due now and revoked in
    // the same run. Only GoTrue's own user_not_found is "gone".
    it('⛔ a 404 that is not GoTrue\'s own user_not_found — the gateway\'s "no Route matched", an empty or HTML body, validation_failed — is NOT gone', async () => {
      world('refused', [ROUTE])
      for (const body of ['{"message":"no Route matched with those values"}', '', '<html>404</html>', '{"code":404,"error_code":"validation_failed","msg":"user_id must be an UUID"}']) {
        h.exec = []
        gotrue({ [ROUTE]: { status: 404, body } })
        expect(await lib.queueOrphanedTokens(), body).toEqual({ candidates: 1, queued: 0, unconfirmed: 1 })
        expect(queues(), body).toEqual([])
      }
      // the 2024-01-01 response shape (`code` holds the word) is GoTrue's own too
      gotrue({ [ROUTE]: { status: 404, body: '{"code":"user_not_found","msg":"User not found"}' } })
      expect(await lib.queueOrphanedTokens()).toEqual({ candidates: 1, queued: 1, unconfirmed: 0 })
    })

    it('⛔ auth.users "readable" but EMPTY (row-level security hiding every row) is not "everyone is gone" — GoTrue decides', async () => {
      world('hidden', [LIVE])
      gotrue({ [LIVE]: 200 })
      expect(await lib.queueOrphanedTokens()).toEqual({ candidates: 1, queued: 0, unconfirmed: 0 })
      gotrue({})
      expect(await lib.queueOrphanedTokens()).toEqual({ candidates: 1, queued: 0, unconfirmed: 1 })
      expect(queues()).toEqual([])
    })

    // ⛔ Verifier, 2026-10-09: the window was "whatever 50 rows Postgres returns first", with no order and nothing
    // recorded for a candidate that did not confirm — so 50 that never confirm held it shut on every orphan behind them.
    it('⛔ a ROTATING window: least recently touched first, and every candidate not confirmed gone is touched — the next run moves on', async () => {
      // A small table of active, profile-less rows: [user, updated_at]; the candidate query sorts and limits like Postgres.
      const A = '0000000a-0000-4000-8000-00000000000a', B = '0000000b-0000-4000-8000-00000000000b', C = '0000000c-0000-4000-8000-00000000000c'
      const touched = new Map<string, number>([[A, 1], [B, 2], [C, 3]])
      let clock = 10
      const looked: string[] = []
      h.queryImpl = async (sql, v) => {
        if (sql.includes('NOT EXISTS (SELECT 1 FROM public."Profile"')) {
          expect(sql).toMatch(/GROUP BY t\.user_id\s+ORDER BY min\(t\.updated_at\), t\.user_id\s+LIMIT \?/)
          return [...touched].sort((x, y) => x[1] - y[1] || x[0].localeCompare(y[0])).slice(0, Number(v[0])).map(([user_id]) => ({ user_id }))
        }
        if (sql.includes('FROM auth.users')) { looked.push(String(v[0])); return [{ readable: true, present: true }] } // all live
        return []
      }
      h.execImpl = async (sql, v) => {
        if (sql.includes('SET updated_at = now()') && !sql.includes('queued_at = now()')) {
          expect(sql).toContain('WHERE user_id = ?::uuid AND queued_at IS NULL')
          touched.set(String(v[0]), ++clock)
        }
        return 1
      }
      expect(await lib.queueOrphanedTokens(2)).toEqual({ candidates: 2, queued: 0, unconfirmed: 0 })
      expect(looked).toEqual([A, B])
      expect(await lib.queueOrphanedTokens(2)).toEqual({ candidates: 2, queued: 0, unconfirmed: 0 })
      expect(looked).toEqual([A, B, C, A]) // C was behind the window; without the touch it would be [A, B] again, forever
    })

    it('what is touched: the present and the unconfirmed — never a row it queued', async () => {
      world('refused', [GONE, LIVE, LOST])
      gotrue({ [GONE]: 404, [LIVE]: 200, [LOST]: 'throw' })
      await lib.queueOrphanedTokens()
      expect(touches().map((x) => x.values[0])).toEqual([LIVE, LOST])
    })
  })
})

/**
 * ⛔ C4 (codex, commit gate 2026-10-08): /auth/callback trusted `p=apple`. Which provider minted a code is GoTrue's
 * to say — its flow state, found by the code, read before the exchange deletes it.
 */
describe('⛔ C4 — pkceCodeProvider: GoTrue\'s own flow state for this code', () => {
  it('reads auth.flow_state by auth_code and answers the provider (lowercased) and the user', async () => {
    h.queryImpl = async () => [{ provider_type: 'Apple', user_id: USER }]
    expect(await lib.pkceCodeProvider('8f1c2d3e-code')).toEqual({ provider: 'apple', userId: USER })
    expect(h.query[0].sql).toMatch(/SELECT provider_type, user_id::text AS user_id FROM auth\.flow_state WHERE auth_code = \? LIMIT 2/)
    expect(h.query[0].values).toEqual(['8f1c2d3e-code'])
    h.queryImpl = async () => [{ provider_type: 'google', user_id: null }]
    expect(await lib.pkceCodeProvider('c')).toEqual({ provider: 'google', userId: null })
  })
  it('any doubt is null — keep nothing: no row, two rows, no provider, an unreadable auth schema', async () => {
    for (const answer of [[], [{ provider_type: 'apple', user_id: USER }, { provider_type: 'apple', user_id: USER }], [{ provider_type: null, user_id: USER }], [{ provider_type: '', user_id: USER }]]) {
      h.queryImpl = async () => answer
      expect(await lib.pkceCodeProvider('c'), JSON.stringify(answer)).toBeNull()
    }
    h.queryImpl = async () => { throw Object.assign(new Error('permission denied for table flow_state'), { code: 'P2010', meta: { driverAdapterError: { cause: { originalCode: '42501' } } } }) }
    expect(await lib.pkceCodeProvider('c.SENSITIVE-CODE')).toBeNull()
    // a failed read says so — distinct from "no row" — with the SQLSTATE and never the code
    expect(h.logs.filter((l) => l.startsWith('[auth] apple_flow_state_unreadable'))).toEqual(['[auth] apple_flow_state_unreadable {"code":"42501"}'])
    expect(h.logs.join('\n')).not.toContain('SENSITIVE')
  })
  it('an empty or absurd code is never even looked up', async () => {
    expect(await lib.pkceCodeProvider('')).toBeNull()
    expect(await lib.pkceCodeProvider('x'.repeat(513))).toBeNull()
    expect(h.query).toEqual([])
  })
})

/**
 * ⛔ C2 (codex, commit gate round 2): the native routes checked only the bundle ID — written into BOTH editions' env —
 * so they answered on eno.forum and through the dark deploy. The routes' own tests drive them; this is the rule.
 */
describe('⛔ C2 — nativeAppleBundleId', () => {
  it('the bundle ID only with `ios` in the rollout flag, on the marketplace edition (eno.vn)', () => {
    h.marketplace = true
    for (const flag of ['ios', 'ios,web-test', 'web,ios']) {
      vi.stubEnv('NEXT_PUBLIC_APPLE_SIGNIN', flag)
      expect(lib.nativeAppleBundleId(), flag).toBe(BUNDLE)
    }
    for (const flag of ['', 'web', 'web-test', 'web,web-test', 'iso']) {
      vi.stubEnv('NEXT_PUBLIC_APPLE_SIGNIN', flag)
      expect(lib.nativeAppleBundleId(), flag).toBeNull()
    }
    vi.stubEnv('NEXT_PUBLIC_APPLE_SIGNIN', 'ios,web')
    h.marketplace = false // eno.forum (D2)
    expect(lib.nativeAppleBundleId()).toBeNull()
    expect(lib.appleBundleId()).toBe(BUNDLE) // the daily retry still sees it: tokens kept before must still be revoked
    h.marketplace = true
    vi.stubEnv('APPLE_SIWA_BUNDLE_ID', '')
    expect(lib.nativeAppleBundleId()).toBeNull()
  })
})

describe('appleIdentityState (GoTrue admin)', () => {
  const gotrue = (status: number, body?: unknown) => vi.stubGlobal('fetch', vi.fn(async () => new Response(body === undefined ? '' : JSON.stringify(body), { status })))
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://sb.example')
    vi.stubEnv('SUPABASE_SECRET_KEY', 'service')
  })
  it('apple / none / unknown', async () => {
    gotrue(200, { identities: [{ provider: 'email' }, { provider: 'apple' }] })
    expect(await lib.appleIdentityState(USER)).toBe('apple')
    gotrue(200, { identities: [{ provider: 'google' }], app_metadata: { providers: ['google'] } })
    expect(await lib.appleIdentityState(USER)).toBe('none')
    // ⛔ C1 (commit gate round 2): GoTrue no longer knowing the user proves nothing about its identities — they went with it
    gotrue(404, { code: 404, error_code: 'user_not_found', msg: 'User not found' })
    expect(await lib.appleIdentityState(USER)).toBe('unknown')
    gotrue(404, { message: 'no Route matched with those values' }) // a gateway's 404 says nothing about the user
    expect(await lib.appleIdentityState(USER)).toBe('unknown')
    gotrue(500)
    expect(await lib.appleIdentityState(USER)).toBe('unknown')
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('timeout') }))
    expect(await lib.appleIdentityState(USER)).toBe('unknown')
    vi.stubEnv('SUPABASE_SECRET_KEY', '')
    expect(await lib.appleIdentityState(USER)).toBe('unknown')
  })
  // ⛔ C1 (commit gate round 2): `none` decides that no "remove eno in your Apple Account" notice is shown, so it must be
  // a proof — GoTrue's own list of the user's providers with no Apple in it — never the absence of an answer.
  it('⛔ none only on a PROOF: an answer without either list of providers is unknown; Apple in any field, any case, is apple', async () => {
    gotrue(200, {})
    expect(await lib.appleIdentityState(USER)).toBe('unknown')
    gotrue(200, { identities: null, app_metadata: { provider: 'email' } })
    expect(await lib.appleIdentityState(USER)).toBe('unknown')
    gotrue(200, { identities: null, app_metadata: { providers: ['email'] } })
    expect(await lib.appleIdentityState(USER)).toBe('none')
    gotrue(200, { identities: [], app_metadata: {} })
    expect(await lib.appleIdentityState(USER)).toBe('none')
    gotrue(200, { identities: [], app_metadata: { provider: 'apple' } })
    expect(await lib.appleIdentityState(USER)).toBe('apple')
    gotrue(200, { identities: [{ provider: 'Apple' }], app_metadata: { providers: ['email'] } })
    expect(await lib.appleIdentityState(USER)).toBe('apple')
    gotrue(200, { identities: [{ provider: 'email' }], app_metadata: { providers: ['email', 'APPLE'] } })
    expect(await lib.appleIdentityState(USER)).toBe('apple')
  })
})

describe('isGoTrueUserNotFound — GoTrue\'s own 404, never just any', () => {
  const res = (status: number, body: string) => new Response(body, { status })
  it('user_not_found in either response shape → true', async () => {
    expect(await lib.isGoTrueUserNotFound(res(404, '{"code":404,"error_code":"user_not_found","msg":"User not found"}'))).toBe(true)
    expect(await lib.isGoTrueUserNotFound(res(404, '{"code":"user_not_found","msg":"User not found"}'))).toBe(true)
  })
  it('any other 404 — the gateway\'s, an empty or HTML body, a malformed id — and any non-404 → false', async () => {
    for (const body of ['{"message":"no Route matched with those values"}', '', '<html><body>404</body></html>', 'null', '{"code":404,"error_code":"validation_failed","msg":"user_id must be an UUID"}']) {
      expect(await lib.isGoTrueUserNotFound(res(404, body)), body).toBe(false)
    }
    expect(await lib.isGoTrueUserNotFound(res(200, '{"error_code":"user_not_found"}'))).toBe(false)
    expect(await lib.isGoTrueUserNotFound(res(410, '{"error_code":"user_not_found"}'))).toBe(false)
    expect(await lib.isGoTrueUserNotFound({ status: 404 } as Response)).toBe(false) // no body to read at all
  })
})

/**
 * ⛔ Verifier, 2026-10-09: nothing said out loud that the app's role could not read GoTrue's tables — every reader turns
 * "cannot read" into "cannot tell" and carries on. And the grant alone proves nothing: GoTrue enables row-level security
 * on every auth table, so a role without BYPASSRLS holds SELECT and sees zero rows.
 */
describe('probeAuthTables — can this role READ GoTrue\'s tables?', () => {
  it('one query: the grant AND no row-level security for this role, per table; any other answer is unreadable', async () => {
    h.queryImpl = async () => [{ name: 'flow_state', readable: true }, { name: 'identities', readable: false }, { name: 'users', readable: null }]
    expect(await lib.probeAuthTables()).toEqual({ flowState: 'readable', identities: 'unreadable', users: 'unreadable' })
    const sql = h.query[0].sql
    expect(sql).toContain("has_table_privilege(c.rel, 'SELECT') AND NOT row_security_active(c.rel) AS readable")
    expect(sql).toContain("to_regclass('auth.' || t.name)")
    expect(sql).toContain("(VALUES ('flow_state'), ('identities'), ('users'))")
  })
  it('a probe that cannot run (no USAGE on schema auth: to_regclass raises 42501) → all three unreadable, with the SQLSTATE', async () => {
    h.queryImpl = async () => { throw Object.assign(new Error('permission denied for schema auth'), { code: 'P2010', meta: { driverAdapterError: { cause: { originalCode: '42501' } } } }) }
    expect(await lib.probeAuthTables()).toEqual({ flowState: 'unreadable', identities: 'unreadable', users: 'unreadable', error: '42501' })
  })
  it('a missing row is unreadable, never assumed', async () => {
    h.queryImpl = async () => [{ name: 'identities', readable: true }]
    expect(await lib.probeAuthTables()).toEqual({ flowState: 'unreadable', identities: 'readable', users: 'unreadable' })
  })
})

describe('guards', () => {
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  it('never READS the AASA\'s team-id variable (APPLE_TEAM_ID switches on applinks)', () => {
    for (const f of [
      'src/lib/auth/apple-siwa.ts',
      'src/lib/apple-signin.ts',
      'src/app/api/auth/apple/nonce/route.ts',
      'src/app/api/auth/apple/native/route.ts',
      'src/app/api/cron/apple-revocations/route.ts',
    ]) {
      expect(strip(readFileSync(f, 'utf8')), f).not.toMatch(/\bAPPLE_TEAM_ID\b/)
    }
  })
  it('logs carry codes, never a token or a code', async () => {
    appleAnswers({ status: 400, body: { error: 'invalid_grant' } })
    await lib.exchangeCode(BUNDLE, 'c.SENSITIVE-CODE')
    vi.stubEnv('APPLE_TOKEN_ENC_KEY', '')
    await lib.storeAppleToken({ userId: USER, clientId: SERVICES, appleSub: 's', refreshToken: 'r.SENSITIVE-TOKEN' })
    expect(h.logs.join('\n')).not.toMatch(/SENSITIVE/)
  })
})

describe('appleOnOffer — where Apple can have been used (commit gate round 7)', () => {
  it('true while the flag is set, or once Apple is configured on this server (through a rollback); false before both', () => {
    vi.stubEnv('NEXT_PUBLIC_APPLE_SIGNIN', '')
    vi.stubEnv('APPLE_SIWA_SERVICES_ID', '')
    vi.stubEnv('APPLE_SIWA_BUNDLE_ID', '')
    expect(lib.appleOnOffer()).toBe(false)
    vi.stubEnv('NEXT_PUBLIC_APPLE_SIGNIN', 'ios')
    expect(lib.appleOnOffer()).toBe(true)
    vi.stubEnv('NEXT_PUBLIC_APPLE_SIGNIN', '')
    vi.stubEnv('APPLE_SIWA_SERVICES_ID', 'vn.eno.web')
    expect(lib.appleOnOffer()).toBe(true)
    vi.stubEnv('APPLE_SIWA_SERVICES_ID', '')
    vi.stubEnv('APPLE_SIWA_BUNDLE_ID', 'vn.eno.app')
    expect(lib.appleOnOffer()).toBe(true)
  })
})
