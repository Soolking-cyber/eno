// @vitest-environment jsdom
/**
 * THE PARTNER BAND'S TWO PLACEMENTS (owner, 2026-11-10: item 5 of the decision scorecard). On a phone the band is a row
 * of the home feed, not the first thing under the header; from `sm` up it is where it was. One component, two mounts,
 * each shown at its own widths by a class, both in the server's HTML:
 *   · `top`  → `max-sm:hidden`, and nothing that marks it as a feed row;
 *   · `feed` → `sm:hidden col-span-full`, `data-partner-band` (the hook globals.css uses to take it out of a directed
 *     cold link's masked seed and to count it among the grid's first children), and no page gutter of its own.
 * Only the copy on screen at the current width runs the loop: the other stays the one still row the server sent, so a
 * hidden band never holds six rosters of logos in the DOM.
 */
import * as React from 'react'
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToString } from 'react-dom/server'

vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ lang: 'en', tr: (en: string) => en }),
  useTr: () => (en: string) => en,
  Tr: ({ text }: { text: string }) => text,
}))

import { PartnerStrip } from './partner-strip'
import { stripPartners } from '@/lib/partner-strip'

const CSS = readFileSync('src/app/globals.css', 'utf8')
const sectionClass = (html: string) => /<section[^>]*class="([^"]*)"/.exec(html)![1].split(' ')

/** A browser at this width: `(min-width: 40rem)` answers for 640px and up. */
function atWidth(px: number) {
  const listeners = new Set<() => void>()
  const mq = { matches: px >= 640, addEventListener: (_: string, fn: () => void) => listeners.add(fn), removeEventListener: (_: string, fn: () => void) => listeners.delete(fn) }
  vi.stubGlobal('matchMedia', (q: string) => { expect(q).toBe('(min-width: 40rem)'); return mq })
  return { set: (w: number) => { mq.matches = w >= 640; for (const fn of listeners) fn() } }
}

async function mount(placement: 'top' | 'feed') {
  const { createRoot } = await import('react-dom/client')
  const { act } = await import('react')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => { root.render(<PartnerStrip placement={placement} />) })
  return { host, act, done: async () => { await act(async () => { root.unmount() }); host.remove() } }
}

afterEach(() => { vi.unstubAllGlobals() })

describe('the two placements, from the server', () => {
  it('top: hidden below sm, the full-width band it always was', () => {
    const html = renderToString(<PartnerStrip />)
    expect(sectionClass(html)).toEqual(['partner-strip', 'max-sm:hidden'])
    expect(html).not.toContain('data-partner-band')
    expect(html).toContain('max-w-7xl')
  })

  it('feed: a full-width grid row shown below sm only, marked for the stylesheet, with no gutter of its own', () => {
    const html = renderToString(<PartnerStrip placement="feed" />)
    expect(sectionClass(html)).toEqual(['partner-strip', 'partner-strip-feed', 'col-span-full', 'sm:hidden'])
    expect(html).toContain('data-partner-band=""')
    expect(html).not.toContain('max-w-7xl')
    expect(html).not.toMatch(/class="[^"]*\bpx-3\b/)
  })

  it('each sends every partner once, as one still row', () => {
    for (const placement of ['top', 'feed'] as const) {
      const html = renderToString(<PartnerStrip placement={placement} />)
      expect(html.match(/<li class="partner-strip-item"/g)?.length).toBe(stripPartners().length)
      expect(html).not.toContain('data-loop')
    }
  })
})

