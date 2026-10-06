// @vitest-environment jsdom
import * as React from 'react'
import { renderToString } from 'react-dom/server'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LanguageProvider } from '@/context/language-context'

// ── App Store gate `ios-hide-visa` (D5 = b) on SeoLanding: the /vietnam-evisa family is information only in the iOS app ──
// The page is ISR and the edge cache shares its HTML with the web, so the gate may only ADD CSS hooks — and off, or on
// a page without `appInfoOnly`, the HTML must be byte-identical.

vi.mock('./header', () => ({ Header: () => null }))
vi.mock('./footer', () => ({ Footer: () => null }))
vi.mock('./seo-listing-rail', () => ({
  loadSeoRail: async () => ({ listings: [{ id: 'l1' }], known: true }),
  SeoListingGrid: () => <section data-grid="1" />,
}))

import { SeoLanding, type SeoContent } from './seo-landing'

afterEach(() => vi.unstubAllEnvs())

const base: SeoContent = {
  eyebrow: 'e-Visa · Vietnam',
  h1: 'Vietnam e-Visa',
  intro: 'Intro.',
  categorySlug: 'services',
  subcategorySlug: 'visa-legal',
  cta: 'See all e-visa options',
  sections: [],
  faqs: [],
}

async function html(content: SeoContent) {
  const el = await SeoLanding({ content })
  return renderToString(<LanguageProvider initialLang="en" initialViDict={{}}>{el}</LanguageProvider>)
}

describe('SeoLanding × ios-hide-visa', () => {
  it('gate OFF: `appInfoOnly` changes nothing — byte-identical HTML', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', '')
    expect(await html({ ...base, appInfoOnly: true })).toBe(await html(base))
  })

  it('gate ON, a page WITHOUT `appInfoOnly` (every marketplace landing page): byte-identical HTML', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', '')
    const off = await html(base)
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ios-hide-visa')
    expect(await html(base)).toBe(off)
  })

  it('gate ON + `appInfoOnly`: the CTA and the grid sit inside the ios-app-hidden hook, the note inside ios-app-only', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ios-hide-visa')
    const doc = new DOMParser().parseFromString(await html({ ...base, appInfoOnly: true }), 'text/html')
    const hidden = [...doc.querySelectorAll('.ios-app-hidden')]
    expect(hidden).toHaveLength(2)
    expect(hidden.some((n) => n.textContent?.includes('See all e-visa options'))).toBe(true)
    expect(hidden.some((n) => n.querySelector('[data-grid]'))).toBe(true)
    const note = doc.querySelector('.ios-app-only')
    expect(note?.textContent).toContain('In the app this page is for information only. e-Visa applications can be made in a web browser.')
    // Nothing outside the hidden wrappers links onward to the listings.
    for (const a of doc.querySelectorAll('a')) expect(a.closest('.ios-app-hidden') || !/category=services/.test(a.getAttribute('href') ?? '')).toBeTruthy()
  })
})

describe('which pages are information-only', () => {
  // Every SeoLanding page that SELLS an e-Visa sets the flag; nothing else does (the marketplace pages keep their CTA).
  const pages: string[] = []
  const walk = (d: string) => {
    for (const e of readdirSync(d)) {
      const p = join(d, e)
      if (statSync(p).isDirectory()) walk(p)
      else if (/^page\..*tsx$/.test(e) && readFileSync(p, 'utf8').includes('<SeoLanding')) pages.push(p.split('src/app/[lang]/')[1])
    }
  }
  walk(join(process.cwd(), 'src/app/[lang]'))
  const flagged = pages.filter((p) => readFileSync(join(process.cwd(), 'src/app/[lang]', p), 'utf8').includes('appInfoOnly: true')).sort()

  it('finds the SeoLanding pages (so the check is not vacuous)', () => {
    expect(pages.length).toBeGreaterThan(flagged.length)
  })

  // NOT /services-for-expats-vietnam: its CTA and grid browse ALL services (eSIMs, trip planning…), so hiding them would
  // take more than e-Visa out of the app (codex, review); its e-Visa cards lead to product pages that are gated anyway.
  it('exactly the e-Visa landing family', () => {
    expect(flagged).toEqual([
      'vietnam-evisa/1-hour-urgent/page.forum.svc.tsx',
      'vietnam-evisa/by-nationality/page.forum.svc.tsx',
      'vietnam-evisa/multiple-entry-cost/page.forum.svc.tsx',
      'vietnam-evisa/page.forum.svc.tsx',
      'vietnam-evisa/rejected/page.forum.svc.tsx',
      'vietnam-evisa/vs-visa-on-arrival/page.forum.svc.tsx',
    ])
  })
})
