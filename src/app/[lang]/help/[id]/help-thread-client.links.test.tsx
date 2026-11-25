// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'

// The marketplace: eno.forum has no /vi twins (lang-pinned.ts VI_PILOT is empty there).
vi.mock('@/lib/edition', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/edition')>()), IS_SERVICES: false, IS_MARKETPLACE: true }))
vi.mock('@/context/auth-context', () => ({ useAuth: () => ({ user: null, openSignIn: () => {} }) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }), usePathname: () => '/help/x' }))

import { LanguageProvider } from '@/context/language-context'
import type { HelpPost } from '@/lib/help-center-data'
import { HelpThreadClient } from './help-thread-client'

/**
 * An answer's page links within its own variant (owner, 2026-11-25, help articles to industry standard): on the Vietnamese
 * page the way back to the hub, the topic chip and the related answers go to /vi/help…, as the Vietnamese hub's rows do
 * (help-center.tsx helpHref) — they all went to the plain URLs, so a crawler reached /vi/help answers only through each English
 * page's twin link (Seobility crawl 5: 5–6 clicks deep).
 */

afterEach(cleanup)

const post = {
  id: 'help-how-offers-work',
  title: 'How do offers work?',
  body: 'Make an offer from the listing page.',
  community: 'help-buying',
  official: true,
  author: { name: 'eno', avatarUrl: null, avatarColor: '#000' },
  createdAt: '2026-09-01T00:00:00.000Z',
  editedAt: null,
  score: 0,
  viewerVote: 0,
  commentCount: 0,
} as unknown as HelpPost

const related = [{ id: 'help-spot-a-bait-price', title: 'How do I spot a bait price?', i18n: null }]

function hrefsIn(lang: 'en' | 'vi') {
  Object.defineProperty(navigator, 'languages', { configurable: true, get: () => (lang === 'vi' ? ['vi-VN', 'vi'] : ['en-US', 'en']) })
  const { container } = render(
    <LanguageProvider initialLang={lang} initialViDict={{}}>
      <HelpThreadClient post={post} comments={[]} related={related} />
    </LanguageProvider>,
  )
  return [...container.querySelectorAll('a')].map((a) => a.getAttribute('href')).filter((h): h is string => !!h && h.includes('/help'))
}

describe('a help answer links within its variant', () => {
  it('Vietnamese: the hub and the related answer are the /vi ones', () => {
    const hrefs = hrefsIn('vi')
    expect(hrefs).toContain('/vi/help')
    expect(hrefs).toContain('/vi/help/help-spot-a-bait-price')
    expect(hrefs.filter((h) => h === '/help' || h.startsWith('/help/'))).toEqual([])
  })
  it('English: the plain ones', () => {
    const hrefs = hrefsIn('en')
    expect(hrefs).toContain('/help')
    expect(hrefs).toContain('/help/help-spot-a-bait-price')
    expect(hrefs.filter((h) => h.startsWith('/vi/'))).toEqual([])
  })
})
