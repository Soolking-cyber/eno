import { createHash, createHmac } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * infra/cloudflare/eno-mailer.js — the Worker every app email goes to first (Cloudflare Email
 * Sending; since 2026-09-23 the primary transport, with Resend as eno.vn's fallback in mail.ts).
 *
 * These run the REAL Worker file against fake bindings. What they pin, in the order it matters:
 *   1. The sender is decided by the KEY that verified, never by the caller: a forum key cannot send
 *      as eno.vn, and nothing in the body can set From, Reply-To, Cc or Bcc.
 *   2. Every authentication failure is the same 401, and nothing is sent.
 *   3. One recipient, a closed header list, one attachment, a size cap, no marketing.
 *   4. The daily budget refuses background mail first and security last.
 *   5. Idempotency and the budget fail the way the header says: open, with an unreadable counter
 *      braking background mail per isolate and never refusing sign-in or security.
 *   6. Logs carry a masked recipient and never a body.
 * The smoke script's signer is run against it too, so the operator's cutover check cannot drift.
 */

import worker from '../../infra/cloudflare/eno-mailer.js'
import { buildRequest as buildSmokeRequest, main as smokeMain } from '../../scripts/mailer-smoke.mjs'

/**
 * The signature exactly as the Worker's header documents it, written out here rather than imported
 * from src/lib/mail.ts: these tests stand on the contract alone, and mail.test.ts separately proves
 * that what mail.ts signs, this Worker verifies.
 */
function signMailerRequest(input: { key: string; ts: number; edition: string; idempotencyKey: string; body: string }): string {
  const bodyHash = createHash('sha256').update(input.body, 'utf8').digest('hex')
  return 'v1=' + createHmac('sha256', input.key).update(`${input.ts}\n${input.edition}\n${input.idempotencyKey}\n${bodyHash}`).digest('hex')
}

const KEY_VN = 'vn-key-0123456789abcdef0123456789abcdef'
const KEY_FORUM = 'forum-key-0123456789abcdef0123456789abcd'
const URL_SEND = 'https://eno-mailer.example.workers.dev/v1/send'

type Sent = Record<string, unknown>
type KVStore = Map<string, string>

function fakeKV(store: KVStore, opts: { failGet?: boolean; failPut?: boolean } = {}) {
  return {
    puts: [] as Array<{ key: string; value: string; ttl?: number }>,
    async get(key: string) {
      if (opts.failGet) throw new Error('KV GET failed: 503')
      return store.get(key) ?? null
    },
    async put(key: string, value: string, o?: { expirationTtl?: number }) {
      if (opts.failPut) throw new Error('KV PUT failed: 429 Too Many Requests')
      this.puts.push({ key, value, ttl: o?.expirationTtl })
      store.set(key, value)
    },
  }
}

function fakeBinding(name: string) {
  const b = {
    name,
    sent: [] as Sent[],
    throwCode: null as string | null,
    async send(msg: Sent) {
      if (b.throwCode) throw Object.assign(new Error('binding refused'), { code: b.throwCode })
      b.sent.push(msg)
      return { messageId: `${name}-msg-${b.sent.length}` }
    },
  }
  return b
}

let store: KVStore
let env: Record<string, unknown> & { EMAIL_VN: ReturnType<typeof fakeBinding>; EMAIL_FORUM: ReturnType<typeof fakeBinding>; MAILER_KV: ReturnType<typeof fakeKV> }
let waits: Promise<unknown>[]
let logs: string[]
const ctx = { waitUntil: (p: Promise<unknown>) => { waits.push(p) } }

beforeEach(() => {
  store = new Map()
  waits = []
  logs = []
  env = {
    EMAIL_VN: fakeBinding('vn'),
    EMAIL_FORUM: fakeBinding('forum'),
    MAILER_KV: fakeKV(store),
    MAILER_KEY_VN: KEY_VN,
    MAILER_KEY_FORUM: KEY_FORUM,
    DAILY_QUOTA: '1000',
    PRIORITY_RESERVE: '400',
    SECURITY_RESERVE: '25',
  }
  for (const level of ['log', 'warn', 'error'] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => { logs.push(args.map(String).join(' ')) })
  }
})
afterEach(() => { vi.restoreAllMocks() })

const baseBody = (over: Record<string, unknown> = {}) => ({
  to: 'alice.example@gmail.com',
  subject: 'Your sign-in link for eno.vn',
  html: '<p>SECRET-MAGIC-LINK</p>',
  text: 'SECRET-MAGIC-LINK',
  class: 'transactional',
  tag: 'test',
  ...over,
})

