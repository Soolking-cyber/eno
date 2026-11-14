// @vitest-environment jsdom
import * as React from 'react'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { renderToString } from 'react-dom/server'

/**
 * THE HOME PAGE'S PARTNER STRIP (owner, 2026-11-09). Pins what makes it work as a strip: one still row from the server,
 * the second copy for the seamless -50% loop added in the browser (the top copy only: the phone's feed copy holds still,
 * owner 2026-11-14), hidden from screen readers and out of the tab order, every link going to the
 * partner's own storefront, both languages' one-word labels, the edition rule (eno.forum leaves out the visa and travel
 * partners that compete with its own desk), and logos that exist at the size the markup promises (no layout shift).
 */

let LANG = 'en'
vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ lang: LANG, tr: (en: string, vi?: string) => (LANG === 'vi' && vi != null ? vi : en) }),
  useTr: () => (en: string) => en,
  Tr: ({ text }: { text: string }) => text,
}))

import { PartnerStrip } from './partner-strip'
import { PARTNER_STRIP, stripPartners } from '@/lib/partner-strip'

const html = () => renderToString(<PartnerStrip />)

describe('PartnerStrip', () => {
  it('sends each partner ONCE from the server, as a still row (the loop copy is added after hydration)', () => {
    const out = html()
    const n = stripPartners().length
    expect(out.match(/<li class="partner-strip-item"/g)?.length).toBe(n)
    expect(out).not.toContain('data-copy="1"')
    expect(out).not.toContain('data-loop')
    expect(out).not.toContain('aria-hidden="true"')
  })

  it('in the browser fills two equal halves of three rosters each, every repeat hidden from assistive tech and the keyboard', async () => {
    const { createRoot } = await import('react-dom/client')
    const { act } = await import('react')
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    await act(async () => { root.render(<PartnerStrip />) })
    const n = stripPartners().length
    // 2 halves × 3 rosters: each half wider than the band, so the -50% loop never shows a gap (review 2026-11-09).
    expect(host.querySelectorAll('li.partner-strip-item').length).toBe(n * 6)
    const repeats = host.querySelectorAll('li[data-copy="1"]')
    expect(repeats.length).toBe(n * 5)
    for (const li of repeats) {
      expect(li.getAttribute('aria-hidden')).toBe('true')
      expect(li.querySelector('a')?.getAttribute('tabindex')).toBe('-1')
    }
    // Exactly one reachable link per partner.
    expect(host.querySelectorAll('a.partner-strip-link:not([tabindex="-1"])').length).toBe(n)
    const track = host.querySelector('.partner-strip-track') as HTMLElement
    expect(track.hasAttribute('data-loop')).toBe(true)
    expect(track.style.getPropertyValue('--partner-strip-duration')).toMatch(/^\d+s$/)
    await act(async () => { root.unmount() })
    host.remove()
  })

  it('can be paused and resumed with a real toggle button (WCAG 2.2.2), which the server never renders', async () => {
    expect(html()).not.toContain('partner-strip-pause')
    const { createRoot } = await import('react-dom/client')
    const { act } = await import('react')
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    await act(async () => { root.render(<PartnerStrip />) })
    const button = host.querySelector('button.partner-strip-pause') as HTMLButtonElement
    const track = host.querySelector('.partner-strip-track') as HTMLElement
    expect(button.getAttribute('aria-pressed')).toBe('false')
    expect(button.getAttribute('aria-label')).toBe('Pause the partner logos')
    expect(track.hasAttribute('data-paused')).toBe(false)
    await act(async () => { button.click() })
    expect(button.getAttribute('aria-pressed')).toBe('true')
    expect(button.getAttribute('aria-label')).toBe('Play the partner logos')
    expect(track.hasAttribute('data-paused')).toBe(true)
    await act(async () => { button.click() })
    expect(track.hasAttribute('data-paused')).toBe(false)
    await act(async () => { root.unmount() })
    host.remove()
  })

  it('⛔ the feed copy never loops, even where matchMedia is missing (jsdom): the phone band holds still (owner 2026-11-14)', async () => {
    expect(typeof window.matchMedia).not.toBe('function')
    const { createRoot } = await import('react-dom/client')
    const { act } = await import('react')
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    await act(async () => { root.render(<PartnerStrip placement="feed" />) })
    expect(host.querySelectorAll('li.partner-strip-item').length).toBe(stripPartners().length)
    expect(host.querySelector('.partner-strip-track')!.hasAttribute('data-loop')).toBe(false)
    expect(host.querySelector('.partner-strip-pause')).toBeNull()
    await act(async () => { root.unmount() })
    host.remove()
  })

  it("a blur on the still feed copy keeps the visitor's hand scroll; the looping top copy still goes back to 0", async () => {
    const { createRoot } = await import('react-dom/client')
    const { act } = await import('react')
    for (const [placement, after] of [['feed', 120], ['top', 0]] as const) {
      const host = document.createElement('div')
      document.body.append(host)
      const root = createRoot(host)
      await act(async () => { root.render(<PartnerStrip placement={placement} />) })
      const viewport = host.querySelector('.partner-strip-viewport') as HTMLElement
      // jsdom keeps no scroll offset, so give the viewport one it remembers, as a swipe would leave behind.
      Object.defineProperty(viewport, 'scrollLeft', { value: 120, writable: true, configurable: true })
      const link = viewport.querySelector('a.partner-strip-link') as HTMLElement
      await act(async () => { link.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null })) })
      expect({ placement, scrollLeft: viewport.scrollLeft }).toEqual({ placement, scrollLeft: after })
      await act(async () => { root.unmount() })
      host.remove()
    }
  })

  it("links each partner to its own storefront, named by its logo's alt and its one word", () => {
    const out = html()
    for (const p of stripPartners()) {
      expect(out).toContain(`href="/${p.handle}"`)
      expect(out).toContain(`alt="${p.name}"`)
      expect(out).toContain(`>${p.label.en}<`)
    }
  })

  it('labels the band and the partners in Vietnamese on /vi', () => {
    LANG = 'vi'
    try {
      const out = html()
      expect(out).toContain('aria-label="Đối tác của eno"')
      expect(out).toContain('>Đối tác<')
      expect(out).toContain('>Chuyển nhà<')
    } finally {
      LANG = 'en'
    }
  })
})

