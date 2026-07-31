import { SITE_NAME } from '@/lib/edition'
import type { Metadata } from 'next'
import { SeoLanding, type SeoContent } from '@/components/marketplace/seo-landing'
import { VISA_CATEGORY_SLUG, VISA_SUBCATEGORY_SLUG } from '@/lib/taxonomy'
import { EVISA_HUB_PATH, evisaRelated } from '../links'

// ⚠️ 24h, NOT the 7d the other landing pages use. Those sell a category; this cluster's whole
// argument is "compare the prices on the cards below", and those cards render live
// `Listing.price` values into ISR HTML. A weekly window means an admin can change a visa price
// and this page keeps quoting the old one for six more days — on the one surface where being
// wrong about money costs the most trust. The prose is static and cheap to re-render; the prices
// are the reason for the shorter window.
export const revalidate = 86400

// ⚠️ NO PRICES IN THE PROSE. Every number a visitor needs is on the listing cards this page
// renders, and `Listing.price` is the only place a visa price is allowed to live (see
// src/lib/visa/speed.ts, which refuses to hold prices for the same reason). Copy that restates a
// figure goes stale the first time the admin edits a listing and nothing fails — the page simply
// starts lying, in the one place where being wrong about money costs the most trust.
const CONTENT: SeoContent = {
  eyebrow: 'e-Visa · Multiple entry',
  h1: 'Vietnam multiple entry e-visa: what it costs and when it pays off',
  intro:
    'A multiple-entry e-visa costs more than a single-entry one at every processing speed. Whether that difference is worth paying comes down to a single question — are you leaving Vietnam and coming back inside the same 90 days? If the answer is no, you are buying a permission you will not use.',
  categorySlug: VISA_CATEGORY_SLUG,
  subcategorySlug: VISA_SUBCATEGORY_SLUG,
  attributes: { visaEntryType: 'multiple' },
  cta: 'See multiple-entry options',
  sections: [
    {
      title: 'What you get for the difference',
      body: 'Both types are valid for up to 90 days. Single entry admits you once: leave the country and the visa is spent, even with weeks left on it. Multiple entry lets you exit and re-enter as often as you like until it expires. The validity window is the same — the extra money buys crossings, not time.',
    },
    {
      title: 'The cases where it clearly pays',
      body: 'A side trip to Cambodia, Laos or Thailand mid-stay. A visa run you are already planning. Regional work travel from a base in Ho Chi Minh City or Hanoi. In each of these a second single-entry visa — plus the second round of paperwork and the second wait — costs more than the multiple-entry option did in the first place.',
    },
    {
      title: 'The case where it does not',
      body: 'One arrival, one departure, no border crossings in between: that is a single-entry trip, and the vast majority of holidays are. "Just in case" is an expensive hedge here — if plans change you can apply again, and at standard processing that is a cheaper way to be wrong than pre-paying for a crossing you never make.',
    },
    {
      title: 'Speed costs more than entry type',
      body: 'Compare the cards above against the single-entry ones and the pattern is clear: moving from standard processing to same-day express changes the price far more than moving from single to multiple entry does. If the budget is tight, taking a slower tier saves more than downgrading the entry type — provided your travel date allows it.',
    },
  ],
  related: [
    { href: EVISA_HUB_PATH, label: 'All Vietnam e-visa options', blurb: 'Every entry type and speed, priced, in one place.' },
    ...evisaRelated('multiple-entry-cost'),
  ],
  faqs: [
    {
      q: 'How much more is a multiple entry e-visa?',
      a: 'More than single entry at every speed — the exact difference is on the listings above, where each entry type and processing speed is priced separately.',
    },
    {
      q: 'How long is a multiple entry e-visa valid?',
      a: 'Up to 90 days, the same as single entry. The difference is how many times you may enter within that window, not how long it lasts.',
    },
    {
      q: 'Can I upgrade a single entry visa to multiple entry?',
      a: 'No. Entry type is fixed when the visa is issued, so a change means a fresh application. That is the argument for deciding before you apply rather than after.',
    },
    {
      q: 'Do I need multiple entry for a visa run?',
      a: 'If you intend to leave and return on the same visa, yes. A single-entry visa is spent the moment you exit, whatever time is left on it.',
    },
  ],
}

export const metadata: Metadata = {
  title: `Vietnam Multiple Entry e-Visa — Cost & When It Pays Off | ${SITE_NAME}`,
  description:
    'Vietnam multiple entry e-visa: what it costs against single entry at each processing speed, when the difference is worth paying, and when it is not.',
  alternates: { canonical: '/vietnam-evisa/multiple-entry-cost' },
  openGraph: {
    title: `Vietnam Multiple Entry e-Visa — Cost & When It Pays Off | ${SITE_NAME}`,
    description: '90 days either way — the extra buys crossings, not time. When that is worth it.',
  },
}

export default function Page() {
  return <SeoLanding content={CONTENT} />
}
