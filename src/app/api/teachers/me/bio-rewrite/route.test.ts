import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TeacherBioRequest } from '@/lib/teachers/bio-context'

// POST /api/teachers/me/bio-rewrite — "Improve with AI" under the About text (owner, 2026-10-21): Vertex or nothing, the
// free refusals before anything is spent, one rewrite at a time per account, the limits one after another (the account's
// own first), the consent record BEFORE anything leaves, a refused answer is a 502 — never the teacher's own text — and
// nothing of the text in a log line or a record. The rewrite itself is bio-ai.ts's (its own tests); the request the
// route builds is the REAL teacherBioRequest, so what the body carries beyond the allowlist is seen to stop here.
const h = vi.hoisted(() => ({
  signedIn: true,
  vertex: true,
  client: { vertex: 'the Vertex client' },
  limits: [] as string[],
  limitArgs: [] as unknown[][],
  deny: null as string | null,
  lock: new Map<string, unknown>(),
  lockOpts: [] as unknown[],
  delFails: false,
  calls: [] as string[],
  sql: [] as string[],
  txOpts: [] as unknown[],
  audits: [] as { action: string; actorType: string; actorId: string; subjectType: string; subjectId: string; detail: Record<string, unknown> }[],
  failAudit: null as string | null,
  result: null as unknown,
  rewrites: [] as { ai: unknown; request: TeacherBioRequest; opts: { fallback: string } }[],
  onRewrite: null as null | (() => unknown),
  logs: [] as unknown[][],
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/admin', () => ({
  getCurrentProfile: async () => (h.signedIn ? { id: 'p1', email: 'a@example.com' } : null),
  getCurrentProfileId: async () => (h.signedIn ? 'p1' : null),
  getAdmin: async () => null,
  isAdminEmail: () => false,
}))
vi.mock('@/lib/client-ip', () => ({ clientIp: () => '203.0.113.7' }))
vi.mock('@/lib/ratelimit', () => ({
  rateLimit: async (...args: unknown[]) => {
    const name = String(args[0])
    h.limits.push(name)
    h.limitArgs.push(args)
    h.calls.push(`limit:${name}`)
    return { success: h.deny !== name, resetSec: 0 }
  },
  kv: {
    set: async (k: string, v: unknown, opts?: { nx?: boolean; ex?: number }) => {
      h.lockOpts.push({ key: k, ...opts })
      if (opts?.nx && h.lock.has(k)) return null
      h.lock.set(k, v)
      return 'OK'
    },
    get: async (k: string) => h.lock.get(k) ?? null,
    del: async (k: string) => {
      if (h.delFails) throw new Error('kv_store: connection reset')
      h.calls.push('unlock')
      h.lock.delete(k)
    },
  },
}))
vi.mock('@/lib/db', () => ({
  db: {
    $transaction: async (fn: (tx: unknown) => Promise<unknown>, opts: unknown) => {
      h.txOpts.push(opts)
      return fn({ $executeRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => { h.sql.push([strings.join('?'), ...values].join(' | ')); return 0 } })
    },
  },
}))
vi.mock('@/lib/compliance/audit', () => ({
  appendAudit: async (_tx: unknown, input: (typeof h.audits)[number]) => {
    if (h.failAudit === input.action) throw new Error('lock timeout')
    h.calls.push(input.action)
    h.audits.push(input)
  },
}))
vi.mock('@/lib/gemini', () => ({ getGeminiVertex: () => (h.vertex ? h.client : null), GEMINI_MODEL: 'gemini-3.8-flash' }))
vi.mock('@/lib/teachers/bio-ai', () => ({
  rewriteTeacherBio: async (ai: unknown, request: TeacherBioRequest, opts: { fallback: string }) => {
    h.calls.push('model')
    h.rewrites.push({ ai, request, opts })
    await h.onRewrite?.()
    return h.result
  },
}))
// The real request builder, its call recorded — so the order below shows WHEN the route builds it.
vi.mock('@/lib/teachers/bio-context', async (orig) => {
  const real = await orig<typeof import('@/lib/teachers/bio-context')>()
  return { ...real, teacherBioRequest: (raw: unknown) => { h.calls.push('request'); return real.teacherBioRequest(raw) } }
})
vi.mock('@/lib/log', () => ({ logWarn: (...a: unknown[]) => { h.logs.push(a) }, logError: (...a: unknown[]) => { h.logs.push(a) }, logInfo: () => {} }))