describe('the partner roster', () => {
  it('has unique handles and one-word English labels', () => {
    const handles = PARTNER_STRIP.map((p) => p.handle)
    expect(new Set(handles).size).toBe(handles.length)
    for (const p of PARTNER_STRIP) expect(p.label.en).toMatch(/^[\w-]+$/)
  })

  it('leaves the visa partner off eno.forum, keeps every marketplace partner on both, and no longer lists GMBR', () => {
    expect(stripPartners(true).map((p) => p.handle)).toEqual(['goplus', 'blvck', 'saigonmoving', 'vinwonders'])
    expect(PARTNER_STRIP.map((p) => p.handle)).not.toContain('gmbr')
    expect(stripPartners(false).map((p) => p.handle)).toEqual(PARTNER_STRIP.map((p) => p.handle))
  })

  it('points at logo files that exist, with the dimensions the markup declares', () => {
    for (const p of PARTNER_STRIP) {
      const file = join(process.cwd(), 'public', p.logo.src)
      expect(existsSync(file), p.logo.src).toBe(true)
      // WebP VP8X header: canvas width-1 and height-1 as 24-bit little-endian at bytes 24 and 27.
      const b = readFileSync(file)
      expect(b.subarray(0, 4).toString()).toBe('RIFF')
      expect(b.subarray(12, 16).toString()).toBe('VP8X')
      const w = 1 + b.readUIntLE(24, 3)
      const h = 1 + b.readUIntLE(27, 3)
      expect({ handle: p.handle, w, h }).toEqual({ handle: p.handle, w: p.logo.width, h: p.logo.height })
    }
  })
})
