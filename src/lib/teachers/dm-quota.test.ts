import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash, createHmac } from 'node:crypto'
// The REAL badge test decides "business verified" below — a seller fixture either passes isBusinessVerified or it does
// not; nothing about the business rung is stubbed.
import { sellerIdentityHash } from '@/lib/business-verification'
import { TEACHER_DM_IP_POOL, TEACHER_DM_LIMITS, TEACHER_UNANSWERED_MAX } from './constants'
import type { TeacherDmStanding } from './dm-quota'

// ── THE TEACHER DM LADDER (owner, 2026-10-13) ──────────────────────────────────────────────────────────────────────────
//
// How many NEW teachers an account may start a chat with per Vietnam day: revoked 0, unverified 3, identity 10, business
// 30 — the unverified accounts on one connection sharing 6 while phone sign-in is off — and at most 2 messages to a
// teacher who has not answered. dm-quota.ts is the one module the create route, the quota endpoint and the message route
// all read, so these tests are what holds the rules.

type Convo = { id: string; listingId: string | null; buyerProfileId: string; createdAt: Date; listingType: string; buyerDeletedAt?: Date | null }
type Msg = { id: string; conversationId: string; senderProfileId: string; deletedAt?: Date | null; body?: string }
type ConvoWhere = { buyerProfileId?: string; createdAt?: { gte?: Date }; listing?: { listingType?: string }; [k: string]: unknown }
type MsgWhere = { conversationId?: string; senderProfileId?: string; deletedAt?: null; [k: string]: unknown }

const h = vi.hoisted(() => ({
  s: {
    /** What verificationStatusForDecision answers — the identity check derived from its rows, at this instant. */
    identity: 'unverified' as string,
    identityCalls: [] as Array<{ profileId: string; now: Date | undefined }>,
    /** auth-policy's PHONE_OTP_ENABLED, behind a getter so one file can test both positions of the switch. */
    phoneOtp: false,
    profile: null as Record<string, unknown> | null,
    profileReads: [] as string[],
    /** The seller's latest business-verification case (sellerVerification), or none. */
    latestCase: null as { status: string } | null,
    caseQueries: [] as Record<string, unknown>[],
    convos: [] as Convo[],
    messages: [] as Msg[],
    messageQueries: [] as Array<{ op: string; where: MsgWhere }>,
    /** The kv_store counters — the IP pool — read by kv.get outside the transaction and kv_get / kv_incrby inside it. */
    pool: new Map<string, number | string>(),
    kvReads: [] as string[],
    /** Every statement the transaction ran, in order: the locks, the re-read, the recount, the insert, the pool write. */
    events: [] as string[],
    countQueries: [] as Array<{ reader: string; args: { where: ConvoWhere; select?: unknown; distinct?: string[] } }>,
    uniqueQueries: [] as Array<{ reader: string; listingId: string; buyerProfileId: string }>,
    created: [] as Record<string, unknown>[],
    /** A concurrent request committed the same (listing, account) thread first: this insert then meets the unique key. */
    raceWinner: null as string | null,
    createThrows: null as (Error & { code?: string }) | null,
    txOpts: null as Record<string, unknown> | null,
    /** A revoked identity row lands while the request waits on the account lock (read on the transaction's client). */
    revokedUnderLock: false,
    /** Runs when the account's lock is granted — a test moves the clock here to model a request that waited past midnight. */
    onLock: null as null | (() => void),
    /** createdAt for rows the fake inserts. */
    clock: new Date(0),
    logs: [] as Array<{ message: string; ctx: Record<string, unknown> | undefined }>,
  },
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/compliance/recompute-verification', () => ({
  verificationStatusForDecision: async (profileId: string, now?: Date) => { h.s.identityCalls.push({ profileId, now }); return h.s.identity },
}))
vi.mock('@/lib/auth-policy', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth-policy')>()),
  get PHONE_OTP_ENABLED() { return h.s.phoneOtp },
}))
vi.mock('@/lib/ratelimit', () => ({
  kv: { get: async (key: string) => { h.s.kvReads.push(key); return h.s.pool.get(key) ?? null } },
}))
vi.mock('@/lib/log', () => ({
  logInfo: (message: string, ctx?: Record<string, unknown>) => { h.s.logs.push({ message, ctx }) },
  logWarn: () => {},
  logError: () => {},
}))
vi.mock('@/lib/db', () => {
  /** One conversation table behind two clients, so a test can tell a read made INSIDE the transaction from one outside. */
  const conversation = (reader: 'db' | 'tx') => ({
    findUnique: async ({ where }: { where: { listingId_buyerProfileId: { listingId: string; buyerProfileId: string } } }) => {
      if (reader === 'tx') h.s.events.push('find')
      const k = where.listingId_buyerProfileId
      h.s.uniqueQueries.push({ reader, listingId: k.listingId, buyerProfileId: k.buyerProfileId })
      const c = h.s.convos.find((x) => x.listingId === k.listingId && x.buyerProfileId === k.buyerProfileId)
      return c ? { id: c.id } : null
    },
    findMany: async (args: { where: ConvoWhere; select?: unknown; distinct?: string[] }) => {
      if (reader === 'tx') h.s.events.push('count')
      h.s.countQueries.push({ reader, args })
      const { buyerProfileId, createdAt, listing, ...rest } = args.where
      // ⚠️ STRICT: a filter this fake does not understand is a change to WHAT COUNTS (a buyerDeletedAt filter would let
      // an account hide a thread to get its chat back). Fail loudly rather than ignore it.
      if (Object.keys(rest).length) throw new Error(`fake conversation.findMany: unexpected filter ${Object.keys(rest).join(', ')}`)
      let rows = h.s.convos.filter((c) =>
        (buyerProfileId === undefined || c.buyerProfileId === buyerProfileId) &&
        (createdAt?.gte === undefined || c.createdAt.getTime() >= createdAt.gte.getTime()) &&
        (listing?.listingType === undefined || c.listingType === listing.listingType))
      if (args.distinct?.includes('listingId')) rows = rows.filter((c, i) => rows.findIndex((d) => d.listingId === c.listingId) === i)
      return rows.map((c) => ({ listingId: c.listingId }))
    },
    create: async ({ data }: { data: { listingId: string; buyerProfileId: string; sellerId: string; sellerProfileId: string | null } }) => {
      if (reader === 'tx') h.s.events.push('create')
      if (h.s.raceWinner) {
        h.s.convos.push({ id: h.s.raceWinner, listingId: data.listingId, buyerProfileId: data.buyerProfileId, createdAt: h.s.clock, listingType: 'teacher' })
        throw Object.assign(new Error('Unique constraint failed on the fields: (`listingId`,`buyerProfileId`)'), { code: 'P2002' })
      }
      if (h.s.createThrows) throw h.s.createThrows
      h.s.created.push(data)
      const id = `c_new_${h.s.created.length}`
      h.s.convos.push({ id, listingId: data.listingId, buyerProfileId: data.buyerProfileId, createdAt: h.s.clock, listingType: 'teacher' })
      return { id }
    },
  })
  const msgMatch = (x: Msg, where: MsgWhere) => {
    const { conversationId, senderProfileId, deletedAt, ...rest } = where
    if (Object.keys(rest).length) throw new Error(`fake message: unexpected filter ${Object.keys(rest).join(', ')}`)
    return x.conversationId === conversationId && (senderProfileId === undefined || x.senderProfileId === senderProfileId) && (deletedAt === null ? !x.deletedAt : true)
  }
  const tx = {
    conversation: conversation('tx'),
    identityVerification: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        h.s.events.push(`revoked? ${JSON.stringify(where)}`)
        return h.s.revokedUnderLock ? { id: 'iv_revoked' } : null
      },
    },
    $executeRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join('?')
      if (sql !== 'select pg_advisory_xact_lock(hashtext(?))') throw new Error(`fake tx: unexpected statement: ${sql}`)
      h.s.events.push(`lock ${String(values[0])}`)
      if (String(values[0]).startsWith('teacher-dm:')) h.s.onLock?.()
      return 1
    },
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join('?')
      const key = String(values[0])
      if (sql === 'select kv_get(?) as v') {
        h.s.events.push(`kv_get ${key}`)
        return [{ v: h.s.pool.get(key) ?? null }]
      }
      const incr = /^select kv_incrby\(\?, (\d+)::bigint, \?::int\) as v$/.exec(sql)
      if (incr) {
        const n = Number(h.s.pool.get(key) ?? 0) + Number(incr[1])
        h.s.pool.set(key, n)
        h.s.events.push(`kv_incrby ${key} +${incr[1]} ttl=${String(values[1])}`)
        return [{ v: n }]
      }
      throw new Error(`fake tx: unexpected query: ${sql}`)
    },
  }
  const db = {
    profile: { findUnique: async ({ where }: { where: { id: string } }) => { h.s.profileReads.push(where.id); return h.s.profile } },
    sellerVerification: { findFirst: async (args: Record<string, unknown>) => { h.s.caseQueries.push(args); return h.s.latestCase } },
    conversation: conversation('db'),
    // teacherUnansweredGuard builds its two statements on `db` — LAZY, like PrismaPromises: recorded here, run by the
    // message's batch transaction (insertMessage's SendOpts.alongside), never by the guard itself.
    $executeRaw: (strings: TemplateStringsArray, ...values: unknown[]) => ({ sql: strings.join('?'), values }),
    $queryRaw: (strings: TemplateStringsArray, ...values: unknown[]) => ({ sql: strings.join('?'), values }),
    message: {
      findFirst: async ({ where, orderBy, select }: { where: MsgWhere; orderBy?: { createdAt?: 'asc' | 'desc' }; select?: Record<string, true> }) => {
        h.s.messageQueries.push({ op: 'findFirst', where })
        const all = h.s.messages.filter((x) => msgMatch(x, where))
        // h.s.messages is in send order: "newest first" is the last match.
        const m = orderBy?.createdAt === 'desc' ? all.at(-1) : all[0]
        if (!m) return null
        return select?.body ? { senderProfileId: m.senderProfileId, body: m.body ?? '', deletedAt: m.deletedAt ?? null } : { id: m.id }
      },
      count: async ({ where }: { where: MsgWhere }) => {
        h.s.messageQueries.push({ op: 'count', where })
        return h.s.messages.filter((x) => msgMatch(x, where)).length
      },
    },
    // ⚠️ No rollback is modelled: every write the code makes inside comes after its last check, so nothing a test
    // asserts depends on one. What IS modelled is the order of statements (h.s.events) and which client ran them.
    $transaction: async (fn: (t: typeof tx) => Promise<unknown>, opts?: Record<string, unknown>) => {
      h.s.txOpts = opts ?? null
      return fn(tx)
    },
  }
  return { db }
})