const { POST } = await import('./route')
const { TEACHER_BIO_NOTICE_VERSION, bioNoticeBody } = await import('@/lib/teachers/bio-notice')
const { BIO_OWN_TEXT_MIN } = await import('@/lib/teachers/bio-context')
const { AI_GLOBAL_DAILY_LIMIT } = await import('@/lib/ai-guard')
const { EDITION } = await import('@/lib/edition')
const { wordCount } = await import('@/lib/teachers/search-floor')

/** The teacher's own About text — and below, the model's rewrite. Neither may ever reach a log line or a record. */
const OWN = 'I have taught English to kids in Hanoi since 2021, with games and songs.'
const BIO = 'I teach General English to young children in Hanoi, and I hold a TEFL certificate with 120 hours of training. At Apax English I use games, songs and phonics to keep lessons active. I am looking for part-time work in Hanoi.'
const TEXT_IN = /games and songs|keep lessons active|phonics|Apax/
/** The form's answers, as the About step sends them (the client's allowlist). */
const T = {
  livesIn: 'city', currentCity: 'ha-noi', currentDistrictKey: '', currentProvince: '', jobTypes: ['parttime'], relocate: 'no',
  teachAreas: ['ha-noi'], teachAreasConfirmed: true,
  subjects: ['general-english'], teachLanguages: [], ageGroups: ['kids'], experienceBand: '3-5-years',
  experience: [{ role: 'English Teacher', employer: 'Apax English', city: 'Hanoi', from: '2021-03', to: '' }],
  degreeLevel: 'bachelor', degreeMajor: 'Education', degreeInstitution: '', degreeYear: null,
  certificates: [{ type: 'tefl', hours: 120, provider: '', year: null }],
  nationality: 'GB', englishLevel: 'native', languages: [], headline: 'TEFL-certified teacher for kids', bio: OWN,
}
const OK = { ok: true, bio: BIO, model: 'gemini-3.8-flash', calls: 1 }
const ALL_LIMITS = ['teacher-bio', 'teacher-bio-day', 'teacher-bio-ip', 'teacher-bio-global', 'ai-global']
const NOTICE_SHA = createHash('sha256').update(bioNoticeBody()).digest('hex').slice(0, 16)

