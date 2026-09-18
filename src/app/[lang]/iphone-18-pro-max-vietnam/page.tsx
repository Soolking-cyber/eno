import type { Metadata } from 'next'
import { ModelLanding, modelMeta, type ModelPageConfig } from '../iphone-18-vietnam/model-landing'

/** ⚠️ ONE HOUR — see the note on the sibling page; a stale price is worse than no page. */
export const revalidate = 3600

const CFG: ModelPageConfig = {
  model: 'iPhone 18 Pro Max',
  slug: 'iphone-18-pro-max-vietnam',
  eyebrow: 'Apple · Vietnam',
  h1: 'iPhone 18 Pro Max price in Vietnam',
  intro:
    'The iPhone 18 Pro Max is Apple’s largest 2026 flagship — a 6.9-inch phone that reached Vietnamese buyers on 18 September 2026, in four storage tiers from 256GB to 2TB, and the most expensive non-folding iPhone sold here.',
  rrp: 41_999_000,
  shipDate: Date.UTC(2026, 8, 18),
  cta: 'Browse every iPhone 18 Pro Max',
  browseQuery: 'iPhone 18 Pro Max',
  sections: [
    {
      title: 'What the extra 3 million đồng buys',
      body:
        'Against the 6.3-inch Pro, the Pro Max adds screen and battery and nothing else — same chip, same cameras, same titanium build, same four storage tiers. On paper that is a thin difference; in daily use in Vietnam it is the one that matters most, because the larger cell is what survives a day of Google Maps on a motorbike with the screen at full brightness under sun. If your phone spends the day in a bag and you read on it, the size is worth paying for. If it lives in a pocket and you ride, the Pro is the better shape.',
    },
    {
      title: 'The 2TB tier, and who it is actually for',
      body:
        'The Pro Max is the only iPhone where the 2TB tier sells in any volume here, and it is bought almost entirely by people shooting ProRes or ProRes RAW for work — an hour of 4K ProRes is roughly 250GB, so the capacity is a working constraint rather than a luxury. Everyone else is better served by 256GB or 512GB plus iCloud: the 2TB commands a much thinner second-hand premium than its price gap suggests, so the extra outlay is not recovered at resale.',
    },
    {
      title: 'Chính hãng VN/A, and why some prices look too good',
      body:
        'A phone sold “chính hãng VN/A” is an Apple Vietnam unit: the model number ends in VN/A, it carries the 12-month Apple Vietnam warranty, and any authorised service centre will take it. Cheaper grey-market units — LL/A from the US, ZA/A from Singapore — are imported and warranted by the shop rather than by Apple Vietnam. The gap is widest on the Pro Max precisely because the absolute numbers are largest, so this is the model where checking the model number in Settings › General › About before paying matters most.',
    },
    {
      title: 'Buying one as a foreigner',
      body:
        'A passport is enough to buy outright at any Vietnamese retailer; no residence card or local ID is needed, though 0% instalment plans generally are. All four networks issue eSIM profiles, so an eSIM-only imported handset works here. If you are visiting and fly out within 60 days, keep the VAT invoice — the airport refund returns most of the 10% VAT on invoices over 2,000,000 ₫, which on a Pro Max is a meaningful sum, claimed at the departure terminal before check-in.',
    },
  ],
  faqs: [
    {
      q: 'How much is an iPhone 18 Pro Max in Vietnam?',
      a: 'The table above shows the lowest live listing per storage tier, read from Vietnamese retailers, with the date it was last checked printed beside it. Apple Vietnam’s own recommended price starts at 41.999.000 ₫ for 256GB and runs past 100 million đồng at 2TB.',
    },
    {
      q: 'Is the Pro Max worth 3 million đồng more than the Pro?',
      a: 'It buys screen size and battery life, not capability — the chip, cameras and storage tiers are identical. For heavy navigation, video and reading it is the better phone; for one-handed use and pocket carry it is not, and the Pro saves the difference at every tier.',
    },
    {
      q: 'How much storage do I actually need?',
      a: '256GB suits most people who use iCloud and stream. Go to 512GB if you keep a large offline photo library, and to 1TB or 2TB only if you shoot ProRes video for work — an hour of 4K ProRes is roughly 250GB, and there is no card slot.',
    },
    {
      q: 'Does the iPhone 18 Pro Max support Vietnamese eSIM?',
      a: 'Yes. Viettel, VinaPhone, MobiFone and Vietnamobile all issue eSIM profiles, so both dual-SIM VN/A handsets and eSIM-only imported models work on local networks.',
    },
    {
      q: 'Will the price drop?',
      a: 'Usually. Vietnamese retail prices for a new iPhone typically settle 1–3 million đồng below launch within the first two months as pre-orders clear, and the slide is largest in absolute terms on the Pro Max. This page re-reads live listings as it regenerates, so it shows the fall as it happens.',
    },
  ],
  related: [
    { href: '/iphone-18-pro-vietnam', label: 'iPhone 18 Pro price', blurb: 'The 6.3-inch model — same chip and cameras, smaller battery, about 3 million đồng less per tier.' },
    { href: '/iphone-duo-vietnam', label: 'iPhone Duo price', blurb: 'Apple’s first foldable, on sale in Vietnam from 23 October 2026.' },
    { href: '/iphone-18-vietnam', label: 'The whole iPhone 18 line', blurb: 'Pro, Pro Max and Duo compared on one page, with every live price.' },
  ],
}

export const metadata: Metadata = modelMeta(
  CFG,
  'What an iPhone 18 Pro Max costs in Vietnam right now: live prices by storage tier from Vietnamese retailers, whether the size is worth the premium over the Pro, and what “chính hãng VN/A” means.',
)

export default function IPhone18ProMaxVietnamPage() {
  return <ModelLanding cfg={CFG} />
}
