import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ kv: new Map<string, unknown>(), broken: false }))
vi.mock('@/lib/ratelimit', () => ({
  kv: {
    get: async (k: string) => { if (h.broken) throw new Error('down'); return h.kv.get(k) ?? null },
    set: async (k: string, v: unknown, o?: { nx?: boolean }) => { if (h.broken) throw new Error('down'); if (o?.nx && h.kv.has(k)) return null; h.kv.set(k, v); return 'OK' },
    del: async (k: string) => { h.kv.delete(k) },
  },
}))
vi.mock('@/lib/log', () => ({ logError: vi.fn() }))
const { idempotent } = await import('./idempotency')

const fail = (code: string) => ({ code })
beforeEach(() => { h.kv.clear(); h.broken = false })

describe('UCP idempotency', () => {
  it('runs once; the same key and body replays the stored result; another body is 409 and does not run', async () => {
    const run = vi.fn(async () => ({ status: 200, body: { id: 'chk_1' } }))
    expect(await idempotent('p', 'k1', '{"a":1}', run, fail)).toEqual({ status: 200, body: { id: 'chk_1' } })
    expect(await idempotent('p', 'k1', '{"a":1}', run, fail)).toEqual({ status: 200, body: { id: 'chk_1' }, replayed: true })
    expect(await idempotent('p', 'k1', '{"a":2}', run, fail)).toEqual({ status: 409, body: { code: 'idempotency_key_reused' } })
    expect(run).toHaveBeenCalledTimes(1)
    // Keys are per platform.
    await idempotent('q', 'k1', '{"a":2}', run, fail)
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('fails closed when the store is down, and never stores our own failure', async () => {
    h.broken = true
    const run = vi.fn(async () => ({ status: 200, body: {} }))
    expect(await idempotent('p', 'k', '{}', run, fail)).toEqual({ status: 503, body: { code: 'idempotency_unavailable' } })
    expect(run).not.toHaveBeenCalled()
    h.broken = false
    const boom = vi.fn(async () => ({ status: 500, body: { e: 1 } }))
    await idempotent('p', 'k2', '{}', boom, fail)
    await idempotent('p', 'k2', '{}', boom, fail)
    expect(boom).toHaveBeenCalledTimes(2)
  })

  it('a reply that says "retry" is answered but never kept', async () => {
    const busy = vi.fn(async () => ({ status: 200, body: { busy: true }, store: false as const }))
    await idempotent('p', 'k3', '{}', busy, fail)
    await idempotent('p', 'k3', '{}', busy, fail)
    expect(busy).toHaveBeenCalledTimes(2)
  })
})
