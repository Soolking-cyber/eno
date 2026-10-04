import * as React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { renderToString } from 'react-dom/server'

/**
 * WHAT A BUYER READS ON CARDS, PDPs AND STOREFRONTS — the 2026-10-01 compliance pass (W-C), pinned on the
 * rendered components, in both languages:
 *   · the vehicle-hire safety lines (no "landlord or agent" on a car; the driving-licence line);
 *   · the commission disclosure beside a COMMISSION-BEARING partner CTA, and only there;
 *   · "not verified by eno.vn / chưa xác minh" (never "chưa kiểm duyệt") on a linked listing's shop row;
 *   · the unrated / Linked-shop rules on the PDP shop row;
 *   · "Seller information" — business rows, the linked-shop source, and what it never prints;
 *   · "eno is not a party to this offer" (never "a price offer is not a contract").
 * ⚠️ vitest pins NEXT_PUBLIC_ENO_EDITION=services (vitest.config.ts), so edition-split copy renders its
 * eno.forum variant here unless a test re-imports under the marketplace edition.
 */

let LANG = 'en'
vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ lang: LANG, tr: (en: string, vi?: string) => (LANG === 'vi' && vi != null ? vi : en), t: (en: string, vi?: string) => (LANG === 'vi' && vi != null ? vi : en), setLang: () => {} }),
  useTr: () => (en: string) => en,
  Tr: ({ text }: { text: string }) => text,
}))
vi.mock('@/hooks/use-mounted', () => ({ useMounted: () => false }))

import { SafetyStrip } from './safety-strip'
import { AffiliateBooking, AffiliateCtaRepeat } from './affiliate-booking'
import { PdpShopLink } from './pdp-shop-link'
import { SellerCard } from './seller-card'
import { SellerInfo } from './seller-info'
import { OfferPartiesNote } from './chat-safety-note'
import { AffiliateNote } from '@/app/[lang]/iphone-18-vietnam/price-table'
import type { SellerMetrics } from '@/lib/seller-metrics'

const text = (html: string) => html.replace(/<!-- -->/g, '').replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim()
const both = (fn: () => string) => { LANG = 'en'; const en = fn(); LANG = 'vi'; const vi = fn(); LANG = 'en'; return { en, vi } }

