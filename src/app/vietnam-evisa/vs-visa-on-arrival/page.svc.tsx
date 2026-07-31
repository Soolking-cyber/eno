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

const CONTENT: SeoContent = {
  eyebrow: 'e-Visa · Comparison',
  h1: 'Vietnam e-visa vs visa on arrival: which one applies to you',
  intro:
    'These are two different products with confusingly similar names, and the difference is not price — it is how you are arriving. Pick the wrong one and you find out at the airport, which is the worst possible place to find out.',
  categorySlug: VISA_CATEGORY_SLUG,
  subcategorySlug: VISA_SUBCATEGORY_SLUG,
  cta: 'See e-visa options',
  sections: [
    {
      title: 'The e-visa',
      body: 'Applied for online before you travel and issued electronically by the Immigration Department. You arrive holding the visa itself: print it or keep it on your phone, present it at immigration, walk through. It is valid at land and sea borders as well as airports, and there is nothing to pay or queue for on arrival. Up to 90 days, single or multiple entry.',
    },
    {
      title: 'Visa on arrival, and what it really is',
      body: 'The name is misleading. You do not turn up and buy a visa — you must obtain an approval letter from a sponsoring agent beforehand, then queue at the landing-visa counter on arrival, hand over passport photos and pay a stamping fee in cash. It works only at a handful of international airports: arrive by land or sea and it does not apply at all. It is a pre-arranged process that finishes at the airport, not an alternative to arranging anything.',
    },
    {
      title: 'Which to choose',
      body: 'For almost every traveller arriving by air on an ordinary passport, the e-visa is simpler: no counter queue after a long flight, no cash fee at the border, no photos to remember, and no dependency on how busy the landing-visa desk is when you land. Visa on arrival mainly survives for cases the e-visa does not cover, and for travellers whose plans changed too late to apply — though express e-visa processing has narrowed that window considerably.',
    },
    {
      title: 'The two costs are not comparable as advertised',
      body: 'A visa-on-arrival price is usually quoted as the approval-letter fee alone, with the government stamping fee paid separately in cash at the airport. An e-visa price covers the whole thing. Compare totals, not headline numbers — and treat any quote that does not say which of the two it is as incomplete.',
    },
  ],
  related: [
    { href: EVISA_HUB_PATH, label: 'All Vietnam e-visa options', blurb: 'Every entry type and speed, priced, in one place.' },
    ...evisaRelated('vs-visa-on-arrival'),
  ],
  faqs: [
    {
      q: 'Is a Vietnam e-visa better than visa on arrival?',
      a: 'For most air arrivals, yes — you land holding the visa, with no counter queue, no cash stamping fee and no photos required. Visa on arrival also requires a pre-arranged approval letter, so it saves no preparation.',
    },
    {
      q: 'Can I get a visa on arrival at a land border?',
      a: 'No. Visa on arrival works only at designated international airports. Arriving overland or by sea means you need the visa before you travel.',
    },
    {
      q: 'Can I just turn up and buy a visa at the airport?',
      a: 'No. Despite the name, visa on arrival requires an approval letter obtained in advance through a sponsoring agent.',
    },
    {
      q: 'Which is faster if I am travelling in the next day or two?',
      a: 'Express e-visa processing is measured in hours, so the e-visa is usually the faster of the two even at short notice — and it removes the arrival-counter step entirely.',
    },
  ],
}

export const metadata: Metadata = {
  title: `Vietnam e-Visa vs Visa on Arrival — Which Applies to You | ${SITE_NAME}`,
  description:
    'Vietnam e-visa or visa on arrival? What each actually involves, which one works at land borders, why the advertised prices are not comparable, and which to choose.',
  alternates: { canonical: '/vietnam-evisa/vs-visa-on-arrival' },
  openGraph: {
    title: `Vietnam e-Visa vs Visa on Arrival — Which Applies to You | ${SITE_NAME}`,
    description: 'Two products, similar names, different arrival requirements. The practical difference.',
  },
}

export default function Page() {
  return <SeoLanding content={CONTENT} />
}