const { db } = await import('@/lib/db')
const {
  ipv6Prefix64, mayWriteToTeacher, teacherGuardAbort, openTeacherThread, openerAgainst, poolKeyFor, sendToTeacherGuarded, teacherDmRefusal, teacherUnansweredGuard, teacherDmStanding, teacherDmTier,
  teacherThreadsOpenedSince, vnDayWindow,
} = await import('./dm-quota')

const P = 'p1'
const NOW = new Date('2026-10-13T10:00:00+07:00')       // 03:00Z — Vietnam day 2026-10-13
const DAY_START = new Date('2026-10-12T17:00:00.000Z')  // 00:00 on the 13th, Vietnam time
const RESET = new Date('2026-10-13T17:00:00.000Z')      // 00:00 on the 14th
const IP = '203.0.113.7'
/** The pool key as dm-quota.ts derives it: an HMAC under the server pepper (set below), never a bare hash of the address. */
const PEPPER = 'test-pepper'
const unitKey = (unit: string, day = '2026-10-13') => `teacher-dm-ip:${day}:${createHmac('sha256', PEPPER).update(`teacher-dm-pool:${day}:${unit}`).digest('hex').slice(0, 32)}`
const KEY = unitKey(IP)
const DAY_MS = 86_400_000

const IDENT = { name: 'Saigon English Centre', legalName: 'CONG TY TNHH SAIGON ENGLISH CENTRE', legalAddress: '12 Le Loi, Ben Nghe, Quan 1', idNumber: null, taxCode: '0312345678' }
/** A seller whose "Business verified" badge is live right now: stamped hash = live hash, window open, tax registry verified. */
const liveBadge = (over: Record<string, unknown> = {}) => ({
  id: 's1', ...IDENT, officialPartner: false,
  taxCheckedAt: new Date(), taxRegisteredName: IDENT.legalName, taxActive: true,
  verifiedIdentityHash: sellerIdentityHash(IDENT), verifiedUntil: new Date(Date.now() + 90 * DAY_MS),
  ...over,
})
/** A seller row that never went through business verification. */
const noBadge = (over: Record<string, unknown> = {}) => ({
  id: 's1', ...IDENT, officialPartner: false, taxCode: null,
  taxCheckedAt: null, taxRegisteredName: null, taxActive: null, verifiedIdentityHash: null, verifiedUntil: null,
  ...over,
})
const person = (over: Record<string, unknown> = {}) => ({ accountType: 'individual', phone: null, seller: null, ...over })
const company = (seller: Record<string, unknown> | null, over: Record<string, unknown> = {}) => ({ accountType: 'business', phone: null, seller, ...over })

let seq = 0
/** A thread this account opened with a teacher listing. */
const opened = (listingId: string, at: Date = NOW, over: Partial<Convo> = {}): Convo =>
  ({ id: `c${++seq}`, listingId, buyerProfileId: P, createdAt: at, listingType: 'teacher', ...over })
const msg = (sender: string, over: Partial<Msg> = {}): Msg => ({ id: `m${++seq}`, conversationId: 'c1', senderProfileId: sender, deletedAt: null, ...over })

