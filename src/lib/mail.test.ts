import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * src/lib/mail.ts — the app's one way to send mail: the eno-mailer Worker first, and on eno.vn ONLY
 * the Resend fallback when the Worker did not accept the message. Pinned here:
 *   · the contract: what this file signs, the REAL Worker verifies and sends — as this build's
 *     edition (vitest pins `services`, so eno.forum);
 *   · never throws, and says WHY it failed as a code;
 *   · exactly one retry, only on the retryable codes, with the SAME idempotency key;
 *   · refusals that never touch the network: unset env, a non-https URL, marketing, oversize;
 *   · the fallback: marketplace build only, only with RESEND_API_KEY + MAIL_FROM, only on the codes
 *     that mean "not accepted", same idempotency key, inside the deadline, and logged every time.
 */

import worker from '../../infra/cloudflare/eno-mailer.js'
import {
  MAILER_MAX_REQUEST_BYTES,
  mailEnabled,
  mailerEdition,
  maskEmail,
  sendMail,
  sendMailDetailed,
  signMailerRequest,
} from './mail'

const KEY_FORUM = 'forum-key-0123456789abcdef0123456789abcd'
const URL_SEND = 'https://eno-mailer.example.workers.dev/v1/send'

const msg = (over: Record<string, unknown> = {}) => ({
  to: 'alice.example@gmail.com',
  subject: 'Your sign-in link for eno.forum',
  html: '<p>link</p>',
  text: 'link',
  ...over,
})

type Seen = { url: string; headers: Record<string, string>; body: string; redirect?: string; cache?: string; signal?: AbortSignal | null }
let seen: Seen[]
let replies: Array<(req: Request, init: RequestInit) => Promise<Response> | Response>
let errors: string[]
let infos: string[]
const RESEND_URL = 'https://api.resend.com/emails'
const logLine = (a: unknown[]) => a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')

function workerEnv() {
  const sent: Record<string, unknown>[] = []
  const binding = { async send(m: Record<string, unknown>) { sent.push(m); return { messageId: `msg-${sent.length}` } } }
  const store = new Map<string, string>()
  const kv = { async get(k: string) { return store.get(k) ?? null }, async put(k: string, v: string) { store.set(k, v) } }
  return { sent, env: { EMAIL_FORUM: binding, EMAIL_VN: binding, MAILER_KV: kv, MAILER_KEY_FORUM: KEY_FORUM, MAILER_KEY_VN: 'x'.repeat(40) } }
}

beforeEach(() => {
  seen = []
  replies = []
  errors = []
  infos = []
  vi.stubEnv('MAILER_URL', URL_SEND)
  vi.stubEnv('MAILER_KEY', KEY_FORUM)
  // Hermetic: a shell that exports the repo .env must not hand these tests a live Resend key.
  vi.stubEnv('RESEND_API_KEY', '')
  vi.stubEnv('MAIL_FROM', '')
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    // Headers arrive as a plain record from mail.ts and as a Headers object from the Resend SDK.
    const headers = Object.fromEntries(new Headers(init.headers as HeadersInit).entries())
    const entry = { url: String(url), headers, body: String(init.body), redirect: init.redirect, cache: init.cache, signal: init.signal }
    seen.push(entry)
    const next = replies.shift()
    if (!next) throw new Error('unexpected fetch')
    return next(new Request(url, { method: 'POST', headers, body: entry.body }), init)
  })
  vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => { errors.push(logLine(a)) })
  vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => { errors.push(logLine(a)) })
  vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => { infos.push(logLine(a)) })
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

