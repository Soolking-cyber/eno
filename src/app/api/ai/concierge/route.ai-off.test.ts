import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

// ── App Store gate `app-ai-notice`: `ai: false` (the apps' "Not now") means NO Google for that turn ─────────
// Neither Gemini (understand) nor Vertex AI Search (conciergeSearch) is called, and the turn is still answered from the
// keyword reading + Postgres search. Without the field — every request with the gate off — both are used as before.

const { generateContent, conciergeSearch, rows } = vi.hoisted(() => ({
  generateContent: vi.fn(async () => ({ text: 'not json' })),
  conciergeSearch: vi.fn(async () => ({ listingIds: [] as string[], answer: '' })),
  rows: { value: [] as Array<Record<string, unknown>> },
}))

vi.mock('@/lib/db', () => ({
  db: {
    category: { findMany: vi.fn(async () => [{ slug: 'electronics' }, { slug: 'vehicles' }]) },
    listing: { findMany: vi.fn(async () => rows.value) },
  },
}))
vi.mock('@/lib/ai-guard', () => ({ aiGuard: vi.fn(async () => ({ ok: true, profileId: 'p1' })) }))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: vi.fn(async () => ({ success: true })) }))
vi.mock('@/lib/gemini', () => ({ getGemini: () => ({ models: { generateContent } }), GEMINI_MODEL: 'gemini-test' }))
vi.mock('@/lib/vertex-search', () => ({ conciergeSearch, vertexConfigured: () => true }))
vi.mock('@/lib/brand', () => ({ matchBrand: vi.fn(async () => null) }))
vi.mock('@/lib/serialize', () => ({ serializeListing: (r: unknown) => r }))
vi.mock('@/lib/edition-scope', () => ({
  marketplaceListingScope: vi.fn(async () => ({})),
  scopedListingWhere: vi.fn(async (w: unknown) => w),
  teacherExclusion: vi.fn(async () => ({})),
}))

import { POST } from './route'

const ask = (extra: Record<string, unknown>) =>
  POST(new NextRequest('http://localhost/api/ai/concierge', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ lang: 'en', messages: [{ role: 'user', content: 'a used road bike under 8 million' }], ...extra }),
  }))

beforeEach(() => {
  generateContent.mockClear()
  conciergeSearch.mockClear()
  rows.value = []
})

describe('POST /api/ai/concierge — the `ai` field', () => {
  it('ai: false ⇒ no Gemini, no Vertex AI Search, still an answer', async () => {
    const res = await ask({ ai: false })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { reply?: string; source?: string }
    expect(typeof body.reply).toBe('string')
    expect(body.source).toBe('fallback')
    expect(generateContent).not.toHaveBeenCalled()
    expect(conciergeSearch).not.toHaveBeenCalled()
  })

  it('absent (gate off, or allowed) ⇒ Gemini and Vertex AI Search, exactly as before', async () => {
    const res = await ask({})
    expect(res.status).toBe(200)
    expect(generateContent).toHaveBeenCalledTimes(1)
    expect(conciergeSearch).toHaveBeenCalledTimes(1)
  })

  it('ai: false WITH listings found ⇒ still no Gemini — the reply over the results is the route\'s own words', async () => {
    rows.value = [{ id: 'l1', title: 'Giant road bike', price: 7_500_000 }, { id: 'l2', title: 'Trek road bike', price: 6_900_000 }]
    const res = await ask({ ai: false })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { reply?: string; listings?: unknown[]; source?: string }
    expect(body.listings?.length).toBeGreaterThan(0)
    expect(typeof body.reply).toBe('string')
    expect(generateContent).not.toHaveBeenCalled()
    expect(conciergeSearch).not.toHaveBeenCalled()
  })

  it('only the literal false switches it off', async () => {
    for (const ai of [true, 'false', 0, null]) {
      generateContent.mockClear()
      await ask({ ai })
      expect(generateContent).toHaveBeenCalledTimes(1)
    }
  })
})
