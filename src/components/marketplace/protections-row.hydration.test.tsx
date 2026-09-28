// @vitest-environment jsdom
import * as React from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { hydrateRoot, type Root } from 'react-dom/client'

/**
 * THE REPORTS-AND-DISPUTES ROW WORKS BEFORE HYDRATION (SEO wave B, P0t).
 *
 * The row is in the server HTML, so on a slow phone it is on screen well before React attaches a
 * handler. It used to be a <button>, and a tap in that window did nothing: people tapped twice. Now it
 * is a link to the /safety section that covers the same ground until hydration, and a dialog trigger
 * after it. This file pins the three things that make that true, on the component itself:
 *   1. the SERVER HTML is a plain link (an <a href>, with no button role and no popup state), so a
 *      tap before hydration navigates, and assistive tech hears what the element does;
 *   2. HYDRATION keeps the same DOM node, raises no mismatch, and then makes it a button that opens
 *      a dialog: role, aria-haspopup, aria-expanded;
 *   3. after hydration a CLICK opens the dialog and cancels the navigation, a ⌘, Ctrl or Shift click is
 *      left to the browser (new tab or window) with the dialog shut, an Alt click opens the dialog
 *      (on a link it would download the page), and Space opens it without scrolling the page.
 * What only a real browser can show (the tap before hydration landing on /safety#protection, focus
 * returning on close, Enter on the link) is in e2e/ci/protections-row.spec.ts.
 *
 * ⚠️ EXPLICIT CLEANUP: no vitest `globals`, so Testing Library registers no afterEach of its own.
 */

vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ lang: 'en', tr: (en: string) => en, t: (k: string) => k, setLang: () => {} }),
  useTr: () => (en: string) => en,
  Tr: ({ text, en }: { text?: string; en?: string }) => text ?? en ?? null,
}))

import { ProtectionsRow, PROTECTIONS_FALLBACK_HREF } from './protections-row'

const TITLE = 'How reports and disputes work'
const roots: Root[] = []

afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount())
  cleanup()
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

/** Server-render the row, put that HTML in the document, and return the <a> as the server sent it. */
function serverHtml(inline: boolean) {
  const html = renderToString(<ProtectionsRow inline={inline} />)
  const container = document.createElement('div')
  container.innerHTML = html
  document.body.appendChild(container)
  const row = container.querySelector<HTMLAnchorElement>('[data-protections-row]')
  if (!row) throw new Error('no row in the server HTML')
  return { html, container, row }
}

/** Hydrate the server HTML, collecting every recoverable error (a hydration mismatch is one). */
async function hydrate(container: HTMLElement, inline: boolean) {
  const recoverable: unknown[] = []
  const consoleErrors: string[] = []
  vi.spyOn(console, 'error').mockImplementation((...args) => { consoleErrors.push(args.map(String).join(' ')) })
  await act(async () => {
    roots.push(hydrateRoot(container, <ProtectionsRow inline={inline} />, {
      onRecoverableError: (e) => { recoverable.push(e) },
    }))
  })
  return { recoverable, consoleErrors }
}

/**
 * Click the row and return whether the APP cancelled the click (and so the link's navigation). A window
 * listener runs after React's root listener: it reads that verdict, then cancels the default itself, so
 * jsdom never attempts a navigation it cannot perform ("Not implemented: navigation to another Document").
 */
async function click(row: HTMLElement, init?: MouseEventInit) {
  let appCancelled = false
  const verdict = (e: Event) => { appCancelled = e.defaultPrevented; e.preventDefault() }
  window.addEventListener('click', verdict)
  try {
    await act(async () => { fireEvent.click(row, init) })
  } finally {
    window.removeEventListener('click', verdict)
  }
  return appCancelled
}

