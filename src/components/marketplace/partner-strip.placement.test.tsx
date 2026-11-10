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
})

/**
 * ⛔ NO LOGO PRELOAD (speed plan R26, 2026-11-10; why: PartnerItem). React writes a `<link rel="preload" as="image">` for
 * every plain `<img>` it server-renders (in `<head>` on a page, before the img in a bare render), so the five logos went
 * out ahead of the first paint on every phone home view. The top copy's logo is a `<source>` that matches only from `sm`
 * up, over a blank data-URI `<img>`; the phone's feed copy is lazy on the server and eager in the repeats.
 */
describe('the logos are never preloaded, and a phone never fetches the top copy', () => {
  const logos = () => stripPartners().map((p) => p.logo.src)
  const imgs = (html: string) => html.match(/<img\b[^>]*>/g) ?? []
  const attr = (tag: string, name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1]

  it('the server writes no preload for either copy, alone or in a whole document as the home page renders both', () => {
    for (const placement of ['top', 'feed'] as const) expect(renderToString(<PartnerStrip placement={placement} />)).not.toContain('rel="preload"')
    // React writes the `<head>` itself, preloads in it, when the tree is a whole document.
    const page = renderToString(<html><body><PartnerStrip /><PartnerStrip placement="feed" /></body></html>)
    expect(page).toMatch(/^<html><head>/)
    expect(page.slice(0, page.indexOf('</head>'))).not.toContain('/partners/')
  })

  it('top: each logo is a <picture> whose source matches from sm up, over a blank 1x1 <img> that keeps the alt and the size', () => {
    const html = renderToString(<PartnerStrip />)
    const pictures = html.match(/<picture><source [^>]*\/><img [^>]*\/><\/picture>/g) ?? []
    expect(pictures).toHaveLength(stripPartners().length)
    // The same query the loop and the `max-sm:hidden` class answer to (40rem): shown is exactly when the source matches.
    expect(html.match(/<source [^>]*>/g)).toEqual(logos().map((src) => `<source media="(min-width: 40rem)" srcSet="${src}"/>`))
    stripPartners().forEach((p, i) => {
      const img = imgs(html)[i]
      expect(attr(img, 'alt')).toBe(p.name)
      expect([attr(img, 'width'), attr(img, 'height')]).toEqual([String(p.logo.width), String(p.logo.height)])
      expect(attr(img, 'loading')).toBeUndefined() // a desktop paints the band with its logos
      const src = attr(img, 'src')!
      expect(src).toMatch(/^data:image\/gif;base64,/)
      const gif = Buffer.from(src.slice(src.indexOf(',') + 1), 'base64')
      expect([gif.subarray(0, 6).toString(), gif.readUInt16LE(6), gif.readUInt16LE(8)]).toEqual(['GIF89a', 1, 1])
    })
    // No logo URL anywhere a phone would fetch it: only in the sources' srcset.
    for (const src of logos()) expect(html.split(src).length - 1).toBe(1)
  })

  it('feed: a plain lazy <img> per logo from the server, alt and size kept', () => {
    const html = renderToString(<PartnerStrip placement="feed" />)
    expect(html).not.toContain('<picture')
    expect(imgs(html).map((img) => [attr(img, 'src'), attr(img, 'loading'), attr(img, 'alt')])).toEqual(
      stripPartners().map((p) => [p.logo.src, 'lazy', p.name]))
  })

  it("in the browser the feed's repeats are eager, so the loop never slides in a logo still to be fetched; the top's stay pictures", async () => {
    atWidth(390)
    const feed = await mount('feed')
    const first = [...feed.host.querySelectorAll('li[data-copy="0"] img')]
    const repeats = [...feed.host.querySelectorAll('li[data-copy="1"] img')]
    expect(first.map((img) => img.getAttribute('loading'))).toEqual(stripPartners().map(() => 'lazy'))
    expect(repeats).toHaveLength(stripPartners().length * 5)
    expect(repeats.every((img) => !img.hasAttribute('loading'))).toBe(true)
    await feed.done()
    atWidth(1280)
    const top = await mount('top')
    expect(top.host.querySelectorAll('li.partner-strip-item').length).toBe(stripPartners().length * 6)
    expect(top.host.querySelectorAll('li.partner-strip-item > a > span > picture > source[media="(min-width: 40rem)"] + img').length).toBe(stripPartners().length * 6)
    await top.done()
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
