// @vitest-environment jsdom
/**
 * ⛔ THE GOODS STRIP STAYS PINNED (owner-approved 2026-11-15 (build 8), cook r08 goods — StockX's pinned controls), AND EVERY
 * PHONE STRIP SAYS SO WITH ONE HAIRLINE (owner, 2026-11-16, hub Q15 — build 8 had the hairline on the goods strip alone):
 * SortStrip reads `useStuck` on its own sticky box on a phone; while the strip sits in place its rule is transparent (its 1px
 * kept), and once it is stuck over the grid the rule is the border's colour again — a colour, never a box. The explorer passes
 * `stayPinned` with the goods look (listings-explorer.tsx); the pin's classes are the rentals feed's own (explorer-toolbar.test.tsx
 * pins those).
 */
import React from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const stuckNow = vi.hoisted(() => ({ value: false, on: [] as boolean[] }))
vi.mock('@/hooks/use-stuck', () => ({ useStuck: (_ref: unknown, on = true) => { stuckNow.on.push(on); return on && stuckNow.value } }))
vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ lang: 'en', t: (k: string) => k, tr: (en: string) => en }),
  useTr: (s: string) => s,
  Tr: ({ text }: { text?: string | null }) => <>{text}</>,
}))

import { SortStrip } from './explorer-toolbar'

// `phone`: the viewport useIsPhone reads (max-width 639.98px).
const vp = vi.hoisted(() => ({ phone: true }))
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: vp.phone && q.includes('max-width'), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); stuckNow.value = false; stuckNow.on = []; vp.phone = true })

const strip = (look?: 'goods') => <SortStrip sort="newest" onPickSort={() => {}} goodPrice={false} onGoodPrice={() => {}} look={look} stayPinned={look === 'goods'} leading={<div data-facet-pills="" />} />
const rule = (c: HTMLElement) => c.querySelector('#explorer-toolbar > .border-b')!
const tokens = (el: Element) => (el.getAttribute('class') ?? '').split(/\s+/)

describe('SortStrip — the hairline only once stuck, on every phone strip (hub Q15, 2026-11-16)', () => {
  it.each([['the goods strip', 'goods' as const], ['every other strip (rentals, jobs, the home, a shop)', undefined]])('%s, in place: the rule stays transparent below sm (its 1px kept); the strip asks whether it is stuck', (_n, look) => {
    const { container } = render(strip(look))
    expect(tokens(rule(container))).toEqual(expect.arrayContaining(['border-b', 'border-border', 'max-sm:border-b-transparent']))
    expect(stuckNow.on).toContain(true)
  })

  it.each([['the goods strip', 'goods' as const], ['every other strip', undefined]])('%s, stuck over the grid: the rule takes the border\'s colour again — no class that changes a box', (_n, look) => {
    stuckNow.value = true
    const { container } = render(strip(look))
    const cls = tokens(rule(container))
    expect(cls).toEqual(expect.arrayContaining(['border-b', 'border-border']))
    expect(cls).not.toContain('max-sm:border-b-transparent')
  })

  it('from sm the strip never asks (the class is max-sm: anyway)', () => {
    vp.phone = false
    stuckNow.value = true
    render(strip())
    expect(stuckNow.on.every((on) => on === false)).toBe(true)
  })

  it('the goods strip stays pinned (build 8); the others keep the 08-12 rule', () => {
    expect(render(strip('goods')).container.querySelector('#explorer-toolbar')!.getAttribute('data-stay-pinned')).toBe('true')
    cleanup()
    expect(render(strip()).container.querySelector('#explorer-toolbar')!.hasAttribute('data-stay-pinned')).toBe(false)
  })

  it('the explorer pins the goods strip: `stayPinned` with the goods look, beside the rentals feed', () => {
    const src = readFileSync(join(__dirname, 'listings-explorer.tsx'), 'utf8')
    expect(src).toContain('stayPinned={rentalsWide || goodsLook}')
    expect(src).toContain("look={goodsLook ? 'goods' : undefined}")
  })
})
