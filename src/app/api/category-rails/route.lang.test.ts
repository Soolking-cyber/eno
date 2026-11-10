import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LANGS } from '@/lib/i18n/langs'

/**
 * GET /api/category-rails?lang= — the shelves carry the READER'S title translations, not every language's (audit api-08).
 *
 * Measured 2026-11-10: every card carried `titleI18n` in nine machine-translated languages (30% of the raw answer), to a
 * reader who needs one, or none. The language comes from the URL, never a cookie: the answer is publicly cached.
 * ⚠️ WITHOUT `lang` THE ANSWER IS UNCHANGED (every language): a page loaded before the client sent it still asks that way.
 *
 * The real translator (`localizeListingTitles`) runs here, over a mocked translation cache, so these are the bytes a reader gets.
 * ⚠️ DATA SAFETY — the database and the edition scope are mocked by name.
 */

type Row = Record<string, any>

/** Every title is cached in every site language (LANGS); en and vi are in the row itself and never embedded. */
const TARGETS: string[] = [...LANGS]
const MT = TARGETS.filter((t) => t !== 'en' && t !== 'vi')

const h = vi.hoisted(() => ({ translationReads: 0 }))

vi.mock('@/lib/db', () => ({
  db: {
    listing: {
      groupBy: async () => ['rentals', 'jobs'].map((slug) => ({ categoryId: `id-${slug}`, _count: { _all: 50 }, _sum: { views: 10, contactCount: 0 } })),
      findMany: async ({ where }: { where: Row }) => {
        const categoryId = (where.AND?.[0] ?? where).categoryId
        return Array.from({ length: 8 }, (_, i) => ({ id: `${categoryId}-${i}`, title: `${categoryId} card ${i}` }))
      },
    },
    category: {
      findMany: async ({ where }: { where: { id: { in: string[] } } }) => where.id.in.map((id) => ({ id, slug: id.slice(3) })),
    },
    translation: {
      findMany: async ({ where }: { where: { hash: { in: string[] } } }) => {
        h.translationReads++
        return where.hash.in.flatMap((hash) => TARGETS.map((target) => ({ hash, target, value: `${target}:${hash.slice(0, 6)}` })))
      },
    },
  },
}))
vi.mock('@/lib/edition-scope', () => ({ scopedListingWhere: async (w: Row) => w }))
vi.mock('@/lib/serialize', () => ({ LISTING_CARD_SELECT: {}, serializeListingCard: (l: Row) => l }))
vi.mock('@/lib/feed-diversity', () => ({ diversifyRail: (rows: Row[], { take }: { take: number }) => rows.slice(0, take) }))
vi.mock('@/lib/admin', () => ({ getAdmin: async () => null, getCurrentProfile: async () => null, getCurrentProfileId: async () => null }))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => ({ success: true }) }))
vi.mock('@/lib/log', () => ({ logError: () => {} }))

import { NextRequest } from 'next/server'
const { GET } = await import('./route')

async function cards(query: string): Promise<Array<{ id: string; titleI18n?: Record<string, string> }>> {
  const res = await GET(new NextRequest(`https://eno.vn/api/category-rails${query}`))
  expect(res.status).toBe(200)
  const { rails } = (await res.json()) as { rails: Array<{ listings: Array<{ id: string; titleI18n?: Record<string, string> }> }> }
  expect(rails).toHaveLength(2)
  return rails.flatMap((r) => r.listings)
}

beforeEach(() => { h.translationReads = 0 })

