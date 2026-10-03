import type { SeoRailTarget } from '@/components/marketplace/seo-listing-rail'
import { PHONE_GUIDES, phoneGuideCategories } from './phone-guides'

/**
 * THE SECOND-HAND RAIL UNDER EVERY PHONE GUIDE (second-hand focus, owner 2026-10-03).
 *
 * The 36 phone guides ended on "Keep reading" — editorial text with no inventory under it. They now end
 * on the second-hand phones the marketplace actually lists: SeoArticle applies this by default to any
 * phone guide whose primary shelf is electronics (`content.rail` still wins where a page sets one). The
 * rail renders only with at least four listings (SeoListingRail's `minCount`), so a thin shelf leaves the
 * article ending as it did.
 *
 * ⚠️ NARROWED BY BRAND WHERE THE GUIDE IS ABOUT ONE (review, 2026-10-03): unnarrowed, a phones rail
 * sorted by price opened on ₫300,000 Masstel feature phones — under "Buying a used iPhone". The iPhone and
 * iPad guides rail used Apple phones and tablets, the Galaxy pair used Samsung, the rest any used phone.
 * ⚠️ NEWEST FIRST, NOT CHEAPEST (`order: 'recent'`): a guide's rail is a window on what is for sale, not a
 * price ranking — the cheapest end of a used shelf is exactly the junk that reads as an empty market.
 * ⛔ NOT THE eSIM PAIR: its primary shelf is services (carrier eSIMs), and a phones rail there is off-topic.
 */
const APPLE_GUIDES = new Set([
  'best-place-to-buy-iphone-vietnam', 'mua-iphone-o-dau-uy-tin',
  'chinh-hang-vs-xach-tay-vietnam', 'iphone-chinh-hang-va-xach-tay',
  'buying-a-used-iphone-vietnam', 'kinh-nghiem-mua-iphone-cu',
  'iphone-18-vs-iphone-17-vietnam', 'co-nen-len-doi-iphone-18',
  'ipad-buying-guide-vietnam', 'mua-ipad-loai-nao-tot',
  'iphone-battery-replacement-vietnam', 'thay-pin-iphone-o-dau',
])
const SAMSUNG_GUIDES = new Set(['samsung-galaxy-buying-guide-vietnam', 'mua-samsung-galaxy-dong-nao'])

const COPY = {
  apple: {
    en: { title: 'Second-hand iPhones and iPads for sale now', cta: 'Browse second-hand iPhones and iPads' },
    vi: { title: 'iPhone và iPad cũ đang được rao bán', cta: 'Xem iPhone, iPad cũ' },
  },
  samsung: {
    en: { title: 'Second-hand Samsung phones for sale now', cta: 'Browse second-hand Samsung phones' },
    vi: { title: 'Điện thoại Samsung cũ đang được rao bán', cta: 'Xem điện thoại Samsung cũ' },
  },
  any: {
    en: { title: 'Second-hand phones for sale now', cta: 'Browse second-hand phones' },
    vi: { title: 'Điện thoại cũ đang được rao bán', cta: 'Xem điện thoại cũ' },
  },
} as const

export type PhoneGuideRail = { target: SeoRailTarget; title: string; cta: string }

/** The default rail for the phone guide at `canonical` (`/<slug>`), or undefined when it gets none. */
export function phoneGuideRail(canonical: string): PhoneGuideRail | undefined {
  const slug = canonical.replace(/^\//, '').replace(/\/$/, '')
  const guide = PHONE_GUIDES.find((g) => g.slug === slug)
  if (!guide || phoneGuideCategories(guide)[0] !== 'electronics') return undefined
  const brand = APPLE_GUIDES.has(slug) ? 'apple' : SAMSUNG_GUIDES.has(slug) ? 'samsung' : undefined
  const copy = COPY[brand ?? 'any'][guide.lang]
  return {
    target: {
      categorySlug: 'electronics',
      subcategorySlug: 'phones-tablets',
      condition: 'used',
      ...(brand ? { brandSlug: brand } : {}),
      order: 'recent',
    },
    title: copy.title,
    cta: copy.cta,
  }
}
