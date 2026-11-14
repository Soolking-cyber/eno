// @vitest-environment jsdom
/**
 * THE PARTNER BAND'S TWO PLACEMENTS (owner, 2026-11-10: item 5 of the decision scorecard). On a phone the band is a row
 * of the home feed, not the first thing under the header; from `sm` up it is where it was. One component, two mounts,
 * each shown at its own widths by a class, both in the server's HTML:
 *   · `top`  → `max-sm:hidden`, and nothing that marks it as a feed row;
 *   · `feed` → `sm:hidden col-span-full`, `data-partner-band` (the hook globals.css uses to take it out of a directed
 *     cold link's masked seed and to count it among the grid's first children), and no page gutter of its own.
 * Only the top copy runs the loop, and only from `sm` up; the feed copy holds still at every width (owner, 2026-11-14:
 * "8 still band"). So a phone's band never moves, and a hidden band never holds six rosters of logos in the DOM.
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

describe('only the top copy runs the loop, from sm up; the feed copy holds still', () => {
  const n = () => stripPartners().length
  const items = (host: HTMLElement) => host.querySelectorAll('li.partner-strip-item').length
  const still = (host: HTMLElement) => {
    expect(items(host)).toBe(n())
    expect(host.querySelector('.partner-strip-track')!.hasAttribute('data-loop')).toBe(false)
    expect(host.querySelectorAll('li[data-copy="1"]')).toHaveLength(0)
    expect(host.querySelector('[aria-hidden]')).toBeNull()
    expect(host.querySelector('.partner-strip-pause')).toBeNull()
    // Every partner once, each one a link the keyboard reaches.
    expect(host.querySelectorAll('a.partner-strip-link:not([tabindex="-1"])')).toHaveLength(n())
  }

  it('⛔ on a phone the band holds still (owner 2026-11-14): one row, no repeats, no loop, no pause button; the hidden top copy is still too', async () => {
    atWidth(390)
    const feed = await mount('feed')
    still(feed.host)
    await feed.done()
    const top = await mount('top')
    still(top.host)
    await top.done()
  })

  it('from sm up: the top copy loops with its pause button; the hidden feed copy stays the one still row', async () => {
    atWidth(1280)
    const top = await mount('top')
    expect(items(top.host)).toBe(n() * 6)
    expect(top.host.querySelector('.partner-strip-pause')).not.toBeNull()
    await top.done()
    const feed = await mount('feed')
    still(feed.host)
    await feed.done()
  })

  it('the top copy follows the window across the breakpoint; the feed copy holds still through it', async () => {
    const win = atWidth(390)
    const top = await mount('top')
    expect(items(top.host)).toBe(n())
    await top.act(async () => { win.set(800) })
    expect(items(top.host)).toBe(n() * 6)
    expect(top.host.querySelector('.partner-strip-pause')).not.toBeNull()
    await top.act(async () => { win.set(390) })
    still(top.host)
    await top.done()
    const feed = await mount('feed')
    for (const w of [390, 800, 390]) {
      await feed.act(async () => { win.set(w) })
      still(feed.host)
    }
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

  it('in the browser the repeats of the copy that loops (the top copy, from sm up) are eager, so the loop never slides in a logo still to be fetched', async () => {
    atWidth(1280)
    const band = await mount('top')
    const first = [...band.host.querySelectorAll('li[data-copy="0"] > a > span > img')]
    const repeats = [...band.host.querySelectorAll('li[data-copy="1"] > a > span > img')]
    expect(first.map((img) => img.getAttribute('loading'))).toEqual(stripPartners().map(() => 'lazy'))
    expect(repeats).toHaveLength(stripPartners().length * 5)
    expect(repeats.every((img) => !img.hasAttribute('loading'))).toBe(true)
    expect(repeats.slice(0, stripPartners().length).map((img) => img.getAttribute('src'))).toEqual(logos())
    await band.done()
  })

  it("the feed copy's own logos turn eager once it is on screen, so a logo scrolled in by hand is already fetched", async () => {
    atWidth(390)
    const band = await mount('feed')
    const imgs = [...band.host.querySelectorAll('img')]
    expect(imgs.map((img) => [img.getAttribute('src'), img.getAttribute('loading')])).toEqual(logos().map((src) => [src, 'eager']))
    await band.done()
  })

  it("a desktop's hidden feed copy stays lazy and fetches nothing (desktop unchanged), and turns eager once the window is narrowed to a phone", async () => {
    const win = atWidth(1280)
    const band = await mount('feed')
    const loading = () => [...band.host.querySelectorAll('img')].map((img) => img.getAttribute('loading'))
    expect(loading()).toEqual(logos().map(() => 'lazy'))
    await band.act(async () => { win.set(390) })
    expect(loading()).toEqual(logos().map(() => 'eager'))
    await band.done()
  })

  it('hydrates the server row of either copy at either width without a mismatch, keeping the served nodes', async () => {
    const { hydrateRoot } = await import('react-dom/client')
    const { act } = await import('react')
    // React's own test-environment flag, so the only console errors left are what hydration reports.
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const recovered: unknown[] = []
    try {
      for (const width of [390, 1280]) {
        atWidth(width)
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
          // On a phone the feed copy's served logos themselves turn eager after hydration; everything else stays lazy.
          const want = width < 640 && placement === 'feed' ? 'eager' : 'lazy'
          expect(served.map((img) => img.getAttribute('loading'))).toEqual(served.map(() => want))
          await act(async () => { root!.unmount() })
          host.remove()
        }
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

  it('⛔ the feed copy scrolls by hand with no edge fade (owner 2026-11-14); the top copy keeps its fade', () => {
    expect(CSS).toMatch(/\n\.partner-strip-feed \.partner-strip-viewport \{\s*overflow-x: auto;\s*-webkit-mask-image: none;\s*mask-image: none;\s*\}/)
    // The base rule (the top copy, from sm up) still fades both ends.
    const base = /\n\.partner-strip-viewport \{([^}]*)\}/.exec(CSS)![1]
    expect(base).toContain('overflow: hidden;')
    expect(base).toContain('-webkit-mask-image: linear-gradient(')
    expect(base).toMatch(/\smask-image: linear-gradient\(/)
  })

  it('guard: under reduced motion the looping copy still never moves, its repeats and pause button hidden', () => {
    expect(CSS).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.partner-strip-track\[data-loop\] \{ animation: none; \}\s*\.partner-strip-item\[data-copy="1"\],\s*\.partner-strip-pause \{ display: none; \}/)
  })
})