describe('SafetyStrip — vehicle hire is not a home (2026-10-01)', () => {
  const strip = (sub: string | null, variant?: 'affiliate-rental') => text(renderToString(<SafetyStrip categorySlug="rentals" subcategorySlug={sub} variant={variant} />))

  it('an imported car or motorbike gets the vehicle line, never "landlord or agent", plus the licence line', () => {
    for (const sub of ['car-rental', 'motorbike-rental']) {
      const { en, vi } = both(() => strip(sub, 'affiliate-rental'))
      expect(en).not.toMatch(/landlord|agent/i)
      expect(vi).not.toMatch(/chủ nhà|môi giới/)
      expect(en).toContain('Book through the rental platform or the shop itself, and check the vehicle and its papers at handover. eno never takes payment or a deposit for these listings and cannot refund one.')
      expect(vi).toContain('Đặt thuê qua nền tảng cho thuê hoặc trực tiếp với cửa hàng, và kiểm tra xe cùng giấy tờ xe khi nhận xe.')
      // Mioto/BonbonCar are booked AND paid on the platform (vehicle-rental-listing.ts) — "check before you pay" does not fit.
      expect(en).not.toContain('before you pay')
      expect(en).not.toContain('Book only on the rental website')
      // SELF-DRIVE: car-rental also holds hire with a driver (taxonomy.ts), where the hirer needs no licence.
      expect(en).toContain('Driving a hired car or motorbike yourself needs a valid licence for it — an owner may not hand a vehicle to someone without one.')
      expect(vi).toContain('Tự lái ô tô hoặc xe máy thuê cần có giấy phép lái xe hợp lệ, đúng hạng xe — chủ xe không được giao xe cho người không có giấy phép lái xe.')
      expect(en).not.toContain('Renting a car or motorbike needs')
    }
  })

  it('a bicycle or an e-bike gets the vehicle line but no licence line', () => {
    for (const sub of ['bicycle-rental', 'ebike-rental']) {
      const en = strip(sub, 'affiliate-rental')
      expect(en).not.toMatch(/landlord/i)
      expect(en).not.toContain('valid licence')
    }
  })

  it("a seller's OWN car rental gets the vehicles papers line, not the housing \"hold a place\" one", () => {
    const en = strip('car-rental')
    expect(en).toContain('Check the papers match the chassis before paying')
    expect(en).not.toContain('hold a place')
    expect(en).toContain('Driving a hired car or motorbike yourself')
  })

  it('Vehicles › Parts is goods: the goods line, not papers-and-chassis (pdp-08); a car keeps the papers line', () => {
    const parts = both(() => text(renderToString(<SafetyStrip categorySlug="vehicles" subcategorySlug="parts-gear" />)))
    expect(parts.en).toContain('Meet, inspect, then pay.')
    expect(parts.vi).toContain('Gặp trực tiếp, kiểm tra hàng rồi mới trả tiền.')
    expect(parts.en).not.toContain('chassis')
    expect(text(renderToString(<SafetyStrip categorySlug="vehicles" subcategorySlug="car" />))).toContain('Check the papers match the chassis before paying')
    expect(text(renderToString(<SafetyStrip categorySlug="vehicles" />))).toContain('Check the papers match the chassis before paying')
  })

  it('an apartment is unchanged — the housing line, no licence line', () => {
    expect(strip('apartment-rental', 'affiliate-rental')).toContain('See the place and meet the landlord or agent before you pay anything.')
    expect(strip('apartment-rental', 'affiliate-rental')).not.toContain('valid licence')
    expect(strip(null)).toContain('Visit in person before paying any deposit')
  })

  it('no "partner" and no "eno.vn" on a vehicle rental (the strip renders on both editions)', () => {
    for (const lang of ['en', 'vi']) {
      LANG = lang
      expect(strip('car-rental', 'affiliate-rental')).not.toMatch(/partner|đối tác|eno\.vn/i)
    }
    LANG = 'en'
  })
})

/**
 * ⛔ NO "PARTNER" FOR A SELLER THAT IS NOT ONE (review P2, 2026-10-01): "partner" now means a signed agreement
 * (partner-badge.tsx's tooltip), and the ticket sellers and shops behind these rows hold none.
 */
describe('linked ticket and code copy names the seller or the operator, never a partner', () => {
  it("the ticket safety line (variant 'affiliate'), both languages", () => {
    const { en, vi } = both(() => text(renderToString(<SafetyStrip categorySlug="tickets-travel" variant="affiliate" />)))
    expect(en).toContain("Book only on the operator's own website — eno never takes payment or a deposit for these tickets, and cannot refund one.")
    expect(vi).toContain('Chỉ đặt vé trên website chính thức của nhà cung cấp — eno không bao giờ nhận thanh toán hay tiền cọc cho các vé này, và không thể hoàn tiền.')
    for (const t of [en, vi]) expect(t).not.toMatch(/partner|đối tác|eno\.vn/i)
  })
  it('the iPhone price table’s commission note calls the link an affiliate link, both languages', () => {
    const { en, vi } = both(() => text(renderToString(<AffiliateNote />)))
    expect(en).toContain('through a tracked affiliate link, which may earn this site a commission at no cost to you.')
    // "shop", not "retailer" since the second-hand focus (2026-10-03): the rows are used listings.
    expect(en).toContain('when two listings ask exactly the same, the one with the tracked link is shown.')
    expect(vi).toContain('tin có liên kết được theo dõi sẽ được hiển thị')
    for (const t of [en, vi]) expect(t).not.toMatch(/partner|đối tác/i)
  })
  it('the discount-code step names the seller’s site, both languages', () => {
    const { en, vi } = both(() => text(renderToString(<AffiliateBooking url="https://shorten.asia/Abc" partnerName="VinWonders" listingId="l1" booking discountCode="ENO10" />)))
    expect(en).toContain('Sign in on the VinWonders website and enter the code at the payment step.')
    expect(vi).toContain('Đăng nhập trên website VinWonders và nhập mã tại bước thanh toán.')
    for (const t of [en, vi]) expect(t).not.toMatch(/partner site|trang đối tác/i)
  })
})