function send(body: BodyInit | null, headers: Record<string, string> = {}, init: RequestInit = {}) {
  return POST(new Request('https://eno.vn/api/teachers/me/bio-rewrite', { method: 'POST', headers: { 'content-type': 'application/json', host: 'eno.vn', ...headers }, body, ...init }) as never, {} as never)
}
/** The About step's request; `over` replaces top-level keys (undefined drops one). */
const post = (over: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
  send(JSON.stringify({ t: T, lang: 'en', notice: TEACHER_BIO_NOTICE_VERSION, ...over }), headers)
/** Every log call's arguments as text — an Error with its message and stack (JSON.stringify alone would print `{}`). */
const logged = () => JSON.stringify(h.logs, (_k, v: unknown) => (v instanceof Error ? { name: v.name, message: v.message, stack: v.stack } : v))
const consent = () => h.audits.find((a) => a.action === 'teacher.bio.consent')
const outcome = () => h.audits.find((a) => a.action === 'teacher.bio.result')
/** Nothing was spent and nothing was held: no limit asked, no lock taken, no record, no model call. */
const nothingSpent = () => {
  expect(h.limits).toEqual([])
  expect(h.lockOpts).toEqual([])
  expect(h.audits).toEqual([])
  expect(h.rewrites).toEqual([])
}

beforeEach(() => {
  Object.assign(h, {
    signedIn: true, vertex: true, limits: [], limitArgs: [], deny: null, lockOpts: [], delFails: false, calls: [], sql: [], txOpts: [],
    audits: [], failAudit: null, result: OK, rewrites: [], onRewrite: null, logs: [],
  })
  h.lock.clear()
  // The shell's .env must not decide what the record says (the vitest config's note on the environment).
  vi.stubEnv('GEMINI_LOCATION', '')
})
afterEach(() => { vi.unstubAllEnvs() })

describe('POST /api/teachers/me/bio-rewrite — the refusals that cost nothing', () => {
  it('signed out → 401 auth_required from route(), before anything', async () => {
    h.signedIn = false
    const res = await post()
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'auth_required' })
    nothingSpent()
  })

  it('⛔ no Vertex client (never the API-key path) → 503 ai_unavailable before anything — the body is not even read', async () => {
    h.vertex = false
    const unread = new ReadableStream({ pull() { throw new Error('the body must not be read') } })
    let res = await send(unread, {}, { duplex: 'half' } as RequestInit)
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'ai_unavailable' })
    res = await post()
    expect(res.status).toBe(503)
    nothingSpent()
  })

  it.each([
    ['not JSON', 'not json'],
    ['an array', '[]'],
    ['null', 'null'],
    ['a string', '"t"'],
    ['no answers', JSON.stringify({ lang: 'en', notice: 'x' })],
    ['answers that are a string', JSON.stringify({ t: 'bio' })],
    ['answers that are a list', JSON.stringify({ t: [] })],
    ['answers that are null', JSON.stringify({ t: null })],
  ])('a body that is not the form’s answers (%s) → 400 bad_request, nothing spent', async (_label, body) => {
    const res = await send(body)
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'bad_request' })
    nothingSpent()
  })

  it.each([['an older notice', '2020-01-01'], ['no notice', undefined], ['a notice that is not a string', 42]])(
    '%s → 409 notice_changed, exactly { error, notice: "bio" }, private and never cached — nothing spent',
    async (_label, notice) => {
      const res = await post({ notice })
      expect(res.status).toBe(409)
      expect(await res.json()).toEqual({ error: 'notice_changed', notice: 'bio' })
      expect(res.headers.get('cache-control')).toBe('private, no-store')
      nothingSpent()
    },
  )

  it.each([['empty', ''], ['under the minimum once trimmed', '  hi \n'], ['missing', undefined], ['not a string', 42]])(
    'the teacher’s own text %s → 400 too_short, nothing spent',
    async (_label, bio) => {
      const res = await post({ t: { ...T, bio } })
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'too_short' })
      nothingSpent()
    },
  )

  it('⛔ a body past the cap (the draft route’s, 256 KB) → 413 payload_too_large before it is parsed — by its label, and as it streams in unlabelled; nothing spent (gate review, codex + opus 2026-10-22)', async () => {
    let res = await send('{}', { 'content-length': String(65_536 * 4 + 1) })
    expect(res.status).toBe(413)
    expect(await res.json()).toEqual({ error: 'payload_too_large' })
    const big = new TextEncoder().encode(JSON.stringify({ t: { ...T, bio: 'x'.repeat(300_000) }, lang: 'en', notice: TEACHER_BIO_NOTICE_VERSION }))
    let sent = 0
    const stream = new ReadableStream({ pull(c) { if (sent >= big.length) c.close(); else { c.enqueue(big.slice(sent, sent + 16_384)); sent += 16_384 } } })
    res = await send(stream, {}, { duplex: 'half' } as RequestInit)
    expect(res.status).toBe(413)
    expect(sent).toBeLessThan(big.length) // cut off as it came in, never read to the end
    nothingSpent()
  })

  it('exactly BIO_OWN_TEXT_MIN characters of the teacher’s own text is enough to ask', async () => {
    expect((await post({ t: { ...T, bio: 'x'.repeat(BIO_OWN_TEXT_MIN) } })).status).toBe(200)
  })
})

