// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { hydrateRoot, type Root } from 'react-dom/client'

/**
 * THE PROVENANCE LINE HYDRATES WITHOUT A MISMATCH (SEO wave B, P1).
 *
 * The listing page is one ISR-cached HTML for 30 days, and this line prints a DATE in its first client
 * render — the classic React #418 on this page. It is safe only because the language is seeded the
 * same on both sides and the day is string arithmetic in Vietnam time. This renders on the "server",
 * hydrates that HTML in the "browser", and requires zero recoverable errors, in both languages and at
 * the 17:30Z boundary where a UTC slice and a Vietnam day disagree.
 *
 * ⚠️ EXPLICIT CLEANUP: no vitest `globals`, so Testing Library registers no afterEach of its own.
 */

let LANG = 'en'
vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ lang: LANG, tr: (en: string, vi?: string) => (LANG === 'vi' && vi != null ? vi : en), t: (k: string) => k, setLang: () => {} }),
}))

import { ImportProvenance } from './import-provenance'

const roots: Root[] = []
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount())
  cleanup()
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

const HREF = 'https://www.nhatot.com/thue-can-ho-quan-7/123.htm'

async function serverThenHydrate(el: React.ReactElement) {
  const container = document.createElement('div')
  container.innerHTML = renderToString(el)
  document.body.appendChild(container)
  const before = container.innerHTML
  const recoverable: unknown[] = []
  const consoleErrors: string[] = []
  vi.spyOn(console, 'error').mockImplementation((...args) => { consoleErrors.push(args.map(String).join(' ')) })
  await act(async () => {
    roots.push(hydrateRoot(container, el, { onRecoverableError: (e) => { recoverable.push(e) } }))
  })
  return { container, before, recoverable, consoleErrors }
}

describe('ImportProvenance: server HTML, then hydration', () => {
  for (const lang of ['en', 'vi']) {
    it(`${lang}: the source-dated line at the 17:30Z day boundary hydrates with no mismatch`, async () => {
      LANG = lang
      const { container, before, recoverable, consoleErrors } = await serverThenHydrate(
        <ImportProvenance kind="source-date" site="Nhatot.com" iso="2026-09-12T17:30:00.000Z" href={HREF} />,
      )
      expect(recoverable).toEqual([])
      expect(consoleErrors.filter((m) => /hydrat|did not match|mismatch/i.test(m))).toEqual([])
      expect(container.innerHTML).toBe(before)

      const p = container.querySelector('[data-import-provenance]')!
      const time = p.querySelector('time')!
      expect(time.getAttribute('dateTime')).toBe('2026-09-13')
      expect(time.textContent).toBe(lang === 'vi' ? '13/9/2026' : '13 Sep 2026')
      expect(p.textContent).toBe(lang === 'vi'
        ? 'Nguồn: Nhatot.com · đăng ngày 13/9/2026 · tin gốc (mở trong tab mới)'
        : 'Source: Nhatot.com · posted there on 13 Sep 2026 · original ad (opens in a new tab)')
    })
  }

  it('the link is the CTA\'s: same href, new tab, the same rel, a positioned 44px hit area', async () => {
    LANG = 'en'
    const { container } = await serverThenHydrate(<ImportProvenance kind="import-date" site="Rever.vn" iso="2026-09-25T05:00:00Z" href={HREF} />)
    const a = container.querySelector<HTMLAnchorElement>('[data-import-provenance] a')!
    expect(a.getAttribute('href')).toBe(HREF)
    expect(a.getAttribute('target')).toBe('_blank')
    expect(a.getAttribute('rel')).toBe('sponsored nofollow noopener noreferrer')
    expect(a.className).toMatch(/(^| )relative( |$)/)
    expect(a.className).toMatch(/(^| )tap-44( |$)/)
    expect(a.querySelector('.sr-only')!.textContent).toBe(' (opens in a new tab)')
  })

  it('a retail item prints no <time>', async () => {
    LANG = 'vi'
    const { container } = await serverThenHydrate(<ImportProvenance kind="retail" site="FPT Shop" iso={null} href="https://fptshop.com.vn/x/y" />)
    const p = container.querySelector('[data-import-provenance]')!
    expect(p.querySelector('time')).toBeNull()
    expect(p.textContent).toBe('Nguồn: website của FPT Shop · trang gốc (mở trong tab mới)')
  })

  it('an unreadable date renders nothing at all', async () => {
    LANG = 'en'
    const { container } = await serverThenHydrate(<ImportProvenance kind="source-date" site="Nhatot.com" iso="not a date" href={HREF} />)
    expect(container.querySelector('[data-import-provenance]')).toBeNull()
  })
})
