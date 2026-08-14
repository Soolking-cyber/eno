import type { Metadata } from 'next'
import { SITE_NAME } from '@/lib/edition'
import { PROVIDER_OF_RECORD, VISA_PROVIDER } from '@/lib/visa-provider'
import { expatGuidesExcept } from '@/lib/expat-guides'
import {
  HereLink,
  OfficialLink,
  P,
  SeoArticle,
  Ul,
  VnLink,
  marketplaceHref,
  type ArticleContent,
} from '@/components/marketplace/seo-article'
import { EVISA_HUB_PATH, evisaRelated } from '../links'
import { visaServiceLd } from '../service-jsonld'

/**
 * THE PAGE THAT TELLS PEOPLE THEY CAN DO IT THEMSELVES.
 *
 * ⚠️ THAT IS THE POINT, NOT A CONCESSION. This cluster's other five pages sell against each other —
 * which speed, which entry type, what a refusal costs. None of them answers the question a
 * first-time applicant is actually asking, which is "is this a government thing or a shop thing, and
 * what is the real price?" Publishing the official portal and the official fee, and stating plainly
 * what an agent cannot do, is the page that earns the trust the rest of the cluster spends. It also
 * happens to be what the query deserves: a page that hides evisa.gov.vn while ranking for the
 * official process is the behaviour that makes agent sites indistinguishable from each other.
 *
 * ⚠️ AND IT IS THE PAGE MOST EXPOSED TO A LEGAL DEFECT, so three rules hold here without exception.
 *   1. eno.forum does NOT provide this service. `PROVIDER_OF_RECORD` from src/lib/visa-provider.ts
 *      is rendered as the disclosure block AND restated in its own section — the partner performs
 *      the work under its own licence, this site is the intermediary and takes a commission. No
 *      sentence anywhere on the page may imply otherwise.
 *   2. NO LICENCE NUMBER, NO REGISTRATION NUMBER, NO COMPANY FORM. Every such field in
 *      visa-provider.ts is a placeholder today. `VISA_PROVIDER.brand` is the only value used here,
 *      because it is the only one that is not pending.
 *   3. NO GUARANTEE, IMPLIED OR OTHERWISE, about an outcome the Immigration Department decides.
 *
 * ⚠️ THE FEE IS HEDGED AND IT MUST STAY HEDGED. Government fees move by circular. The figures below
 * are written as "at the time of writing" and point at the portal, which is the only source that is
 * right by construction. A hard number on this page ages into a false price claim and nothing in
 * CI can see it happen.
 *
 * ⚠️ SERVICES EDITION ONLY (`page.svc.tsx`) — the route does not exist on the licensed marketplace.
 */

export const revalidate = 604800 // 7d — no live prices on this page (see the note on prices below).