describe('POST /api/teachers/me/bio-rewrite — one at a time, the limits in order', () => {
  it('⛔ the whole order: the request (built and checked for free), the account’s limits, the shared limits, the consent record, the model, the outcome, the unlock', async () => {
    const res = await post()
    expect(res.status).toBe(200)
    expect(h.calls).toEqual([
      'request', 'limit:teacher-bio', 'limit:teacher-bio-day', 'limit:teacher-bio-ip', 'limit:teacher-bio-global', 'limit:ai-global',
      'teacher.bio.consent', 'model', 'teacher.bio.result', 'unlock',
    ])
  })

  it('⛔ each limit strict, keyed and sized as the feature’s: the account per hour and per day, the connection, the feature, the shared AI day', async () => {
    await post()
    expect(h.limitArgs).toEqual([
      ['teacher-bio', 'p1', 10, '1 h', { strict: true }],
      ['teacher-bio-day', 'p1', 30, '1 d', { strict: true }],
      ['teacher-bio-ip', '203.0.113.7', 100, '1 d', { strict: true }],
      ['teacher-bio-global', 'all', 1000, '1 d', { strict: true }],
      ['ai-global', 'global', AI_GLOBAL_DAILY_LIMIT, '1 d', { strict: true }],
    ])
  })

  it.each([
    ['the account’s hour', 'teacher-bio', 429, 'rate_limited'],
    ['the account’s day', 'teacher-bio-day', 429, 'rate_limited'],
    ['a connection’s day — said as unavailable, never as the account’s own limit', 'teacher-bio-ip', 503, 'ai_unavailable'],
    ['the feature’s day', 'teacher-bio-global', 503, 'ai_unavailable'],
    ['the shared AI day', 'ai-global', 503, 'ai_unavailable'],
  ])('⛔ %s used → %s gives %i %s, and the chain stops there: no later limit, no record, no model call — the lock released', async (_label, name, status, error) => {
    h.deny = name
    const res = await post()
    expect(res.status).toBe(status)
    expect(await res.json()).toEqual({ error })
    expect(h.limits).toEqual(ALL_LIMITS.slice(0, ALL_LIMITS.indexOf(name) + 1))
    expect(h.audits).toEqual([])
    expect(h.rewrites).toEqual([])
    expect(h.calls.at(-1)).toBe('unlock')
    expect(h.lock.size).toBe(0)
  })

  it('⛔ one rewrite at a time per account: a second tap while the first runs → 429 rate_limited, before any limit — and the first releases its lock', async () => {
    let release: () => void = () => {}
    h.onRewrite = () => new Promise<void>((r) => { release = r })
    const first = post()
    await vi.waitFor(() => expect(h.rewrites).toHaveLength(1))
    expect(h.lockOpts).toEqual([{ key: 'teacher-bio:busy:p1', nx: true, ex: 90 }])
    const second = await post()
    expect(second.status).toBe(429)
    expect(await second.json()).toEqual({ error: 'rate_limited' })
    expect(h.limits).toEqual(ALL_LIMITS) // the first request's, once: the second spent none
    expect(h.rewrites).toHaveLength(1)
    expect(h.lock.size).toBe(1) // the second never touched the first's lock
    release()
    expect((await first).status).toBe(200)
    expect(h.lock.size).toBe(0)
    // …and the next tap runs.
    h.onRewrite = null
    expect((await post()).status).toBe(200)
  })

  it('⛔ the lock is OWNED: a request whose lock was taken over (it ran past it) never frees the other one', async () => {
    h.onRewrite = () => { h.lock.set('teacher-bio:busy:p1', 'another-request') }
    const res = await post()
    expect(res.status).toBe(200)
    expect(h.calls).not.toContain('unlock')
    expect(h.lock.get('teacher-bio:busy:p1')).toBe('another-request')
  })

  it('the lock is released on every way out — a failed consent record, a refused answer — and an unlock that fails is logged, never thrown', async () => {
    h.failAudit = 'teacher.bio.consent'
    expect((await post()).status).toBe(503)
    expect(h.lock.size).toBe(0)
    h.failAudit = null
    h.result = { ok: false, failure: 'rejected', reason: 'thin', calls: 2 }
    expect((await post()).status).toBe(502)
    expect(h.lock.size).toBe(0)
    h.result = OK
    h.delFails = true
    h.logs = []
    const res = await post()
    expect(res.status).toBe(200)
    expect(h.logs).toEqual([[expect.any(Error), { op: 'teachers.bio.unlock' }]])
  })
})

