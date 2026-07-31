import { SITE_NAME } from '@/lib/edition'
import type { Metadata } from 'next'
import { SeoLanding, type SeoContent } from '@/components/marketplace/seo-landing'
import { VISA_CATEGORY_SLUG, VISA_SUBCATEGORY_SLUG } from '@/lib/taxonomy'
import { evisaRelated } from './links'

// ⚠️ 24h, NOT the 7d the other landing pages use. Those sell a category; this cluster's whole
// argument is "compare the prices on the cards below", and those cards render live
// `Listing.price` values into ISR HTML. A weekly window means an admin can change a visa price
// and this page keeps quoting the old one for six more days — on the one surface where being
// wrong about money costs the most trust. The prose is static and cheap to re-render; the prices
// are the reason for the shorter window.
export const revalidate = 86400

// The e-visa hub. Fourteen of the site's thirty-two live listings are e-visa products and until
// 2026-07-27 there was no page targeting the query at all — /visa, /evisa, /vietnam-evisa and
// /e-visa each 404'd. The incumbents on these searches are mid-tier agent sites rather than
// platform giants, which is why this is the one query set worth contesting from a new domain.
//
// ⚠️ THE CATEGORY/SUBCATEGORY PAIR COMES FROM taxonomy.ts, NOT FROM STRING LITERALS HERE. A landing
// page that restates 'services'/'visa-legal' would keep rendering a plausible-looking rail after a
// taxonomy rename — empty, or worse, full of the wrong listings — and nothing would fail.
const CONTENT: SeoContent = {
  eyebrow: 'e-Visa · Vietnam',
  h1: 'Vietnam e-Visa: prices, processing times and how to apply',
  intro:
    'A Vietnam e-visa is a 90-day visa issued electronically by the Immigration Department — no embassy visit, no stamp collected on arrival. What varies between providers is how fast the paperwork gets handled and what they charge for the handling. On eno.vn each combination is a listing with its own price: single or multiple entry, at seven processing speeds from standard to one hour. Compare them below before you talk to anyone.',
  categorySlug: VISA_CATEGORY_SLUG,
  subcategorySlug: VISA_SUBCATEGORY_SLUG,
  cta: 'See all e-visa options',
  sections: [
    {
      title: 'What you are choosing between',
      body: 'Two decisions, and they price independently. Entry type: single entry is one crossing, multiple entry lets you leave and come back within the same 90 days. Processing speed: standard, 3, 2 or 1 working days, or express at 4 hours, 2 hours or 1 hour. Speed is the expensive axis — the one-hour tier costs several times the standard one — so pay for it only if your travel date genuinely requires it.',
    },
    {
      title: 'Express tiers run on daily cutoffs',
      body: 'The hour-based tiers are not "any time, one hour later". Each has fixed intake times in Vietnamese working hours, and an application handed in after the last one is worked at the next intake — the following working day if that falls on a weekend or public holiday. The working-day tiers have no such gate: those you can queue at any hour. The listing and the application flow both show you the next real cutoff rather than an optimistic estimate.',
    },
    {
      title: 'How applying works here',
      body: 'Open the listing for the option you want and message the desk. The government form is filled in step by step in that chat — passport details, photo, entry date and port — and your passport scan is checked for readability and data mismatches before anything is submitted, which is where most refusals come from. The desk confirms the price and how to pay before submitting; nothing is charged at the moment you start, and no card details are taken in the chat.',
    },
    {
      title: 'What an agent cannot do',
      body: 'No provider can guarantee approval, override the Immigration Department, or issue a visa faster than the department will process it. What faster tiers buy is priority handling of your paperwork, not a different decision. Anyone promising a guaranteed approval is describing something they do not control.',
    },
  ],
  related: evisaRelated(),
  faqs: [
    {
      q: 'How long is a Vietnam e-visa valid?',
      a: 'Up to 90 days, for both single and multiple entry. Multiple entry lets you exit and re-enter within that window; single entry is one crossing.',
    },
    {
      q: 'How fast can I get one?',
      a: 'The fastest tier listed is one hour from submission, subject to that tier’s daily intake cutoffs and Vietnamese working days. Standard processing is the cheapest and takes several working days.',
    },
    {
      q: 'What does it cost?',
      a: 'It depends on entry type and speed — every combination is priced on its own listing above, so you can see the exact cost of going faster instead of being quoted after you have handed over your documents.',
    },
    {
      q: 'Do I pay when I apply?',
      a: 'No. Applying opens a chat with the visa desk and the government form is completed there. The desk confirms the price and payment before your application is submitted.',
    },
    {
      q: 'Can I get a refund if I am refused?',
      a: 'The government fee is not refundable if an application is refused — that is the Immigration Department’s rule, not the agent’s. Ask the desk what happens to the handling fee before you submit.',
    },
  ],
}

export const metadata: Metadata = {
  title: `Vietnam e-Visa — Prices, Processing Times & How to Apply | ${SITE_NAME}`,
  description:
    'Vietnam e-visa, 90 days, single or multiple entry, at seven processing speeds from standard to 1-hour express. Every option priced on its own listing — compare before you apply.',
  alternates: { canonical: '/vietnam-evisa' },
  openGraph: {
    title: `Vietnam e-Visa — Prices, Processing Times & How to Apply | ${SITE_NAME}`,
    description:
      'Single or multiple entry, standard to 1-hour express. Every combination priced up front on eno.vn.',
  },
}

export default function Page() {
  return <SeoLanding content={CONTENT} />
}