const open = (over: Partial<Parameters<typeof openTeacherThread>[0]> = {}) =>
  openTeacherThread({ profileId: P, listingId: 'L9', sellerId: 's9', sellerProfileId: 't9', ip: IP, now: NOW, ...over })

beforeEach(() => {
  vi.stubEnv('IDENTITY_HASH_PEPPER', PEPPER)
  h.s.identity = 'unverified'; h.s.identityCalls = []; h.s.phoneOtp = false
  h.s.profile = person(); h.s.profileReads = []; h.s.latestCase = null; h.s.caseQueries = []
  h.s.convos = []; h.s.messages = []; h.s.messageQueries = []
  h.s.pool = new Map(); h.s.kvReads = []; h.s.events = []; h.s.countQueries = []; h.s.uniqueQueries = []; h.s.created = []
  h.s.raceWinner = null; h.s.createThrows = null; h.s.txOpts = null; h.s.clock = NOW; h.s.logs = []
  h.s.revokedUnderLock = false; h.s.onLock = null
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs() })

describe('the ladder — the owner\'s numbers', () => {
  it('is revoked 0 · unverified 3 · identity 10 · business 30 a day, 6 per connection, 2 unanswered messages', () => {
    // A change here is the owner's call, not a refactor's: dm-limit-copy.test.ts holds the copy to these same numbers.
    expect(TEACHER_DM_LIMITS).toEqual({ revoked: 0, unverified: 3, identity: 10, business: 30 })
    expect(TEACHER_DM_IP_POOL).toBe(6)
    expect(TEACHER_UNANSWERED_MAX).toBe(2)
  })
})

describe('teacherDmTier — the rung, derived on every request', () => {
  it('⛔ a REVOKED identity is 0 with no way up — and outranks a live business badge', async () => {
    h.s.identity = 'revoked'
    h.s.profile = company(liveBadge())
    expect(await teacherDmTier(P, NOW)).toEqual({ tier: 'revoked', limit: 0, next: 'none', nextLimit: null, needsPhone: false, pooled: false })
    expect(h.s.profileReads).toEqual([]) // nothing about the account can lift it
  })

  it('reads the identity check AT THIS INSTANT, never the profile\'s cached status', async () => {
    // A passport that lapsed this morning is expired now, not after a sweep: `now` reaches the derivation, and a stale
    // cached 'verified' on the profile row lifts nothing.
    h.s.profile = person({ verificationStatus: 'verified' })
    const t = await teacherDmTier(P, NOW)
    expect(h.s.identityCalls).toEqual([{ profileId: P, now: NOW }])
    expect(t.tier).toBe('unverified')
  })

  it('an unverified account is 3 a day, shares its connection\'s pool, and is offered the identity check', async () => {
    expect(await teacherDmTier(P, NOW)).toEqual({ tier: 'unverified', limit: 3, next: 'verify_identity', nextLimit: 10, needsPhone: false, pooled: true })
  })

  it('the unverified rung\'s step follows the identity check\'s own state', async () => {
    for (const [identity, next] of [
      ['unverified', 'verify_identity'], ['rejected', 'verify_identity'], ['pending', 'identity_pending'], ['expired', 'renew_identity'],
    ] as const) {
      h.s.identity = identity
      expect(await teacherDmTier(P, NOW), identity).toEqual({ tier: 'unverified', limit: 3, next, nextLimit: 10, needsPhone: false, pooled: true })
    }
  })

  it('⛔ a business account WITHOUT a live identity check is the unverified rung, badge or not — the person verifies first', async () => {
    h.s.profile = company(liveBadge())
    for (const [identity, next] of [['unverified', 'verify_identity'], ['pending', 'identity_pending'], ['expired', 'renew_identity']] as const) {
      h.s.identity = identity
      expect(await teacherDmTier(P, NOW), identity).toEqual({ tier: 'unverified', limit: 3, next, nextLimit: 10, needsPhone: false, pooled: true })
    }
  })

  it('a verified identity is 10, and the way up is a business account', async () => {
    h.s.identity = 'verified'
    expect(await teacherDmTier(P, NOW)).toEqual({ tier: 'identity', limit: 10, next: 'switch_to_business', nextLimit: 30, needsPhone: false, pooled: false })
    // An account that never chose a type gets the same step; teacherDmStep sends it to /onboard instead of settings.
    h.s.profile = person({ accountType: null })
    expect((await teacherDmTier(P, NOW)).next).toBe('switch_to_business')
    expect(h.s.caseQueries).toEqual([]) // no business case is read for an account that is not a business
  })

  it('⛔ a live badge on an INDIVIDUAL account is not the business rung', async () => {
    h.s.identity = 'verified'
    h.s.profile = person({ seller: liveBadge() })
    expect(await teacherDmTier(P, NOW)).toMatchObject({ tier: 'identity', limit: 10, next: 'switch_to_business' })
  })

  it('a business account with a live badge AND a live identity check is 30, and only tomorrow lifts it', async () => {
    h.s.identity = 'verified'
    h.s.profile = company(liveBadge())
    expect(await teacherDmTier(P, NOW)).toEqual({ tier: 'business', limit: 30, next: 'tomorrow', nextLimit: null, needsPhone: false, pooled: false })
  })

  it('⛔ officialPartner is a commercial flag, not a business verification', async () => {
    h.s.identity = 'verified'
    h.s.profile = company(noBadge({ officialPartner: true }))
    expect(await teacherDmTier(P, NOW)).toEqual({ tier: 'identity', limit: 10, next: 'verify_business', nextLimit: 30, needsPhone: false, pooled: false })
  })

  it('the identity rung\'s step follows the business verification\'s state', async () => {
    h.s.identity = 'verified'
    const past = new Date(Date.now() - DAY_MS)
    for (const [why, seller, latest, next] of [
      ['a business account with no shop yet', null, null, 'verify_business'],
      ['never started', noBadge(), null, 'verify_business'],
      ['a draft is not submitted', noBadge(), 'draft', 'verify_business'],
      ['under review', noBadge(), 'pending', 'business_pending'],
      ['refused: verify again', noBadge(), 'rejected', 'verify_business'],
      // 'changes_needed' was never approved — it is not a lapse: verify, not renew.
      ['the tax registry does not match yet', noBadge({ taxCode: '0312345678' }), null, 'verify_business'],
      ['the badge window lapsed', liveBadge({ verifiedUntil: past }), 'approved', 'renew_business'],
      ['the storefront was renamed after approval', liveBadge({ name: 'Renamed After Approval' }), 'approved', 'renew_business'],
      ['a renewal is under review', liveBadge({ verifiedUntil: past }), 'pending', 'business_pending'],
    ] as const) {
      h.s.profile = company(seller as Record<string, unknown> | null)
      h.s.latestCase = latest ? { status: latest } : null
      expect(await teacherDmTier(P, NOW), why).toEqual({ tier: 'identity', limit: 10, next, nextLimit: 30, needsPhone: false, pooled: false })
    }
  })

  it('reads the seller\'s LATEST business case', async () => {
    h.s.identity = 'verified'
    h.s.profile = company(noBadge())
    await teacherDmTier(P, NOW)
    expect(h.s.caseQueries).toEqual([{ where: { sellerId: 's1' }, orderBy: { version: 'desc' }, select: { status: true } }])
  })

  describe('once phone sign-in is back (PHONE_OTP_ENABLED)', () => {
    beforeEach(() => { h.s.phoneOtp = true })

    it('an unverified account with no phone gets 0 until it adds one — and the pool stops applying', async () => {
      expect(await teacherDmTier(P, NOW)).toEqual({ tier: 'unverified', limit: 0, next: 'add_phone', nextLimit: 3, needsPhone: true, pooled: false })
      h.s.identity = 'pending'
      expect((await teacherDmTier(P, NOW)).next).toBe('add_phone')
    })

    it('with a phone it is 3, unpooled', async () => {
      h.s.profile = person({ phone: '+84901234567' })
      expect(await teacherDmTier(P, NOW)).toEqual({ tier: 'unverified', limit: 3, next: 'verify_identity', nextLimit: 10, needsPhone: false, pooled: false })
    })

    it('a verified identity needs no phone, and revoked stays revoked', async () => {
      h.s.identity = 'verified'
      expect(await teacherDmTier(P, NOW)).toMatchObject({ tier: 'identity', limit: 10, needsPhone: false })
      h.s.identity = 'revoked'
      expect(await teacherDmTier(P, NOW)).toMatchObject({ tier: 'revoked', limit: 0, next: 'none' })
    })
  })
})

