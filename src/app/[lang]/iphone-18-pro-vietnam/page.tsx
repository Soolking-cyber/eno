import type { Metadata } from 'next'
import { ModelLanding, modelMeta, type ModelPageConfig } from '../iphone-18-vietnam/model-landing'

/**
 * ⚠️ ONE HOUR, because this page PRINTS PRICES. A stale figure on a page that ranks for "iPhone 18
 * Pro price" is worse than no page, and the affiliate refresh cron re-reads retailer prices nightly.
 */
export const revalidate = 3600

const CFG: ModelPageConfig = {
  model: 'iPhone 18 Pro',
  slug: 'iphone-18-pro-vietnam',
  eyebrow: 'Apple · Vietnam',
  h1: 'iPhone 18 Pro price in Vietnam',
  intro:
    'The iPhone 18 Pro is the smaller of Apple’s two autumn 2026 flagships — a 6.3-inch phone that reached Vietnamese buyers on 18 September 2026, in four storage tiers from 256GB to 2TB.',
  rrp: 38_999_000,
  shipDate: Date.UTC(2026, 8, 18),
  cta: 'Browse every iPhone 18 Pro',
  browseQuery: 'iPhone 18 Pro',
  sections: [
    {
      title: 'What you give up against the Pro Max',
      body:
        'The two Pro models share a chip, a camera system and a build; what separates them is size and the battery that fits behind it. The 6.3-inch Pro is the one that works one-handed and slips into a pocket on a motorbike commute, and it costs roughly 3 million đồng less than the Pro Max at every storage tier. What you trade is screen area and endurance — the Pro Max runs noticeably longer on a heavy day of navigation and video. If you ride a lot and shoot a little, the Pro is the right half of the pair.',
    },
    {
      title: 'Storage, and why the tiers cost more here',
      body:
        'The Pro starts at 256GB and runs 512GB, 1TB and 2TB, with no card slot to fall back on. In Vietnam the gap between tiers is wider than US retail: the step from 256GB to 2TB roughly doubles the price. The 256GB model is also the tier that holds its value best on the Vietnamese second-hand market, where most buyers are replacing a two-year-old phone rather than chasing capacity. Buy the storage only if you actually shoot ProRes.',
    },
    {
      title: 'Chính hãng VN/A, and why some prices look too good',
      body:
        'A phone sold “chính hãng VN/A” is an Apple Vietnam unit: the model number ends in VN/A, it carries the 12-month Apple Vietnam warranty, and any authorised service centre will take it. Cheaper grey-market units — LL/A from the US, ZA/A from Singapore — are imported and warranted by the shop rather than by Apple Vietnam, which is fine until a screen fails. Check the model number in Settings › General › About before you pay, and check the IMEI on Apple’s coverage page.',
    },
    {
      title: 'Buying one as a foreigner',
      body:
        'A passport is enough to buy outright at any Vietnamese retailer; no residence card or local ID is needed, though 0% instalment plans generally are. All four networks issue eSIM profiles, so an eSIM-only imported handset works here. If you are visiting and fly out within 60 days, keep the VAT invoice — the airport refund scheme returns most of the 10% VAT on invoices over 2,000,000 ₫ from a registered shop, claimed at the departure terminal before check-in.',
    },
  ],
  faqs: [
    {
      q: 'How much is an iPhone 18 Pro in Vietnam?',
      a: 'The table above shows the lowest live listing per storage tier, read from Vietnamese retailers, with the date it was last checked printed beside it. Apple Vietnam’s own recommended price starts at 38.999.000 ₫ for 256GB; retailers usually list below it once launch demand clears.',
    },
    {
      q: 'Is the iPhone 18 Pro worth it over the iPhone 17 Pro?',
      a: 'If you are coming from a 17 Pro, no — it is a one-generation step and the 17 Pro is heavily discounted on the second-hand market here. From a 15 Pro or older the jump is real: a brighter display, a longer telephoto and several years of iOS support still ahead of it.',
    },
    {
      q: 'What is the difference between the iPhone 18 Pro and Pro Max?',
      a: 'Size and battery. The Pro is 6.3 inches, the Pro Max 6.9, and the larger body holds a bigger cell that shows on a long day of navigation or video. The chip, cameras, materials and storage tiers are the same, and the Pro costs roughly 3 million đồng less at each tier.',
    },
    {
      q: 'Does the iPhone 18 Pro support Vietnamese eSIM?',
      a: 'Yes. Viettel, VinaPhone, MobiFone and Vietnamobile all issue eSIM profiles, so both dual-SIM VN/A handsets and eSIM-only imported models work on local networks.',
    },
    {
      q: 'Will the price drop?',
      a: 'Usually. Vietnamese retail prices for a new iPhone typically settle 1–3 million đồng below launch within the first two months as pre-orders clear. This page re-reads live listings as it regenerates, so it shows the fall as it happens.',
    },
  ],
  related: [
    { href: '/iphone-18-pro-max-vietnam', label: 'iPhone 18 Pro Max price', blurb: 'The 6.9-inch model — same chip and cameras, bigger battery, about 3 million đồng more per tier.' },
    { href: '/iphone-duo-vietnam', label: 'iPhone Duo price', blurb: 'Apple’s first foldable, on sale in Vietnam from 23 October 2026.' },
    { href: '/iphone-18-vietnam', label: 'The whole iPhone 18 line', blurb: 'Pro, Pro Max and Duo compared on one page, with every live price.' },
  ],
}

export const metadata: Metadata = modelMeta(
  CFG,
  'What an iPhone 18 Pro costs in Vietnam right now: live prices by storage tier from Vietnamese retailers, how it differs from the Pro Max, and what “chính hãng VN/A” means when you buy as a foreigner.',
)

export default function IPhone18ProVietnamPage() {
  return <ModelLanding cfg={CFG} />
}