function signed(opts: {
  edition?: string
  key?: string
  body?: unknown
  rawBody?: string
  ts?: number
  idem?: string
  signature?: string
  headers?: Record<string, string>
  method?: string
  url?: string
} = {}): Request {
  const edition = opts.edition ?? 'vn'
  const key = opts.key ?? (edition === 'forum' ? KEY_FORUM : KEY_VN)
  const body = opts.rawBody ?? JSON.stringify(opts.body ?? baseBody())
  const ts = opts.ts ?? Math.floor(Date.now() / 1000)
  const idem = opts.idem ?? 'idem-test-0001'
  const signature = opts.signature ?? signMailerRequest({ key, ts, edition, idempotencyKey: idem, body })
  return new Request(opts.url ?? URL_SEND, {
    method: opts.method ?? 'POST',
    headers: {
      'content-type': 'application/json',
      'x-eno-edition': edition,
      'x-eno-timestamp': String(ts),
      'idempotency-key': idem,
      'x-eno-signature': signature,
      ...opts.headers,
    },
    ...(opts.method === 'GET' ? {} : { body }),
  })
}

async function call(req: Request) {
  const res = await worker.fetch(req, env, ctx) as Response
  await Promise.all(waits)
  return { res, body: await res.json() as Record<string, unknown> }
}

const allSent = () => [...env.EMAIL_VN.sent, ...env.EMAIL_FORUM.sent]

// ── 1. The sender is the key's edition, never the caller's choice ──────────────────────────────

describe('eno-mailer — sender pinned to the verified edition', () => {
  it('eno.vn key → EMAIL_VN, From no-reply@eno.vn, Reply-To support@eno.vn', async () => {
    const { res, body } = await call(signed())
    expect(res.status).toBe(200)
    expect(body).toEqual({ ok: true, messageId: 'vn-msg-1' })
    expect(env.EMAIL_FORUM.sent).toEqual([])
    expect(env.EMAIL_VN.sent).toHaveLength(1)
    expect(env.EMAIL_VN.sent[0]).toEqual({
      to: 'alice.example@gmail.com',
      subject: 'Your sign-in link for eno.vn',
      html: '<p>SECRET-MAGIC-LINK</p>',
      text: 'SECRET-MAGIC-LINK',
      from: { email: 'no-reply@eno.vn', name: 'eno.vn' },
      replyTo: 'support@eno.vn',
    })
  })

  it('eno.forum key → EMAIL_FORUM, From no-reply@eno.forum, Reply-To support@eno.forum', async () => {
    const { res } = await call(signed({ edition: 'forum' }))
    expect(res.status).toBe(200)
    expect(env.EMAIL_VN.sent).toEqual([])
    expect(env.EMAIL_FORUM.sent[0]).toMatchObject({
      from: { email: 'no-reply@eno.forum', name: 'eno.forum' },
      replyTo: 'support@eno.forum',
    })
  })

  it('⛔ the forum key cannot send as eno.vn, nor the vn key as the forum', async () => {
    const a = await call(signed({ edition: 'vn', key: KEY_FORUM }))
    const b = await call(signed({ edition: 'forum', key: KEY_VN }))
    expect(a.res.status).toBe(401)
    expect(b.res.status).toBe(401)
    expect(allSent()).toEqual([])
  })

  it('ignores every sender/recipient field the body tries to set', async () => {
    const { res } = await call(signed({
      body: baseBody({ from: 'ceo@eno.vn', replyTo: 'attacker@evil.test', reply_to: 'x@evil.test', cc: 'x@evil.test', bcc: ['y@evil.test'] }),
    }))
    expect(res.status).toBe(200)
    const msg = env.EMAIL_VN.sent[0]
    expect(Object.keys(msg).sort()).toEqual(['from', 'html', 'replyTo', 'subject', 'text', 'to'])
    expect(msg.from).toEqual({ email: 'no-reply@eno.vn', name: 'eno.vn' })
    expect(msg.replyTo).toBe('support@eno.vn')
  })

  it('sign-in mail carries NO Reply-To — a reply must not carry a live link into support', async () => {
    await call(signed({ body: baseBody({ class: 'signin' }) }))
    expect(env.EMAIL_VN.sent[0]).not.toHaveProperty('replyTo')
    await call(signed({ edition: 'forum', body: baseBody({ class: 'security' }), idem: 'idem-test-0002' }))
    expect(env.EMAIL_FORUM.sent[0].replyTo).toBe('support@eno.forum')
  })
})

// ── 2. Authentication ─────────────────────────────────────────────────────────────────────────