const json = (status: number, body: unknown) => () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('mail.ts ↔ eno-mailer Worker — the contract', () => {
  it('what mail.ts signs, the real Worker verifies and sends as THIS edition', async () => {
    const w = workerEnv()
    replies.push((req) => worker.fetch(req, w.env, { waitUntil: () => {} }) as Promise<Response>)
    const res = await sendMailDetailed(msg({ class: 'signin', tag: 'signin-link' }))
    expect(res).toEqual({ ok: true, messageId: 'msg-1', transport: 'worker' })
    expect(mailerEdition()).toBe('forum') // vitest pins the services edition
    expect(w.sent[0]).toMatchObject({ to: 'alice.example@gmail.com', from: { email: 'no-reply@eno.forum' } })
    expect(w.sent[0]).not.toHaveProperty('replyTo') // signin
    const h = seen[0].headers
    expect(h['x-eno-edition']).toBe('forum')
    expect(h['idempotency-key']).toMatch(/^m-[0-9a-f-]{36}$/)
    expect(JSON.parse(seen[0].body)).toMatchObject({ class: 'signin', tag: 'signin-link' })
  })

  it('the signature covers the exact bytes sent', () => {
    const body = JSON.stringify({ a: 1 })
    const a = signMailerRequest({ key: 'k', ts: 1, edition: 'vn', idempotencyKey: 'idem-00000001', body })
    expect(a).toMatch(/^v1=[0-9a-f]{64}$/)
    expect(signMailerRequest({ key: 'k', ts: 1, edition: 'vn', idempotencyKey: 'idem-00000001', body: body + ' ' })).not.toBe(a)
    expect(signMailerRequest({ key: 'k', ts: 2, edition: 'vn', idempotencyKey: 'idem-00000001', body })).not.toBe(a)
    expect(signMailerRequest({ key: 'k', ts: 1, edition: 'forum', idempotencyKey: 'idem-00000001', body })).not.toBe(a)
  })

  it('defaults the class to transactional and derives the attachment type', async () => {
    replies.push(json(200, { ok: true, messageId: 'm1' }))
    await sendMail(msg({ attachments: [{ filename: 'EV-1042-evisa.pdf', content: 'JVBERg==' }] }))
    const body = JSON.parse(seen[0].body)
    expect(body.class).toBe('transactional')
    expect(body.attachments).toEqual([{ filename: 'EV-1042-evisa.pdf', content: 'JVBERg==', type: 'application/pdf' }])
  })

  it('passes a caller-chosen idempotency key through unchanged', async () => {
    replies.push(json(200, { ok: true, messageId: 'm1' }))
    await sendMail(msg({ idempotencyKey: 'visa-result:abc-123' }))
    expect(seen[0].headers['idempotency-key']).toBe('visa-result:abc-123')
  })

  it('⛔ never follows a redirect — the signed body carries a live sign-in credential', async () => {
    replies.push(json(200, { ok: true, messageId: 'm1' }))
    await sendMail(msg())
    expect(seen[0].redirect).toBe('error')
    expect(seen[0].cache).toBe('no-store')
    expect(seen[0].signal).toBeInstanceOf(AbortSignal)
  })

  it('a key reused for a DIFFERENT message comes back from the real Worker as idempotency_conflict — a failure, not retried', async () => {
    const w = workerEnv()
    replies.push(
      (req) => worker.fetch(req, w.env, { waitUntil: () => {} }) as Promise<Response>,
      (req) => worker.fetch(req, w.env, { waitUntil: () => {} }) as Promise<Response>,
    )
    expect(await sendMailDetailed(msg({ idempotencyKey: 'visa-result:case-1', html: '<p>first</p>' }))).toEqual({ ok: true, messageId: 'msg-1', transport: 'worker' })
    expect(await sendMailDetailed(msg({ idempotencyKey: 'visa-result:case-1', html: '<p>corrected</p>' }))).toEqual({ ok: false, code: 'idempotency_conflict', status: 409 })
    expect(w.sent).toHaveLength(1)
    expect(seen).toHaveLength(2)
  })
})

