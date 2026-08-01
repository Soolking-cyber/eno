import { SITE_NAME } from '@/lib/edition'
import type { Metadata } from 'next'
import { CrossSitePromo } from '@/components/marketplace/cross-site-promo'
import { SeoLanding, type SeoContent } from '@/components/marketplace/seo-landing'
import { PROVIDER_OF_RECORD } from '@/lib/visa-provider'
import { expatGuidesExcept } from '@/lib/expat-guides'
import { EVISA_HUB_PATH, evisaChildPath } from '@/app/vietnam-evisa/links'
import { visaServiceLd } from '@/app/vietnam-evisa/service-jsonld'

export const revalidate = 604800 // 7d — static SEO copy; weekly regen is plenty (fewer ISR writes)

// ⚠️ THIS PAGE USED TO SELL SERVICES THAT DO NOT EXIST. Until 2026-07-27 the copy promised
// "cleaning, moving, repairs, tutoring, beauty and pet care … across Ho Chi Minh City" and never
// once contained the word "visa". Measured against production the same day: `services` holds 15
// live listings — 14 e-visa products and one trip-planning anchor. Zero cleaners, zero tutors,
// zero pet care, and not one of them is in Ho Chi Minh City.
//
// That is worse than a wasted page. It is the only landing page with real inventory behind it, so
// every visitor it did attract arrived expecting a cleaner and met a visa desk — a bounce Google
// reads as the page failing to answer its own query. The fix is to describe what is actually for
// sale. When somebody finally posts a cleaner this copy stops being COMPLETE rather than becoming
// FALSE, which is the failure direction to prefer.
//
// ⚠️ THEN IT NAMED THE WRONG COMPANY AS THE SELLER, WHICH IS THE SERIOUS VERSION OF THE SAME
// MISTAKE (fixed 2026-08-01). Four sentences said "on eno.vn" — the licensed sàn TMĐT that may not
// offer e-visa services at all — on a page that exists only on eno.forum. Nothing eno.vn serves
// ever contained them (this is a `.svc.` file), so the damage was entirely on eno.forum: every
// reader and every crawler was told the wrong operator. The rule now is that a page rendering on
// ONE deployment names that deployment through SITE_NAME, never through a literal, because a
// literal cannot be wrong in a way anybody notices.
//
// ⚠️ eno DOES NOT PROVIDE THE VISA SERVICE. A licensed Vietnamese travel company does, under its own
// licence and answering for the outcome; this site lists it and takes a commission. Stated in the
// intro and again as its own section, from PROVIDER_OF_RECORD — never reworded here.
//
// ⚠️ TRIP PLANNING IS NO LONGER ADVERTISED (owner, 2026-08-01). The itinerary code stays; the
// promises do not. Do not restore "free trip planning" to this copy without the owner asking —
// a landing page selling a withdrawn product is the original defect at the top of this comment,
// repeated with the roles reversed.
const CONTENT: SeoContent = {
  eyebrow: 'Services · Vietnam',
  h1: 'Services for Expats in Vietnam',
  intro: `One service category is genuinely live here today: Vietnam e-visa applications, at every processing speed from standard to one-hour express. Each combination is its own listing with its own price, so you can compare before you talk to anyone. The e-visa services are provided by a licensed Vietnamese travel company — ${SITE_NAME} is the platform that lists them, not the provider — and every provider on the site carries a public trust score.`,
  categorySlug: 'services',
  cta: 'Browse services',
  sections: [
    {
      title: 'Vietnam e-visas, priced up front',
      body: 'Fourteen e-visa products are listed: single entry or multiple entry, 90 days, at seven processing speeds — standard, 3, 2 and 1 working days, and 4-hour, 2-hour and 1-hour express. Each is its own listing with its own price, so the cost of going faster is visible before you commit rather than quoted after you have handed over a passport scan. The government fee is set by the Immigration Department and is the same whoever you apply through; anything above it is a handling fee, and you should be able to see the split.',
    },
    // ⚠️ NOT REWORDED, EVER. One constant, rendered wherever the service is offered — see
    // src/lib/visa-provider.ts for the three claims this statement may never make.
    { title: 'Who provides the e-visa service', body: PROVIDER_OF_RECORD.en },
    {
      title: 'Visa, work permits, tax and legal',
      body: 'The Visa category is not visa-only: work-permit, tax and legal services belong in it too, and anyone can post one — it is an ordinary marketplace category, not a desk we run. Right now e-visa products are the only listings in it, so if you need a work permit or a tax filing, ask in chat rather than assuming it is on the shelf.',
    },
    {
      title: 'What is not here yet',
      body: 'Cleaning, moving help, repairs, tutoring, beauty and pet care are live categories, but nobody has posted one in Vietnam yet. Better to say so than to list services we cannot deliver — and if you provide one, posting takes a few minutes and is free.',
    },
  ],
  // The same statement in machine-readable form: the partner is the `provider`, this site is the
  // `broker`. Prose that disclaims the service while the structured data claims it is worse than
  // saying nothing at all.
  jsonLd: [visaServiceLd()],
  related: [
    {
      href: EVISA_HUB_PATH,
      label: 'Vietnam e-visa: prices and processing times',
      blurb: 'Every entry type and speed listed, what each one costs, and which are worth paying for.',
    },
    {
      href: evisaChildPath('official-process'),
      label: 'The official e-visa process and fee',
      blurb: 'What evisa.gov.vn does, what the government charges, and the honest limits of any service.',
    },
    ...expatGuidesExcept(),
  ],
  faqs: [
    {
      q: 'What services can I actually find here right now?',
      a: 'Vietnam e-visa applications at seven processing speeds. The other service categories — including work permits, tax and legal, which share the Visa category — exist but have no listings in Vietnam yet.',
    },
    {
      q: 'How much does a Vietnam e-visa cost here?',
      a: 'It depends on entry type and how fast you need it — standard single entry is the cheapest listing and 1-hour multiple entry the most expensive. Every price is on its own listing; nothing is quoted privately. The government fee is a separate, fixed component set by the Immigration Department.',
    },
    {
      q: 'Who actually provides the e-visa service?',
      a: PROVIDER_OF_RECORD.shortEn,
    },
    {
      q: 'How do I hire a provider?',
      a: 'Tap “Message” on the listing to chat in-app, agree on scope and price, then go ahead. You only share your number once they reply, which keeps spam away.',
    },
    {
      q: 'Can I post a service here?',
      a: 'Yes, and it is free. Cleaning, repairs, tutoring and pet care are all live categories with no competition in them yet.',
    },
  ],
}