describe('AffiliateBooking — the QR code’s accessible name follows the page (quality-12, 2026-10-04)', () => {
  const qrLabel = (props: Record<string, unknown>) => renderToString(<AffiliateBooking url="https://shorten.asia/Abc" partnerName="Vin$&Wonders" listingId="l1" booking {...props} />).match(/<svg[^>]*aria-label="([^"]*)"/)?.[1]
  it('Vietnamese on a vi page, English otherwise — and a `$` in the name prints as typed', () => {
    expect(qrLabel({ lang: 'vi' })).toBe('Mã QR để đặt trên Vin$&amp;Wonders')
    expect(qrLabel({})).toBe('QR code to book on Vin$&amp;Wonders')
    expect(qrLabel({ lang: 'vi', job: true })).toBe('Mã QR để mở tin tuyển dụng trên Vin$&amp;Wonders')
    expect(qrLabel({ lang: 'vi', rental: true, booking: false })).toBe('Mã QR để mở tin cho thuê trên Vin$&amp;Wonders')
  })
})

describe('AffiliateBooking — the commission disclosure (owner reversal, 2026-10-01)', () => {
  const box = (url: string, extra: Record<string, unknown> = {}) => text(renderToString(<AffiliateBooking url={url} partnerName="Shop" listingId="l1" booking={false} {...extra} />))
  const SENTENCE = 'We may earn a commission if you buy through this link, at no extra cost to you.'

  it('beside a commission-bearing (AccessTrade) CTA, in both languages', () => {
    const { en, vi } = both(() => box('https://go.isclix.com/deep_link/1/2?url=https%3A%2F%2Fcellphones.com.vn%2Fx'))
    expect(en).toContain(SENTENCE)
    // vitest runs the services edition, so the Vietnamese names eno.forum (the eno.vn twin is a literal).
    expect(vi).toContain('eno.forum có thể nhận hoa hồng nếu bạn mua qua liên kết này, bạn không phải trả thêm.')
    expect(box('https://shorten.asia/Abc')).toContain(SENTENCE)
  })

  it('never on a link that pays nothing: a rental portal, a job board, a shop’s own URL', () => {
    expect(box('https://www.nhatot.com/123.htm', { rental: true })).not.toContain('commission')
    expect(box('https://www.careerlink.vn/job/1', { job: true })).not.toContain('commission')
    expect(box('https://fptshop.com.vn/x')).not.toContain('commission')
  })

  it('the in-flow repeat CTA carries the same sentence, and only on a commission link', () => {
    expect(text(renderToString(<AffiliateCtaRepeat url="https://go.isclix.com/deep_link/1/2?url=x" partnerName="Shop" booking={false} />))).toContain(SENTENCE)
    expect(text(renderToString(<AffiliateCtaRepeat url="https://www.nhatot.com/1.htm" partnerName="Nhatot.com" booking={false} rental />))).not.toContain('commission')
  })
})

describe('PdpShopLink — linked listings, unrated storefronts, the Linked shop chip', () => {
  const metrics = { responseBucket: { key: null, en: '', vi: '' }, lastSeenDay: null, memberSinceYear: 2026, reviewCount: 0, rating: 0, trustScore: 100 } as unknown as SellerMetrics
  const row = (props: Record<string, unknown>) => renderToString(<PdpShopLink name="Shop" href="/sellers/s1" metrics={metrics} {...props} />)

  it('a linked listing says "not verified", never "kiểm duyệt"', () => {
    const { en, vi } = both(() => text(row({ linked: 'listing', unrated: true })))
    expect(en).toContain('Linked listing — not verified by eno.vn')
    expect(vi).toContain('Tin đăng dẫn link — eno.vn chưa xác minh')
    expect(vi).not.toContain('kiểm duyệt')
    const job = both(() => text(row({ linked: 'job', unrated: true })))
    expect(job.vi).toContain('Tin tuyển dụng dẫn link — eno.vn chưa xác minh')
  })

  it('an unrated storefront shows no trust chip; a rated one does', () => {
    expect(row({ unrated: true })).not.toContain('data-trust-chip')
    expect(row({})).toContain('data-trust-chip')
  })

  it('a linked shop shows the neutral chip in the partner badge’s place, and no trust chip', () => {
    const { en, vi } = both(() => row({ linked: 'listing', unrated: true, linkedShop: true }))
    expect(en).toContain('data-linked-shop-chip')
    expect(text(en)).toContain('Linked shop')
    expect(text(vi)).toContain('Cửa hàng liên kết')
    expect(en).not.toContain('data-trust-chip')
  })
})