describe('mail.ts — timeouts, and the one attempt a file gets', () => {
  let timeouts: number[]
  beforeEach(() => {
    timeouts = []
    const real = AbortSignal.timeout.bind(AbortSignal)
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms: number) => { timeouts.push(ms); return real(ms) })
  })
  const withFile = (over: Record<string, unknown> = {}) => msg({ attachments: [{ filename: 'EV-1042-evisa.pdf', content: 'JVBERg==' }], ...over })

  it('waits 6 s for a plain message and 20 s for one with a file', async () => {
    replies.push(json(200, { ok: true, messageId: 'm1' }), json(200, { ok: true, messageId: 'm2' }))
    await sendMail(msg())
    await sendMail(withFile())
    expect(timeouts).toEqual([6000, 20000])
  })

  it('⛔ a message with a FILE gets exactly one attempt, even on a retryable failure', async () => {
    for (const first of [json(503, { ok: false, code: 'unavailable' }), () => { throw new DOMException('timed out', 'TimeoutError') }]) {
      seen = []
      replies = [first, json(200, { ok: true, messageId: 'never' })]
      const res = await sendMailDetailed(withFile())
      expect(res.ok).toBe(false)
      expect(seen).toHaveLength(1)
    }
  })

  it('cuts each attempt to what is left before the deadline', async () => {
    replies.push(json(200, { ok: true, messageId: 'm1' }))
    await sendMail(withFile({ deadline: Date.now() + 3000 }))
    expect(timeouts).toHaveLength(1)
    expect(timeouts[0]).toBeLessThanOrEqual(3000)
    expect(timeouts[0]).toBeGreaterThan(2000)
    expect(Number.isInteger(timeouts[0])).toBe(true)
  })

  it('does not start an attempt it cannot finish: past (or nearly at) the deadline it answers timeout, unsent', async () => {
    expect(await sendMailDetailed(msg({ deadline: Date.now() + 500 }))).toEqual({ ok: false, code: 'timeout' })
    expect(await sendMailDetailed(withFile({ deadline: Date.now() - 1 }))).toEqual({ ok: false, code: 'timeout' })
    expect(seen).toEqual([])
  })

  it('skips the retry of a plain message when the deadline leaves no room for it', async () => {
    replies.push(json(503, { ok: false, code: 'unavailable' }), json(200, { ok: true, messageId: 'late' }))
    const res = await sendMailDetailed(msg({ deadline: Date.now() + 1200 }))
    expect(res).toEqual({ ok: false, code: 'unavailable', status: 503 })
    expect(seen).toHaveLength(1)
  })

  it('the deadline never reaches the Worker', async () => {
    replies.push(json(200, { ok: true, messageId: 'm1' }))
    await sendMail(msg({ deadline: Date.now() + 10_000 }))
    expect(JSON.parse(seen[0].body)).not.toHaveProperty('deadline')
  })
})