describe('reports-and-disputes row: a link until hydration, a dialog trigger after it (P0t)', () => {
  for (const inline of [true, false]) {
    describe(inline ? 'inline (the listing page)' : 'standalone', () => {
      it('the server HTML is a plain link to /safety#protection, with no button or popup semantics', () => {
        const { row } = serverHtml(inline)
        expect(row.tagName).toBe('A')
        expect(row.getAttribute('href')).toBe('/safety#protection')
        for (const attr of ['role', 'aria-haspopup', 'aria-expanded', 'aria-controls', 'type']) {
          expect(row.hasAttribute(attr), attr).toBe(false)
        }
        // The words a tap target is found by, and nothing else, are its accessible name.
        expect(row.textContent).toBe('Reports & disputes — how they work')
      })

      it('hydrates onto the same node with no mismatch, then becomes a button that opens a dialog', async () => {
        const { container, row } = serverHtml(inline)
        const before = row.outerHTML
        const { recoverable, consoleErrors } = await hydrate(container, inline)
        expect(recoverable).toEqual([])
        expect(consoleErrors.filter((m) => /hydrat|did not match|mismatch/i.test(m))).toEqual([])
        const after = container.querySelector('[data-protections-row]')
        expect(after).toBe(row)
        expect(row.getAttribute('href')).toBe('/safety#protection')
        expect(row.getAttribute('role')).toBe('button')
        expect(row.getAttribute('aria-haspopup')).toBe('dialog')
        expect(row.getAttribute('aria-expanded')).toBe('false')
        // Only the semantics changed: the classes (and so the box) are the server's, byte for byte.
        expect(row.className).toBe(new DOMParser().parseFromString(before, 'text/html').body.firstElementChild!.className)
      })
    })
  }

  it('after hydration a click opens the dialog and cancels the navigation', async () => {
    const { container, row } = serverHtml(true)
    await hydrate(container, true)
    expect(await click(row)).toBe(true)
    expect(screen.getByRole('dialog', { name: TITLE })).toBeTruthy()
    expect(row.getAttribute('aria-expanded')).toBe('true')
  })

  for (const mod of ['metaKey', 'ctrlKey', 'shiftKey'] as const) {
    it(`a ${mod} click is left to the browser (a new tab or window) and the dialog stays shut`, async () => {
      const { container, row } = serverHtml(true)
      await hydrate(container, true)
      expect(await click(row, { [mod]: true })).toBe(false)
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(row.getAttribute('aria-expanded')).toBe('false')
    })
  }

  it('an altKey click opens the dialog like a plain one (on a link, Alt-click would download the page)', async () => {
    const { container, row } = serverHtml(true)
    await hydrate(container, true)
    expect(await click(row, { altKey: true })).toBe(true)
    expect(screen.getByRole('dialog', { name: TITLE })).toBeTruthy()
  })

  it('Space opens the dialog without scrolling the page (its keydown is cancelled)', async () => {
    const { container, row } = serverHtml(true)
    await hydrate(container, true)
    row.focus()
    let keydownNotCancelled = true
    await act(async () => { keydownNotCancelled = fireEvent.keyDown(row, { key: ' ', code: 'Space' }) })
    expect(keydownNotCancelled).toBe(false)
    await act(async () => { fireEvent.keyUp(row, { key: ' ', code: 'Space' }) })
    expect(screen.getByRole('dialog', { name: TITLE })).toBeTruthy()
  })

  it('a client-side mount (a soft navigation, no server HTML) is a button from its first render', () => {
    render(<ProtectionsRow inline />)
    const row = document.querySelector('[data-protections-row]')!
    expect(row.getAttribute('role')).toBe('button')
    expect(row.getAttribute('href')).toBe('/safety#protection')
  })

  it('the fallback is the /safety section that covers the same ground, and that section keeps its id', () => {
    expect(PROTECTIONS_FALLBACK_HREF).toBe('/safety#protection')
    const safety = readFileSync(join(process.cwd(), 'src/app/[lang]/safety/page.tsx'), 'utf8')
    expect(safety).toMatch(/<ContentSection id="protection"/)
  })
})
