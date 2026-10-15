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
 * ⛔ THE TERMS' VERSION 3 IS IMMEDIATE (owner, 2026-10-07: "Immediately (Recommended)" — in force on its
 * publication day, no window, no announcement; the 2026-10-01 precedent), so the strip says nothing about it —
 * pinned below against the real LEGAL_AMENDMENT, and October's immediate amendment against its own dates. The
 * Terms window behaviour is tested against a fixture amendment (the dates 110295be shipped).
 * /prohibited's OWN AMENDMENT (owner, 2026-10-14 — PROHIBITED_AMENDMENT) shipped with a window, announced on eno.vn only —
 * tested on the same fixture window — and was made IMMEDIATE the day it went live (owner, 2026-10-15: "apply from now no
 * need for warning"), pinned against the real record. The edition is stubbed per load (default: eno.forum, where nothing
 * about /prohibited shows).
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

/**
 * The component, loaded against the real LEGAL_AMENDMENT (`true` → the windowed fixture, or a given record), and the
 * real PROHIBITED_AMENDMENT unless `opts.prohibited` gives one — on eno.forum unless `opts.edition` says otherwise.
 */
async function load(window: boolean | Amendment, opts: { prohibited?: Amendment; edition?: 'marketplace' | 'services' } = {}): Promise<Strip> {
  vi.resetModules()
  vi.stubEnv('NEXT_PUBLIC_ENO_EDITION', opts.edition ?? 'services')
  const record = window === true ? WINDOW : window || null
  if (record || opts.prohibited) {
    vi.doMock('@/lib/compliance/legal-amendment', async (importOriginal) => {
      const real = await importOriginal<typeof import('@/lib/compliance/legal-amendment')>()
      return {
        ...real,
        ...(record ? { LEGAL_AMENDMENT: record, AMENDED: real.amendedDates(record) } : {}),
        ...(opts.prohibited ? { PROHIBITED_AMENDMENT: opts.prohibited, PROHIBITED_AMENDED: real.amendedDates(opts.prohibited) } : {}),
      }
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
  vi.unstubAllEnvs()
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

// ⛔ /prohibited's own amendment (owner, 2026-10-14: the e-Visa rules join eno.vn's list, with 5 days' notice).
describe('TosChangeNotice — the /prohibited amendment, on eno.vn', () => {
  const SENTENCE = 'The list of prohibited items and services on eno.vn has been amended. The changes take effect on 7 October 2026.'

  it('announces it on eno.vn throughout its window, linking the e-Visa section — not the Terms', async () => {
    const Notice = await load(false, { prohibited: WINDOW, edition: 'marketplace' })
    for (const at of [PUBLISHED_AT, Date.parse('2026-10-03T12:00:00+07:00'), EFFECTIVE_AT - 1]) {
      const notice = (await mountAt(Notice, at)).querySelector('#tos-change-notice')
      expect(notice?.textContent, new Date(at).toISOString()).toContain(SENTENCE)
      expect(notice?.textContent).not.toContain('Our Terms')
      expect(notice?.querySelector('a')?.getAttribute('href')).toBe('/prohibited#visa-services')
      cleanup()
    }
  })

  it('speaks Vietnamese with the Vietnamese date form', async () => {
    h.lang = 'vi'
    const el = await mountAt(await load(false, { prohibited: WINDOW, edition: 'marketplace' }), EFFECTIVE_AT - 3_600_000)
    expect(el.textContent).toContain('Danh mục hàng hóa và dịch vụ cấm đăng trên eno.vn đã được sửa đổi')
    expect(el.textContent).toContain('có hiệu lực từ ngày 07/10/2026')
  })

  it('is absent outside the window, on /messages, and on the server', async () => {
    const Notice = await load(false, { prohibited: WINDOW, edition: 'marketplace' })
    expect((await mountAt(Notice, PUBLISHED_AT - 1)).querySelector('#tos-change-notice')).toBeNull()
    cleanup()
    expect((await mountAt(Notice, EFFECTIVE_AT)).querySelector('#tos-change-notice')).toBeNull()
    cleanup()
    h.pathname = '/messages/abc'
    expect((await mountAt(Notice, EFFECTIVE_AT - 1)).querySelector('#tos-change-notice')).toBeNull()
    vi.setSystemTime(EFFECTIVE_AT - 60_000)
    expect(renderToString(<Notice />)).toBe('')
  })

  // eno.forum has carried these rules since August: nothing binds anew there, so nothing is announced.
  it('says nothing on eno.forum, mid-window', async () => {
    const el = await mountAt(await load(false, { prohibited: WINDOW, edition: 'services' }), Date.parse('2026-10-03T12:00:00+07:00'))
    expect(el.querySelector('#tos-change-notice')).toBeNull()
  })

  // codex, plan review: the clock was re-read only on mount and navigation, so a page left open over midnight kept
  // the strip after the change took effect. It now re-decides at the window's edge on the same mounted page.
  it('removes itself at the in-force instant on a page left open, with no navigation', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    const Notice = await load(false, { prohibited: WINDOW, edition: 'marketplace' })
    const el = await mountAt(Notice, EFFECTIVE_AT - 60_000)
    expect(el.querySelector('#tos-change-notice')).not.toBeNull()
    await act(async () => { vi.advanceTimersByTime(2 * 60_000) })
    expect(el.querySelector('#tos-change-notice')).toBeNull()
  })

  it('appears at the publication instant on a page opened the evening before', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    const Notice = await load(false, { prohibited: WINDOW, edition: 'marketplace' })
    const el = await mountAt(Notice, PUBLISHED_AT - 3 * 3_600_000)
    expect(el.querySelector('#tos-change-notice')).toBeNull()
    await act(async () => { vi.advanceTimersByTime(3 * 3_600_000 + 5_000) })
    expect(el.querySelector('#tos-change-notice')?.textContent).toContain(SENTENCE)
  })

  it('against the real record: immediate (owner, 2026-10-15) — nothing on eno.vn at any instant', async () => {
    const { PROHIBITED_AMENDMENT } = await import('@/lib/compliance/legal-amendment')
    expect(PROHIBITED_AMENDMENT.immediate).toBe(true)
    const Notice = await load(false, { edition: 'marketplace' })
    for (const at of [`${PROHIBITED_AMENDMENT.published}T00:00:00+07:00`, `${PROHIBITED_AMENDMENT.published}T12:00:00+07:00`, '2026-10-20T12:00:00+07:00']) {
      expect((await mountAt(Notice, Date.parse(at))).querySelector('#tos-change-notice'), at).toBeNull()
      cleanup()
    }
  })
})