describe('mail.ts — one retry, only when it can help', () => {
  it.each([
    ['503 unavailable', json(503, { ok: false, code: 'unavailable' })],
    ['429 rate_limited', json(429, { ok: false, code: 'rate_limited' })],
    ['an HTML 502 from the edge', () => new Response('<html>bad gateway</html>', { status: 502 })],
    ['a 200 that is not the Worker (an interstitial page)', () => new Response('<html>please wait</html>', { status: 200 })],
    ['a network error', () => { throw new TypeError('fetch failed') }],
    ['a timeout', () => { throw new DOMException('The operation was aborted due to timeout', 'TimeoutError') }],
  ])('retries once after %s, with the SAME idempotency key', async (_label, first) => {
    replies.push(first, json(200, { ok: true, messageId: 'm2' }))
    const res = await sendMailDetailed(msg())
    expect(res).toEqual({ ok: true, messageId: 'm2', transport: 'worker' })
    expect(seen).toHaveLength(2)
    expect(seen[1].headers['idempotency-key']).toBe(seen[0].headers['idempotency-key'])
    expect(seen[1].body).toBe(seen[0].body)
  })

  it('gives up after the second failure and reports the code', async () => {
    replies.push(json(503, { ok: false, code: 'unavailable' }), json(503, { ok: false, code: 'unavailable' }))
    expect(await sendMailDetailed(msg())).toEqual({ ok: false, code: 'unavailable', status: 503 })
    expect(seen).toHaveLength(2)
  })

  it.each([
    ['suppressed', 422],
    ['too_large', 413],
    ['invalid', 400],
    ['unauthorized', 401],
    ['daily_limit', 429],
    ['budget', 429],
    ['budget_unknown', 429],
    ['idempotency_conflict', 409],
    ['config', 500],
    ['marketing_refused', 403],
  ])('does NOT retry %s', async (code, status) => {
    replies.push(json(status, { ok: false, code }))
    expect(await sendMailDetailed(msg())).toEqual({ ok: false, code, status })
    expect(seen).toHaveLength(1)
  })

  it('maps an unknown code by status, and a timeout to `timeout`', async () => {
    replies.push(json(422, { ok: false, code: 'something_new' }))
    expect(await sendMailDetailed(msg())).toMatchObject({ ok: false, code: 'suppressed' })
    replies.push(json(404, { ok: false, code: 'not_found' }))
    expect(await sendMailDetailed(msg())).toMatchObject({ ok: false, code: 'config', status: 404 })
    replies.push(json(409, { ok: false, code: 'something_new' }))
    expect(await sendMailDetailed(msg())).toMatchObject({ ok: false, code: 'idempotency_conflict' })
    const t = () => { throw new DOMException('timed out', 'TimeoutError') }
    replies.push(t, t)
    expect(await sendMailDetailed(msg())).toEqual({ ok: false, code: 'timeout' })
  })

  it('sendMail is the boolean of sendMailDetailed and never throws', async () => {
    replies.push(() => { throw new Error('boom') }, () => { throw new Error('boom') })
    await expect(sendMail(msg())).resolves.toBe(false)
  })

  it('logs a failure with a MASKED address and the code, never the body', async () => {
    replies.push(json(422, { ok: false, code: 'suppressed' }))
    await sendMail(msg())
    const all = errors.join('\n')
    expect(all).toContain('a…e@gmail.com')
    expect(all).toContain('suppressed')
    expect(all).not.toContain('alice.example@gmail.com')
    expect(all).not.toContain('<p>link</p>')
  })
})

describe('mail.ts — refusals that never reach the network', () => {
  it('disabled when MAILER_URL or MAILER_KEY is unset', async () => {
    vi.stubEnv('MAILER_KEY', '')
    expect(mailEnabled()).toBe(false)
    expect(await sendMailDetailed(msg())).toEqual({ ok: false, code: 'disabled' })
    vi.stubEnv('MAILER_KEY', KEY_FORUM)
    vi.stubEnv('MAILER_URL', '')
    expect(await sendMail(msg())).toBe(false)
    expect(seen).toEqual([])
  })

  it('refuses a non-https Worker URL (the body carries a live sign-in credential)', async () => {
    vi.stubEnv('MAILER_URL', 'http://eno-mailer.example.workers.dev/v1/send')
    expect(mailEnabled()).toBe(false)
    expect(await sendMailDetailed(msg())).toEqual({ ok: false, code: 'config' })
    vi.stubEnv('MAILER_URL', 'not a url')
    expect(await sendMailDetailed(msg())).toEqual({ ok: false, code: 'config' })
    expect(seen).toEqual([])
  })

  it('allows plain http only on loopback, for a local `wrangler dev`', async () => {
    vi.stubEnv('MAILER_URL', 'http://127.0.0.1:8787/v1/send')
    replies.push(json(200, { ok: true, messageId: 'm' }))
    expect(await sendMail(msg())).toBe(true)
  })

  it('⛔ marketing is never enabled and never sent, whatever the env says', async () => {
    expect(mailEnabled()).toBe(true)
    expect(mailEnabled('marketing')).toBe(false)
    expect(await sendMailDetailed(msg({ class: 'marketing' }))).toEqual({ ok: false, code: 'marketing_refused' })
    expect(seen).toEqual([])
  })

  it('refuses a request over the Worker cap as too_large, before sending it', async () => {
    const big = 'A'.repeat(MAILER_MAX_REQUEST_BYTES)
    expect(await sendMailDetailed(msg({ attachments: [{ filename: 'x.pdf', content: big }] }))).toEqual({ ok: false, code: 'too_large' })
    expect(seen).toEqual([])
  })
})