describe('eno-mailer — authentication', () => {
  const unauthorized = { ok: false, code: 'unauthorized' }
  const now = () => Math.floor(Date.now() / 1000)

  it.each([
    ['a wrong signature', () => signed({ signature: `v1=${'0'.repeat(64)}` })],
    ['no signature', () => signed({ signature: '' })],
    ['a v2 signature', () => signed({ signature: `v2=${'a'.repeat(64)}` })],
    ['an unknown edition', () => signed({ edition: 'www', key: KEY_VN })],
    ['a timestamp 301 s old', () => signed({ ts: now() - 301 })],
    ['a timestamp 301 s ahead', () => signed({ ts: now() + 301 })],
    ['a non-numeric timestamp', () => signed({ headers: { 'x-eno-timestamp': '1e9' } })],
  ])('refuses %s with the same 401 and sends nothing', async (_label, make) => {
    const { res, body } = await call(make())
    expect(res.status).toBe(401)
    expect(body).toEqual(unauthorized)
    expect(allSent()).toEqual([])
  })

  it('accepts a timestamp inside the 300 s window', async () => {
    const { res } = await call(signed({ ts: now() - 290 }))
    expect(res.status).toBe(200)
  })

  it('refuses a body changed after signing', async () => {
    const good = JSON.stringify(baseBody())
    const ts = now()
    const sig = signMailerRequest({ key: KEY_VN, ts, edition: 'vn', idempotencyKey: 'idem-test-0001', body: good })
    const tampered = good.replace('alice.example@gmail.com', 'victim.person@gmail.com')
    const { res } = await call(signed({ rawBody: tampered, ts, signature: sig }))
    expect(res.status).toBe(401)
    expect(allSent()).toEqual([])
  })

  it('refuses a signature bound to another idempotency key', async () => {
    const body = JSON.stringify(baseBody())
    const ts = now()
    const sig = signMailerRequest({ key: KEY_VN, ts, edition: 'vn', idempotencyKey: 'idem-other-0001', body })
    const { res } = await call(signed({ rawBody: body, ts, signature: sig, idem: 'idem-test-0001' }))
    expect(res.status).toBe(401)
  })

  it('⛔ an edition with no key answers the SAME 401 — an outsider cannot tell it is unconfigured', async () => {
    delete env.MAILER_KEY_VN
    const { res, body } = await call(signed())
    expect(res.status).toBe(401)
    expect(body).toEqual(unauthorized)
    expect(allSent()).toEqual([])
    // Only the operator's log says why.
    const line = JSON.parse(logs.find((l) => l.includes('"evt":"mail"'))!)
    expect(line).toMatchObject({ edition: 'vn', status: 401, code: 'unauthorized', reason: 'no_key' })
  })

  it('an unauthenticated probe gets byte-identical answers from a configured and an unconfigured edition', async () => {
    const probe = () => signed({ signature: `v1=${'0'.repeat(64)}`, idem: 'idem-probe-0001' })
    const configured = await call(probe())
    delete env.MAILER_KEY_VN
    const unconfigured = await call(probe())
    expect(unconfigured.res.status).toBe(configured.res.status)
    expect(unconfigured.body).toEqual(configured.body)
  })

  it('an _OLD key on its own verifies nothing — not even a request it signed', async () => {
    const OLD = 'old-vn-key-0123456789abcdef0123456789ab'
    delete env.MAILER_KEY_VN
    env.MAILER_KEY_VN_OLD = OLD
    const { res, body } = await call(signed({ key: OLD }))
    expect(res.status).toBe(401)
    expect(body).toEqual(unauthorized)
    expect(allSent()).toEqual([])
    expect(JSON.parse(logs.find((l) => l.includes('"evt":"mail"'))!).reason).toBe('no_key')
  })

  it('checks configuration only AFTER authentication: a missing binding is 401 to a stranger, 500 config to the signer', async () => {
    delete (env as Record<string, unknown>).EMAIL_VN
    const stranger = await call(signed({ signature: `v1=${'0'.repeat(64)}` }))
    expect(stranger.res.status).toBe(401)
    expect(stranger.body).toEqual(unauthorized)
    const signer = await call(signed({ idem: 'idem-test-0002' }))
    expect(signer.res.status).toBe(500)
    expect(signer.body).toEqual({ ok: false, code: 'config' })
  })

  it('accepts the rotating-out _OLD key while it is set, and only then', async () => {
    const OLD = 'old-vn-key-0123456789abcdef0123456789ab'
    const first = await call(signed({ key: OLD }))
    expect(first.res.status).toBe(401)
    env.MAILER_KEY_VN_OLD = OLD
    const second = await call(signed({ key: OLD, idem: 'idem-test-0009' }))
    expect(second.res.status).toBe(200)
    expect(env.EMAIL_VN.sent).toHaveLength(1)
  })

  it('answers 404 off the one route and 405 for anything but POST', async () => {
    expect((await call(signed({ url: 'https://eno-mailer.example.workers.dev/' }))).res.status).toBe(404)
    expect((await call(signed({ method: 'GET' }))).res.status).toBe(405)
  })
})

// ── 3. What a message may contain ─────────────────────────────────────────────────────────────