describe('vnDayWindow — the day is the Vietnam calendar day', () => {
  it('2026-10-12T17:30Z is already the 13th in Vietnam', () => {
    expect(vnDayWindow(new Date('2026-10-12T17:30:00Z'))).toEqual({
      day: '2026-10-13', start: new Date('2026-10-12T17:00:00.000Z'), resetAt: new Date('2026-10-13T17:00:00.000Z'),
    })
  })

  it('turns at 17:00Z exactly, and the window holds the instant it was asked about', () => {
    expect(vnDayWindow(new Date('2026-10-12T16:59:59.999Z'))).toEqual({
      day: '2026-10-12', start: new Date('2026-10-11T17:00:00.000Z'), resetAt: new Date('2026-10-12T17:00:00.000Z'),
    })
    expect(vnDayWindow(new Date('2026-10-12T17:00:00.000Z')).day).toBe('2026-10-13')
    const w = vnDayWindow(NOW)
    expect(w).toEqual({ day: '2026-10-13', start: DAY_START, resetAt: RESET })
    expect(w.start.getTime()).toBeLessThanOrEqual(NOW.getTime())
    expect(w.resetAt.getTime() - w.start.getTime()).toBe(DAY_MS)
  })
})

describe('poolKeyFor — one key per connection per day, no address kept', () => {
  it('hashes the address: the key never holds it', () => {
    const k = poolKeyFor(IP, '2026-10-13')
    expect(k).toBe(KEY)
    expect(k).toMatch(/^teacher-dm-ip:2026-10-13:[0-9a-f]{32}$/)
    expect(k).not.toContain(IP)
  })

  it('⛔ keyed under the server pepper, never a bare hash: no table of the 2³² IPv4 hashes reverses it (Opus, gate 2026-10-13)', () => {
    expect(KEY).not.toContain(createHash('sha256').update(IP).digest('hex').slice(0, 32))
    vi.stubEnv('IDENTITY_HASH_PEPPER', 'another-pepper')
    expect(poolKeyFor(IP, '2026-10-13')).not.toBe(KEY)
    // No pepper: the second key auth/handoff.ts uses, and only with neither an unkeyed digest — the brake still works.
    vi.stubEnv('IDENTITY_HASH_PEPPER', '')
    vi.stubEnv('SUPABASE_SECRET_KEY', 'sb-secret')
    expect(poolKeyFor(IP, '2026-10-13')).toBe(`teacher-dm-ip:2026-10-13:${createHmac('sha256', 'sb-secret').update(`teacher-dm-pool:2026-10-13:${IP}`).digest('hex').slice(0, 32)}`)
  })

  it('surrounding whitespace is the same connection; another address or another day is another key', () => {
    expect(poolKeyFor(`  ${IP} `, '2026-10-13')).toBe(KEY)
    expect(poolKeyFor('203.0.113.8', '2026-10-13')).not.toBe(KEY)
    expect(poolKeyFor(IP, '2026-10-14')).not.toBe(KEY)
  })

  it('⛔ no address is ONE shared pool, never no pool (opus, gate 2026-10-13): a missing address must not lift the brake', () => {
    const shared = poolKeyFor('unknown', '2026-10-13')
    expect(shared).toMatch(/^teacher-dm-ip:2026-10-13:[0-9a-f]{32}$/)
    for (const ip of ['', '   ', null, undefined, 'unknown', 'UNKNOWN']) expect(poolKeyFor(ip, '2026-10-13'), String(ip)).toBe(shared)
    expect(shared).not.toBe(KEY)
  })

  it('⛔ an IPv6 client is its /64 (opus, gate 2026-10-13): an address rotated inside the prefix is the same pool, the next /64 is not', () => {
    const k = poolKeyFor('2405:4803:c7fd:1::9', '2026-10-13')
    expect(k).toBe(unitKey('2405:4803:c7fd:1'))
    for (const ip of ['2405:4803:c7fd:1:abcd:ef01:2345:6789', '2405:4803:C7FD:0001::1', '[2405:4803:c7fd:1::9]', '2405:4803:c7fd:1::9%en0']) {
      expect(poolKeyFor(ip, '2026-10-13'), ip).toBe(k)
    }
    expect(poolKeyFor('2405:4803:c7fd:2::9', '2026-10-13')).not.toBe(k)
  })

  it('an IPv4 address in IPv6 dress (::ffff:a.b.c.d) is that IPv4 address — never the all-zero /64 every one of them shares', () => {
    expect(poolKeyFor('::ffff:203.0.113.7', '2026-10-13')).toBe(KEY)
    expect(poolKeyFor('::ffff:203.0.113.8', '2026-10-13')).not.toBe(KEY)
  })

  it('ipv6Prefix64 expands "::" wherever it sits and drops leading zeros', () => {
    expect(ipv6Prefix64('2405:4803::1')).toBe('2405:4803:0:0')
    expect(ipv6Prefix64('::1')).toBe('0:0:0:0')
    expect(ipv6Prefix64('2001:db8:0:0:1:2:3:4')).toBe('2001:db8:0:0')
    expect(ipv6Prefix64('2001:0db8:0000:0042::')).toBe('2001:db8:0:42')
  })
})

