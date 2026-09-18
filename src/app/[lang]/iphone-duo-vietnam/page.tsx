import type { Metadata } from 'next'
import { ModelLanding, modelMeta, type ModelPageConfig } from '../iphone-18-vietnam/model-landing'
import { IPHONE_DUO_MODEL } from '../iphone-18-vietnam/lowest-prices'

/** ⚠️ ONE HOUR — see the note on the sibling pages; a stale price is worse than no page. */
export const revalidate = 3600

const CFG: ModelPageConfig = {
  /**
   * ⚠️ IMPORTED, NOT RETYPED. The model is free text in `Listing.model`, so the page and the query
   * have to agree on the exact string — and "iPhone Duo" is precisely the kind of value somebody
   * would reasonably write as "iPhone 18 Duo" or "iPhone Fold" and get an empty page for.
   */
  model: IPHONE_DUO_MODEL,
  slug: 'iphone-duo-vietnam',
  eyebrow: 'Apple · Vietnam',
  h1: 'iPhone Duo price in Vietnam',
  intro:
    'The iPhone Duo is Apple’s first folding iPhone — sold under that name rather than as an “iPhone 18 Fold” — announced alongside the Pro models on 9 September 2026 and on sale in Vietnam from 23 October, with pre-orders from 7pm on 16 October. It is the first iPhone officially sold here above 100 million đồng at its top tier.',
  rrp: 64_999_000,
  shipDate: Date.UTC(2026, 9, 23),
  cta: 'Browse every iPhone Duo',
  browseQuery: 'iPhone Duo',
  sections: [
    {
      title: 'What “Duo” actually is',
      body:
        'A book-style foldable: a compact outer screen you use one-handed, opening to a tablet-sized inner display. Apple arrived years after Samsung, Huawei and Oppo shipped theirs in Vietnam, and the pitch is not novelty but the two things earlier foldables kept trading away — a crease you can feel, and a hinge that ages. Whether Apple actually solved either is something a launch review cannot tell you; the honest advice on a first-generation folding phone from any maker is to wait for the second batch if you cannot replace it easily.',
    },
    {
      title: 'Why it costs what it costs here',
      body:
        'Vietnamese prices include 10% VAT and the Duo starts around 65 million đồng, running past 100 million at 2TB — roughly double a same-storage iPhone 18 Pro. Most of that is the folding display and hinge, which are the expensive, failure-prone parts of every foldable on the market. It is worth comparing against the Galaxy Z Fold line sold here, which is several generations into the same problem and routinely discounted well below its own launch price a few months in.',
    },
    {
      title: 'Repairs, and the question to ask before you buy',
      body:
        'A folding screen is the single most expensive component on the phone and it is not covered by the standard warranty when it fails from wear rather than defect. Before paying, ask the retailer what an out-of-warranty inner-screen replacement costs and whether an authorised centre in Vietnam can do it at all, or whether the unit ships abroad — on a first-generation device the answer is often the latter, which means weeks without the phone. AppleCare+ is worth more on this model than on any other iPhone sold here.',
    },
    {
      title: 'Chính hãng VN/A, and buying as a foreigner',
      body:
        'A “chính hãng VN/A” unit is an Apple Vietnam phone with the 12-month Apple Vietnam warranty honoured by every authorised service centre; imported LL/A or ZA/A handsets are warranted by the shop instead. On a foldable that distinction is worth more than the price gap, for the repair reasons above. A passport is enough to buy outright; instalment plans generally need a Vietnamese ID or residence card, and visitors flying out within 60 days can reclaim most of the 10% VAT at the airport on invoices over 2,000,000 ₫.',
    },
  ],
  faqs: [
    {
      q: 'When does the iPhone Duo go on sale in Vietnam?',
      a: 'Pre-orders open at 7pm on 16 October 2026 and deliveries begin on 23 October 2026. Listings before that date are pre-orders, whatever the retailer’s page says.',
    },
    {
      q: 'How much is the iPhone Duo in Vietnam?',
      a: 'Apple Vietnam prices run from 64.999.000 ₫ for 256GB to 103.999.000 ₫ for 2TB — the first iPhone sold officially here above 100 million đồng. The table above shows what Vietnamese retailers are actually listing, with the date it was last checked printed beside it.',
    },
    {
      q: 'Is it called the iPhone 18 Fold?',
      a: 'No. Apple sells it as iPhone Duo, outside the numbered line entirely, which is why it has its own page here and its own row in the family comparison. Vietnamese retailers sometimes list it as “iPhone Fold” or “iPhone 18 Fold” in their own copy.',
    },
    {
      q: 'Should I buy a first-generation foldable?',
      a: 'If you cannot comfortably replace the phone, wait. Folding screens and hinges are the parts that fail, the repair is the most expensive on the device, and no first-generation foldable from any maker has had its durability settled at launch. AppleCare+ changes that calculation more here than on a regular iPhone.',
    },
    {
      q: 'How does it compare with the Samsung Galaxy Z Fold?',
      a: 'Samsung is several generations into the same engineering problem and its folding line is widely available in Vietnam, usually discounted well below launch within a few months. If the form factor is what you want rather than iOS specifically, the Fold is the cheaper and more proven way to get it.',
    },
    {
      q: 'Does the iPhone Duo work with Vietnamese eSIM?',
      a: 'Yes. Viettel, VinaPhone, MobiFone and Vietnamobile all issue eSIM profiles, so both VN/A and imported units work on local networks.',
    },
  ],
  related: [
    { href: '/iphone-18-pro-vietnam', label: 'iPhone 18 Pro price', blurb: 'The 6.3-inch flagship — roughly half the Duo’s price at the same storage tier.' },
    { href: '/iphone-18-pro-max-vietnam', label: 'iPhone 18 Pro Max price', blurb: 'The 6.9-inch flagship, if you want the big screen without the fold.' },
    { href: '/iphone-18-vietnam', label: 'The whole iPhone 18 line', blurb: 'Pro, Pro Max and Duo compared on one page, with every live price.' },
  ],
}

export const metadata: Metadata = modelMeta(
  CFG,
  'What Apple’s folding iPhone Duo costs in Vietnam: live retailer prices by storage tier, the 23 October on-sale date, repair costs to ask about before buying, and how it compares with the Galaxy Z Fold.',
)

export default function IPhoneDuoVietnamPage() {
  return <ModelLanding cfg={CFG} />
}
