import * as React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { renderToString } from 'react-dom/server'

/**
 * THE STOREFRONT HEADER'S CHAT (B3-STORE, inbox-05).
 *   · On the canonical host the chat is the in-app button; on a shop's own host (`chatOrigin` set) it is a
 *     link to the listing on the canonical origin — the session and every write live there (proxy.ts).
 *   · No anchor (affiliate-only shop, visa desk, empty shop) → no chat of either kind.
 * ⚠️ vitest pins NEXT_PUBLIC_ENO_EDITION=services, so SITE_NAME is eno.forum here.
 */
let LANG = 'en'
vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ lang: LANG, tr: (en: string, vi?: string) => (LANG === 'vi' && vi != null ? vi : en), t: (en: string, vi?: string) => (LANG === 'vi' && vi != null ? vi : en), setLang: () => {} }),
  useTr: () => (en: string) => en,
  Tr: ({ text }: { text: string }) => text,
}))
vi.mock('@/hooks/use-mounted', () => ({ useMounted: () => false }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {} }) }))

import { StorefrontSellerCard } from './storefront-seller-card'
import { SITE_NAME } from '@/lib/edition'
import type { SellerMetrics } from '@/lib/seller-metrics'

const text = (html: string) => html.replace(/<!-- -->/g, '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()
const metrics = { responseBucket: { key: null, en: '', vi: '' }, lastSeenDay: null, memberSinceYear: 2026, reviewCount: 0, rating: 0, trustScore: 80 } as unknown as SellerMetrics
const seller = { id: 's1', name: 'Shop', avatarColor: '#000', isBusiness: false }
const render = (props: Partial<React.ComponentProps<typeof StorefrontSellerCard>>) =>
  renderToString(<StorefrontSellerCard seller={seller} metrics={metrics} chatListingId={null} {...props} />)

describe('StorefrontSellerCard — chat on either host', () => {
  it('canonical host: the in-app "Chat now" button, no cross-host link', () => {
    const html = render({ chatListingId: 'lst1' })
    expect(text(html)).toContain('Chat now')
    expect(html).not.toContain('/listings/lst1#contact"')
  })

  it("shop's own host: a link to the listing on the canonical origin, labelled with the site", () => {
    const html = render({ chatListingId: 'lst1', chatOrigin: 'https://eno.vn/' })
    expect(html).toContain('href="https://eno.vn/listings/lst1#contact"')
    expect(text(html)).toContain(`Chat on ${SITE_NAME}`)
    expect(text(html)).not.toContain('Chat now')
    LANG = 'vi'
    expect(text(render({ chatListingId: 'lst1', chatOrigin: 'https://eno.vn' }))).toContain(`Chat trên ${SITE_NAME}`)
    LANG = 'en'
  })

  it('no anchor (affiliate-only shop, visa desk): no chat of either kind', () => {
    for (const html of [render({}), render({ chatOrigin: 'https://eno.vn' })]) {
      expect(text(html)).not.toMatch(/Chat (now|on)/)
      expect(html).not.toContain('#contact')
    }
  })
})