describe('GET /api/category-rails — the reader’s language', () => {
  it.each(['en', 'vi'])('lang=%s: no titleI18n, and no translation read (the row has both titles)', async (lang) => {
    const all = await cards(`?lang=${lang}`)
    expect(all).toHaveLength(16)
    for (const c of all) expect(c).not.toHaveProperty('titleI18n')
    expect(h.translationReads).toBe(0)
  })

  it.each(['ko', 'zh-Hans', 'th'])('lang=%s: that language only', async (lang) => {
    const all = await cards(`?lang=${lang}`)
    expect(all).toHaveLength(16)
    for (const c of all) expect(Object.keys(c.titleI18n ?? {})).toEqual([lang])
    expect(h.translationReads).toBe(1)
  })

  it('no lang: every machine-translated language, as before (a page loaded before the client sent it)', async () => {
    for (const query of ['', '?lang=']) {
      const all = await cards(query)
      expect(all).toHaveLength(16)
      for (const c of all) expect(Object.keys(c.titleI18n ?? {}).sort()).toEqual([...MT].sort())
    }
  })

  it('the same titles reach a Korean reader either way', async () => {
    const everything = await cards('')
    const korean = await cards('?lang=ko')
    expect(korean.map((c) => c.titleI18n?.ko)).toEqual(everything.map((c) => c.titleI18n?.ko))
  })
})

/** The whole answer as a client sees it: status, Cache-Control, body bytes, and how many translation reads it cost. */
async function answer(query: string): Promise<{ status: number; cache: string | null; body: string; reads: number }> {
  h.translationReads = 0
  const res = await GET(new NextRequest(`https://eno.vn/api/category-rails${query}`))
  return { status: res.status, cache: res.headers.get('cache-control'), body: await res.text(), reads: h.translationReads }
}

/**
 * ⛔ ONLY THE SITE'S OWN CODES (commit gate, 2026-11-11). The route is public and every miss runs the groupBy and ~10
 * findMany, so a made-up `lang` must not become an answer of its own: it is the no-lang answer, byte for byte. Without
 * the allowlist `lang=xx` answered with no titles at all and `lang=constructor` / `toString` with `"titleI18n":{}` on every
 * card (localizeListingTitles read the prototype's member as a translation).
 */
describe('GET /api/category-rails — lang is one of the site’s codes, or it is no lang', () => {
  it.each([
    ['xx'], ['ko-KR'], ['zh'], ['english'], ['constructor'], ['__proto__'], ['toString'], [' '], ['en-GB'], ['k'.repeat(40)],
  ])('lang=%j answers exactly like no lang (the every-language answer)', async (lang) => {
    const none = await answer('')
    const made = await answer(`?lang=${encodeURIComponent(lang)}`)
    expect(made).toEqual(none)
    expect(none.status).toBe(200)
    expect(none.reads).toBe(1)
  })

  it('an empty lang answers exactly like no lang', async () => {
    expect(await answer('?lang=')).toEqual(await answer(''))
  })

  it('every site language is accepted: en/vi carry no titleI18n and cost no read, the others carry that one language', async () => {
    for (const lang of LANGS) {
      const all = await cards(`?lang=${encodeURIComponent(lang)}`)
      expect(all).toHaveLength(16)
      if (lang === 'en' || lang === 'vi') {
        for (const c of all) expect(c).not.toHaveProperty('titleI18n')
      } else {
        for (const c of all) expect(Object.keys(c.titleI18n ?? {})).toEqual([lang])
      }
    }
  })

  it.each([['KO', 'ko'], ['zh-hans', 'zh-Hans'], ['ZH-HANS', 'zh-Hans'], ['Th', 'th'], [' ja ', 'ja']])(
    'lang=%j is read case-blind and trimmed, as the canonical %s',
    async (lang, code) => {
      const all = await cards(`?lang=${encodeURIComponent(lang)}`)
      for (const c of all) expect(Object.keys(c.titleI18n ?? {})).toEqual([code])
      expect(await answer(`?lang=${encodeURIComponent(lang)}`)).toEqual(await answer(`?lang=${code}`))
    },
  )

  it.each(['EN', 'Vi', ' vi '])('lang=%j is en/vi: no titleI18n and no translation read', async (lang) => {
    const a = await answer(`?lang=${encodeURIComponent(lang)}`)
    expect(a.reads).toBe(0)
    expect(a.body).not.toContain('titleI18n')
  })
})