describe('eno-mailer — message shape', () => {
  it.each([
    ['an array of recipients', { to: ['a@b.com', 'c@d.com'] }, 'to'],
    ['two comma-separated recipients', { to: 'alice@gmail.com, bob@gmail.com' }, 'to'],
    ['a display-name recipient', { to: 'Alice <alice@gmail.com>' }, 'to'],
    ['a CRLF-injected recipient', { to: 'alice@gmail.com\r\nBcc: x@evil.test' }, 'to'],
    ['a CRLF-injected subject', { subject: 'hi\r\nBcc: x@evil.test' }, 'subject'],
    ['an empty html part', { html: '' }, 'html'],
    ['a Bcc header', { headers: { Bcc: 'x@evil.test' } }, 'headers'],
    ['a From header', { headers: { From: 'ceo@eno.vn' } }, 'headers'],
    ['a header value with CRLF', { headers: { 'X-Eno-Case': 'a\r\nBcc: x@evil.test' } }, 'headers'],
    ['two attachments', { attachments: [
      { filename: 'a.pdf', type: 'application/pdf', content: 'QUJD' },
      { filename: 'b.pdf', type: 'application/pdf', content: 'QUJD' },
    ] }, 'attachments'],
    ['an executable attachment', { attachments: [{ filename: 'a.exe', type: 'application/x-msdownload', content: 'QUJD' }] }, 'attachments'],
    ['a path in the filename', { attachments: [{ filename: '../etc/passwd.pdf', type: 'application/pdf', content: 'QUJD' }] }, 'attachments'],
    ['non-base64 content', { attachments: [{ filename: 'a.pdf', type: 'application/pdf', content: 'not base64!' }] }, 'attachments'],
    ['no class', { class: undefined }, 'class'],
    ['an unknown class', { class: 'bulk' }, 'class'],
  ])('refuses %s (400 invalid)', async (_label, over, field) => {
    const { res, body } = await call(signed({ body: baseBody(over) }))
    expect(res.status).toBe(400)
    expect(body).toEqual({ ok: false, code: 'invalid', field })
    expect(allSent()).toEqual([])
  })

  it('passes the allowlisted headers and one PDF through', async () => {
    const { res } = await call(signed({
      body: baseBody({
        headers: { 'List-Unsubscribe': '<https://eno.vn/u>', 'Auto-Submitted': 'auto-generated', 'X-Eno-Case': 'EV-1042' },
        attachments: [{ filename: 'EV-1042-evisa.pdf', type: 'application/pdf', content: Buffer.from('%PDF').toString('base64') }],
      }),
    }))
    expect(res.status).toBe(200)
    expect(env.EMAIL_VN.sent[0]).toMatchObject({
      headers: { 'List-Unsubscribe': '<https://eno.vn/u>', 'Auto-Submitted': 'auto-generated', 'X-Eno-Case': 'EV-1042' },
      attachments: [{ filename: 'EV-1042-evisa.pdf', type: 'application/pdf', content: 'JVBERg==', disposition: 'attachment' }],
    })
  })

  it('⛔ refuses marketing mail with 403 marketing_refused', async () => {
    const { res, body } = await call(signed({ body: baseBody({ class: 'marketing' }) }))
    expect(res.status).toBe(403)
    expect(body).toEqual({ ok: false, code: 'marketing_refused' })
    expect(allSent()).toEqual([])
  })

  it('refuses a body over 4.9 MiB by its Content-Length, before reading it', async () => {
    const req = signed({ headers: { 'content-length': String(5138023) } })
    const { res, body } = await call(req)
    expect(res.status).toBe(413)
    expect(body).toEqual({ ok: false, code: 'too_large' })
  })

  it('refuses a STREAMED body over 4.9 MiB that declares no length', async () => {
    const chunk = new Uint8Array(1024 * 1024)
    let sentChunks = 0
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sentChunks++ < 6) controller.enqueue(chunk)
        else controller.close()
      },
    })
    const ts = Math.floor(Date.now() / 1000)
    const req = new Request(URL_SEND, {
      method: 'POST',
      headers: { 'x-eno-edition': 'vn', 'x-eno-timestamp': String(ts), 'idempotency-key': 'idem-test-0001', 'x-eno-signature': `v1=${'0'.repeat(64)}` },
      body: stream,
      // @ts-expect-error — Node's fetch needs duplex for a streamed request body
      duplex: 'half',
    })
    const { res } = await call(req)
    expect(res.status).toBe(413)
    expect(sentChunks).toBeLessThanOrEqual(6) // it stopped reading at the cap
  })

  it('refuses a malformed idempotency key', async () => {
    const { res, body } = await call(signed({ idem: 'short' }))
    expect(res.status).toBe(400)
    expect(body).toMatchObject({ code: 'invalid', field: 'idempotency_key' })
  })
})

// ── Binding errors ───────────────────────────────────────────────────────────────────────────

