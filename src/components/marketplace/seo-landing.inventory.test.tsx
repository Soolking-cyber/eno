// @vitest-environment jsdom
import * as React from 'react'
import { renderToString } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LanguageProvider } from '@/context/language-context'

// ── SeoLanding's `inventory`: a page that lists its whole inventory itself (the teaching jobs board on
// /jobs-vietnam-expats) takes the rail's place — its block where the rail would be, its own read deciding the empty state,
// and no rail query at all (eight cards over the same rows would repeat the list's first eight lines).

const rail = vi.hoisted(() => ({ calls: 0 }))
vi.mock('./header', () => ({ Header: () => null }))
vi.mock('./footer', () => ({ Footer: () => null }))
vi.mock('./seo-listing-rail', () => ({
  loadSeoRail: async () => {
    rail.calls++
    return { listings: [{ id: 'l1' }], known: true }
  },
  SeoListingGrid: () => <section data-grid="1" />,
}))

import { SeoLanding, type SeoContent } from './seo-landing'

const content: SeoContent = {
  eyebrow: 'Teaching jobs · Vietnam',
  h1: 'English teaching jobs in Vietnam',
  intro: 'Intro.',
  categorySlug: 'jobs',
  subcategorySlug: 'teaching',
  listingType: 'job',
  cta: 'Browse teaching jobs',
  sections: [],
  faqs: [],
}

const BOARD = <div data-board="teaching-jobs" />

async function doc(inventory?: { known: boolean; count: number; node: React.ReactNode }) {
  const el = await SeoLanding({ content, inventory })
  const html = renderToString(<LanguageProvider initialLang="en" initialViDict={{}}>{el}</LanguageProvider>)
  return new DOMParser().parseFromString(html, 'text/html')
}

const EMPTY_STATE = 'This part of the marketplace is just getting started'

beforeEach(() => { rail.calls = 0 })

describe('SeoLanding × inventory', () => {
  it('without it, nothing changes: the rail is read and drawn', async () => {
    const d = await doc()
    expect(rail.calls).toBe(1)
    expect(d.querySelector('[data-grid]')).not.toBeNull()
  })

  it('with rows: the page’s block where the rail was, no rail query, the ordinary CTA', async () => {
    const d = await doc({ known: true, count: 37, node: BOARD })
    expect(rail.calls).toBe(0)
    expect(d.querySelector('[data-grid]')).toBeNull()
    expect(d.querySelector('[data-board]')?.getAttribute('data-board')).toBe('teaching-jobs')
    expect(d.body.textContent).toContain('Browse teaching jobs')
    expect(d.body.textContent).not.toContain(EMPTY_STATE)
  })

  it('looked and found none: SeoLanding’s own empty state, still no rail query', async () => {
    const d = await doc({ known: true, count: 0, node: null })
    expect(rail.calls).toBe(0)
    expect(d.body.textContent).toContain(EMPTY_STATE)
    expect(d.body.textContent).not.toContain('Browse teaching jobs')
  })

  it('⚠️ could not look: NOT the empty state — the ordinary CTA, as a failed rail read shows', async () => {
    const d = await doc({ known: false, count: 0, node: null })
    expect(rail.calls).toBe(0)
    expect(d.body.textContent).not.toContain(EMPTY_STATE)
    expect(d.body.textContent).toContain('Browse teaching jobs')
  })
})