describe('SellerCard (storefront header) — the same two rules', () => {
  const metrics = { responseBucket: { key: null, en: '', vi: '' }, lastSeenDay: null, memberSinceYear: 2026, reviewCount: 0, rating: 0, trustScore: 100 } as unknown as SellerMetrics
  const card = (seller: Record<string, unknown>) => renderToString(<SellerCard variant="storefront" metrics={metrics} seller={{ id: 's1', name: 'Shop', avatarColor: '#000', isBusiness: false, ...seller }} />)
  it('an owned storefront keeps its trust chip and shows no Linked-shop chip', () => {
    const html = card({})
    expect(html).toContain('data-trust-chip')
    expect(html).not.toContain('data-linked-shop-chip')
  })
  it('an unrated linked shop shows the neutral chip and no trust chip', () => {
    const html = card({ unrated: true, linkedShop: true })
    expect(html).not.toContain('data-trust-chip')
    expect(html).toContain('data-linked-shop-chip')
  })
  it('an unrated GUEST storefront (no linked rows) shows neither', () => {
    const html = card({ unrated: true, linkedShop: false })
    expect(html).not.toContain('data-trust-chip')
    expect(html).not.toContain('data-linked-shop-chip')
  })
})

describe('SellerInfo — who is selling (Decree 248 Art 18.1.c)', () => {
  it('a business shows legal name, address and tax code — each only when present', () => {
    const { en, vi } = both(() => text(renderToString(<SellerInfo info={{ kind: 'business', holder: 'company', legalName: 'Công ty TNHH ABC', legalAddress: '1 Lê Lợi, Quận 1, TP.HCM', taxCode: '0312345678' }} />)))
    expect(en).toContain('Seller information')
    // "Registered name", not "Business name": a business ACCOUNT can be an individual (schema.prisma, Seller.legalName).
    expect(en).toContain('Registered name Công ty TNHH ABC')
    expect(en).not.toContain('Business name')
    expect(vi).toContain('Tên đăng ký Công ty TNHH ABC')
    expect(vi).not.toContain('Tên doanh nghiệp')
    expect(en).toContain('Address 1 Lê Lợi, Quận 1, TP.HCM')
    expect(en).toContain('Tax code 0312345678')
    expect(en).toContain('As provided by the seller.')
    expect(vi).toContain('Thông tin người bán')
    expect(vi).toContain('Mã số thuế 0312345678')
    const partial = text(renderToString(<SellerInfo info={{ kind: 'business', holder: 'company', legalName: 'ABC', legalAddress: null, taxCode: '' }} />))
    expect(partial).toContain('Registered name ABC')
    expect(partial).not.toContain('Address')
    expect(partial).not.toContain('Tax code')
  })

  it('a person (no business registration number) is labelled by name, not "Business name"', () => {
    const { en, vi } = both(() => text(renderToString(<SellerInfo info={{ kind: 'business', holder: 'person', legalName: 'Nguyễn Văn A', legalAddress: null, taxCode: null }} />)))
    expect(en).toContain('Name Nguyễn Văn A')
    expect(en).not.toContain('Business name')
    expect(vi).toContain('Họ và tên Nguyễn Văn A')
  })

  it('a business with nothing entered renders NOTHING — no empty heading', () => {
    expect(renderToString(<SellerInfo info={{ kind: 'business', holder: 'company', legalName: null, legalAddress: '  ', taxCode: null }} />)).toBe('')
  })

  it('a linked shop names its source and says eno is not the seller', () => {
    const { en, vi } = both(() => text(renderToString(<SellerInfo info={{ kind: 'source', source: 'Tiki', action: 'buy' }} />)))
    expect(en).toContain('Source Tiki')
    expect(vi).toContain('Nguồn Tiki')
    expect(en).toContain('is not the seller here — you contact or buy on the source website.')
  })

  // 2026-10-01: the same caption rendered on linked JOB and RENTAL PDPs — nobody buys a job or a flat.
  it('the caption verb follows the listing type: apply for a job, contact/book for a rental, none for a mix', () => {
    const job = both(() => text(renderToString(<SellerInfo info={{ kind: 'source', source: 'VietnamWorks', action: 'apply' }} />)))
    expect(job.en).toContain('eno.forum is not the employer — you apply on the source website.')
    expect(job.vi).toContain('eno.forum không phải là nhà tuyển dụng — bạn ứng tuyển trên website gốc.')
    const rent = both(() => text(renderToString(<SellerInfo info={{ kind: 'source', source: 'Batdongsan.com.vn', action: 'rent' }} />)))
    expect(rent.en).toContain('Source Batdongsan.com.vn')
    expect(rent.en).toContain('eno.forum does not rent this out — you contact or book on the source website.')
    expect(rent.vi).toContain('eno.forum không phải là bên cho thuê — bạn liên hệ hoặc đặt thuê trên website gốc.')
    const mixed = text(renderToString(<SellerInfo info={{ kind: 'source', source: 'X', action: 'any' }} />))
    expect(mixed).toContain('each listing links to its source website, and you continue there.')
    for (const t of [job.en, rent.en, mixed]) expect(t).not.toMatch(/\bbuy\b/)
  })

  it('takes no phone or ID-number prop at all — they cannot be passed by mistake', () => {
    // @ts-expect-error — `phone` is not part of SellerInfoProps
    const html = renderToString(<SellerInfo info={{ kind: 'business', holder: 'company', legalName: 'ABC', legalAddress: null, taxCode: null, phone: '0901234567', idNumber: '079123456789' }} />)
    expect(html).not.toContain('0901234567')
    expect(html).not.toContain('079123456789')
  })
})

