// @vitest-environment jsdom
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
import { StorefrontChatButton } from './storefront-chat-button'
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

/** The [Chat][Share][⋯] row's members (owner, 2026-11-16 — hub Q21; store-pair.ts): a pair only when both are drawn. */
describe('the storefront row — Chat and Share an equal pair only together (review, 2026-11-16)', () => {
  const dom = (html: string) => { const d = document.createElement('div'); d.innerHTML = html; return d }
  const tokens = (el: Element | null) => (el?.getAttribute('class') ?? '').split(/\s+/)
  /** A stand-in for the page's Share, held in a constant for the i18n lint. */
  const SHARE = 'Share'

  it('the path storefront\'s Chat: half the row beside Share; ⛔ alone (a shop with no handle has no Share) its own width', () => {
    const paired = tokens(dom(renderToString(<StorefrontChatButton chatListingId="l1" />)).querySelector('button'))
    expect(paired).toEqual(expect.arrayContaining(['flex-1', 'min-w-0', 'min-h-11', 'px-3']))
    const alone = tokens(dom(renderToString(<StorefrontChatButton chatListingId="l1" alone />)).querySelector('button'))
    expect(alone).toEqual(expect.arrayContaining(['min-h-11', 'px-8']))
    expect(alone).not.toContain('flex-1')
  })

  it('the shop\'s own host: "Chat on …" is Share\'s equal, 16px under the identity; its label may wrap, its 12px sides may not', () => {
    LANG = 'vi'
    const d = dom(render({ chatListingId: 'lst1', chatOrigin: 'https://eno.vn', actions: <button type="button">{SHARE}</button> }))
    LANG = 'en'
    const link = d.querySelector('a[href="https://eno.vn/listings/lst1#contact"]')
    // On the Button, merged: the Button's own `whitespace-nowrap` is gone, not left to fight it.
    expect(tokens(link)).toEqual(expect.arrayContaining(['flex-1', 'min-w-0', 'px-3', 'whitespace-normal', 'text-center']))
    expect(tokens(link)).not.toContain('whitespace-nowrap')
    // Share stands as tall as a two-line label beside it.
    expect(tokens(d.querySelector('[data-store-actions]'))).toEqual(expect.arrayContaining(['flex', 'items-stretch']))
    expect(tokens(d.firstElementChild)).toEqual(expect.arrayContaining(['flex-col', 'gap-3', 'max-sm:gap-4']))
  })

  it('the shop\'s own host with no `actions`: the lone Chat keeps its own width', () => {
    const d = dom(render({ chatListingId: 'lst1', chatOrigin: 'https://eno.vn' }))
    const link = tokens(d.querySelector('a[href$="#contact"]'))
    expect(link).toContain('px-8')
    expect(link).not.toContain('flex-1')
  })
})