describe('teacherThreadsOpenedSince — the threads that EXIST', () => {
  it('asks for DISTINCT teacher listings of this account since the start — and nothing else', async () => {
    await teacherThreadsOpenedSince(db, P, DAY_START)
    expect(h.s.countQueries).toEqual([{
      reader: 'db',
      args: { where: { buyerProfileId: P, createdAt: { gte: DAY_START }, listing: { listingType: 'teacher' } }, select: { listingId: true }, distinct: ['listingId'] },
    }])
  })

  it('counts today\'s teachers — a hidden thread too — and not yesterday\'s, not other listings, not other accounts', async () => {
    h.s.convos = [
      opened('L1'),
      opened('L2', NOW, { buyerDeletedAt: NOW }),                // hidden by the account: DELETE only stamps buyerDeletedAt
      opened('L3', DAY_START),                                   // the first instant of the day
      opened('L4', new Date(DAY_START.getTime() - 1)),           // 23:59:59.999 yesterday
      opened('S1', NOW, { listingType: 'sell' }),                // a chat about a sofa
      opened('L5', NOW, { buyerProfileId: 'p2' }),               // someone else's
    ]
    expect(await teacherThreadsOpenedSince(db, P, DAY_START)).toBe(3)
  })
})

describe('teacherDmStanding — what the profile page shows and the early check refuses on', () => {
  it('an unverified account that opened one teacher today has two left, until the Vietnam midnight', async () => {
    h.s.convos = [opened('L1'), opened('L0', new Date(DAY_START.getTime() - 1))]
    expect(await teacherDmStanding(P, { ip: IP, now: NOW })).toEqual({
      tier: 'unverified', limit: 3, next: 'verify_identity', nextLimit: 10, needsPhone: false, pooled: true,
      used: 1, remaining: 2, resetAt: RESET.toISOString(), reason: null, hasThread: false,
    })
  })

  it('at the limit: nothing left, reason limit', async () => {
    h.s.convos = [opened('L1'), opened('L2'), opened('L3')]
    expect(await teacherDmStanding(P, { ip: IP, now: NOW })).toMatchObject({ used: 3, remaining: 0, reason: 'limit' })
  })

  it('a rung that drops mid-day leaves 0, never a negative', async () => {
    // Five opened while the identity check was live; it lapsed at noon: the unverified 3 is already spent.
    h.s.identity = 'expired'
    h.s.convos = ['L1', 'L2', 'L3', 'L4', 'L5'].map((l) => opened(l))
    expect(await teacherDmStanding(P, { ip: IP, now: NOW })).toMatchObject({ tier: 'unverified', used: 5, remaining: 0, reason: 'limit', next: 'renew_identity' })
  })

  it('⛔ the connection\'s pool: once 6 new chats were started on it today, reason pool — though the account has its own left', async () => {
    h.s.pool.set(KEY, TEACHER_DM_IP_POOL)
    expect(await teacherDmStanding(P, { ip: IP, now: NOW })).toMatchObject({ used: 0, remaining: 0, reason: 'pool' })
    expect(h.s.kvReads).toEqual([KEY])
  })

  it('the pool can bind before the account\'s own limit, and a counter read back as a string still counts', async () => {
    h.s.convos = [opened('L1')]
    h.s.pool.set(KEY, '5')
    expect(await teacherDmStanding(P, { ip: IP, now: NOW })).toMatchObject({ used: 1, remaining: 1, reason: null })
  })

  it('both spent: the account\'s own limit is the reason given', async () => {
    h.s.convos = [opened('L1'), opened('L2'), opened('L3')]
    h.s.pool.set(KEY, TEACHER_DM_IP_POOL)
    expect(await teacherDmStanding(P, { ip: IP, now: NOW })).toMatchObject({ remaining: 0, reason: 'limit' })
  })

  it('⛔ the pool never touches a verified identity', async () => {
    h.s.identity = 'verified'
    h.s.pool.set(KEY, TEACHER_DM_IP_POOL)
    expect(await teacherDmStanding(P, { ip: IP, now: NOW })).toMatchObject({ tier: 'identity', remaining: 10, reason: null })
    expect(h.s.kvReads).toEqual([])
  })

  it('⛔ no address: the ONE shared no-address pool is read, never skipped (opus, gate 2026-10-13)', async () => {
    const NOADDR = poolKeyFor(null, '2026-10-13')
    h.s.pool.set(NOADDR, TEACHER_DM_IP_POOL)
    expect(await teacherDmStanding(P, { ip: null, now: NOW })).toMatchObject({ remaining: 0, reason: 'pool' })
    expect(h.s.kvReads).toEqual([NOADDR])
  })

  it('revoked: nothing left, reason revoked', async () => {
    h.s.identity = 'revoked'
    expect(await teacherDmStanding(P, { ip: IP, now: NOW })).toMatchObject({ tier: 'revoked', limit: 0, remaining: 0, reason: 'revoked', next: 'none' })
  })

  it('PHONE_OTP_ENABLED and no phone: reason phone, and the pool is not read', async () => {
    h.s.phoneOtp = true
    h.s.pool.set(KEY, TEACHER_DM_IP_POOL)
    expect(await teacherDmStanding(P, { ip: IP, now: NOW })).toMatchObject({ limit: 0, remaining: 0, reason: 'phone', next: 'add_phone' })
    expect(h.s.kvReads).toEqual([])
  })

  it('hasThread: whether THIS account already has a thread with THIS teacher — so a spent day still lets it reopen one', async () => {
    h.s.convos = [opened('L1'), opened('L2'), opened('L3')]
    expect(await teacherDmStanding(P, { ip: IP, listingId: 'L1', now: NOW })).toMatchObject({ remaining: 0, hasThread: true })
    expect(h.s.uniqueQueries).toEqual([{ reader: 'db', listingId: 'L1', buyerProfileId: P }])
    expect((await teacherDmStanding(P, { ip: IP, listingId: 'L9', now: NOW })).hasThread).toBe(false)
    h.s.uniqueQueries = []
    expect((await teacherDmStanding(P, { ip: IP, now: NOW })).hasThread).toBe(false)
    expect(h.s.uniqueQueries).toEqual([])
  })
})

