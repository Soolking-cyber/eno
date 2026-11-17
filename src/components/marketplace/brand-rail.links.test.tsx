// @vitest-environment jsdom
/**
 * Brand and model chips are LINKS when the page can say where they go (owner, 2026-11-07: right-click "Open link in new
 * tab", Cmd/Ctrl and middle click). category-rail's tile rule: an <a href> to the ladder the chip stands for, the active
 * one to the step above it; a plain click is prevented and picked in place; a modified click is the browser's. Without
 * `hrefFor` they stay toggle buttons.
 */
import * as React from 'react'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/context/language-context', () => ({ useLanguage: () => ({ lang: 'en', tr: (en: string) => en, t: (en: string) => en }) }))
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
HTMLElement.prototype.scrollTo = () => {}

import { BrandRail } from './brand-rail'

const hrefFor = (p: Record<string, string> | null) => (p ? `/?${new URLSearchParams(Object.entries(p).filter(([, v]) => v && v !== 'all'))}` : '/')

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn((url: string) => Promise.resolve({
    json: () => Promise.resolve(url.includes('/models')
      ? { models: [{ model: 'Vision', count: 5 }, { model: 'Wave', count: 3 }] }
      : { brands: [{ slug: 'honda', name: 'Honda', count: 8, iconPath: null }, { slug: 'yamaha', name: 'Yamaha', count: 4, iconPath: null }] }),
  })))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }) })

function rail(over: Partial<React.ComponentProps<typeof BrandRail>> = {}) {
  const onPickBrand = vi.fn()
  const onPickModel = vi.fn()
  render(<BrandRail category="vehicles" subcategory="motorbikes" activeBrand="honda" activeModel="vision" onPickBrand={onPickBrand} onPickModel={onPickModel} hrefFor={hrefFor} {...over} />)
  return { onPickBrand, onPickModel }
}

describe('BrandRail chips are links', () => {
  it('a brand links to the aisle with that brand; the active brand to the aisle alone', async () => {
    rail({ activeModel: 'all' })
    await waitFor(() => expect(document.querySelector('[data-brand="yamaha"]')).not.toBeNull())
    const yamaha = document.querySelector('[data-brand="yamaha"]')!
    expect(yamaha.tagName).toBe('A')
    expect(yamaha.getAttribute('href')).toBe('/?category=vehicles&subcategory=motorbikes&brand=yamaha')
    const honda = document.querySelector('[data-brand="honda"]')!
    expect(honda.getAttribute('href')).toBe('/?category=vehicles&subcategory=motorbikes')
    expect(honda.getAttribute('aria-current')).toBe('true')
  })

  it('a model links to the brand with that model; the active model to the brand alone', async () => {
    rail({ activeModel: 'Vision' })
    await waitFor(() => expect(document.querySelector('[data-model="Wave"]')).not.toBeNull())
    expect(document.querySelector('[data-model="Wave"]')!.getAttribute('href')).toBe('/?category=vehicles&subcategory=motorbikes&brand=honda&model=Wave')
    expect(document.querySelector('[data-model="Vision"]')!.getAttribute('href')).toBe('/?category=vehicles&subcategory=motorbikes&brand=honda')
  })

  it('a plain click picks in place and is prevented; a modified click is the browser\'s', async () => {
    const { onPickBrand, onPickModel } = rail({ activeModel: 'all' })
    await waitFor(() => expect(document.querySelector('[data-brand="yamaha"]')).not.toBeNull())
    const yamaha = document.querySelector('[data-brand="yamaha"]')!
    const cmd = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, metaKey: true })
    yamaha.dispatchEvent(cmd)
    expect(cmd.defaultPrevented).toBe(false)
    expect(onPickBrand).not.toHaveBeenCalled()
    const plain = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })
    yamaha.dispatchEvent(plain)
    expect(plain.defaultPrevented).toBe(true)
    expect(onPickBrand).toHaveBeenCalledWith('yamaha')
    expect(onPickModel).toHaveBeenCalledWith('all')
  })

  it('the models under "More" are link rows too (desktop menu)', async () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ model: `M${i + 1}`, count: 20 - i }))
    vi.stubGlobal('fetch', vi.fn((url: string) => Promise.resolve({
      json: () => Promise.resolve(url.includes('/models') ? { models: many } : { brands: [{ slug: 'honda', name: 'Honda', count: 80, iconPath: null }] }),
    })))
    const user = userEvent.setup()
    const { onPickModel } = rail({ activeModel: 'all' })
    const more = await screen.findByRole('button', { name: /More/ })
    await user.click(more)
    const row = await screen.findByRole('menuitem', { name: /M12/ })
    expect(row.tagName).toBe('A')
    expect(row.getAttribute('href')).toBe('/?category=vehicles&subcategory=motorbikes&brand=honda&model=M12')
    expect(row.getAttribute('data-model')).toBe('M12')
    await user.click(row)
    expect(onPickModel).toHaveBeenCalledWith('M12')
  })

  it('without hrefFor they stay toggle buttons', async () => {
    rail({ hrefFor: undefined, activeModel: 'all' })
    await waitFor(() => expect(document.querySelector('[data-brand="yamaha"]')).not.toBeNull())
    expect(document.querySelector('[data-brand="yamaha"]')!.tagName).toBe('BUTTON')
    expect(document.querySelector('[data-brand="honda"]')!.getAttribute('aria-pressed')).toBe('true')
  })
})