describe('mail.ts — edition', () => {
  it('the marketplace build signs as vn', async () => {
    vi.stubEnv('NEXT_PUBLIC_ENO_EDITION', 'marketplace')
    vi.resetModules()
    const fresh = await import('./mail')
    expect(fresh.mailerEdition()).toBe('vn')
  })

  it('masks addresses the same way the Worker does', () => {
    expect(maskEmail('alice.example@gmail.com')).toBe('a…e@gmail.com')
    expect(maskEmail('a@x.vn')).toBe('*@x.vn')
    expect(maskEmail('nope')).toBe('***')
  })
})

describe('mail.ts — which transport delivered is logged', () => {
  it('a Worker delivery logs `[mail] sent` with transport worker, and no fallback line', async () => {
    replies.push(json(200, { ok: true, messageId: 'm1' }))
    await sendMail(msg({ class: 'signin', tag: 'signin-link' }))
    const sent = infos.find((l) => l.startsWith('[mail] sent'))
    expect(sent).toContain('"transport":"worker"')
    expect(sent).toContain('a…e@gmail.com')
    expect(sent).not.toContain('alice.example@gmail.com')
    expect(errors.join('\n')).not.toContain('mail_fallback')
  })
})

// ── The Resend fallback: eno.vn only ─────────────────────────────────────────────────────────────

