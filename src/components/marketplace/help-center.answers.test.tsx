// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import type { HelpCenterData, HelpPost } from '@/lib/help-center-data'

/**
 * THE HUB LISTS ARTICLES; THE ARTICLE PAGE HOLDS THE ANSWER (owner, 2026-11-25: "fix it properly to industry standard
 * regarding help articles"). Every answer on /help is a link to its own page — never an accordion whose page link sat in a
 * `hidden="until-found"` panel, invisible to a crawler (Seobility crawl 5: 27 links on /help, its answers 4–6 clicks deep) —
 * and the Vietnamese hub links the Vietnamese answers.
 */

const h = vi.hoisted(() => ({ lang: 'en' }))

// The marketplace: eno.forum has no /vi twins (lang-pinned.ts VI_PILOT is empty there).
vi.mock('@/lib/edition', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/edition')>()), IS_SERVICES: false, IS_MARKETPLACE: true }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }), usePathname: () => '/help' }))
vi.mock('next/link', () => ({ default: ({ href, children, prefetch: _p, ...rest }: { href: string; prefetch?: boolean; children?: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }))
vi.mock('@/context/auth-context', () => ({ useAuth: () => ({ user: null, loading: false }) }))
vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ lang: h.lang, tr: (en: string) => en }),
  useTr: () => (en: string) => en,
  Tr: ({ text }: { text: string }) => <>{text}</>,
}))
vi.mock('@/components/marketplace/listing-content', () => ({ useLocalized: (text: string) => text }))
vi.mock('@/lib/log', () => ({ logError: vi.fn() }))

import { HelpCenter, helpHref } from './help-center'

const post = (id: string, community: string, viewCount: number): HelpPost =>
  ({
    id,
    title: `Question ${id}?`,
    body: `The answer to ${id}, written by the eno team.`,
    community,
    official: true,
    viewCount,
    score: 0,
    commentCount: 0,
    viewerVote: 0,
    author: { name: 'eno', avatarUrl: null, avatarColor: '#000' },
  }) as unknown as HelpPost

// Nine answers in three topics: six go to Top questions, so the groups hold the rest.
const DATA: HelpCenterData = {
  answers: [
    ...['a1', 'a2', 'a3'].map((id, i) => post(id, 'help-getting-started', 90 - i)),
    ...['b1', 'b2', 'b3'].map((id, i) => post(id, 'help-buying', 60 - i)),
    ...['c1', 'c2', 'c3'].map((id, i) => post(id, 'vietnam-travel', 30 - i)),
  ],
  questions: [],
  reviews: [],
}

afterEach(cleanup)
beforeEach(() => { h.lang = 'en' })

describe('/help — the hub lists articles', () => {
  it('every answer is a link to its own page, under its topic; no panel, nothing hidden until found', () => {
    const { container } = render(<HelpCenter data={DATA} />)
    const rows = [...container.querySelectorAll<HTMLAnchorElement>('a[data-help-answer]')]
    // Six are Top questions (left out of their groups); the other three are rows under their topics.
    expect(rows.map((a) => a.getAttribute('href'))).toEqual(['/help/c1', '/help/c2', '/help/c3'])
    expect(rows[0].textContent).toBe('Question c1?')
    // Every answer reachable by a plain link: the six Top questions and the three rows.
    const linked = new Set([...container.querySelectorAll('a[href^="/help/"]')].map((a) => a.getAttribute('href')))
    expect(linked.size).toBe(9)
    expect(container.querySelector('[data-slot="accordion-trigger"], [data-slot="accordion-panel"]')).toBeNull()
    expect(container.querySelector('[hidden]')).toBeNull()
    // The hub carries questions, not answers: an answer's body is on its page.
    expect(container.textContent).not.toContain('The answer to c1')
  })

  it('the Vietnamese hub links the Vietnamese answers (/vi/help/<id>), the Top questions too', () => {
    h.lang = 'vi'
    const { container } = render(<HelpCenter data={DATA} />)
    const hrefs = [...container.querySelectorAll('a[href*="/help/"]')].map((a) => a.getAttribute('href'))
    expect(hrefs.length).toBe(9)
    for (const href of hrefs) expect(href).toMatch(/^\/vi\/help\/[a-c]\d$/)
  })

  it('a search lists the matching answers; one found by its answer shows the words that found it, one found by its question does not', async () => {
    const data: HelpCenterData = { ...DATA, answers: [...DATA.answers, { ...post('d1', 'help-buying', 1), body: 'Never pay a deposit before you see the item.' } as HelpPost] }
    const { container, getByRole } = render(<HelpCenter data={data} />)
    await act(async () => { fireEvent.change(getByRole('searchbox'), { target: { value: 'deposit' } }) })
    const rows = [...container.querySelectorAll<HTMLAnchorElement>('a[data-help-answer]')]
    expect(rows.map((a) => a.getAttribute('href'))).toEqual(['/help/d1'])
    expect(rows[0].textContent).toBe('Question d1? Never pay a deposit before you see the item.')
    await act(async () => { fireEvent.change(getByRole('searchbox'), { target: { value: 'question c1' } }) })
    const byTitle = [...container.querySelectorAll<HTMLAnchorElement>('a[data-help-answer]')]
    expect(byTitle.map((a) => a.textContent)).toEqual(['Question c1?'])
  })

  it('helpHref: the reader\'s variant, an id encoded', () => {
    expect(helpHref('help-how-offers-work', 'en')).toBe('/help/help-how-offers-work')
    expect(helpHref('help-how-offers-work', 'vi')).toBe('/vi/help/help-how-offers-work')
    expect(helpHref('help-how-offers-work', 'fr')).toBe('/help/help-how-offers-work')
  })
})
