// @vitest-environment jsdom
import React from 'react'
import { renderToString } from 'react-dom/server'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AMENDED } from '@/lib/compliance/legal-amendment'
import { TOS_EFFECTIVE_AT } from '@/lib/site-legal'

/**
 * THE AMENDMENT NOTICE IS DECIDED BY THE CLOCK, IN THE BROWSER.
 *
 * It renders on statically prerendered pages, so anything decided on the server is frozen into HTML
 * (d067d756). These tests pin the three properties that keep it honest: nothing in the server
 * markup, shown on the client throughout the window, gone from the in-force instant — plus the
 * in-force date it announces, which comes from LEGAL_AMENDMENT rather than a typed date.
 */

const h = vi.hoisted(() => ({ lang: 'en' as 'en' | 'vi', pathname: '/' }))
vi.mock('next/navigation', () => ({ usePathname: () => h.pathname }))
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}))
vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ lang: h.lang, tr: (en: string, vi?: string) => (h.lang === 'vi' && vi ? vi : en) }),
}))

const { TosChangeNotice } = await import('./tos-change-notice')

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  h.lang = 'en'
  h.pathname = '/'
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

async function mountAt(at: number) {
  vi.setSystemTime(at)
  let view!: ReturnType<typeof render>
  await act(async () => { view = render(<TosChangeNotice />) })
  return view.container
}

describe('TosChangeNotice', () => {
  it('renders nothing on the server, so no prerendered page can freeze it', () => {
    vi.setSystemTime(TOS_EFFECTIVE_AT - 60_000)
    expect(renderToString(<TosChangeNotice />)).toBe('')
  })

  it('announces the amendment and its in-force date during the window, linking the change log', async () => {
    const el = await mountAt(TOS_EFFECTIVE_AT - 1)
    const notice = el.querySelector('#tos-change-notice')
    expect(notice?.textContent).toContain('Terms of Service, Operating Regulations, Returns policy and Prohibited items list have been amended')
    expect(notice?.textContent).toContain(`take effect on ${AMENDED.inForceEn}`)
    expect(notice?.querySelector('a')?.getAttribute('href')).toBe('/regulations#changelog')
  })

  it('speaks Vietnamese with the Vietnamese date form', async () => {
    h.lang = 'vi'
    const el = await mountAt(TOS_EFFECTIVE_AT - 3_600_000)
    expect(el.textContent).toContain('Quy chế hoạt động')
    expect(el.textContent).toContain(`có hiệu lực từ ngày ${AMENDED.inForceVi}`)
  })

  it('is gone from midnight Vietnam time on the in-force date', async () => {
    const el = await mountAt(TOS_EFFECTIVE_AT)
    expect(el.querySelector('#tos-change-notice')).toBeNull()
  })

  it('stays off the chat surface, whose height is computed without it', async () => {
    h.pathname = '/messages/abc'
    const el = await mountAt(TOS_EFFECTIVE_AT - 1)
    expect(el.querySelector('#tos-change-notice')).toBeNull()
  })
})