describe('eno-mailer — binding error mapping', () => {
  it.each([
    ['E_RECIPIENT_SUPPRESSED', 422, 'suppressed'],
    ['E_CONTENT_TOO_LARGE', 413, 'too_large'],
    ['E_VALIDATION_ERROR', 400, 'invalid'],
    ['E_FIELD_MISSING', 400, 'invalid'],
    ['E_TOO_MANY_RECIPIENTS', 400, 'invalid'],
    ['E_HEADER_NOT_ALLOWED', 400, 'invalid'],
    ['E_HEADERS_TOO_LARGE', 400, 'invalid'],
    ['E_RATE_LIMIT_EXCEEDED', 429, 'rate_limited'],
    ['E_DAILY_LIMIT_EXCEEDED', 429, 'daily_limit'],
    ['E_SENDER_NOT_VERIFIED', 500, 'config'],
    ['E_SENDER_DOMAIN_NOT_AVAILABLE', 500, 'config'],
    ['E_RECIPIENT_NOT_ALLOWED', 500, 'config'],
    ['E_INTERNAL_SERVER_ERROR', 503, 'unavailable'],
    ['E_DELIVERY_FAILED', 503, 'unavailable'],
    ['E_SOMETHING_NEW', 503, 'unavailable'],
  ])('%s → %i %s, and nothing is recorded as sent', async (code, status, ours) => {
    env.EMAIL_VN.throwCode = code
    const { res, body } = await call(signed())
    expect(res.status).toBe(status)
    expect(body).toEqual({ ok: false, code: ours })
    expect([...store.keys()].filter((k) => k.startsWith('idem:') || k.startsWith('cnt:'))).toEqual([])
  })
})

// ── Idempotency ─────────────────────────────────────────────────────────────────────────────

describe('eno-mailer — idempotency (best effort, fails open)', () => {
  it('a repeat of the same key answers the first messageId without sending again', async () => {
    const first = await call(signed())
    const second = await call(signed())
    expect(first.body).toEqual({ ok: true, messageId: 'vn-msg-1' })
    expect(second.body).toEqual({ ok: true, messageId: 'vn-msg-1', deduped: true })
    expect(env.EMAIL_VN.sent).toHaveLength(1)
    expect(env.MAILER_KV.puts.find((p) => p.key === 'idem:vn:idem-test-0001')?.ttl).toBe(86400)
  })

  it('⛔ the same key with a DIFFERENT body is a 409 idempotency_conflict, never a deduped success', async () => {
    // The corrected-visa bug: a per-case key reused for a fixed PDF was answered with the FIRST
    // send's messageId, so the desk was told "emailed" and the applicant kept the wrong visa.
    const first = await call(signed({ body: baseBody({ attachments: [{ filename: 'EV-1042-evisa.pdf', type: 'application/pdf', content: 'V1JPTkc=' }] }) }))
    const second = await call(signed({ body: baseBody({ attachments: [{ filename: 'EV-1042-evisa.pdf', type: 'application/pdf', content: 'UklHSFQ=' }] }) }))
    expect(first.body).toEqual({ ok: true, messageId: 'vn-msg-1' })
    expect(second.res.status).toBe(409)
    expect(second.body).toEqual({ ok: false, code: 'idempotency_conflict' })
    expect(env.EMAIL_VN.sent).toHaveLength(1)
  })

  it('stores the messageId WITH the body hash, and nothing readable about the message', async () => {
    const raw = JSON.stringify(baseBody())
    await call(signed({ rawBody: raw }))
    const stored = JSON.parse(store.get('idem:vn:idem-test-0001')!)
    const { createHash } = await import('node:crypto')
    expect(stored).toEqual({ m: 'vn-msg-1', h: createHash('sha256').update(raw).digest('hex') })
    expect(store.get('idem:vn:idem-test-0001')).not.toContain('alice')
  })

  it('ignores an idempotency value it did not write (fails open, sends)', async () => {
    store.set('idem:vn:idem-test-0001', 'not-a-record')
    const { res, body } = await call(signed())
    expect(res.status).toBe(200)
    expect(body).toEqual({ ok: true, messageId: 'vn-msg-1' })
  })

  it('keys are per edition — the forum cannot collide with (or probe) eno.vn keys', async () => {
    await call(signed({ edition: 'vn' }))
    const forum = await call(signed({ edition: 'forum' }))
    expect(forum.body).toEqual({ ok: true, messageId: 'forum-msg-1' })
  })

  it('sends anyway when KV cannot be read or written', async () => {
    env.MAILER_KV = fakeKV(store, { failGet: true, failPut: true })
    const { res } = await call(signed({ body: baseBody({ class: 'signin' }) }))
    expect(res.status).toBe(200)
    expect(env.EMAIL_VN.sent).toHaveLength(1)
  })
})

// ── The daily budget ────────────────────────────────────────────────────────────────────────

