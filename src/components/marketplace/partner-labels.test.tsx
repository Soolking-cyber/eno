import * as React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { renderToString } from 'react-dom/server'

/**
 * WHAT A BUYER IS TOLD ABOUT AN OFFICIAL PARTNER (2026-10-01, round 2), in both languages:
 *   · the badge's tooltip states the SIGNED AGREEMENT — the /partners definition since the owner withdrew
 *     the badge from every import/affiliate storefront — never "eno carries this shop's catalogue";
 *   · the PDP chat footnote never offers a partner's phone number: `phoneForSeller` refuses partners
 *     (src/lib/contact.ts) and the reveal route answers 403 `partner_chat_only`;
 *   · the Linked-shop chip claims no verb ("buy") that is false on a job board or a rental portal.
 * ⚠️ ui/tooltip is stubbed to print its content: the real one renders nothing until hovered.
 */

let LANG = 'en'
vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ lang: LANG, tr: (en: string, vi?: string) => (LANG === 'vi' && vi != null ? vi : en), t: (en: string, vi?: string) => (LANG === 'vi' && vi != null ? vi : en), setLang: () => {} }),
  useTr: () => (en: string) => en,
  Tr: ({ text }: { text: string }) => text,
}))
vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ content, children }: { content: React.ReactNode; children: React.ReactNode }) => <span data-tooltip="">{content}{children}</span>,
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }) }))
vi.mock('@/context/auth-context', () => ({ useAuth: () => ({ user: null, loading: false, openSignIn: vi.fn() }) }))

import { PartnerBadge } from './partner-badge'
import { LinkedShopChip } from './linked-shop-chip'
import { ContactComposer } from './contact-composer'

const text = (html: string) => html.replace(/<!-- -->/g, '').replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim()
const both = (fn: () => string) => { LANG = 'en'; const en = fn(); LANG = 'vi'; const vi = fn(); LANG = 'en'; return { en, vi } }

describe('PartnerBadge — the tooltip states the agreement', () => {
  it('says "a company with a signed agreement with eno", never "carries this shop\'s catalogue"', () => {
    for (const asLink of [true, false]) {
      const { en, vi } = both(() => text(renderToString(<PartnerBadge asLink={asLink} />)))
      expect(en).toContain('Official partner — a company with a signed agreement with eno')
      expect(vi).toContain('Đối tác chính thức — doanh nghiệp đã ký thỏa thuận hợp tác với eno')
      expect(en).not.toMatch(/catalogue/i)
      expect(vi).not.toContain('danh mục sản phẩm')
    }
  })
})

describe('ContactComposer — the footnote under Chat now', () => {
  const footnote = (sellerIsPartner?: boolean) =>
    both(() => text(renderToString(<ContactComposer listingId="l1" currency="₫" price={100_000} negotiable={false} sellerIsPartner={sellerIsPartner} />)))

  it('an ordinary seller: request their number once they reply (Zalo + WhatsApp)', () => {
    const { en, vi } = footnote()
    expect(en).toContain('Request their number once they reply — one number works for both Zalo and WhatsApp.')
    expect(vi).toContain('Yêu cầu số điện thoại sau khi họ trả lời')
  })

  it('an official partner: never offers a number — the server refuses one (partner_chat_only)', () => {
    const { en, vi } = footnote(true)
    expect(en).toContain('Official partners talk with buyers in eno chat — no phone number is shared.')
    expect(vi).toContain('Đối tác chính thức trao đổi với người mua qua chat trên eno — không chia sẻ số điện thoại.')
    expect(en).not.toMatch(/Request their number|Zalo|WhatsApp/)
    expect(vi).not.toMatch(/Yêu cầu số điện thoại|Zalo|WhatsApp/)
  })
})

describe('LinkedShopChip — no verb that is false on a job board or rental portal', () => {
  it('says the listings link to the source, and nothing about buying', () => {
    const { en, vi } = both(() => text(renderToString(<LinkedShopChip />)))
    expect(en).toContain('Linked shop')
    expect(en).toContain('Its listings link to the source website — you continue there.')
    expect(vi).toContain('Tin đăng dẫn link về website gốc — bạn tiếp tục tại đó.')
    expect(en).not.toMatch(/\bbuy\b/i)
    expect(vi).not.toMatch(/\bmua\b/)
  })
})
