// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

import { Tabs, TabsList, TabsTrigger } from './tabs'

/**
 * A tab presses (the base transitions `scale`), and a tab CHANGE never animates (no colour/underline
 * transition — Base UI changes tabs on arrow keys). A caller's `transition-colors` used to replace
 * the base list through tailwind-merge, which both deleted the press tween and brought the keyboard
 * fade back; it is dropped now. jsdom sees classes, not frames — the press was measured on the preview.
 */
afterEach(cleanup)
const classes = (el: HTMLElement) => el.className.split(/\s+/)
// Fixture labels as consts: `react/jsx-no-literals` lints tests too.
const [NEWEST, PRICE] = ['Newest', 'Price']

describe('TabsTrigger', () => {
  it('transitions only the press, and a caller transition-colors cannot replace it', () => {
    render(
      <Tabs defaultValue="a">
        <TabsList>
          <TabsTrigger value="a">{NEWEST}</TabsTrigger>
          <TabsTrigger value="b" className="transition-colors duration-100 active:scale-[0.97]">{PRICE}</TabsTrigger>
        </TabsList>
      </Tabs>,
    )
    for (const name of [NEWEST, PRICE]) {
      const tab = screen.getByRole('tab', { name })
      expect(classes(tab)).toContain('transition-[scale]')
      expect(classes(tab)).not.toContain('transition-all')
      expect(classes(tab)).not.toContain('transition-colors')
      expect(classes(tab)).not.toContain('after:transition-opacity')
      expect(classes(tab)).toContain('active:scale-[0.97]')
    }
    // The caller's own duration still wins over the base.
    expect(classes(screen.getByRole('tab', { name: PRICE }))).toContain('duration-100')
  })
})

/**
 * TabsList `plain` (2026-11-25): the list without Base UI's, with Base UI's own server markup, for a strip that hydrates with the
 * page (SortStrip). The markup must be Base UI's, so it looks and styles exactly as every other tab strip.
 */
describe('TabsList plain', () => {
  const strip = (plain?: { value: unknown; onValueChange: (v: unknown) => void }, onPriceClick?: () => void) => (
    <Tabs value="a" className="block">
      <TabsList variant="line" className="flex" plain={plain}>
        <TabsTrigger value="a" type="button">{NEWEST}</TabsTrigger>
        <TabsTrigger value="b" type="button" aria-label="Price: low to high" onClick={onPriceClick}>{PRICE}</TabsTrigger>
      </TabsList>
    </Tabs>
  )
  // Base UI's generated ids, and the roving tabindex Base UI's server HTML leaves at -1 on every tab (the plain list makes the
  // active tab the Tab stop), are the only differences allowed.
  const norm = (html: string) => html.replace(/ id="[^"]*"/g, '').replace(/ tabindex="-?\d"/g, '')

  it('renders the same server markup as Base UI: classes, role, aria-selected and every data attribute', async () => {
    const { renderToString } = await import('react-dom/server')
    const live = renderToString(strip())
    const still = renderToString(strip({ value: 'a', onValueChange: () => {} }))
    expect(norm(still)).toBe(norm(live))
    expect(still).toContain('role="tablist"')
    expect(still).toMatch(/aria-selected="true"[^>]*data-composite-item-active=""/)
  })

  it('a click on another tab commits it (after the tab\'s own onClick); a click on the active tab commits nothing', () => {
    const picked: unknown[] = []
    let priceClicks = 0
    render(strip({ value: 'a', onValueChange: (v) => picked.push(v) }, () => priceClicks++))
    screen.getByRole('tab', { name: NEWEST }).click()
    expect(picked).toEqual([])
    screen.getByRole('tab', { name: 'Price: low to high' }).click()
    expect(priceClicks).toBe(1)
    expect(picked).toEqual(['b'])
  })

  it('the active tab is the one Tab stop, and ← / → / Home / End move focus without committing (manual activation)', async () => {
    const { fireEvent } = await import('@testing-library/react')
    const picked: unknown[] = []
    render(strip({ value: 'a', onValueChange: (v) => picked.push(v) }))
    const [a, b] = screen.getAllByRole('tab')
    expect([a.tabIndex, b.tabIndex]).toEqual([0, -1])
    a.focus()
    fireEvent.keyDown(a, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(b)
    fireEvent.keyDown(b, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(a) // loops
    fireEvent.keyDown(a, { key: 'End' })
    expect(document.activeElement).toBe(b)
    expect(picked).toEqual([])
  })
})
