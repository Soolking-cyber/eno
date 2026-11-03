// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/context/language-context', () => ({ useLanguage: () => ({ lang: 'en', tr: (en: string) => en, t: (en: string) => en }) }))
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })

import { BrandRail } from './brand-rail'

/** A skeleton that only ever vanishes moves every result under it twice: 0.27 of CLS on /?category=rentals. */
const rail = (category: string) => render(
  <BrandRail category={category} subcategory="all" activeBrand="all" activeModel="all" activeLine="" onPickBrand={() => {}} onPickModel={() => {}} onPickLine={() => {}} />,
)
beforeEach(() => { vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {}))) })
afterEach(() => { cleanup() })

describe('BrandRail while /api/brands is out', () => {
  it.each(['rentals', 'fashion-beauty', 'baby-kids', 'sports'])('%s, which has no brands: nothing to hold', (category) => {
    expect(rail(category).container.firstChild).toBeNull()
  })
  it('electronics, which has: the skeleton holds the rail', () => {
    expect(rail('electronics').container.querySelector('[aria-hidden="true"]')).not.toBeNull()
  })
})