const CONTENT: ArticleContent = {
  eyebrow: 'e-Visa · Official process',
  h1: 'Vietnam e-visa: the official process, the official fee, and what a service can and cannot do',
  intro:
    'A Vietnam e-visa is issued by the Immigration Department through one government portal, for a fee the government sets. Everything else on the market is a service layered on top of that process. This page describes the official route in full, states what it costs, and is specific about the things an agent genuinely helps with and the things nobody can sell you.',
  canonical: '/vietnam-evisa/official-process',
  published: '2026-08-01',
  disclosure: PROVIDER_OF_RECORD.en,
  jsonLd: [visaServiceLd()],
  sections: [
    {
      id: 'official-route',
      title: 'The official route, start to finish',
      body: (
        <>
          <P>
            The e-visa is applied for at{' '}
            <OfficialLink href="https://evisa.gov.vn">evisa.gov.vn</OfficialLink>, the Immigration
            Department’s own portal. Whether you apply yourself or through a service, this is where
            the application ends up and where the decision is made. The steps are:
          </P>
          <Ul>
            <li>Create an account on the portal and start an application.</li>
            <li>
              Complete the form — personal details exactly as they appear in your passport, your
              intended date of entry, the port you will arrive at, and the purpose of the visit.
            </li>
            <li>
              Upload two images: a scan or photograph of the passport data page, and a portrait photo
              against a plain background, face to camera, no hat and no glasses.
            </li>
            <li>Pay the fee by card, and keep the registration code you are given.</li>
            <li>
              Check the result with that code, your email address and your date of birth, then
              download the visa and print it or keep it on your phone.
            </li>
          </Ul>
          <P>
            The visa is valid for up to 90 days, single or multiple entry, and it is accepted at land
            and sea borders as well as airports — you arrive holding the visa, with nothing to queue
            for or pay on entry.
          </P>
        </>
      ),
    },
    {
      id: 'official-fee',
      title: 'The official fee, and why any quote should separate it out',
      body: (
        <>
          <P>
            At the time of writing, the government fee is US$25 for a single-entry e-visa and US$50
            for multiple entry. It is paid to the state, and it is not refunded if the application is
            refused — that is the department’s rule, not an agent’s policy. The portal publishes the
            current figure, and it is the only source worth trusting for it, because fees change by
            circular and pages like this one do not.
          </P>
          <P>
            Everything above that number is a service fee. That is a legitimate thing to charge for —
            document checking, form completion, following the result up, being reachable at eleven at
            night — but you should be able to see the split. A quote that gives you one total with no
            breakdown is not telling you what you are buying, and the question “how much of this is
            the government fee?” is the fastest way to find out who you are dealing with.
          </P>
          <P>
            {/* ⚠️ NO PRICES IN THIS PROSE. Service prices live on Listing.price and change; a figure
                typed here goes stale on the first admin edit with nothing failing. Same rule as the
                head of multiple-entry-cost/page.svc.tsx. */}
            The services listed on {SITE_NAME} are priced per listing, one price for each combination
            of entry type and processing speed, so the comparison is visible before you talk to
            anybody — <HereLink href={EVISA_HUB_PATH}>the options are here</HereLink>.
          </P>
        </>
      ),
    },
    {
      id: 'processing-time',
      title: 'How long it officially takes',
      body: (
        <>
          <P>
            The portal states a standard processing time of three working days from a complete
            application. Working days are Vietnamese working days, so a weekend or a public holiday
            moves everything, and an application submitted on a Friday evening is not three days from
            Friday evening.
          </P>
          <P>
            Faster tiers sold by services are priority handling of your paperwork. They are real —
            the difference between an application that sits in someone’s queue and one that is worked
            immediately is genuine — but they are a different queue position, not a different decision
            and not a different department. That distinction is worth holding on to when you decide
            what to pay for: it is the honest reason a slower tier is usually the better buy unless
            your travel is imminent.
          </P>
        </>
      ),
    },
    {
      id: 'what-a-service-can-do',
      title: 'What a service can genuinely do for you',
      body: (
        <>
          <P>
            Most refusals that are fixable are document problems, and documents are exactly what a
            check can catch before submission rather than after. Concretely, a service can:
          </P>
          <Ul>
            <li>
              Verify the passport page is the right page, complete, in focus and readable, and that
              the machine-readable strip agrees with the passport number, date of birth and expiry
              date typed into the form.
            </li>
            <li>
              Catch the surname/given-name ordering mistake, which is the single most common
              mismatch, and the one-character passport-number typo.
            </li>
            <li>
              Judge the portrait against the requirements before it is submitted, rather than after a
              refusal.
            </li>
            <li>Complete the form in your language and explain what a field is asking for.</li>
            <li>
              Track the result, tell you when it lands, and be a person you can ask — which matters
              most at the point where something has gone wrong.
            </li>
          </Ul>
          <P>
            If you are confident with the form and your documents are straightforward, the portal is
            genuinely usable on your own. The case for a service is the case for a checked
            application, not a case that the official route is closed to you.
          </P>
        </>
      ),
    },
    {
      id: 'what-no-service-can-do',
      title: 'What no service can do, at any price',
      body: (
        <>
          <P>
            Guarantee an approval. Appeal a refusal — there is no appeal process for an e-visa.
            Recover the government fee after a refusal. Change what your immigration history says.
            Issue a visa, or influence the officer deciding one.
          </P>
          <P>
            A refusal notice is normally issued without reasons, and the department is not obliged to
            give any. That is why “we handle difficult cases” is a sentence to read carefully: if the
            obstacle is a prior overstay or a previous refusal, a tidier form does not address it, and
            paying more for the same application is buying a faster no. What you can fix is the
            paperwork, which is what{' '}
            <HereLink href="/vietnam-evisa/rejected">the guide to refusals</HereLink> goes through.
          </P>
        </>
      ),
    },
    {
      id: 'lookalikes',
      title: 'Telling the government’s site from everything that looks like it',
      body: (
        <>
          <P>
            The official portal is <OfficialLink href="https://evisa.gov.vn">evisa.gov.vn</OfficialLink>{' '}
            and there is only one of it. A large number of sites imitate the layout, the colour scheme
            and the naming conventions closely enough that people believe they have paid a government
            fee when they have paid an agent’s total. Being an agent is not the problem — being an
            agent that a visitor mistakes for the department is.
          </P>
          <P>
            Two habits are enough. Check the domain before you type a passport number into anything.
            And send your passport scan only through a channel you can identify and come back to —
            not to an address that arrived unsolicited, and not into a chat you cannot reopen. Our
            wider <HereLink href="/safety">safety guidance</HereLink> makes the same argument for
            every kind of transaction.
          </P>
        </>
      ),
    },
    {
      id: 'who-provides',
      title: `Who provides the service listed on ${SITE_NAME}`,
      body: (
        <>
          <P>{PROVIDER_OF_RECORD.en}</P>
          <P>
            In practice that means: you compare the listings here and start the application here,
            {' '}{VISA_PROVIDER.brand} performs the visa work and is the party responsible for that
            service and its outcome, and {SITE_NAME} earns a commission for the introduction. It also
            means the questions worth asking before you pay — what is included, what happens if the
            application is refused, what the handling fee is on top of the government fee — are
            questions about {VISA_PROVIDER.brand}’s terms, and you should get the answers in writing
            before submitting anything.
          </P>
          <P>
            {SITE_NAME} is not a government body, is not an immigration agency, and does not decide
            visa applications. Nothing on this site, including this page, is legal or immigration
            advice.
          </P>
        </>
      ),
    },
    {
      id: 'after-you-land',
      title: 'Once the visa is sorted: what people ask next',
      body: (
        <>
          <P>
            Almost everyone who applies for a 90-day visa is arriving with something else to arrange.
            The two questions that follow immediately are where to stay and how to get around, and
            both have better answers than a hotel and a taxi account:{' '}
            <VnLink href={marketplaceHref('housing')}>apartments and houses for rent</VnLink> listed
            by the people who own them, and{' '}
            <VnLink href={marketplaceHref('motorbikes')}>motorbikes to rent monthly or buy
            outright</VnLink> — renting first is the cheaper way to find out what you want.
          </P>
          <P>
            If the move is longer term, the two guides worth reading before you fly are{' '}
            <HereLink href="/moving-to-vietnam">what to arrange before you fly</HereLink> — the
            documents only your home country can issue, and what not to ship — and{' '}
            <HereLink href="/first-month-in-vietnam">the first-month checklist</HereLink>, which
            covers registering your stay and the two deadlines that have consequences. If you are
            arriving with work to find,{' '}
            <VnLink href={marketplaceHref('jobs')}>roles that ask for English</VnLink> are a
            reasonable place to calibrate salaries against the rents you have been quoted.
          </P>
        </>
      ),
    },
  ],
  related: [
    { href: EVISA_HUB_PATH, label: 'All Vietnam e-visa options', blurb: 'Every entry type and speed, priced, in one place.' },
    ...evisaRelated('official-process'),
    ...expatGuidesExcept(),
  ],
  faqs: [
    {
      q: 'What is the official Vietnam e-visa website?',
      a: 'evisa.gov.vn, the Immigration Department’s portal. Every e-visa application is decided there, whether it is submitted by you or by a service on your behalf.',
    },
    {
      q: 'How much does the Vietnam e-visa cost officially?',
      a: 'At the time of writing the government fee is US$25 for single entry and US$50 for multiple entry, paid to the state and not refunded if the application is refused. The portal publishes the current figure. Anything charged above it is a service fee.',
    },
    {
      q: 'Can I apply for a Vietnam e-visa myself?',
      a: 'Yes. The portal is open to applicants directly, and for a straightforward case with good documents it is entirely usable on your own. A service adds a document check, form completion in your language, follow-up and priority handling — not access.',
    },
    {
      q: 'Can an agent guarantee my visa will be approved?',
      a: 'No. The decision belongs to the Immigration Department, there is no appeal for an e-visa, and no service can influence the outcome or recover the government fee after a refusal. A guarantee of approval is a promise about something the seller does not control.',
    },
    {
      q: 'How long does the e-visa take?',
      a: 'The portal states three working days for standard processing from a complete application, counted in Vietnamese working days. Faster tiers sold by services are priority handling of your paperwork, not a different government process.',
    },
    {
      q: `Who actually provides the e-visa service listed on ${SITE_NAME}?`,
      a: PROVIDER_OF_RECORD.shortEn,
    },
  ],
}

export const metadata: Metadata = {
  title: `Vietnam e-Visa: Official Process, Official Fee & What a Service Can Do | ${SITE_NAME}`,
  description:
    'The official Vietnam e-visa process at evisa.gov.vn, the government fee (US$25 single / US$50 multiple entry at the time of writing), the official processing time, and an honest account of what an agent can and cannot do for you.',
  alternates: { canonical: '/vietnam-evisa/official-process' },
  openGraph: {
    title: `Vietnam e-Visa: Official Process, Official Fee & What a Service Can Do | ${SITE_NAME}`,
    description:
      'One government portal, one government fee. What a service genuinely adds, and what nobody can sell you.',
  },
}

export default function Page() {
  return <SeoArticle content={CONTENT} />
}
