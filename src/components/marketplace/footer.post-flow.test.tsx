// @vitest-environment jsdom
import * as React from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

/**
 * ⛔ O-30 W-CHROME (owner, 2026-09-30): NO FOOTER ON THE POST FLOW — decided from the pathname at RENDER
 * time, so the SERVER HTML already omits it (no hydration swap, no jump under the wizard's sticky bar).
 * Server-rendered here on purpose: the claim is about the first byte, and the server pathname can be the
 * internal `/en/post` or the public `/post` — both must answer the same (lib/post-flow-path.ts).
 */
const h = vi.hoisted(() => ({ pathname: '/' as string }))
vi.mock('next/navigation', () => ({ usePathname: () => h.pathname, useRouter: () => ({ push: () => {} }) }))
vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ tr: (en: string) => en, lang: 'en', setLang: () => {} }),
  LANGUAGES: [{ code: 'en', native: 'English' }],
}))
vi.mock('@/context/currency-context', () => ({ useCurrency: () => ({ currency: 'VND', setCurrency: () => {} }) }))
vi.mock('@/components/marketplace/footer-stats', () => ({ FooterStats: () => null }))

import { Footer } from './footer'

const html = (p: string) => { h.pathname = p; return renderToString(<Footer />) }

describe('the footer on the post flow', () => {
  it('is absent from the server HTML of /post and /listings/<id>/edit, public or internal', () => {
    for (const p of ['/post', '/en/post', '/vi/post', '/listings/cmx1/edit', '/vi/listings/cmx1/edit']) expect(html(p), p).toBe('')
  })

  it('is still there everywhere else', () => {
    for (const p of ['/', '/help', '/listings/cmx1', '/posts']) expect(html(p), p).toContain('id="app-footer"')
  })
})
