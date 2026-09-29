import { beforeEach, describe, expect, it, vi } from 'vitest'

// sendMailBatch is the broadcast path. It must: send ONE request with permissive validation and the
// caller's idempotency key, fail only the refused rows, say when a retry can help (429 / 5xx /
// network) and when it cannot (a validation error), and never throw.
type Call = { payload: { to: string; from: string }[]; opts: { idempotencyKey: string; batchValidation: string } }
const h = vi.hoisted(() => ({ calls: [] as Call[], answer: null as unknown, throws: false }))

vi.mock('resend', () => ({
  Resend: class {
    batch = {
      send: async (payload: Call['payload'], opts: Call['opts']) => {
        h.calls.push({ payload, opts })
        if (h.throws) throw new Error('socket hang up')
        return h.answer
      },
    }
    emails = { send: async () => ({ data: { id: 'x' }, error: null }) }
  },
}))

process.env.RESEND_API_KEY = 're_test'
const { sendMailBatch } = await import('./mail')
const msg = (to: string) => ({ to, subject: 's', html: '<p>h</p>', text: 't' })

beforeEach(() => { h.calls = []; h.throws = false; h.answer = { data: { data: [{ id: '1' }, { id: '2' }] }, error: null, headers: {} } })

describe('sendMailBatch', () => {
  it('sends one permissive request carrying the idempotency key', async () => {
    const r = await sendMailBatch([msg('a@x.co'), msg('b@x.co')], { idempotencyKey: 'k1' })
    expect(r).toEqual({ ok: [true, true], retryable: false, retryAfterMs: null, error: null })
    expect(h.calls).toHaveLength(1)
    expect(h.calls[0].opts).toEqual({ idempotencyKey: 'k1', batchValidation: 'permissive' })
    expect(h.calls[0].payload.map((p) => p.to)).toEqual(['a@x.co', 'b@x.co'])
  })

  it('fails only the rows Resend refused', async () => {
    h.answer = { data: { data: [{ id: '1' }], errors: [{ index: 1, message: 'Invalid `to` field' }] }, error: null, headers: {} }
    const r = await sendMailBatch([msg('a@x.co'), msg('not-an-email')], { idempotencyKey: 'k2' })
    expect(r.ok).toEqual([true, false])
    expect(r.retryable).toBe(false)
    expect(r.error).toBe('rows_refused')
  })

  it('marks a 429 retryable and honours retry-after', async () => {
    h.answer = { data: null, error: { name: 'rate_limit_exceeded', statusCode: 429, message: 'Too many requests' }, headers: { 'retry-after': '2' } }
    const r = await sendMailBatch([msg('a@x.co')], { idempotencyKey: 'k3' })
    expect(r).toEqual({ ok: [false], retryable: true, retryAfterMs: 2000, error: 'rate_limit_exceeded' })
  })

  it('does not retry a validation error — sending it again cannot help', async () => {
    h.answer = { data: null, error: { name: 'validation_error', statusCode: 422, message: 'bad' }, headers: {} }
    const r = await sendMailBatch([msg('a@x.co')], { idempotencyKey: 'k4' })
    expect(r.retryable).toBe(false)
  })

  it('turns a thrown network error into a retryable failure instead of throwing', async () => {
    h.throws = true
    const r = await sendMailBatch([msg('a@x.co')], { idempotencyKey: 'k5' })
    expect(r).toEqual({ ok: [false], retryable: true, retryAfterMs: null, error: 'network' })
  })

  it('refuses more than 100 messages without calling Resend', async () => {
    const r = await sendMailBatch(Array.from({ length: 101 }, (_, i) => msg(`p${i}@x.co`)), { idempotencyKey: 'k6' })
    expect(r.error).toBe('batch_too_large')
    expect(h.calls).toHaveLength(0)
  })
})
