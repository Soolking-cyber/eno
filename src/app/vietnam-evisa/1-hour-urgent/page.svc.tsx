import { SITE_NAME } from '@/lib/edition'
import type { Metadata } from 'next'
import { SeoLanding, type SeoContent } from '@/components/marketplace/seo-landing'
import { VISA_CATEGORY_SLUG, VISA_SUBCATEGORY_SLUG } from '@/lib/taxonomy'
import { VISA_BUSINESS_HOURS, VISA_SPEED_SPECS } from '@/lib/visa/speed'
import { EVISA_HUB_PATH, evisaRelated } from '../links'

// ⚠️ 24h, NOT the 7d the other landing pages use. Those sell a category; this cluster's whole
// argument is "compare the prices on the cards below", and those cards render live
// `Listing.price` values into ISR HTML. A weekly window means an admin can change a visa price
// and this page keeps quoting the old one for six more days — on the one surface where being
// wrong about money costs the most trust. The prose is static and cheap to re-render; the prices
// are the reason for the shorter window.
export const revalidate = 86400

// ⚠️ THE CUTOFF TIMES ARE READ FROM src/lib/visa/speed.ts, NEVER TYPED OUT HERE. That module owns
// the operational facts precisely because they are the provider's, identical for every seller and
// every price — and a marketing page quoting "10:00 and 16:00" from memory is the one copy that
// keeps its old value after the desk changes its intake. The same reasoning already stops
// taxonomy.ts restating the tier labels.
const ONE_HOUR = VISA_SPEED_SPECS['1H']
const cutoffs = ONE_HOUR.cutoffs.join(' and ')

const CONTENT: SeoContent = {
  eyebrow: 'e-Visa · Urgent',
  h1: 'Urgent Vietnam visa: e-visa in 1 hour',
  intro:
    'Flying tonight and no visa? The fastest tier listed on eno.vn is sold on a one-hour turnaround — a result within an hour of your application reaching the Immigration Department. It is real, it is the most expensive option on the page, and it depends on one thing people are rarely told before they pay: the desk’s daily intake times.',
  categorySlug: VISA_CATEGORY_SLUG,
  subcategorySlug: VISA_SUBCATEGORY_SLUG,
  attributes: { visaSpeed: '1H' },
  cta: 'See 1-hour options',
  sections: [
    {
      title: 'The clock starts at submission, not at payment',
      body: `${ONE_HOUR.turnaround} "Submission" means your completed application reaching the Immigration Department — not the moment you open a chat. Anything still missing at that point (a readable passport page, your entry date, the port you are arriving at) is time the hour has not started counting.`,
    },
    {
      title: `Intake is at ${cutoffs}, Vietnam time`,
      body: `The one-hour tier accepts applications at ${cutoffs} on Vietnamese working days, inside desk hours of ${VISA_BUSINESS_HOURS.start}–${VISA_BUSINESS_HOURS.end}. Arrive after the last intake and your application is worked at the next one — the following working day if that lands on a weekend or a public holiday. This is why the honest answer to "can I have it in an hour?" is sometimes no at any price, and eno.vn shows you the next real cutoff instead of taking the order quietly.`,
    },
    {
      title: 'When a slower tier is the better buy',
      body: 'Two-hour and four-hour express have their own, earlier intakes and cost meaningfully less. If your flight is tomorrow rather than in the next few hours, a one-working-day tier usually lands well before you need it for a fraction of the price. Paying for one hour buys you the difference between the tiers only when that difference is genuinely the difference between making the flight and not.',
    },
    {
      title: 'What speed does not buy',
      body: 'A faster tier is priority handling of your paperwork. It is not a different decision, and no provider can guarantee an approval or process faster than the department itself will. If a mistake in the application causes a refusal, the express fee has bought you a faster refusal — which is the real argument for having the passport page checked before submission rather than after.',
    },
  ],
  related: [
    { href: EVISA_HUB_PATH, label: 'All Vietnam e-visa options', blurb: 'Every entry type and speed, priced, in one place.' },
    ...evisaRelated('1-hour-urgent'),
  ],
  faqs: [
    {
      q: 'Can I really get a Vietnam visa in 1 hour?',
      a: `Yes, within the tier’s intake times. ${ONE_HOUR.turnaround} Outside those times the application is worked at the next intake, which may be the next working day.`,
    },
    {
      q: 'What if I apply at night or at the weekend?',
      a: 'You can start any time, but the one-hour clock only runs on Vietnamese working days inside the desk’s hours. A weekend application is worked at the first intake on the next working day.',
    },
    {
      q: 'Is 1-hour processing worth the price?',
      a: 'Only if your travel is inside the next few hours. Two-hour, four-hour and one-working-day tiers are all cheaper and all listed — compare them above.',
    },
    {
      q: 'What do I need ready before applying?',
      a: 'Your passport photo page (readable, all four corners visible), a portrait photo, your intended entry date and the port you will arrive at. Missing any of these is what usually costs people the hour.',
    },
  ],
}

export const metadata: Metadata = {
  title: `Urgent Vietnam Visa — e-Visa in 1 Hour | ${SITE_NAME}`,
  description:
    'Vietnam e-visa in 1 hour: what the express tier actually promises, the daily intake cutoffs it depends on, and when a cheaper tier gets you there in time anyway.',
  alternates: { canonical: '/vietnam-evisa/1-hour-urgent' },
  openGraph: {
    title: `Urgent Vietnam Visa — e-Visa in 1 Hour | ${SITE_NAME}`,
    description: 'The express tier, its daily cutoffs, and when it is not worth paying for.',
  },
}

export default function Page() {
  return <SeoLanding content={CONTENT} />
}
