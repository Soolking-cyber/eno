import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// sendMailOnce — the send behind the teacher job-match emails, which must NEVER arrive twice. Resend is mocked: no test
// here reaches the network. What it pins: the idempotency key goes with every request, and the outcome is classified by
// Resend's error NAME — 'refused' only when Resend proved nothing was sent (and only on a first attempt), 'unknown'
// for everything else, so the caller keeps its claim.
type Call = { payload: { to: string; from: string; subject: string; headers?: Record<string, string> }; opts: { idempotencyKey: string } }
const h = vi.hoisted(() => ({ calls: [] as Call[], answer: null as unknown, throws: false }))

vi.mock('resend', () => ({
  Resend: class {
    emails = {
      send: async (payload: Call['payload'], opts: Call['opts']) => {
        h.calls.push({ payload, opts })
        if (h.throws) throw new Error('socket hang up')
        return h.answer
      },
    }
    batch = { send: async () => ({ data: null, error: null }) }
  },
}))

process.env.RESEND_API_KEY = 're_test'
const { sendMailOnce } = await import('./mail')
const msg = { to: 'teacher@example.com', subject: 's', html: '<p>h</p>', text: 't', headers: { 'List-Unsubscribe': '<https://eno.vn/api/unsubscribe?token=x>' } }
const fail = (name: string, statusCode: number | null, headers: Record<string, string> | null = {}) => ({ data: null, error: { name, statusCode, message: 'm' }, headers })

let errors: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  h.calls = []; h.throws = false
  h.answer = { data: { id: 'email_1' }, error: null, headers: {} }
  errors = vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { errors.mockRestore() })

describe('sendMailOnce', () => {
  it('sent: one request, carrying the caller’s idempotency key, the verified sender and the headers', async () => {
    const r = await sendMailOnce(msg, { idempotencyKey: 'teacher-matches/tp1/abc' })
    expect(r).toEqual({ outcome: 'sent', stopRun: false, name: null, retryAfterMs: null })
    expect(h.calls).toHaveLength(1)
    expect(h.calls[0].opts).toEqual({ idempotencyKey: 'teacher-matches/tp1/abc' })
    expect(h.calls[0].payload).toMatchObject({ to: msg.to, subject: 's', headers: msg.headers })
    expect(h.calls[0].payload.from).toMatch(/<[^>]+@[^>]+>|^[^<]+@/)
  })

  it('a first 429 is REFUSED (nothing was sent), not a reason to stop the run, and passes retry-after on', async () => {
    h.answer = fail('rate_limit_exceeded', 429, { 'retry-after': '2' })
    expect(await sendMailOnce(msg, { idempotencyKey: 'k' })).toEqual({ outcome: 'refused', stopRun: false, name: 'rate_limit_exceeded', retryAfterMs: 2000 })
  })

  it('a validation error is refused — and the run goes on', async () => {
    h.answer = fail('validation_error', 422)
    expect(await sendMailOnce(msg, { idempotencyKey: 'k' })).toMatchObject({ outcome: 'refused', stopRun: false })
  })

  it.each(['daily_quota_exceeded', 'monthly_quota_exceeded', 'invalid_api_key', 'restricted_api_key', 'missing_api_key', 'invalid_access', 'invalid_idempotency_key', 'invalid_from_address'])(
    '%s is refused AND stops the run — every later send would fail the same way', async (name) => {
      h.answer = fail(name, 429)
      expect(await sendMailOnce(msg, { idempotencyKey: 'k' })).toMatchObject({ outcome: 'refused', stopRun: true, name })
    },
  )

  it.each([
    ['concurrent_idempotent_requests', 409], ['invalid_idempotent_request', 409], ['application_error', 500],
    ['internal_server_error', 500], ['not_found', 404], ['security_error', 451],
  ] as const)('%s (%i) is UNKNOWN — it may have been sent; the caller keeps its claim', async (name, status) => {
    h.answer = fail(name, status)
    expect(await sendMailOnce(msg, { idempotencyKey: 'k' })).toMatchObject({ outcome: 'unknown', stopRun: false, name })
  })

  it('a network failure — the SDK’s statusCode null ("Unable to fetch data") — is unknown', async () => {
    h.answer = fail('application_error', null, null)
    expect(await sendMailOnce(msg, { idempotencyKey: 'k' })).toMatchObject({ outcome: 'unknown', name: 'application_error' })
  })

  it('a throw is unknown, never a throw', async () => {
    h.throws = true
    expect(await sendMailOnce(msg, { idempotencyKey: 'k' })).toEqual({ outcome: 'unknown', stopRun: false, name: 'network', retryAfterMs: null })
  })

  it('no id and no error is unknown — not a documented answer, and it may have been accepted', async () => {
    h.answer = { data: null, error: null, headers: {} }
    expect((await sendMailOnce(msg, { idempotencyKey: 'k' })).outcome).toBe('unknown')
  })

  it('⛔ after an unclear attempt, even a 429 is unknown: the first request may already have been processed', async () => {
    h.answer = fail('rate_limit_exceeded', 429)
    expect(await sendMailOnce(msg, { idempotencyKey: 'k', afterUnknown: true })).toMatchObject({ outcome: 'unknown', stopRun: false })
    h.answer = fail('daily_quota_exceeded', 429)
    expect(await sendMailOnce(msg, { idempotencyKey: 'k', afterUnknown: true })).toMatchObject({ outcome: 'unknown', stopRun: false })
    h.answer = { data: { id: 'email_1' }, error: null, headers: {} }
    expect((await sendMailOnce(msg, { idempotencyKey: 'k', afterUnknown: true })).outcome).toBe('sent')
  })

  it('logs a masked address, never the address itself', async () => {
    h.answer = fail('validation_error', 422)
    await sendMailOnce(msg, { idempotencyKey: 'k' })
    const logged = errors.mock.calls.flat().map(String).join(' ')
    expect(logged).toContain('t…r@example.com')
    expect(logged).not.toContain('teacher@example.com')
  })
})