describe('openTeacherThread — the only door to a NEW teacher thread', () => {
  it('an existing thread is returned as it is: no count, no pool, no insert', async () => {
    h.s.convos = [{ ...opened('L9'), id: 'c_old' }]
    expect(await open()).toEqual({ outcome: 'existing', id: 'c_old' })
    expect(h.s.events).toEqual(['lock teacher-dm:p1', 'find'])
    expect(h.s.created).toEqual([])
  })

  it('⛔ under the limit: account lock → re-read → recount → pool lock AFTER the account\'s → insert → spend the pool', async () => {
    const r = await open()
    expect(r).toEqual({ outcome: 'created', id: 'c_new_1' })
    expect(h.s.events).toEqual([
      'lock teacher-dm:p1', 'find', 'count', `revoked? ${JSON.stringify({ profileId: P, status: 'revoked' })}`, `lock ${KEY}`, `kv_get ${KEY}`, 'create', `kv_incrby ${KEY} +1 ttl=${2 * 86_400}`,
    ])
    expect(h.s.created).toEqual([{ listingId: 'L9', buyerProfileId: P, sellerId: 's9', sellerProfileId: 't9' }])
    expect(h.s.pool.get(KEY)).toBe(1)
    // The tier is re-derived just BEFORE the transaction (its reads use the shared client — a second pool connection
    // inside the transaction could starve the pool) and the day recounted INSIDE it: a revocation or a parallel tap since
    // the early check is still seen.
    expect(h.s.identityCalls).toEqual([{ profileId: P, now: NOW }])
    expect(h.s.countQueries.map((q) => q.reader)).toEqual(['tx'])
    expect(h.s.countQueries[0].args.where.createdAt).toEqual({ gte: DAY_START })
    expect(h.s.txOpts).toEqual({ timeout: 15_000 })
  })

  it('at the limit: refused with the standing, and nothing is written', async () => {
    h.s.convos = [opened('L1'), opened('L2'), opened('L3')]
    const r = await open()
    expect(r).toEqual({
      outcome: 'refused',
      standing: {
        tier: 'unverified', limit: 3, next: 'verify_identity', nextLimit: 10, needsPhone: false, pooled: true,
        used: 3, remaining: 0, resetAt: RESET.toISOString(), reason: 'limit', hasThread: false,
      },
    })
    expect(h.s.created).toEqual([])
    expect(h.s.events).not.toContain('create')
    expect(h.s.pool.has(KEY)).toBe(false) // a refused attempt spends nothing
  })

  it('⛔ three in a row, then the fourth is refused — each insert is counted by the next — and reopening one still works', async () => {
    for (const [i, listingId] of ['L1', 'L2', 'L3'].entries()) {
      expect(await open({ listingId }), listingId).toEqual({ outcome: 'created', id: `c_new_${i + 1}` })
    }
    expect(await open({ listingId: 'L4' })).toMatchObject({ outcome: 'refused', standing: { used: 3, remaining: 0, reason: 'limit' } })
    expect(h.s.pool.get(KEY)).toBe(3)
    expect(await open({ listingId: 'L1' })).toEqual({ outcome: 'existing', id: 'c_new_1' })
    expect(h.s.created).toHaveLength(3)
  })

  it('⛔ the connection\'s 6 are shared: two accounts open three each, and a third account is refused on the pool', async () => {
    for (const profileId of ['p2', 'p3']) {
      for (const listingId of ['L1', 'L2', 'L3']) expect((await open({ profileId, listingId })).outcome).toBe('created')
    }
    expect(h.s.pool.get(KEY)).toBe(6)
    expect(await open({ profileId: 'p4', listingId: 'L1' })).toMatchObject({ outcome: 'refused', standing: { used: 0, remaining: 0, reason: 'pool' } })
    expect(h.s.created).toHaveLength(6)
  })

  it('pool exhausted: refused, reason pool, nothing written', async () => {
    h.s.pool.set(KEY, TEACHER_DM_IP_POOL)
    expect(await open()).toMatchObject({ outcome: 'refused', standing: { tier: 'unverified', used: 0, remaining: 0, reason: 'pool' } })
    expect(h.s.created).toEqual([])
    expect(h.s.pool.get(KEY)).toBe(TEACHER_DM_IP_POOL)
  })

  it('a verified identity takes no pool lock and writes no counter', async () => {
    h.s.identity = 'verified'
    expect(await open()).toEqual({ outcome: 'created', id: 'c_new_1' })
    expect(h.s.events).toEqual(['lock teacher-dm:p1', 'find', 'count', `revoked? ${JSON.stringify({ profileId: P, status: 'revoked' })}`, 'create'])
    expect(h.s.pool.size).toBe(0)
  })

  it('⛔ no address: the shared no-address pool is locked and counted like any other — never skipped', async () => {
    const NOADDR = poolKeyFor(null, '2026-10-13')
    expect(await open({ ip: null })).toEqual({ outcome: 'created', id: 'c_new_1' })
    expect(h.s.events).toEqual(['lock teacher-dm:p1', 'find', 'count', `revoked? ${JSON.stringify({ profileId: P, status: 'revoked' })}`, `lock ${NOADDR}`, `kv_get ${NOADDR}`, 'create', `kv_incrby ${NOADDR} +1 ttl=${2 * 86_400}`])
    expect(h.s.pool.get(NOADDR)).toBe(1)
  })

  it('⛔ a revocation between the early check and the insert is seen: refused, revoked', async () => {
    h.s.identity = 'revoked'
    expect(await open()).toMatchObject({ outcome: 'refused', standing: { tier: 'revoked', limit: 0, remaining: 0, reason: 'revoked', next: 'none' } })
    expect(h.s.created).toEqual([])
    expect(h.s.pool.size).toBe(0)
  })

  it('⛔ a revocation landing while the request waits on the lock is seen UNDER it: refused revoked, nothing created, no pool touched (codex, gate 2026-10-13)', async () => {
    h.s.revokedUnderLock = true // the tier read before the transaction still said unverified
    expect(await open()).toMatchObject({ outcome: 'refused', standing: { tier: 'revoked', limit: 0, remaining: 0, reason: 'revoked', next: 'none' } })
    expect(h.s.created).toEqual([])
    expect(h.s.events).toEqual(['lock teacher-dm:p1', 'find', 'count', `revoked? ${JSON.stringify({ profileId: P, status: 'revoked' })}`])
    expect(h.s.pool.size).toBe(0)
  })

  it('⛔ the day is read UNDER the lock: a request that waited past midnight is counted and pooled on the day its thread is made (codex, gate 2026-10-13)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(new Date('2026-10-13T23:59:59.900+07:00'))
      h.s.pool.set(KEY, TEACHER_DM_IP_POOL) // the 13th's pool is spent
      h.s.onLock = () => vi.setSystemTime(new Date('2026-10-14T00:00:00.200+07:00'))
      expect(await openTeacherThread({ profileId: P, listingId: 'L9', sellerId: 's9', sellerProfileId: 't9', ip: IP })).toEqual({ outcome: 'created', id: 'c_new_1' })
      const KEY14 = poolKeyFor(IP, '2026-10-14')
      expect(h.s.pool.get(KEY14)).toBe(1)
      expect(h.s.pool.get(KEY)).toBe(TEACHER_DM_IP_POOL)
      expect(h.s.countQueries[0].args.where.createdAt).toEqual({ gte: new Date('2026-10-13T17:00:00.000Z') })
    } finally {
      vi.useRealTimers()
    }
  })

  it('P2002: the thread a concurrent request just made is the same thread — existing, and the pool is not spent', async () => {
    h.s.raceWinner = 'c_winner'
    expect(await open()).toEqual({ outcome: 'existing', id: 'c_winner' })
    expect(h.s.created).toEqual([])
    expect(h.s.pool.has(KEY)).toBe(false)
  })

  it('P2002 with no thread to find, or any other failure, is rethrown', async () => {
    const dup = Object.assign(new Error('Unique constraint failed'), { code: 'P2002' })
    h.s.createThrows = dup
    await expect(open()).rejects.toBe(dup)
    const down = Object.assign(new Error('Connection reset'), { code: 'P1001' })
    h.s.createThrows = down
    await expect(open({ listingId: 'L8' })).rejects.toBe(down)
  })
})

