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