describe('eno-mailer — daily budget protects sign-in', () => {
  const day = () => new Date().toISOString().slice(0, 10)
  const seed = (counts: Partial<Record<'signin' | 'security' | 'transactional', number>>) => {
    for (const [cls, n] of Object.entries(counts)) store.set(`cnt:${day()}:${cls}`, String(n))
  }
  beforeEach(() => {
    env.DAILY_QUOTA = '10'
    env.PRIORITY_RESERVE = '4'
    env.SECURITY_RESERVE = '1'
  })

  let n = 0
  const send = (cls: string, edition = 'vn') => call(signed({ edition, body: baseBody({ class: cls }), idem: `idem-budget-${++n}` }))

  it('refuses BACKGROUND mail once the day reaches quota − priority reserve, even with none of its own', async () => {
    seed({ signin: 6 })
    const bg = await send('transactional')
    expect(bg.res.status).toBe(429)
    expect(bg.body).toEqual({ ok: false, code: 'budget' })
    // …while sign-in and security still go.
    expect((await send('signin')).res.status).toBe(200)
    expect((await send('security')).res.status).toBe(200)
  })

  it('stops sign-in one security-reserve short of the quota, and lets security use the last of it', async () => {
    seed({ signin: 5, transactional: 4 }) // total 9 = quota − security reserve
    expect((await send('signin')).body).toEqual({ ok: false, code: 'budget' })
    expect((await send('security')).res.status).toBe(200) // total now 10
    expect((await send('security')).body).toEqual({ ok: false, code: 'budget' })
  })

  it('counts both editions against ONE account budget, per class', async () => {
    await send('transactional', 'vn')
    await send('transactional', 'forum')
    await send('signin', 'forum')
    expect(store.get(`cnt:${day()}:transactional`)).toBe('2')
    expect(store.get(`cnt:${day()}:signin`)).toBe('1')
    const put = env.MAILER_KV.puts.find((p) => p.key.startsWith('cnt:'))
    expect(put?.ttl).toBe(172800)
  })

  it('does not count a send the provider refused', async () => {
    env.EMAIL_VN.throwCode = 'E_RECIPIENT_SUPPRESSED'
    await send('signin')
    expect(store.get(`cnt:${day()}:signin`)).toBeUndefined()
  })

  it('⛔ an unreadable counter fails OPEN for EVERY class — a visa result is not lost to a KV incident', async () => {
    env.MAILER_KV = fakeKV(store, { failGet: true })
    for (const cls of ['transactional', 'signin', 'security']) {
      const r = await send(cls)
      expect(r.res.status).toBe(200)
    }
    expect(env.EMAIL_VN.sent).toHaveLength(3)
  })

  it('logs a distinct budget_unknown line for every send made without a readable budget', async () => {
    env.MAILER_KV = fakeKV(store, { failGet: true })
    await send('transactional')
    const lines = logs.map((l) => { try { return JSON.parse(l) } catch { return null } })
    expect(lines.some((j) => j?.evt === 'budget_unknown' && j.action === 'sending' && j.class === 'transactional')).toBe(true)
    expect(lines.find((j) => j?.evt === 'mail')?.budget).toMatchObject({ unknown: true })
  })

  it('logs the day\'s counters on every send, and a threshold line when crossing 50 %', async () => {
    seed({ signin: 4 })
    await send('signin')
    const line = logs.map((l) => { try { return JSON.parse(l) } catch { return null } }).find((j) => j?.evt === 'mail' && j.code === 'sent')
    expect(line.budget).toMatchObject({ signin: 5, security: 0, transactional: 0, total: 5, quota: 10 })
    expect(logs.some((l) => l.includes('"evt":"budget_threshold"') && l.includes('"threshold":50'))).toBe(true)
  })
})

// ── Logs ────────────────────────────────────────────────────────────────────────────────────

describe('eno-mailer — logs', () => {
  it('mask the recipient and never carry the subject, body, signature or key', async () => {
    const req = signed({ body: baseBody({ class: 'signin' }) })
    const sig = req.headers.get('x-eno-signature')!
    await call(req)
    const all = logs.join('\n')
    expect(all).toContain('a…e@gmail.com')
    expect(all).not.toContain('alice.example@gmail.com')
    expect(all).not.toContain('SECRET-MAGIC-LINK')
    expect(all).not.toContain('Your sign-in link')
    expect(all).not.toContain(sig.slice(3))
    expect(all).not.toContain(KEY_VN)
    const line = JSON.parse(logs.find((l) => l.includes('"evt":"mail"'))!)
    expect(line).toMatchObject({ evt: 'mail', edition: 'vn', class: 'signin', tag: 'test', status: 200, code: 'sent', messageId: 'vn-msg-1' })
  })
})

// ── The operator's smoke test speaks the same contract ───────────────────────────────────────