describe('mail.ts — Resend fallback, marketplace (eno.vn) build', () => {
  const RESEND_KEY = 're_test_0123456789'
  const FROM = 'eno.vn <no-reply@eno.vn>'
  /** The marketplace build: IS_MARKETPLACE is read when the module loads, as it is inlined at build. */
  async function vnBuild() {
    vi.stubEnv('NEXT_PUBLIC_ENO_EDITION', 'marketplace')
    vi.resetModules()
    return import('./mail')
  }
  const resendOk = (id = 're_msg_1') => json(200, { id })
  const resendCalls = () => seen.filter((s) => s.url === RESEND_URL)
  const workerCalls = () => seen.filter((s) => s.url === URL_SEND)
  const fallbackLines = () => errors.filter((l) => l.includes('[mail] FALLBACK to Resend'))

  beforeEach(() => {
    vi.stubEnv('RESEND_API_KEY', RESEND_KEY)
    vi.stubEnv('MAIL_FROM', FROM)
  })

  it('the Worker down → the SAME message goes to Resend, with the SAME idempotency key, as MAIL_FROM', async () => {
    const vn = await vnBuild()
    replies.push(json(503, { ok: false, code: 'unavailable' }), json(503, { ok: false, code: 'unavailable' }), resendOk())
    const res = await vn.sendMailDetailed(msg({ tag: 'kyc-outcome', idempotencyKey: 'kyc:case-7:approved' }))
    expect(res).toEqual({ ok: true, messageId: 're_msg_1', transport: 'resend' })
    expect(workerCalls()).toHaveLength(2) // the Worker's own retry first
    const [r] = resendCalls()
    expect(r.headers['idempotency-key']).toBe('kyc:case-7:approved')
    expect(r.headers['idempotency-key']).toBe(workerCalls()[0].headers['idempotency-key'])
    expect(r.headers.authorization).toBe(`Bearer ${RESEND_KEY}`)
    expect(JSON.parse(r.body)).toMatchObject({
      from: FROM, to: 'alice.example@gmail.com', subject: 'Your sign-in link for eno.forum', html: '<p>link</p>', text: 'link', reply_to: 'support@eno.vn',
    })
    // The SDK spreads these into the fetch init; if a Resend upgrade stops doing so, this fails.
    expect(r.signal).toBeInstanceOf(AbortSignal)
    expect(r.redirect).toBe('error')
    expect(r.cache).toBe('no-store')
  })

  it('⛔ logs a distinct warning EVERY time the fallback is used, and which transport delivered', async () => {
    const vn = await vnBuild()
    replies.push(json(401, { ok: false, code: 'unauthorized' }), resendOk('re_a'), json(401, { ok: false, code: 'unauthorized' }), resendOk('re_b'))
    await vn.sendMail(msg())
    await vn.sendMail(msg())
    expect(fallbackLines()).toHaveLength(2)
    for (const line of fallbackLines()) {
      expect(line).toContain('"evt":"mail_fallback"')
      expect(line).toContain('"code":"unauthorized"')
      expect(line).toContain('a…e@gmail.com')
      expect(line).not.toContain('alice.example@gmail.com')
    }
    const sent = infos.filter((l) => l.startsWith('[mail] sent'))
    expect(sent).toHaveLength(2)
    expect(sent.every((l) => l.includes('"transport":"resend"'))).toBe(true)
    // ONE line of JSON, not an object util.inspect may wrap: the runbook greps `"evt":"mail_fallback"`.
    const raw = vi.mocked(console.warn).mock.calls.find((c) => c[0] === '[mail] FALLBACK to Resend')!
    expect(typeof raw[2]).toBe('string')
    expect(JSON.parse(raw[2] as string)).toMatchObject({ evt: 'mail_fallback', code: 'unauthorized', class: 'transactional', edition: 'vn' })
    const rawSent = vi.mocked(console.log).mock.calls.find((c) => c[0] === '[mail] sent')!
    expect(JSON.parse(rawSent[2] as string)).toMatchObject({ transport: 'resend', workerCode: 'unauthorized' })
  })

  it.each([
    ['401 unauthorized (key mismatch, clock skew)', [json(401, { ok: false, code: 'unauthorized' })]],
    ['an edge 403 page (lapsed plan)', [() => new Response('<html>forbidden</html>', { status: 403 })]],
    ['429 daily_limit', [json(429, { ok: false, code: 'daily_limit' })]],
    ['429 budget', [json(429, { ok: false, code: 'budget' })]],
    ['429 budget_unknown', [json(429, { ok: false, code: 'budget_unknown' })]],
    ['500 config (Worker misconfigured)', [json(500, { ok: false, code: 'config' })]],
    ['a 404 (MAILER_URL points nowhere, or no Worker is deployed there)', [() => new Response('There is nothing here yet', { status: 404 })]],
    ['429 rate_limited, twice', [json(429, { ok: false, code: 'rate_limited' }), json(429, { ok: false, code: 'rate_limited' })]],
    ['an HTML 502, twice', [() => new Response('bad gateway', { status: 502 }), () => new Response('bad gateway', { status: 502 })]],
    ['a 200 HTML page that is not the Worker, twice', [() => new Response('<html>wait</html>', { status: 200 }), () => new Response('<html>wait</html>', { status: 200 })]],
    ['a network error, twice', [() => { throw new TypeError('fetch failed') }, () => { throw new TypeError('fetch failed') }]],
    ['a timeout, twice', [() => { throw new DOMException('timed out', 'TimeoutError') }, () => { throw new DOMException('timed out', 'TimeoutError') }]],
  ] as Array<[string, Array<() => Response>]>)('falls back after %s', async (_label, worker503s) => {
    const vn = await vnBuild()
    replies.push(...worker503s, resendOk())
    expect(await vn.sendMailDetailed(msg())).toMatchObject({ ok: true, transport: 'resend' })
    expect(workerCalls()).toHaveLength(worker503s.length)
    expect(resendCalls()).toHaveLength(1)
    expect(fallbackLines()).toHaveLength(1)
  })

  it.each([
    ['suppressed', 422],
    ['invalid', 400],
    ['idempotency_conflict', 409],
    ['too_large', 413],
    ['marketing_refused', 403],
  ])('⛔ does NOT fall back on %s — a verdict Resend would bounce or double-send', async (code, status) => {
    const vn = await vnBuild()
    replies.push(json(status, { ok: false, code }))
    expect(await vn.sendMailDetailed(msg())).toEqual({ ok: false, code, status })
    expect(resendCalls()).toHaveLength(0)
    expect(fallbackLines()).toHaveLength(0)
  })

  it('does NOT fall back when the Worker accepted it, deduped or not', async () => {
    const vn = await vnBuild()
    replies.push(json(200, { ok: true, messageId: 'm1' }), json(200, { ok: true, messageId: 'm1', deduped: true }))
    expect(await vn.sendMailDetailed(msg())).toEqual({ ok: true, messageId: 'm1', transport: 'worker' })
    expect(await vn.sendMailDetailed(msg())).toEqual({ ok: true, messageId: 'm1', deduped: true, transport: 'worker' })
    expect(resendCalls()).toHaveLength(0)
  })

  it('a container with no Worker configured sends through Resend (and says so), and counts as enabled', async () => {
    vi.stubEnv('MAILER_URL', '')
    const vn = await vnBuild()
    expect(vn.mailEnabled()).toBe(true)
    replies.push(resendOk())
    expect(await vn.sendMailDetailed(msg())).toEqual({ ok: true, messageId: 're_msg_1', transport: 'resend' })
    expect(workerCalls()).toHaveLength(0)
    expect(resendCalls()[0].headers['idempotency-key']).toMatch(/^m-[0-9a-f-]{36}$/)
    expect(fallbackLines()[0]).toContain('"code":"disabled"')
  })

  it('⛔ sign-in mail through Resend carries NO Reply-To — its body is a live credential', async () => {
    const vn = await vnBuild()
    replies.push(json(401, { ok: false, code: 'unauthorized' }), resendOk())
    await vn.sendMail(msg({ class: 'signin' }))
    expect(JSON.parse(resendCalls()[0].body)).not.toHaveProperty('reply_to')
  })

  it('carries the attachment through, typed', async () => {
    const vn = await vnBuild()
    replies.push(json(503, { ok: false, code: 'unavailable' }), resendOk())
    await vn.sendMail(msg({ attachments: [{ filename: 'EV-1042-evisa.pdf', content: 'JVBERg==' }] }))
    expect(JSON.parse(resendCalls()[0].body).attachments).toEqual([{ filename: 'EV-1042-evisa.pdf', content: 'JVBERg==', content_type: 'application/pdf' }])
  })

  it('the 4.9 MiB ceiling holds on the fallback too: too_large, and nothing is sent anywhere', async () => {
    vi.stubEnv('MAILER_URL', '')
    const vn = await vnBuild()
    const big = 'A'.repeat(MAILER_MAX_REQUEST_BYTES)
    expect(await vn.sendMailDetailed(msg({ attachments: [{ filename: 'x.pdf', content: big }] }))).toEqual({ ok: false, code: 'too_large' })
    expect(seen).toEqual([])
  })

  it('no fallback without BOTH RESEND_API_KEY and MAIL_FROM', async () => {
    for (const [key, from] of [[RESEND_KEY, ''], ['', FROM]]) {
      seen = []
      vi.stubEnv('RESEND_API_KEY', key)
      vi.stubEnv('MAIL_FROM', from)
      const vn = await vnBuild()
      replies.push(json(401, { ok: false, code: 'unauthorized' }))
      expect(await vn.sendMailDetailed(msg())).toEqual({ ok: false, code: 'unauthorized', status: 401 })
      expect(resendCalls()).toHaveLength(0)
    }
    // …and the failure line says the fallback is missing, so a half-set env is visible in the logs.
    expect(errors.filter((l) => l.startsWith('[mail] send failed') && l.includes('"fallback":"unconfigured"'))).toHaveLength(2)
  })

  it('⛔ marketing is refused before any transport, Resend included', async () => {
    const vn = await vnBuild()
    expect(vn.mailEnabled('marketing')).toBe(false)
    expect(await vn.sendMailDetailed(msg({ class: 'marketing' }))).toEqual({ ok: false, code: 'marketing_refused' })
    expect(seen).toEqual([])
  })

  it('a Resend failure reports the WORKER\'s code (the caller\'s verdict) and logs Resend\'s', async () => {
    const vn = await vnBuild()
    replies.push(json(401, { ok: false, code: 'unauthorized' }), json(422, { statusCode: 422, name: 'validation_error', message: 'x' }))
    expect(await vn.sendMailDetailed(msg())).toEqual({ ok: false, code: 'unauthorized', status: 401 })
    const failed = errors.find((l) => l.startsWith('[mail] send failed'))
    expect(failed).toContain('"fallback":"resend"')
    expect(failed).toContain('"fallbackCode":"invalid"')
    expect(failed).toContain('"fallbackStatus":422')
  })

  it('a Resend request that times out is reported as timeout in the log', async () => {
    const vn = await vnBuild()
    const real = AbortSignal.timeout.bind(AbortSignal)
    let calls = 0
    // The Worker attempt gets a real signal; the Resend attempt one that has already fired.
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms: number) => (++calls === 1 ? real(ms) : AbortSignal.abort(new DOMException('timed out', 'TimeoutError'))))
    replies.push(json(401, { ok: false, code: 'unauthorized' }), (_req, init) => { throw (init.signal as AbortSignal).reason })
    expect(await vn.sendMailDetailed(msg())).toEqual({ ok: false, code: 'unauthorized', status: 401 })
    expect(errors.find((l) => l.startsWith('[mail] send failed'))).toContain('"fallbackCode":"timeout"')
  })

  it('⛔ respects the caller\'s deadline: with no time left after the Worker, Resend is not tried', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const vn = await vnBuild()
    const deadline = Date.now() + 1500
    // The Worker's one attempt (a file is never retried) eats 1 s of the 1.5 s budget, then fails.
    replies.push(() => { vi.setSystemTime(Date.now() + 1000); return new Response('bad gateway', { status: 502 }) })
    const res = await vn.sendMailDetailed(msg({ deadline, attachments: [{ filename: 'EV-1042-evisa.pdf', content: 'JVBERg==' }] }))
    expect(res).toEqual({ ok: false, code: 'unavailable', status: 502 })
    expect(resendCalls()).toHaveLength(0)
    expect(errors.find((l) => l.startsWith('[mail] send failed'))).toContain('"fallback":"no_time"')
  })

  it('…and with time left, Resend gets only what remains of it', async () => {
    const vn = await vnBuild()
    const timeouts: number[] = []
    const real = AbortSignal.timeout.bind(AbortSignal)
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms: number) => { timeouts.push(ms); return real(ms) })
    replies.push(() => new Response('bad gateway', { status: 502 }), resendOk())
    const res = await vn.sendMailDetailed(msg({ deadline: Date.now() + 4000, attachments: [{ filename: 'EV-1042-evisa.pdf', content: 'JVBERg==' }] }))
    expect(res).toMatchObject({ ok: true, transport: 'resend' })
    expect(timeouts).toHaveLength(2)
    expect(timeouts[1]).toBeLessThanOrEqual(4000)
    expect(timeouts[1]).toBeGreaterThanOrEqual(1000)
  })
})

describe('mail.ts — ⛔ NO Resend fallback on the services (eno.forum) build', () => {
  beforeEach(() => {
    vi.stubEnv('RESEND_API_KEY', 're_test_0123456789')
    vi.stubEnv('MAIL_FROM', 'eno.vn <no-reply@eno.vn>')
  })

  it('the Worker down → the send fails; nothing goes to Resend, even with its env set', async () => {
    expect(mailerEdition()).toBe('forum')
    replies.push(json(503, { ok: false, code: 'unavailable' }), json(503, { ok: false, code: 'unavailable' }))
    expect(await sendMailDetailed(msg())).toEqual({ ok: false, code: 'unavailable', status: 503 })
    expect(seen.every((s) => s.url === URL_SEND)).toBe(true)
    expect(errors.join('\n')).not.toContain('mail_fallback')
    expect(errors.join('\n')).not.toContain('"fallback"')
  })

  it('with no Worker configured the forum is disabled, not sent from eno.vn through Resend', async () => {
    vi.stubEnv('MAILER_URL', '')
    expect(mailEnabled()).toBe(false)
    expect(await sendMailDetailed(msg())).toEqual({ ok: false, code: 'disabled' })
    expect(seen).toEqual([])
  })
})