/**
 * ⛔ GREY EVERYWHERE (owner, 2026-11-17): the brand rail's model box is THE WELL (ui/chip-style WELL_*) — the field grey,
 * its pick a white flat segment with an ink label, a resting chip the body grey; "More" opens a step deeper. The picked
 * brand says so with the well grey behind its logo and an ink name. None of it is the brand tint or its blue labels any more.
 */
describe('BrandRail — the well\'s grey ladder', () => {
  const tokens = (el: Element | null | undefined) => (el?.getAttribute('class') ?? '').split(/\s+/)
  const BLUE = ['bg-brand-50', 'bg-brand-100', 'bg-card', 'bg-accent', 'text-accent-foreground', '!text-accent-foreground']

  it('the model box is the well; the picked model a white pill with an ink label, the rest body grey', async () => {
    rail({ activeModel: 'Vision' })
    await waitFor(() => expect(document.querySelector('[data-model="Wave"]')).not.toBeNull())
    const well = screen.getByRole('group', { name: 'Models' })
    expect(tokens(well)).toEqual(expect.arrayContaining(['bg-muted', 'rounded-2xl', 'p-1.5']))
    expect(tokens(well)).not.toContain('bg-brand-50')

    const picked = document.querySelector('[data-model="Vision"]')!
    expect(picked.getAttribute('aria-current')).toBe('true')
    expect(tokens(picked)).toEqual(expect.arrayContaining(['rounded-full', 'bg-background', 'text-foreground', 'shadow-sm', 'dark:bg-line-strong', 'dark:shadow-none']))
    for (const gone of [...BLUE, 'rounded-lg']) expect(tokens(picked), gone).not.toContain(gone)

    const resting = document.querySelector('[data-model="Wave"]')!
    expect(tokens(resting)).toEqual(expect.arrayContaining(['rounded-full', 'text-body', 'hover:text-foreground']))
    for (const gone of ['bg-background', 'shadow-sm', 'hover:text-accent-foreground']) expect(tokens(resting), gone).not.toContain(gone)
  })

  it('the picked brand: the selected grey behind its logo and an ink name and mark; another brand has no disc (the gate, 2026-11-17: the well grey was ~1.1:1 on the canvas)', async () => {
    rail({ activeModel: 'all' })
    await waitFor(() => expect(document.querySelector('[data-brand="yamaha"]')).not.toBeNull())
    const honda = document.querySelector('[data-brand="honda"]')!
    const disc = honda.firstElementChild!
    expect(tokens(disc)).toEqual(expect.arrayContaining(['flex', 'h-11', 'w-full', 'rounded-2xl', 'bg-line-strong']))
    const mark = honda.querySelector('[class*="group-hover:scale-110"]')!
    expect(tokens(mark)).toContain('!text-foreground')
    expect(tokens(mark)).not.toContain('!text-accent-foreground')
    const name = honda.querySelector('.line-clamp-2')!
    expect(tokens(name)).toContain('text-foreground')
    for (const gone of ['text-accent-foreground', 'group-hover:text-accent-foreground']) expect(tokens(name), gone).not.toContain(gone)

    const yamaha = document.querySelector('[data-brand="yamaha"]')!
    expect(tokens(yamaha.firstElementChild)).not.toContain('bg-line-strong')
    // …and its name is the body grey, so the pick steps body → ink as well as gaining the disc.
    expect(tokens(yamaha.querySelector('.line-clamp-2'))).toContain('text-body')
  })

  it('"More": a body-grey pill at rest, the white pick while open, its menu a step deeper and its rows on the well ladder', async () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ model: `M${i + 1}`, count: 20 - i }))
    vi.stubGlobal('fetch', vi.fn((url: string) => Promise.resolve({
      json: () => Promise.resolve(url.includes('/models') ? { models: many } : { brands: [{ slug: 'honda', name: 'Honda', count: 80, iconPath: null }] }),
    })))
    const user = userEvent.setup()
    rail({ activeModel: 'all' })
    const more = await screen.findByRole('button', { name: /More/ })
    expect(tokens(more)).toEqual(expect.arrayContaining(['rounded-full', 'icon-own-ink', 'text-body', 'hover:bg-secondary']))
    for (const gone of [...BLUE, 'rounded-lg', 'bg-background']) expect(tokens(more), gone).not.toContain(gone)

    await user.click(more)
    const row = await screen.findByRole('menuitem', { name: /M12/ })
    await waitFor(() => expect(tokens(more)).toEqual(expect.arrayContaining(['bg-background', 'text-foreground', 'shadow-sm', 'icon-own-ink'])))
    for (const gone of BLUE) expect(tokens(more), gone).not.toContain(gone)

    const menu = screen.getByRole('menu')
    expect(tokens(menu)).toContain('bg-secondary')
    expect(tokens(menu)).not.toContain('bg-brand-50')
    // The active model always stays in the box (never in "More"), so every overflow row is a resting one.
    // A row in a dropdown that is itself `--secondary` hovers back up to the well's grey (WELL_MENU_ITEM, gate 2026-11-17).
    expect(tokens(row)).toEqual(expect.arrayContaining(['text-body', 'hover:bg-muted', 'hover:text-foreground']))
    for (const gone of [...BLUE, 'hover:bg-secondary', 'hover:text-accent-foreground', 'hover:bg-background/70']) expect(tokens(row), gone).not.toContain(gone)
  })
})