describe('scripts/mailer-smoke.mjs against the real Worker', () => {
  it('a normal smoke request is accepted and sent as that edition', async () => {
    const req = buildSmokeRequest({ url: URL_SEND, key: KEY_FORUM, edition: 'forum', to: 'seed.box@gmail.com', attachBytes: 1024 })
    const { res } = await call(req)
    expect(res.status).toBe(200)
    expect(env.EMAIL_FORUM.sent[0]).toMatchObject({ to: 'seed.box@gmail.com', from: { email: 'no-reply@eno.forum' } })
  })

  it('--bad-signature and --stale are refused 401', async () => {
    for (const flags of [{ badSignature: true }, { stale: true }]) {
      const { res } = await call(buildSmokeRequest({ url: URL_SEND, key: KEY_VN, edition: 'vn', to: 'seed.box@gmail.com', ...flags }))
      expect(res.status).toBe(401)
    }
    expect(allSent()).toEqual([])
  })

  it('a 3.5 MiB file — the most the app attaches — fits under the 4.9 MiB request cap', async () => {
    const req = buildSmokeRequest({ url: URL_SEND, key: KEY_VN, edition: 'vn', to: 'seed.box@gmail.com', attachBytes: Math.floor(3.5 * 1024 * 1024) })
    const { res } = await call(req)
    expect(res.status).toBe(200)
  })

  it('--key-stdin signs with the key piped in (the laptop path: key over ssh, never in argv or history)', async () => {
    const out: string[] = []
    const viaWorker = async (req: Request) => worker.fetch(req, env, ctx) as Promise<Response>
    // A MAILER_KEY in the env is ignored when --key-stdin is given: stdin wins.
    const code = await smokeMain(
      ['--edition', 'vn', '--to', 'seed.box@gmail.com', '--key-stdin'],
      { MAILER_URL: URL_SEND, MAILER_KEY: 'wrong-key-0123456789abcdef0123456789' },
      (l: string) => out.push(l),
      viaWorker as never,
      async () => `${KEY_VN}\n`,
    )
    expect(code).toBe(0)
    expect(env.EMAIL_VN.sent).toHaveLength(1)
    expect(out.join('\n')).not.toContain(KEY_VN)
  })

  it('--key-stdin with nothing on stdin refuses before sending', async () => {
    const code = await smokeMain(['--edition', 'vn', '--to', 'seed.box@gmail.com', '--key-stdin'], { MAILER_URL: URL_SEND }, () => {}, (async () => { throw new Error('must not fetch') }) as never, async () => '  \n')
    expect(code).toBe(2)
  })
})

// ── KV unreadable: fail open, braked per isolate ─────────────────────────────────────────────