describe('teacherDmRefusal — the refusal and everything the client words it from', () => {
  const standing = (over: Partial<TeacherDmStanding> = {}): TeacherDmStanding => ({
    tier: 'unverified', limit: 3, next: 'verify_identity', nextLimit: 10, needsPhone: false, pooled: true,
    used: 3, remaining: 0, resetAt: RESET.toISOString(), reason: 'limit', hasThread: false, ...over,
  })

  it('429, Retry-After until the Vietnam midnight, no-store, and the facts — no ids', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW.getTime())
    const res = teacherDmRefusal(standing(), { error: 'teacher_thread_cap' })
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe(String(14 * 3600)) // 10:00 → 24:00 Vietnam time
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')
    expect(await res.json()).toEqual({
      error: 'teacher_thread_cap', tier: 'unverified', limit: 3, used: 3, remaining: 0,
      resetAt: RESET.toISOString(), next: 'verify_identity', nextLimit: 10, reason: 'limit',
    })
  })

  it('Retry-After is never 0 or negative', () => {
    vi.spyOn(Date, 'now').mockReturnValue(RESET.getTime() + 5_000)
    expect(teacherDmRefusal(standing(), { error: 'teacher_thread_cap' }).headers.get('Retry-After')).toBe('1')
  })

  it('the pool refusal says pool', async () => {
    const res = teacherDmRefusal(standing({ used: 0, reason: 'pool' }), { error: 'teacher_thread_cap' })
    expect(res.status).toBe(429)
    expect(await res.json()).toMatchObject({ error: 'teacher_thread_cap', used: 0, reason: 'pool' })
  })

  it('⛔ a revoked identity is 403 with no Retry-After — waiting changes nothing', async () => {
    const res = teacherDmRefusal(standing({ tier: 'revoked', limit: 0, next: 'none', nextLimit: null, pooled: false, used: 0, reason: 'revoked' }), { error: 'teacher_thread_cap' })
    expect(res.status).toBe(403)
    expect(res.headers.get('Retry-After')).toBeNull()
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')
    expect(await res.json()).toEqual({
      error: 'teacher_thread_cap', tier: 'revoked', limit: 0, used: 0, remaining: 0,
      resetAt: RESET.toISOString(), next: 'none', nextLimit: null, reason: 'revoked',
    })
  })

  it('logs the rung and the reason, never an id', () => {
    teacherDmRefusal(standing({ reason: 'pool' }), { error: 'teacher_thread_cap' })
    expect(h.s.logs).toEqual([{ message: 'teacher dm refused', ctx: { op: 'teachers.dm_quota.refused', tier: 'unverified', reason: 'pool', next: 'verify_identity' } }])
  })
})

describe('mayWriteToTeacher — two messages until the teacher answers', () => {
  it('a thread with no teacher account on it is not held, and nothing is read', async () => {
    expect(await mayWriteToTeacher('c1', P, null)).toBe(true)
    expect(h.s.messageQueries).toEqual([])
  })

  it('0 or 1 sent: may write; 2 sent: may not', async () => {
    expect(await mayWriteToTeacher('c1', P, 't1')).toBe(true)
    h.s.messages = [msg(P)]
    expect(await mayWriteToTeacher('c1', P, 't1')).toBe(true)
    h.s.messages = [msg(P), msg(P)]
    expect(await mayWriteToTeacher('c1', P, 't1')).toBe(false)
  })

  it('once the teacher has written anything, the chat is open', async () => {
    h.s.messages = [msg(P), msg(P), msg('t1'), msg(P), msg(P)]
    expect(await mayWriteToTeacher('c1', P, 't1')).toBe(true)
  })

  it('⛔ a recalled message still counts — a recall must not buy another try', async () => {
    h.s.messages = [msg(P), msg(P, { deletedAt: NOW })]
    expect(await mayWriteToTeacher('c1', P, 't1')).toBe(false)
    expect(h.s.messageQueries).toEqual(expect.arrayContaining([
      { op: 'findFirst', where: { conversationId: 'c1', senderProfileId: 't1' } },
      { op: 'count', where: { conversationId: 'c1', senderProfileId: P } },
    ]))
  })

  it('counts this writer in this thread only — and a teacher\'s reply elsewhere does not open this one', async () => {
    h.s.messages = [msg(P, { conversationId: 'c2' }), msg(P, { conversationId: 'c2' }), msg('someone-else'), msg(P)]
    expect(await mayWriteToTeacher('c1', P, 't1')).toBe(true)
    h.s.messages = [msg('t1', { conversationId: 'c2' }), msg(P), msg(P)]
    expect(await mayWriteToTeacher('c1', P, 't1')).toBe(false)
  })
})

describe('teacherUnansweredGuard — the atomic half of "2 until reply" (codex, gate 2026-10-13)', () => {
  it('the thread\'s lock first, then the rule read again in one statement that divides by zero when it says no', () => {
    const [lock, check] = teacherUnansweredGuard('c1', P, 't1') as unknown as Array<{ sql: string; values: unknown[] }>
    expect(lock).toEqual({ sql: 'select pg_advisory_xact_lock(hashtext(?))', values: ['teacher-unanswered:c1'] })
    // The same rule as mayWriteToTeacher: the teacher wrote anything, or the writer's messages — every one, recalled
    // too — are under the cap. Measured on a real Postgres: ten concurrent writers, exactly two messages.
    expect(check.sql.replace(/\s+/g, ' ')).toBe(
      'select 1 / (case when exists (select 1 from "Message" where "conversationId" = ? and "senderProfileId" = ?::uuid) ' +
      'or (select count(*) from "Message" where "conversationId" = ? and "senderProfileId" = ?::uuid) < ?::int then 1 else 0 end) as ok',
    )
    expect(check.values).toEqual(['c1', 't1', 'c1', P, TEACHER_UNANSWERED_MAX])
  })

  it('⛔ an OPENER (repeatOf) is also refused as a repeat under the same lock, with its own error, before the cap can fire (codex + Opus, gate 2026-10-13)', () => {
    const [lock, check] = teacherUnansweredGuard('c1', P, 't1', 'Hello') as unknown as Array<{ sql: string; values: unknown[] }>
    expect(lock).toEqual({ sql: 'select pg_advisory_xact_lock(hashtext(?))', values: ['teacher-unanswered:c1'] })
    const sql = check.sql.replace(/\s+/g, ' ')
    // Unanswered, and the newest message is this writer's own, word for word: an int overflow (22003), never the cap's
    // division (22012), which the same condition switches off.
    expect(sql).toContain('(case when not answered and same then 2147483648 else 1 end)::int as fresh')
    expect(sql).toContain('1 / (case when (not answered and same) or answered or sent < ?::int then 1 else 0 end) as ok')
    expect(sql).toContain('order by m."createdAt" desc, m.id desc limit 1')
    expect(check.values).toEqual(['c1', 't1', 'c1', P, P, 'Hello', 'c1', TEACHER_UNANSWERED_MAX])
  })
})

