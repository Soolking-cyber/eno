import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

// The wizard's own test stand-ins (post-wizard.exit-suggest.test.tsx): server-render the component, no DOM.
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {} }), usePathname: () => '/post', useSearchParams: () => new URLSearchParams() }))
vi.mock('sonner', () => ({ toast: Object.assign(() => {}, { success: () => {}, error: () => {} }) }))
vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ lang: 'en', t: (k: string) => k, tr: (en: string) => en, setLang: () => {} }),
  useTr: (s: string) => s,
  Tr: ({ text }: { text?: string | null }) => <>{text}</>,
}))
vi.mock('@/context/auth-context', () => ({ useAuth: () => ({ user: null, profile: null, loading: false, openSignIn: () => {} }) }))
vi.mock('@/context/currency-context', () => ({
  vndPerUsd: () => null,
  useCurrency: () => ({ currency: 'VND', rates: null, ratesPending: false, format: (n: number) => String(n) }),
}))
vi.mock('./square-crop-dialog', () => ({ SquareCropDialog: () => null }))

import { PriceGuidance } from './post-wizard-sections'

describe('PriceGuidance — the wizard never promises what the listing page will not show', () => {
  const band = { n: 12, p25: 2_000_000, p75: 4_000_000 }
  it('a brand+model band: a low ask is "a good deal", as the PDP says', () => {
    expect(renderToString(<PriceGuidance price={1_500_000} band={{ ...band, basis: 'model' }} />)).toContain('buyers will see a good deal')
  })
  it('⛔ a similar-items band: no good-deal promise — only that it is below what similar listings ask (gate, 2026-10-05)', () => {
    const html = renderToString(<PriceGuidance price={1_500_000} band={{ ...band, basis: 'similar' }} />)
    expect(html).not.toContain('good deal')
    expect(html).toContain('Below what similar listings ask')
  })
})
