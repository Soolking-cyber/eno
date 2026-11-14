// @vitest-environment jsdom
/**
 * ⛔ THE GOODS STRIP STAYS PINNED, AND SAYS SO WITH ONE HAIRLINE (owner-approved 2026-11-15 (build 8), cook r08 goods — StockX's
 * pinned controls): SortStrip `look="goods"` reads `useStuck` on its own sticky box, and only there; while the strip sits in
 * place its rule is transparent (r06, its 1px kept), and once it is stuck over the grid the rule is the border's colour again —
 * a colour, never a box. The explorer passes `stayPinned` with the look (listings-explorer.tsx); the pin's classes are the
 * rentals feed's own (explorer-toolbar.test.tsx pins those).
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

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); stuckNow.value = false; stuckNow.on = [] })

const strip = (look?: 'goods') => <SortStrip sort="newest" onPickSort={() => {}} goodPrice={false} onGoodPrice={() => {}} look={look} stayPinned={look === 'goods'} leading={<div data-facet-pills="" />} />
const rule = (c: HTMLElement) => c.querySelector('#explorer-toolbar > .border-b')!
const tokens = (el: Element) => (el.getAttribute('class') ?? '').split(/\s+/)

describe('SortStrip look="goods" — pinned, with its hairline once stuck (build 8)', () => {
  it('in place: the rule stays transparent below sm (its 1px kept); the strip asks whether it is stuck', () => {
    const { container } = render(strip('goods'))
    expect(tokens(rule(container))).toEqual(expect.arrayContaining(['border-b', 'border-border', 'max-sm:border-b-transparent']))
    expect(stuckNow.on).toContain(true)
    expect(container.querySelector('#explorer-toolbar')!.getAttribute('data-stay-pinned')).toBe('true')
  })

  it('stuck over the grid: the rule takes the border\'s colour again — no class that changes a box', () => {
    stuckNow.value = true
    const { container } = render(strip('goods'))
    const cls = tokens(rule(container))
    expect(cls).toEqual(expect.arrayContaining(['border-b', 'border-border']))
    expect(cls).not.toContain('max-sm:border-b-transparent')
  })

  it('every other strip never asks, and keeps its rule as before', () => {
    stuckNow.value = true
    const { container } = render(strip())
    expect(stuckNow.on.every((on) => on === false)).toBe(true)
    expect(tokens(rule(container))).not.toContain('max-sm:border-b-transparent')
  })

  it('the explorer pins the goods strip: `stayPinned` with the goods look, beside the rentals feed', () => {
    const src = readFileSync(join(__dirname, 'listings-explorer.tsx'), 'utf8')
    expect(src).toContain('stayPinned={rentalsWide || goodsLook}')
    expect(src).toContain("look={goodsLook ? 'goods' : undefined}")
  })
})
