// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Bilingual } from '@/components/marketplace/bilingual'
import { LanguageProvider, Tr } from '@/context/language-context'
import { VI_OVERRIDES } from '@/generated/vi-overrides'
import { facetsFor } from '@/lib/taxonomy'

/**
 * ⛔ A DETAILS LABEL IS THE TAXONOMY'S, IN BOTH LANGUAGES — never the raw attribute key through `<Tr>`.
 *
 * The rental PDP printed its attribute KEYS ("bedrooms", "bathrooms") as the Details labels, through
 * the UI dictionary, which is keyed by exact English copy: it has "Bedrooms", not "bedrooms", so the
 * Vietnamese server HTML said "bedrooms" (prod, 2026-09-29) while the facet row beside it carried
 * labelVi "Phòng ngủ". The page now renders the facet's own pair for every category.
 */
const PAGE = readFileSync(join(process.cwd(), 'src/app/[lang]/listings/[id]/(pdp)/page.tsx'), 'utf8')

describe('PDP Details labels', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'languages', { configurable: true, get: () => ['vi-VN', 'vi'] })
  })
  afterEach(() => {
    Reflect.deleteProperty(navigator, 'languages')
  })
  const html = (node: ReactNode) =>
    renderToString(<LanguageProvider initialLang="vi" initialViDict={VI_OVERRIDES}>{node}</LanguageProvider>)

  it('the page renders the facet’s label pair, for every category (not only jobs and eSIM)', () => {
    expect(PAGE).toContain('const labelFacet = !jobText ? attrFacets.find((f) => f.key === k) : undefined')
    expect(PAGE).toContain('<Bilingual en={labelFacet.label} vi={labelFacet.labelVi} />')
    expect(PAGE).toContain('<Bilingual en={option.label} vi={option.labelVi} />')
  })

  it('the defect was real: the raw key misses the dictionary and stays English', () => {
    const rawKey = 'bedrooms'
    expect(html(<Tr text={rawKey} />)).toBe('bedrooms')
  })

  it('every rental facet has Vietnamese of its own, and that is what a Vietnamese reader gets', () => {
    const facets = facetsFor('rentals', 'house-rental')
    expect(facets.map((f) => f.key)).toEqual(expect.arrayContaining(['bedrooms', 'bathrooms']))
    for (const f of facets) {
      expect(f.labelVi.trim(), f.key).not.toBe('')
      expect(html(<Bilingual en={f.label} vi={f.labelVi} />)).toBe(f.labelVi)
    }
    expect(html(<Bilingual en="Bedrooms" vi={facets.find((f) => f.key === 'bedrooms')!.labelVi} />)).toBe('Phòng ngủ')
  })
})
