// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'

vi.mock('@/context/auth-context', () => ({ useAuth: () => ({ user: null, openSignIn: () => {} }) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }), usePathname: () => '/help/x' }))

import { LanguageProvider } from '@/context/language-context'
import type { HelpPost } from '@/lib/help-center-data'
import { HelpThreadClient } from './help-thread-client'

/**
 * ⛔ AN OFFICIAL ANSWER IS NEVER SENT TO /api/translate UNDER THE ENGLISH UI (review, 2026-09-29).
 * /help/help-price-in-vnd-and-price-band and /help/help-languages-and-how-to-switch each posted
 * {"texts":["After the photo, price is…"],"target":"en"} on :3300 and swapped the authored body for the
 * machine output: one "đ" or "한국어" made useLocalized's per-letter detector call the answer foreign.
 * And the "Updated" line must not print the seed's curated-order createdAt as a date.
 */
afterEach(() => {
  cleanup()
  Reflect.deleteProperty(navigator, 'languages')
  vi.unstubAllGlobals()
})

// No '\n\n' and no "Label:" lines, so formatHelpBody keeps each as one paragraph with the text intact.
const VND_BODY = 'After the photo, price is what buyers read first. 12.000.000 đ looks like a real price.'
const LANGS_BODY = 'The site reads in English, Tiếng Việt, 中文 and 한국어 — switch from the globe in the header.'
const ORDER_KEY = '2026-07-21T00:03:00.000Z'

function post(over: Partial<HelpPost>): HelpPost {
  return {
    id: 'help-price-in-vnd-and-price-band',
    community: 'not-a-topic',
    title: 'How do I write the price?',
    body: VND_BODY,
    official: true,
    author: { name: 'eno team' },
    createdAt: ORDER_KEY,
    editedAt: null,
    score: 0,
    viewerVote: 0,
    ...over,
  } as unknown as HelpPost
}

function renderIn(lang: 'en' | 'vi', p: HelpPost, i18n?: { title: Record<string, string> | null; body: Record<string, string> | null }) {
  Object.defineProperty(navigator, 'languages', { configurable: true, get: () => (lang === 'vi' ? ['vi-VN', 'vi'] : ['en-US', 'en']) })
  return render(
    <LanguageProvider initialLang={lang} initialViDict={{}}>
      <HelpThreadClient post={p} comments={[]} i18n={i18n} />
    </LanguageProvider>,
  )
}

/** Past the mt-client batcher's 60ms window, so a queued request would have been sent. */
const settle = () => new Promise((r) => setTimeout(r, 150))
const enTargetCalls = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls.filter(([url, init]) => String(url).includes('/api/translate') && String((init as RequestInit | undefined)?.body ?? '').includes('"target":"en"'))

describe('HelpThreadClient — an official answer under the English UI', () => {
  it.each([VND_BODY, LANGS_BODY])('⛔ renders the authored body and posts nothing to /api/translate: %s', async (body) => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ translations: ['MT[After the …]'] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const { container } = renderIn('en', post({ body }))
    await settle()
    expect(enTargetCalls(fetchMock)).toHaveLength(0)
    expect(container.textContent).toContain(body)
    expect(container.textContent).not.toContain('MT[')
  })

  it("a member's Vietnamese question still translates for an English reader", async () => {
    const src = 'Làm sao để đăng tin cho thuê phòng?'
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ translations: ['How do I post a room for rent?'] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    renderIn('en', post({ official: false, title: 'Đăng tin', body: src, createdAt: '2026-09-20T08:00:00.000Z' }))
    await settle()
    expect(enTargetCalls(fetchMock).length).toBeGreaterThan(0)
  })

  it('a Vietnamese reader gets the curated twin, not the English body read as Vietnamese', () => {
    const vi_ = 'Sau ảnh, giá là điều người mua đọc đầu tiên. 12.000.000 đ trông như giá thật.'
    const { container } = renderIn('vi', post({}), { title: { vi: 'Ghi giá thế nào?' }, body: { vi: vi_ } })
    expect(container.querySelector('h1')?.textContent).toBe('Ghi giá thế nào?')
    expect(container.textContent).toContain(vi_)
    expect(container.textContent).not.toContain(VND_BODY)
  })
})

describe('HelpThreadClient — the date line', () => {
  it('⛔ an official answer never edited shows NO date — not the curated-order createdAt', () => {
    const { container } = renderIn('en', post({ editedAt: null }))
    expect(container.querySelector('time')).toBeNull()
    expect(container.textContent).not.toContain('Updated')
    expect(container.textContent).not.toContain('21 Jul 2026')
  })

  it('an edited official answer shows when its copy changed', () => {
    const { container } = renderIn('en', post({ editedAt: '2026-09-28T10:00:00.000Z' }))
    expect(container.querySelector('time')?.getAttribute('dateTime')).toBe('2026-09-28T10:00:00.000Z')
    expect(container.textContent).toContain('Updated 28 Sep 2026')
  })
})
