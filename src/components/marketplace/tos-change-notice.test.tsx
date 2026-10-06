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
 * ⛔ NOT MOUNTED: the Terms' version 3 is immediate (owner, 2026-10-07: "Immediately (Recommended)" — in force
 * on its publication day, no window, no announcement; the 2026-10-01 precedent), so the strip would render
 * nothing anyway — pinned below against the real LEGAL_AMENDMENT, and October's immediate amendment against its
 * own dates. The window behaviour is tested against a fixture amendment (the dates 110295be shipped), because
 * that is what the next amendment with a window will use it for.
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
/** October's immediate amendment — the owner's waiver: in force the day it was published, nothing to announce. */
const IMMEDIATE = { published: '2026-10-01', inForce: '2026-10-01', immediate: true } as const

type Strip = typeof import('./tos-change-notice')['TosChangeNotice']
type Amendment = import('@/lib/compliance/legal-amendment').LegalAmendment

/** The component, loaded against the real LEGAL_AMENDMENT (`true` → the windowed fixture, or a given record). */
async function load(window: boolean | Amendment): Promise<Strip> {
  vi.resetModules()
  const record = window === true ? WINDOW : window || null
  if (record) {
    vi.doMock('@/lib/compliance/legal-amendment', async (importOriginal) => {
      const real = await importOriginal<typeof import('@/lib/compliance/legal-amendment')>()
      return { ...real, LEGAL_AMENDMENT: record, AMENDED: real.amendedDates(record) }
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
  // The real record: the Terms' version 3, immediate (owner, 2026-10-07) — published and in force 07/10/2026.
  it('renders nothing at any instant for the Terms’ version 3 — immediate, there is nothing to announce', async () => {
    const Notice = await load(false)
    for (const local of ['2026-10-06T23:59:59', '2026-10-07T00:00:00', '2026-10-07T18:00:00', '2026-10-12T23:59:59', '2026-10-13T00:00:00']) {
      const el = await mountAt(Notice, Date.parse(`${local}+07:00`))
      expect(el.querySelector('#tos-change-notice'), local).toBeNull()
      cleanup()
    }
  })

  it('renders nothing at any instant for an immediate amendment — there is nothing to announce', async () => {
    const Notice = await load(IMMEDIATE)
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

  // Throughout the window — from the first instant of the publication day (Vietnam time) to the last before the
  // in-force one — the whole sentence with the in-force date, linking the Terms' change log.
  it('announces the amendment and its in-force date throughout the window, linking the change log', async () => {
    const Notice = await load(true)
    for (const at of [PUBLISHED_AT, Date.parse('2026-10-03T12:00:00+07:00'), EFFECTIVE_AT - 1]) {
      const notice = (await mountAt(Notice, at)).querySelector('#tos-change-notice')
      expect(notice?.textContent, new Date(at).toISOString()).toContain('Our Terms of Service have been amended. The changes take effect on 7 October 2026.')
      expect(notice?.querySelector('a')?.getAttribute('href')).toBe('/terms#changes')
      cleanup()
    }
  })

  it('speaks Vietnamese with the Vietnamese date form', async () => {
    h.lang = 'vi'
    const el = await mountAt(await load(true), EFFECTIVE_AT - 3_600_000)
    expect(el.textContent).toContain('Điều khoản dịch vụ đã được sửa đổi')
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