describe('eno-mailer — budget unknown (KV unreadable): every class sends, background mail braked per isolate', () => {
  // The in-memory tally lives at MODULE scope, i.e. per isolate: a fresh import is a fresh isolate.
  async function freshIsolate() {
    vi.resetModules()
    return (await import('../../infra/cloudflare/eno-mailer.js')).default as typeof worker
  }
  let n = 0
  async function sendVia(w: typeof worker, cls: string) {
    const res = await w.fetch(signed({ body: baseBody({ class: cls }), idem: `idem-blind-${++n}` }), env, ctx) as Response
    await Promise.all(waits)
    return { res, body: await res.json() as Record<string, unknown> }
  }
  const jsonLogs = () => logs.map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)

  beforeEach(() => {
    env.MAILER_KV = fakeKV(store, { failGet: true })
  })
  afterEach(() => { vi.useRealTimers() })

  it('stops BACKGROUND mail at its share of the isolate cap, and says so every time', async () => {
    env.DAILY_QUOTA = '10'
    env.PRIORITY_RESERVE = '4'
    env.SECURITY_RESERVE = '1'
    const w = await freshIsolate()
    // quota 10 → isolate cap 10, of which background may use 6.
    for (let i = 0; i < 6; i++) expect((await sendVia(w, 'transactional')).res.status).toBe(200)
    const bg = await sendVia(w, 'transactional')
    expect(bg.res.status).toBe(429)
    expect(bg.body).toEqual({ ok: false, code: 'budget_unknown' })
    expect(env.EMAIL_VN.sent).toHaveLength(6)
    // ⛔ Never a silent drop: the refusal is an error-level budget_unknown line.
    expect(jsonLogs().filter((j) => j.evt === 'budget_unknown' && j.action === 'refused')).toHaveLength(1)
    expect(jsonLogs().filter((j) => j.evt === 'mail' && j.code === 'budget_unknown')).toHaveLength(1)
  })

  it('⛔ sign-in and security are EXEMPT: never refused on an unreadable counter, even past the whole isolate cap (owner, 2026-09-23)', async () => {
    env.DAILY_QUOTA = '10'
    env.PRIORITY_RESERVE = '4'
    env.SECURITY_RESERVE = '1'
    const w = await freshIsolate()
    for (let i = 0; i < 6; i++) await sendVia(w, 'transactional')
    // The tally is now at background's cap; sign-in and security go on past 9, 10 and beyond.
    for (let i = 0; i < 8; i++) expect((await sendVia(w, 'signin')).res.status).toBe(200)
    for (let i = 0; i < 4; i++) expect((await sendVia(w, 'security')).res.status).toBe(200)
    expect(env.EMAIL_VN.sent).toHaveLength(18)
    const lines = jsonLogs().filter((j) => j.evt === 'budget_unknown')
    expect(lines.filter((j) => j.action === 'refused')).toHaveLength(0)
    // Still logged, every one, and marked exempt, so a KV incident is visible in the Worker's logs.
    expect(lines.filter((j) => j.exempt === true && j.action === 'sending')).toHaveLength(12)
    expect(lines.filter((j) => j.class === 'transactional').every((j) => j.exempt === undefined)).toBe(true)
  })

  it('exempt sends still count in the tally, so background mail stops SOONER, never later', async () => {
    env.DAILY_QUOTA = '10'
    env.PRIORITY_RESERVE = '4'
    env.SECURITY_RESERVE = '1'
    const w = await freshIsolate()
    for (let i = 0; i < 5; i++) await sendVia(w, 'signin')
    expect((await sendVia(w, 'transactional')).res.status).toBe(200) // tally 6
    expect((await sendVia(w, 'transactional')).body).toEqual({ ok: false, code: 'budget_unknown' })
  })

  it('Cloudflare\'s own quota still applies to an exempt class', async () => {
    const w = await freshIsolate()
    env.EMAIL_VN.throwCode = 'E_DAILY_LIMIT_EXCEEDED'
    const r = await sendVia(w, 'signin')
    expect(r.res.status).toBe(429)
    expect(r.body).toEqual({ ok: false, code: 'daily_limit' })
  })

  it('the brake is small: at the real quota an isolate sends 60 background messages, not 600', async () => {
    const w = await freshIsolate()
    for (let i = 0; i < 60; i++) expect((await sendVia(w, 'transactional')).res.status).toBe(200)
    expect((await sendVia(w, 'transactional')).body).toEqual({ ok: false, code: 'budget_unknown' })
    // …while sign-in still goes.
    expect((await sendVia(w, 'signin')).res.status).toBe(200)
  })

  it('a send the provider refuses gives its place back', async () => {
    env.DAILY_QUOTA = '10'
    env.PRIORITY_RESERVE = '4'
    env.SECURITY_RESERVE = '1'
    const w = await freshIsolate()
    env.EMAIL_VN.throwCode = 'E_RATE_LIMIT_EXCEEDED'
    expect((await sendVia(w, 'transactional')).res.status).toBe(429)
    env.EMAIL_VN.throwCode = null
    for (let i = 0; i < 6; i++) expect((await sendVia(w, 'transactional')).res.status).toBe(200)
    expect((await sendVia(w, 'transactional')).body).toEqual({ ok: false, code: 'budget_unknown' })
  })

  it('the tally is per UTC day', async () => {
    env.DAILY_QUOTA = '10'
    env.PRIORITY_RESERVE = '4'
    env.SECURITY_RESERVE = '1'
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-24T23:00:00Z'))
    const w = await freshIsolate()
    for (let i = 0; i < 6; i++) await sendVia(w, 'transactional')
    expect((await sendVia(w, 'transactional')).body).toEqual({ ok: false, code: 'budget_unknown' })
    vi.setSystemTime(new Date('2026-09-25T00:01:00Z'))
    expect((await sendVia(w, 'transactional')).res.status).toBe(200)
  })

  it('a refund never crosses UTC midnight into the next day\'s tally', async () => {
    env.DAILY_QUOTA = '10'
    env.PRIORITY_RESERVE = '4'
    env.SECURITY_RESERVE = '1'
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-24T23:59:59Z'))
    const w = await freshIsolate()
    // The day-D send is in flight across midnight; meanwhile a day-D+1 send resets the tally and
    // takes one place. Then the day-D send is refused by the provider.
    let crossed = false
    env.EMAIL_VN.send = async (m: Sent) => {
      if (!crossed) {
        crossed = true
        vi.setSystemTime(new Date('2026-09-25T00:00:01Z'))
        await sendVia(w, 'transactional')
        throw Object.assign(new Error('binding refused'), { code: 'E_RATE_LIMIT_EXCEEDED' })
      }
      env.EMAIL_VN.sent.push(m)
      return { messageId: `vn-msg-${env.EMAIL_VN.sent.length}` }
    }
    expect((await sendVia(w, 'transactional')).res.status).toBe(429)
    // Day D+1 has used 1 of background's 6 places, so exactly 5 more go, then the brake.
    let ok = 0
    for (let i = 0; i < 8; i++) if ((await sendVia(w, 'transactional')).res.status === 200) ok++
    expect(ok).toBe(5)
  })

  it('an unbound MAILER_KV is treated the same way: sends, and says so', async () => {
    delete (env as Record<string, unknown>).MAILER_KV
    const w = await freshIsolate()
    expect((await sendVia(w, 'transactional')).res.status).toBe(200)
    expect(jsonLogs().some((j) => j.evt === 'budget_unknown')).toBe(true)
  })
})
