import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ── src/lib/ugc-filter.ts — the severe-only refusal behind the `ugc-safety` gate (plan R5) ────────────

const h = vi.hoisted(() => ({ counters: new Map<string, number>(), ttl: [] as number[], kvFails: false }))
vi.mock('@/lib/ratelimit', () => ({
  kv: {
    incrby: async (k: string, by: number, ex?: number) => {
      if (h.kvFails) throw new Error('kv down')
      h.counters.set(k, (h.counters.get(k) ?? 0) + by)
      if (ex) h.ttl.push(ex)
      return h.counters.get(k)
    },
  },
}))
vi.mock('@/lib/edition', async (orig) => ({ ...(await orig<Record<string, unknown>>()), EDITION: 'services' }))
vi.mock('@/lib/log', () => ({ logError: () => {} }))

const { refuseObjectionable, ugcFilterCounterKey, UGC_FILTER_COUNTER_PREFIX } = await import('./ugc-filter')

beforeEach(() => { h.counters = new Map(); h.ttl = []; h.kvFails = false })
afterEach(() => vi.unstubAllEnvs())

describe('refuseObjectionable', () => {
  it('gate OFF: never refuses and never counts — not even a slur', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', '')
    expect(await refuseObjectionable('chat', 'I will kill you, you gook')).toBe(false)
    expect(h.counters.size).toBe(0)
  })

  it('gate ON: refuses a severe term and counts ONE anonymous integer — no text, no user, no term', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ugc-safety')
    expect(await refuseObjectionable('review', 'great phone', 'tao giết mày')).toBe(true)
    expect([...h.counters]).toHaveLength(1)
    const [key, n] = [...h.counters][0]
    expect(n).toBe(1)
    expect(key.startsWith(UGC_FILTER_COUNTER_PREFIX)).toBe(true)
    expect(key).toMatch(/^ugc-filter:\d{4}-\d{2}-\d{2}:services:review:threat$/)
    expect(key).not.toMatch(/giet|may|kill/)
    expect(h.ttl).toEqual([400 * 24 * 60 * 60])
  })

  it('gate ON: lets ordinary text through — including profanity, which the owner left to reports', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ugc-safety')
    for (const t of ['Is this still available?', 'đ.m giá cao quá', 'what the fuck, 5 triệu?', 'bán máy giặt cũ', null, undefined, '']) {
      expect(await refuseObjectionable('chat', t), String(t)).toBe(false)
    }
    expect(h.counters.size).toBe(0)
  })

  it('a broken counter never turns a refusal into an error', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ugc-safety')
    h.kvFails = true
    expect(await refuseObjectionable('help-comment', 'send nudes')).toBe(true)
  })

  it('the counter key is (VN day, edition, surface, category)', () => {
    expect(ugcFilterCounterKey('2026-10-05', 'marketplace', 'help-post', 'slur')).toBe('ugc-filter:2026-10-05:marketplace:help-post:slur')
  })
})
