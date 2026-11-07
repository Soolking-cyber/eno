// @vitest-environment jsdom
/**
 * Brand and model chips are LINKS when the page can say where they go (owner, 2026-11-07: right-click "Open link in new
 * tab", Cmd/Ctrl and middle click). category-rail's tile rule: an <a href> to the ladder the chip stands for, the active
 * one to the step above it; a plain click is prevented and picked in place; a modified click is the browser's. Without
 * `hrefFor` they stay toggle buttons.
 */
import * as React from 'react'
import { cleanup, render, waitFor } from '@testing-library/react'
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

  it('without hrefFor they stay toggle buttons', async () => {
    rail({ hrefFor: undefined, activeModel: 'all' })
    await waitFor(() => expect(document.querySelector('[data-brand="yamaha"]')).not.toBeNull())
    expect(document.querySelector('[data-brand="yamaha"]')!.tagName).toBe('BUTTON')
    expect(document.querySelector('[data-brand="honda"]')!.getAttribute('aria-pressed')).toBe('true')
  })
})