describe('only the copy on screen runs the loop', () => {
  const n = () => stripPartners().length
  it('on a phone: the feed copy loops, the top copy stays one still row with no pause button', async () => {
    atWidth(390)
    const feed = await mount('feed')
    expect(feed.host.querySelectorAll('li.partner-strip-item').length).toBe(n() * 6)
    expect(feed.host.querySelector('.partner-strip-pause')).not.toBeNull()
    await feed.done()
    const top = await mount('top')
    expect(top.host.querySelectorAll('li.partner-strip-item').length).toBe(n())
    expect(top.host.querySelector('.partner-strip-track')!.hasAttribute('data-loop')).toBe(false)
    expect(top.host.querySelector('.partner-strip-pause')).toBeNull()
    await top.done()
  })

  it('from sm up: the other way round', async () => {
    atWidth(1280)
    const top = await mount('top')
    expect(top.host.querySelectorAll('li.partner-strip-item').length).toBe(n() * 6)
    await top.done()
    const feed = await mount('feed')
    expect(feed.host.querySelectorAll('li.partner-strip-item').length).toBe(n())
    await feed.done()
  })

  it('follows the window across the breakpoint', async () => {
    const win = atWidth(390)
    const feed = await mount('feed')
    expect(feed.host.querySelectorAll('li.partner-strip-item').length).toBe(n() * 6)
    await feed.act(async () => { win.set(800) })
    expect(feed.host.querySelectorAll('li.partner-strip-item').length).toBe(n())
    await feed.act(async () => { win.set(390) })
    expect(feed.host.querySelectorAll('li.partner-strip-item').length).toBe(n() * 6)
    await feed.done()
  })

  it('⛔ the top copy has no repeat below sm, at load or after a desktop window is narrowed: its repeats are plain eager images', async () => {
    // A repeat is `<img src=logo>` with no media query of its own, so one that existed on a phone would be fetched.
    const win = atWidth(1280)
    const top = await mount('top')
    expect(top.host.querySelectorAll('li[data-copy="1"]').length).toBe(n() * 5)
    await top.act(async () => { win.set(390) })
    expect(top.host.querySelectorAll('li[data-copy="1"]').length).toBe(0)
    // Only the server's row is left, and its images are lazy: in a hidden band they are not fetched.
    expect([...top.host.querySelectorAll('li img')].every((img) => img.getAttribute('loading') === 'lazy')).toBe(true)
    await top.done()
  })
})

/**
 * ⛔ A PHONE NEVER FETCHES THE TOP COPY'S LOGOS; A DESKTOP PRELOADS THEM AHEAD OF THE CSS (speed plan R26; why and the
 * three measured versions: PartnerItem). Both copies send `<img loading="lazy">`: React preloads no lazy image, and one
 * inside a hidden band is never fetched. The top copy adds its own preload per logo, with the band's media query and
 * high priority: without the priority React writes the link after the stylesheets and the logos miss the first frame.
 */
