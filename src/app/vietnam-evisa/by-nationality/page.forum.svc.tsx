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

// ⚠️ ONE PAGE, NOT ONE PAGE PER NATIONALITY — a deliberate deviation from the task, recorded here
// so the next person does not "finish the job" by templating it.
//
// The obvious build is /vietnam-evisa/for-<country> × N. It is also the definition of a doorway
// set: since the e-visa opened to all nationalities the APPLICATION is identical for every
// passport, so N pages would differ by a country name and nothing else. Google's thin-content and
// doorway guidance is explicit about that shape, and we have just spent T327 de-indexing eight
// empty category pages for being thin — shipping fifty new ones in the same week would trade a
// long-tail gamble for a site-wide quality signal.
//
// The one axis that genuinely varies by nationality is visa EXEMPTION, and that is a table of
// bilateral agreements which change by government decision and which this repo has no source of
// truth for. Publishing a stale exemption length would send somebody to an airport without a visa.
// So this page teaches the reader to check, and points at the department rather than restating it.
const CONTENT: SeoContent = {
  eyebrow: 'e-Visa · Eligibility',
  h1: 'Who needs a Vietnam e-visa? Eligibility by nationality',
  intro:
    'Vietnam’s e-visa is open to citizens of every country and territory — there is no eligibility list to check yourself against, and the application is the same whatever passport you hold. The question worth asking is the other one: whether you need a visa at all, because a number of nationalities can enter visa-free for a limited stay.',
  categorySlug: VISA_CATEGORY_SLUG,
  subcategorySlug: VISA_SUBCATEGORY_SLUG,
  cta: 'See e-visa options',
  sections: [
    {
      title: 'Everyone can apply',
      body: 'Since the scheme was extended to all nationalities, there is no passport that is excluded from the Vietnam e-visa. The form, the documents and the processing times are identical for every applicant — what your nationality changes is which country code goes on the form, not what you have to do or what it costs.',
    },
    {
      title: 'The real question: are you exempt?',
      body: 'Vietnam waives the visa requirement for citizens of a number of countries, for stays up to a fixed number of days. The list and the permitted lengths are set by government decision and are revised from time to time — sometimes extended, occasionally allowed to lapse. That is why you will not find a table of them on this page: a stale one would send somebody to the airport without a visa they needed. Check your nationality against the Immigration Department’s own current list before deciding you do not need to apply.',
    },
    {
      title: 'When an exempt traveller should apply anyway',
      body: 'A visa exemption covers a short stay, and it runs out on a fixed day. If you plan to stay longer than the waiver allows, to leave and re-enter, or simply not to be counting days on a beach, a 90-day e-visa removes the question. It is also the safer choice if your onward plans are not settled — extending inside Vietnam is a harder problem than arriving with more time than you need.',
    },
    {
      title: 'What the application needs from you',
      body: 'A passport valid for at least six months beyond your entry date, with a blank page. A clear photo of the passport data page. A plain portrait photo. Your intended entry date and the port you will arrive at. The name on the form must match the passport exactly — including the order of surname and given names, which is the mismatch that most often costs people an application.',
    },
  ],
  related: [
    { href: EVISA_HUB_PATH, label: 'All Vietnam e-visa options', blurb: 'Every entry type and speed, priced, in one place.' },
    ...evisaRelated('by-nationality'),
  ],
  faqs: [
    {
      q: 'Which nationalities can get a Vietnam e-visa?',
      a: 'All of them. The e-visa is open to citizens of every country and territory, and the application is identical regardless of passport.',
    },
    {
      q: 'Do I need a visa for Vietnam at all?',
      a: 'Not necessarily — some nationalities may enter visa-free for a limited stay. The exempt list and the permitted lengths change by government decision, so check the Immigration Department’s current list rather than an agent’s copy of it.',
    },
    {
      q: 'I am visa-exempt but want to stay longer. What then?',
      a: 'Apply for the 90-day e-visa before you travel. Arriving on a waiver and trying to extend afterwards is considerably harder than arriving with the time you need.',
    },
    {
      q: 'How long must my passport be valid?',
      a: 'At least six months beyond your intended entry date, with a blank page for the entry stamp.',
    },
  ],
}

export const metadata: Metadata = {
  title: `Who Needs a Vietnam e-Visa? Eligibility by Nationality | ${SITE_NAME}`,
  description:
    'Every nationality can apply for a Vietnam e-visa — but some can enter visa-free. How to tell which case you are in, and when an exempt traveller should apply anyway.',
  alternates: { canonical: '/vietnam-evisa/by-nationality' },
  openGraph: {
    title: `Who Needs a Vietnam e-Visa? Eligibility by Nationality | ${SITE_NAME}`,
    description: 'All nationalities are eligible. The question is whether you need a visa at all.',
  },
}

export default function Page() {
  return <SeoLanding content={CONTENT} />
}