describe('POST /api/teachers/me/bio-rewrite — the consent record BEFORE the transfer', () => {
  it('⛔ written before the model is called, naming the notice, its hash, the page, the recipient — what was sent as counts and flags, never a word of it', async () => {
    await post()
    expect(h.calls.indexOf('teacher.bio.consent')).toBeLessThan(h.calls.indexOf('model'))
    const row = consent()
    expect(row).toMatchObject({ actorType: 'user', actorId: 'p1', subjectType: 'profile', subjectId: 'p1' })
    expect(row?.detail).toEqual({
      readId: expect.stringMatching(/^[0-9a-f-]{36}$/), notice: TEACHER_BIO_NOTICE_VERSION, noticeSha: NOTICE_SHA, shownSha: null,
      lang: 'en', translated: false, edition: EDITION, host: 'eno.vn', native: false,
      recipient: 'Google Cloud (Vertex AI, Gemini)', location: 'global',
      facts: h.rewrites[0].request.facts.length, ownText: true,
    })
    expect(h.rewrites[0].request.facts.length).toBeGreaterThan(5)
    expect(JSON.stringify(h.audits)).not.toMatch(TEXT_IN)
    // The CV import's writer: a bounded wait for the log's lock, in its own transaction.
    expect(h.sql[0]).toBe("SELECT set_config('lock_timeout', ?, true) | 1000ms")
    expect(h.txOpts[0]).toEqual({ maxWait: 1_000 })
  })

  it('the notice hash is the authored words’ (sha256 of both languages, first 16 hex) — the same in every record', async () => {
    expect(NOTICE_SHA).toMatch(/^[0-9a-f]{16}$/)
    await post()
    await post({ lang: 'ko' })
    expect(h.audits.filter((a) => a.action === 'teacher.bio.consent').map((a) => a.detail.noticeSha)).toEqual([NOTICE_SHA, NOTICE_SHA])
  })

  it('the page’s own hash of the words it SHOWED is recorded beside it — anything but 64 lower-case hex is null', async () => {
    for (const [shown, recorded] of [['a'.repeat(64), 'a'.repeat(64)], ['A'.repeat(64), null], ['abc', null], [`${'0'.repeat(64)}0`, null], [42, null]] as const) {
      h.audits = []
      await post({ shown })
      expect(consent()?.detail.shownSha).toBe(recorded)
    }
  })

  it('the language the page was read in — any of the eleven, `translated` beyond en/vi; anything else reads as English', async () => {
    for (const [lang, recorded, translated] of [['ko', 'ko', true], ['vi', 'vi', false], ['en', 'en', false], ['xx-evil', 'en', false], [undefined, 'en', false]] as const) {
      h.audits = []
      await post({ lang })
      expect(consent()?.detail).toMatchObject({ lang: recorded, translated })
    }
  })

  it('the region the call is made in, as configured (global when unset) — and a request from the app says so', async () => {
    await post({})
    expect(consent()?.detail).toMatchObject({ location: 'global', native: false })
    h.audits = []
    // A configured region is the one recorded — never a hard-coded 'global' (gate review, 2026-10-21).
    vi.stubEnv('GEMINI_LOCATION', 'asia-southeast1')
    await post({}, { 'user-agent': 'Mozilla/5.0 (iPhone) EnoNativeApp/1.0.3' })
    expect(consent()?.detail).toMatchObject({ location: 'asia-southeast1', native: true })
  })

  it('the site the teacher agreed on is the request\'s own host — never a fixed one', async () => {
    await post({}, { host: 'www.eno.forum' })
    expect(consent()?.detail.host).toBe('www.eno.forum')
  })

  it('nothing to write from — an About text of contact details only, and no answers — is refused before any limit or record', async () => {
    const res = await send(JSON.stringify({ t: { bio: 'Zalo me on 0901 234 567.' }, lang: 'en', notice: TEACHER_BIO_NOTICE_VERSION }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'too_short' })
    expect(h.limits).toEqual([])
    expect(h.audits).toHaveLength(0)
    expect(h.rewrites).toHaveLength(0)
  })

  it('a teacher whose own text was all contact details still asks — the record says no own text went', async () => {
    await post({ t: { ...T, bio: 'Zalo me on 0901 234 567.' } })
    expect(consent()?.detail.ownText).toBe(false)
    expect(h.rewrites[0].request.ownBio).toBe('')
  })

  it('⛔ no consent record, nothing leaves: a failed write → 503 ai_unavailable, the model never called, logged by name only', async () => {
    h.failAudit = 'teacher.bio.consent'
    const res = await post()
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'ai_unavailable' })
    expect(h.rewrites).toEqual([])
    expect(h.logs).toEqual([['[teacher-bio] consent record failed', { name: 'Error' }]])
  })
})