describe('a phone never fetches the top copy, and a desktop preloads it ahead of the stylesheets', () => {
  const logos = () => stripPartners().map((p) => p.logo.src)
  const imgs = (html: string) => html.match(/<img\b[^>]*>/g) ?? []
  const attr = (tag: string, name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1]
  const preloads = (html: string) => html.match(/<link\b[^>]*rel="preload"[^>]*>/g) ?? []

  it('⛔ top: one preload per logo, fetched only from sm up and at high priority; feed: none', () => {
    const top = preloads(renderToString(<PartnerStrip />))
    expect(top.map((l) => [attr(l, 'href'), attr(l, 'as'), attr(l, 'media'), attr(l, 'fetchPriority')])).toEqual(
      logos().map((src) => [src, 'image', '(min-width: 40rem)', 'high']))
    expect(renderToString(<PartnerStrip placement="feed" />)).not.toContain('rel="preload"')
  })

  it('⛔ in a whole document the logo preloads come BEFORE the stylesheet, each with the sm-up media', () => {
    // React writes the `<head>` itself when the tree is a whole document: high-priority image preloads first, then the
    // stylesheets, then everything else. A preload without the priority lands in that last group (after the CSS and
    // every script tag), which measured as 0 of 5 logos in the first painted frame.
    // createElement, not JSX: the Next lint rules about a literal <head> and stylesheet link are for app code.
    const sheetLink = React.createElement('link', { rel: 'stylesheet', href: '/app.css', precedence: 'default' })
    const page = renderToString(
      React.createElement('html', null,
        React.createElement('head', null, sheetLink),
        React.createElement('body', null, <PartnerStrip />, <PartnerStrip placement="feed" />)),
    )
    const head = page.slice(0, page.indexOf('</head>'))
    const links: string[] = head.match(/<link\b[^>]*>/g) ?? []
    const partnerLinks = links.filter((l) => l.includes('/partners/'))
    expect(partnerLinks.map((l) => [attr(l, 'href'), attr(l, 'media')])).toEqual(logos().map((src) => [src, '(min-width: 40rem)']))
    const sheet = links.findIndex((l) => l.includes('rel="stylesheet"'))
    expect(sheet).toBeGreaterThan(-1)
    for (const l of partnerLinks) expect(links.indexOf(l)).toBeLessThan(sheet)
  })

  it('both copies: a plain lazy <img> per logo from the server (nothing a phone fetches for a hidden band), alt and size kept', () => {
    for (const placement of ['top', 'feed'] as const) {
      const html = renderToString(<PartnerStrip placement={placement} />)
      // ⛔ Not a <picture> over a blank image: WebKit downloaded every logo twice with one.
      expect(html).not.toContain('<picture')
      expect(html).not.toContain('data:image')
      expect(imgs(html).map((img) => [attr(img, 'src'), attr(img, 'loading'), attr(img, 'alt'), attr(img, 'width'), attr(img, 'height')])).toEqual(
        stripPartners().map((p) => [p.logo.src, 'lazy', p.name, String(p.logo.width), String(p.logo.height)]))
    }
  })

  it('in the browser the repeats of the copy that loops are eager, so the loop never slides in a logo still to be fetched', async () => {
    for (const [width, placement] of [[390, 'feed'], [1280, 'top']] as const) {
      atWidth(width)
      const band = await mount(placement)
      const first = [...band.host.querySelectorAll('li[data-copy="0"] > a > span > img')]
      const repeats = [...band.host.querySelectorAll('li[data-copy="1"] > a > span > img')]
      expect(first.map((img) => img.getAttribute('loading'))).toEqual(stripPartners().map(() => 'lazy'))
      expect(repeats).toHaveLength(stripPartners().length * 5)
      expect(repeats.every((img) => !img.hasAttribute('loading'))).toBe(true)
      expect(repeats.slice(0, stripPartners().length).map((img) => img.getAttribute('src'))).toEqual(logos())
      await band.done()
    }
  })

  it('hydrates the server row of either copy without a mismatch', async () => {
    const { hydrateRoot } = await import('react-dom/client')
    const { act } = await import('react')
    atWidth(1280)
    // React's own test-environment flag, so the only console errors left are what hydration reports.
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const recovered: unknown[] = []
    try {
      for (const placement of ['top', 'feed'] as const) {
        const host = document.createElement('div')
        host.innerHTML = renderToString(<PartnerStrip placement={placement} />)
        document.body.append(host)
        const served = [...host.querySelectorAll('img')]
        expect(served).toHaveLength(stripPartners().length)
        let root: ReturnType<typeof hydrateRoot> | undefined
        await act(async () => { root = hydrateRoot(host, <PartnerStrip placement={placement} />, { onRecoverableError: (e) => recovered.push(e) }) })
        // Hydrated in place: the server's img nodes were adopted, not thrown away for a client render.
        expect(served.every((img) => host.contains(img))).toBe(true)
        await act(async () => { root!.unmount() })
        host.remove()
      }
      expect(recovered).toEqual([])
      expect(error).not.toHaveBeenCalled()
    } finally {
      error.mockRestore()
    }
  })
})

describe('the stylesheet side', () => {
  it('takes the feed row out of a directed cold link from the first frame, with display, not visibility', () => {
    const rule = /html\[data-explorer-directed\] #listings \.feed-grid > \[data-partner-band\] \{\s*display: none;\s*\}/
    expect(CSS).toMatch(rule)
  })

  it('counts thirteen first children of the feed grid, so the twelfth card is still never skipped', () => {
    expect(CSS).toContain('.feed-grid > *:nth-child(-n + 13) [data-feed-card],')
    expect(CSS).toContain('.feed-grid > *:nth-child(-n + 13)[data-feed-card] {')
    expect(CSS).not.toContain('nth-child(-n + 12)')
  })

  it('gives the feed row a hairline above as well as below', () => {
    expect(CSS).toMatch(/\.partner-strip-feed \{\s*border-top: 1px solid var\(--color-border\);\s*\}/)
  })
})
