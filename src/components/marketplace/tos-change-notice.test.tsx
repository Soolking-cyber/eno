// @vitest-environment jsdom
import React from 'react'
import { renderToString } from 'react-dom/server'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * THE AMENDMENT NOTICE IS DECIDED BY THE CLOCK, IN THE BROWSER.
 *
 * It renders on statically prerendered pages, so anything decided on the server is frozen into HTML
 * (d067d756). These tests pin the properties that keep it honest: nothing in the server markup, shown
 * on the client throughout the window, gone from the in-force instant — plus the in-force date it
 * announces, which comes from LEGAL_AMENDMENT rather than a typed date.
 *
 * ⛔ SINCE 2026-10-01 IT IS NOT MOUNTED: the October 2026 amendment is immediate (owner: "no need for
 * announcement"), so it has no window and the strip would render nothing anyway — pinned below. The
 * window behaviour is tested against a fixture amendment (the dates 110295be shipped), because that is
 * what the next amendment with a window will use it for.
 */

const h = vi.hoisted(() => ({ lang: 'en' as 'en' | 'vi', pathname: '/' }))
vi.mock('next/navigation', () => ({ usePathname: () => h.pathname }))
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}))
vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ lang: h.lang, tr: (en: string, vi?: string) => (h.lang === 'vi' && vi ? vi : en) }),
}))

const WINDOW = { published: '2026-10-01', inForce: '2026-10-07' } as const
const PUBLISHED_AT = Date.parse('2026-10-01T00:00:00+07:00')
const EFFECTIVE_AT = Date.parse('2026-10-07T00:00:00+07:00')

type Strip = typeof import('./tos-change-notice')['TosChangeNotice']

/** The component, loaded against the real LEGAL_AMENDMENT or against the windowed fixture. */
async function load(window: boolean): Promise<Strip> {
  vi.resetModules()
  if (window) {
    vi.doMock('@/lib/compliance/legal-amendment', async (importOriginal) => {
      const real = await importOriginal<typeof import('@/lib/compliance/legal-amendment')>()
      return { ...real, LEGAL_AMENDMENT: WINDOW, AMENDED: real.amendedDates(WINDOW) }
    })
  } else {
    vi.doUnmock('@/lib/compliance/legal-amendment')
  }
  return (await import('./tos-change-notice')).TosChangeNotice
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  h.lang = 'en'
  h.pathname = '/'
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.doUnmock('@/lib/compliance/legal-amendment')
})

async function mountAt(Notice: Strip, at: number) {
  vi.setSystemTime(at)
  let view!: ReturnType<typeof render>
  await act(async () => { view = render(<Notice />) })
  return view.container
}

describe('TosChangeNotice', () => {
  it('renders nothing at any instant for the immediate October 2026 amendment — there is nothing to announce', async () => {
    const Notice = await load(false)
    for (const at of [PUBLISHED_AT - 1, PUBLISHED_AT, Date.parse('2026-10-01T18:00:00+07:00'), EFFECTIVE_AT - 1, EFFECTIVE_AT]) {
      const el = await mountAt(Notice, at)
      expect(el.querySelector('#tos-change-notice'), new Date(at).toISOString()).toBeNull()
      cleanup()
    }
  })

  it('renders nothing on the server, so no prerendered page can freeze it', async () => {
    const Notice = await load(true)
    vi.setSystemTime(EFFECTIVE_AT - 60_000)
    expect(renderToString(<Notice />)).toBe('')
  })

  it('announces the amendment and its in-force date during the window, linking the change log', async () => {
    const el = await mountAt(await load(true), EFFECTIVE_AT - 1)
    const notice = el.querySelector('#tos-change-notice')
    expect(notice?.textContent).toContain('Terms of Service, Operating Regulations, Returns policy and Prohibited items list have been amended')
    expect(notice?.textContent).toContain('take effect on 7 October 2026')
    expect(notice?.querySelector('a')?.getAttribute('href')).toBe('/regulations#changelog')
  })

  it('speaks Vietnamese with the Vietnamese date form', async () => {
    h.lang = 'vi'
    const el = await mountAt(await load(true), EFFECTIVE_AT - 3_600_000)
    expect(el.textContent).toContain('Quy chế hoạt động')
    expect(el.textContent).toContain('có hiệu lực từ ngày 07/10/2026')
  })

  it('is absent before the publication day and gone from midnight Vietnam time on the in-force date', async () => {
    const Notice = await load(true)
    expect((await mountAt(Notice, PUBLISHED_AT - 1)).querySelector('#tos-change-notice')).toBeNull()
    cleanup()
    expect((await mountAt(Notice, EFFECTIVE_AT)).querySelector('#tos-change-notice')).toBeNull()
  })

  it('stays off the chat surface, whose height is computed without it', async () => {
    h.pathname = '/messages/abc'
    const el = await mountAt(await load(true), EFFECTIVE_AT - 1)
    expect(el.querySelector('#tos-change-notice')).toBeNull()
  })
})