export const metadata: Metadata = {
  title: `Services for Expats in Vietnam — e-Visa Applications | ${SITE_NAME}`,
  description:
    'Services for expats in Vietnam: Vietnam e-visa applications, single and multiple entry, from standard to 1-hour express, each priced on its own listing. Provided by a licensed Vietnamese travel partner, with a public trust score behind every provider.',
  alternates: { canonical: '/services-for-expats-vietnam' },
  openGraph: {
    title: `Services for Expats in Vietnam — e-Visa Applications | ${SITE_NAME}`,
    description:
      'Vietnam e-visas priced up front and provided by a licensed travel partner, with a public trust score behind every provider.',
  },
}

/**
 * ⚠️ THE CROSS-SITE PROMO SITS AT THE END, BELOW THE CONTENT SOMEBODY CAME FOR. This page answers
 * "what can I actually get here", so naming the sister marketplace is a genuine part of that answer
 * rather than an interruption — which is the test any placement has to pass.
 *
 * The component's own header owns the rule for where else it may appear, and the reason density is
 * what would break this: for the reader, who starts seeing an ad unit, and for the links, which
 * stop being editorial the moment they are boilerplate on every route.
 */
export default function Page() {
  return <SeoLanding content={CONTENT} after={<CrossSitePromo />} />
}