describe('OfferPartiesNote', () => {
  it('says eno is not a party to the offer, in both languages, naming THIS site — and never "not a contract"', () => {
    const { en, vi } = both(() => text(renderToString(<OfferPartiesNote />)))
    expect(en).toBe('eno.forum is not a party to this offer — you and the seller agree and complete any deal yourselves, off eno.forum.')
    expect(vi).toBe('eno.forum không phải là một bên của đề nghị giá này — hai bên tự thoả thuận và hoàn tất giao dịch, ngoài eno.forum.')
    expect(en).not.toMatch(/not a contract/i)
    expect(vi).not.toContain('không phải là hợp đồng')
  })
})

describe('the marketplace edition names eno.vn, not eno.forum', () => {
  it('offer note, commission sentence and source caption', async () => {
    vi.resetModules()
    vi.doMock('@/lib/edition', async (orig) => ({ ...(await orig<typeof import('@/lib/edition')>()), IS_SERVICES: false, IS_MARKETPLACE: true, SITE_NAME: 'eno.vn' }))
    const note = await import('./chat-safety-note')
    const booking = await import('./affiliate-booking')
    const info = await import('./seller-info')
    LANG = 'vi'
    expect(text(renderToString(<note.OfferPartiesNote />))).toBe('eno.vn không phải là một bên của đề nghị giá này — hai bên tự thoả thuận và hoàn tất giao dịch, ngoài eno.vn.')
    expect(text(renderToString(<booking.AffiliateBooking url="https://go.isclix.com/deep_link/1/2?url=x" partnerName="Shop" listingId="l1" booking={false} />))).toContain('eno.vn có thể nhận hoa hồng nếu bạn mua qua liên kết này, bạn không phải trả thêm.')
    LANG = 'en'
    expect(text(renderToString(<info.SellerInfo info={{ kind: 'source', source: 'Tiki', action: 'buy' }} />))).toContain('eno.vn is not the seller here')
    expect(text(renderToString(<info.SellerInfo info={{ kind: 'source', source: 'VietnamWorks', action: 'apply' }} />))).toContain('eno.vn is not the employer — you apply on the source website.')
    expect(text(renderToString(<info.SellerInfo info={{ kind: 'source', source: 'Mioto', action: 'rent' }} />))).toContain('eno.vn does not rent this out — you contact or book on the source website.')
    vi.doUnmock('@/lib/edition')
  })
})