/** The guard's abort exactly as Prisma raised it through the pg adapter on a real Postgres (dm-guard.integration.test.ts). */
const guardAbort = (code = '22012') => Object.assign(new Error(`Invalid \`prisma.$queryRaw()\` invocation: Raw query failed. Code: \`${code}\`.`), {
  name: 'PrismaClientKnownRequestError', code: 'P2010',
  meta: { driverAdapterError: { name: 'DriverAdapterError', cause: { originalCode: code, kind: 'postgres', code, severity: 'ERROR' } } },
})

describe('teacherDmRefusal — no Retry-After where waiting changes nothing', () => {
  it('an account that needs a phone first gets no Retry-After (Opus, gate 2026-10-13)', () => {
    const phone: TeacherDmStanding = { tier: 'unverified', limit: 0, used: 0, remaining: 0, resetAt: RESET.toISOString(), next: 'add_phone', nextLimit: TEACHER_DM_LIMITS.unverified, needsPhone: true, pooled: false, reason: 'phone', hasThread: false }
    const res = teacherDmRefusal(phone, { error: 'teacher_thread_cap' })
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBeNull()
  })
})

describe('teacherGuardAbort — the guard\'s two refusals, and nothing else', () => {
  it('P2010 carrying 22012 is the cap, 22003 a repeat; any other code, or another error, is neither', () => {
    expect(teacherGuardAbort(guardAbort())).toBe('cap')
    expect(teacherGuardAbort(guardAbort('22003'))).toBe('repeat')
    expect(teacherGuardAbort(Object.assign(new Error('x'), { code: 'P2010', meta: { driverAdapterError: { cause: { code: '40001' } } } }))).toBeNull()
    expect(teacherGuardAbort(Object.assign(new Error('x'), { code: 'P2002' }))).toBeNull()
    for (const e of [new Error('division by zero'), null, undefined, 'P2010']) expect(teacherGuardAbort(e)).toBeNull()
  })
})

describe('sendToTeacherGuarded — the guard rides with the send, and its refusal is told from a fault', () => {
  const thread = { conversationId: 'c1', buyerProfileId: P, teacherProfileId: 't1' }

  it('hands the send the guard\'s two statements and answers what the send returned', async () => {
    let got: unknown[] = []
    expect(await sendToTeacherGuarded(thread, async (alongside) => { got = alongside; return 'm1' })).toEqual({ sent: true, value: 'm1' })
    expect(got).toEqual(teacherUnansweredGuard('c1', P, 't1'))
  })

  it('a thread with no teacher account on it has no rule: the send goes bare', async () => {
    let got: unknown[] | null = null
    expect(await sendToTeacherGuarded({ ...thread, teacherProfileId: null }, async (alongside) => { got = alongside; return 'm1' })).toEqual({ sent: true, value: 'm1' })
    expect(got).toEqual([])
  })

  it('⛔ the guard\'s own abort is a REFUSAL, with its reason: nothing of this send was written', async () => {
    expect(await sendToTeacherGuarded(thread, async () => { throw guardAbort() })).toEqual({ sent: false, reason: 'cap' })
    expect(await sendToTeacherGuarded({ ...thread, repeatOf: 'Hello' }, async () => { throw guardAbort('22003') })).toEqual({ sent: false, reason: 'repeat' })
  })

  it('an opener carries its words to the guard; a plain send carries none', async () => {
    let got: unknown[] = []
    await sendToTeacherGuarded({ ...thread, repeatOf: 'Hello' }, async (alongside) => { got = alongside; return 'm1' })
    expect(got).toEqual(teacherUnansweredGuard('c1', P, 't1', 'Hello'))
  })

  it('⛔ any other failure is the send\'s own, rethrown — even with the rule now saying no: a failure AFTER the message committed must never read as "not sent" (Opus, gate 2026-10-13)', async () => {
    h.s.messages = [msg(P), msg(P)] // this very message would have made it two
    await expect(sendToTeacherGuarded(thread, async () => { throw new Error('push failed') })).rejects.toThrow('push failed')
    const p2010Other = Object.assign(new Error('Raw query failed'), { code: 'P2010', meta: { driverAdapterError: { cause: { code: '57014', originalCode: '57014' } } } })
    await expect(sendToTeacherGuarded(thread, async () => { throw p2010Other })).rejects.toBe(p2010Other)
  })
})

describe('openerAgainst — what the thread\'s newest message says about an opener about to go in', () => {
  const OPENER = 'Hello, I am looking for a teacher and your profile looks like a good fit — are you open to talking?'

  it('an empty thread: the first contact, and no repeat', async () => {
    expect(await openerAgainst('c1', P, 't1', OPENER)).toEqual({ empty: true, repeat: false })
    expect(h.s.messageQueries).toEqual([{ op: 'findFirst', where: { conversationId: 'c1' } }])
  })

  it('⛔ the newest message is this writer\'s own, word for word: a re-sent opener (Opus, gate 2026-10-13)', async () => {
    h.s.messages = [msg(P, { body: OPENER })]
    expect(await openerAgainst('c1', P, 't1', OPENER)).toEqual({ empty: false, repeat: true })
  })

  it('not a repeat: other words, an offer (no text), a recalled message, or the teacher wrote last', async () => {
    h.s.messages = [msg(P, { body: OPENER })]
    expect(await openerAgainst('c1', P, 't1', 'Could you cover Thursday?')).toEqual({ empty: false, repeat: false })
    expect(await openerAgainst('c1', P, 't1', null)).toEqual({ empty: false, repeat: false })
    h.s.messages = [msg(P, { body: OPENER, deletedAt: NOW })]
    expect((await openerAgainst('c1', P, 't1', OPENER)).repeat).toBe(false)
    h.s.messages = [msg(P, { body: OPENER }), msg('t1', { body: 'Hi! Yes.' })]
    expect((await openerAgainst('c1', P, 't1', OPENER)).repeat).toBe(false)
  })

  it('⛔ only while unanswered: once the teacher has written anything, the same words again are a message, not a repeat (codex, gate 2026-10-13)', async () => {
    h.s.messages = [msg(P, { body: OPENER }), msg('t1', { body: 'Hi!' }), msg(P, { body: 'Thanks!' })]
    expect(await openerAgainst('c1', P, 't1', 'Thanks!')).toEqual({ empty: false, repeat: false })
    // No teacher account on the thread: nothing to have answered.
    h.s.messages = [msg(P, { body: OPENER })]
    expect((await openerAgainst('c1', P, null, OPENER)).repeat).toBe(true)
  })

  it('reads the NEWEST message of THIS thread only', async () => {
    h.s.messages = [msg(P, { body: OPENER }), msg(P, { body: 'And Thursday?' }), msg(P, { conversationId: 'c2', body: OPENER })]
    expect(await openerAgainst('c1', P, 't1', OPENER)).toEqual({ empty: false, repeat: false })
    expect(await openerAgainst('c1', P, 't1', 'And Thursday?')).toEqual({ empty: false, repeat: true })
  })
})