describe('POST /api/teachers/me/bio-rewrite — the answer', () => {
  it('a rewrite → 200 { bio, model }, private and never cached — and the outcome row: ok, the model, the calls, the words', async () => {
    h.result = { ...OK, calls: 2 }
    const res = await post()
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    expect(await res.json()).toEqual({ bio: BIO, model: 'gemini-3.8-flash' })
    expect(outcome()?.detail).toEqual({ readId: consent()?.detail.readId, outcome: 'ok', model: 'gemini-3.8-flash', calls: 2, words: wordCount(BIO) })
    expect(wordCount(BIO)).toBe(41) // words, not characters
    expect(h.audits.map((a) => a.action)).toEqual(['teacher.bio.consent', 'teacher.bio.result']) // and nothing else is written
  })

  it('the model gets the Vertex client and the request built from the answers — in the language of the page when it must fall back', async () => {
    await post()
    expect(h.rewrites[0].ai).toBe(h.client)
    expect(h.rewrites[0].request.ownBio).toBe(OWN)
    expect(h.rewrites[0].request.facts).toContain('Subjects: General English')
    expect(h.rewrites[0].opts).toEqual({ fallback: 'English' })
    for (const [lang, fallback] of [['vi', 'Vietnamese'], ['ko', 'English'], ['xx-evil', 'English']] as const) {
      h.rewrites = []
      await post({ lang })
      expect(h.rewrites[0].opts).toEqual({ fallback })
    }
  })

  it('⛔ what the notice says never leaves stops HERE, whatever the body carries: no name, phone, photo, video, salary, start, cover or opt-in reaches the model', async () => {
    await post({
      t: {
        ...T, fullName: 'Thomas Reed', phone: '+84 901 234 567', photoUrl: 'https://sb.eno.vn/storage/v1/object/public/listings/thomas.webp',
        videoUrl: 'https://sb.eno.vn/storage/v1/object/public/listings/thomas-intro.mp4', expectedSalaryM: 47, availableFrom: '2026-12-01',
        coverOpen: true, coverSlots: ['mon-am'], coverRateVnd: 350_000, coverConsent: true, matchEmailOptIn: true, staffContactOptIn: true,
      },
    })
    expect(JSON.stringify(h.rewrites[0].request.facts)).not.toMatch(/Thomas|Reed|901|thomas|47|2026-12|350|cover|opt/i)
    expect(h.rewrites[0].request.ownBio).toBe(OWN)
  })

  it('⛔ an answer the gate refused → 502 ai_failed — never the teacher’s own text — the outcome row says why, the log its kind only', async () => {
    h.result = { ok: false, failure: 'rejected', reason: 'ungrounded', calls: 2 }
    const res = await post()
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: 'ai_failed' })
    expect(outcome()?.detail).toEqual({ readId: consent()?.detail.readId, outcome: 'rejected', reason: 'ungrounded', calls: 2 })
    expect(h.logs).toEqual([['[teacher-bio] no rewrite', { failure: 'rejected', reason: 'ungrounded', calls: 2, name: null, status: null }]])
  })

  it('⛔ no answer from the model → 502 ai_failed; the outcome row says failed; the log names the error and its status, NEVER its message (it can quote the reply)', async () => {
    const quoting = new SyntaxError(`Unexpected token in JSON at position 3: "${BIO}" — ${OWN}`)
    h.result = { ok: false, failure: 'model', calls: 3, error: quoting }
    let res = await post()
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: 'ai_failed' })
    expect(outcome()?.detail).toEqual({ readId: consent()?.detail.readId, outcome: 'failed', calls: 3 })
    expect(h.logs).toEqual([['[teacher-bio] no rewrite', { failure: 'model', reason: null, calls: 3, name: 'SyntaxError', status: null }]])
    // Google's own error, with a status (and a message that quotes the request).
    h.logs = []
    h.result = { ok: false, failure: 'model', calls: 1, error: Object.assign(new Error(`quota for "${OWN}"`), { name: 'ServerError', status: 503 }) }
    res = await post()
    expect(res.status).toBe(502)
    expect(h.logs).toEqual([['[teacher-bio] no rewrite', { failure: 'model', reason: null, calls: 1, name: 'ServerError', status: 503 }]])
  })

  it('⛔ NOTHING OF THE TEXT IN ANY LOG LINE OR RECORD — across a rewrite, a refusal, a failed model, a failed record and a failed unlock', async () => {
    const quote = `"${BIO}" ${OWN}`
    const runs: Array<() => void> = [
      () => { h.result = OK },
      () => { h.result = { ok: false, failure: 'rejected', reason: 'placeholder', calls: 2 } },
      () => { h.result = { ok: false, failure: 'model', calls: 3, error: new SyntaxError(quote) } },
      () => { h.result = { ok: false, failure: 'model', calls: 1, error: Object.assign(new Error(quote), { status: 500 }) } },
      () => { h.result = OK; h.failAudit = 'teacher.bio.result' },
      () => { h.failAudit = 'teacher.bio.consent' },
      () => { h.failAudit = null; h.delFails = true },
    ]
    for (const arrange of runs) {
      arrange()
      await post()
    }
    expect(h.logs.length).toBeGreaterThanOrEqual(6)
    expect(logged()).not.toMatch(TEXT_IN)
    expect(logged()).not.toContain('Hanoi')
    expect(JSON.stringify(h.audits)).not.toMatch(TEXT_IN)
  })

  it('a failed outcome row never costs the teacher the rewrite: 200 with the text, logged by name only', async () => {
    h.failAudit = 'teacher.bio.result'
    const res = await post()
    expect(res.status).toBe(200)
    expect((await res.json()).bio).toBe(BIO)
    expect(h.logs).toEqual([['[teacher-bio] outcome record failed', { name: 'Error' }]])
  })
})
