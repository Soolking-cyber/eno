import type { Metadata } from 'next'
import { SITE_NAME } from '@/lib/edition'
import { PROVIDER_OF_RECORD } from '@/lib/visa-provider'
import { expatGuidesExcept } from '@/lib/expat-guides'
import { EVISA_HUB_PATH, evisaChildPath } from '@/app/vietnam-evisa/links'
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

/**
 * "MOVING TO VIETNAM" — a pre-departure guide, and the top of the funnel for eno.vn.
 *
 * ⚠️ SERVICES EDITION ONLY (`page.svc.tsx`), and that is not a preference. The guide names the
 * e-visa, the government portal and the licensed partner, so on eno.vn — a licensed sàn TMĐT that
 * may not so much as mention the service — the route must not exist at all. `pageExtensions` in
 * next.config.ts is what makes that true: "svc.tsx" is not an extension on a marketplace build, so
 * this file matches nothing, is never compiled, and is absent from the route manifest. A redirect
 * would have been the obvious alternative and the wrong one — a redirect is a route that exists.
 *
 * ⚠️ IT HAS TO EARN ITS INDEX ENTRY WITHOUT THE OUTBOUND LINKS. The commercial reason this page
 * exists is the contextual links into eno.vn, and a page built only for that is a doorway page:
 * Google's guidance names the pattern, and it would also be the first exhibit anyone assembled to
 * argue the two-site split is decorative. So the test applied to every section below is whether it
 * would still be worth reading with the anchors deleted. Everything here is something a person
 * actually has to decide before they fly.
 *
 * ⚠️ FEES AND RULES ARE HEDGED ON PURPOSE. Government fees change by circular and the visa-exemption
 * list changes by decision. Anything numeric is written as "at the time of writing" and points at
 * the authority — a stale number on a page like this sends somebody to an airport with the wrong
 * paperwork, and it is not a defect any test can catch. Where a figure is not stable enough to
 * survive a year, it is not stated at all.
 *
 * ⚠️ EVERY eno.vn href COMES FROM `marketplaceHref()`, NEVER FROM A TYPED URL. Those hrefs are
 * absolute, point at the apex (www 301s on every path), and are checked against the real route tree
 * by cross-site-links.test.ts — a hand-typed link gets none of that and tsc cannot see it is wrong.
 * The helper throws on an unknown key rather than rendering a dead anchor; see its note.
 */

export const revalidate = 604800 // 7d — static editorial; nothing on this page is price- or stock-derived.

const CONTENT: ArticleContent = {
  eyebrow: 'Guide · Before you fly',
  h1: 'Moving to Vietnam: what to arrange before you fly',
  intro:
    'Most of what makes the first month in Vietnam easy or miserable is decided before you get on the plane — which visa you travel on, which documents you had certified at home while it was still possible, and how much you shipped that you could have bought here for a tenth of the price. This is the pre-departure half of the job, in the order the decisions actually come.',
  canonical: '/moving-to-vietnam',
  published: '2026-08-01',
  disclosure: PROVIDER_OF_RECORD.en,
  crossSitePromo: true,
  sections: [
    {
      id: 'visa-first',
      title: 'Start with the visa, because it constrains everything else',
      body: (
        <>
          <P>
            Vietnam’s e-visa is the route most people take: applied for online before you travel,
            valid for up to 90 days, single or multiple entry, and issued electronically so there is
            nothing to collect on arrival. The application is the same for every nationality. It is
            handled by the Immigration Department through its own portal at{' '}
            <OfficialLink href="https://evisa.gov.vn">evisa.gov.vn</OfficialLink>, and the government
            fee at the time of writing is US$25 for single entry and US$50 for multiple entry —
            payable whether the application succeeds or not.
          </P>
          <P>
            What the e-visa is not is a work permit. If you are moving for a job, the visa is the
            second question and your employer’s sponsorship is the first: a work permit is applied
            for by the company, needs documents you can only get at home (below), and takes weeks.
            Arriving on a tourist e-visa with a verbal offer and a plan to sort it out later is the
            single most common way people end up doing a border run every three months.
          </P>
          <P>
            If you already know which processing speed you need, or you want the mechanics of the
            official process before you choose,{' '}
            <HereLink href={evisaChildPath('official-process')}>
              the official process, the official fee and what a service can and cannot do
            </HereLink>{' '}
            covers it end to end.
          </P>
        </>
      ),
    },
    {
      id: 'documents',
      title: 'The documents to certify at home, while you still can',
      body: (
        <>
          <P>
            This is the section people skip and then pay for. Several of the documents a work permit
            or a residence card needs have to be issued and legalised in your own country, and doing
            it from Vietnam means couriering originals home and waiting.
          </P>
          <Ul>
            <li>
              <strong className="font-semibold text-foreground">Passport</strong> — valid at least six
              months beyond your intended entry date, with a blank page. Renew early rather than
              arrive with seven months on it.
            </li>
            <li>
              <strong className="font-semibold text-foreground">Criminal record check</strong> — a
              standard work-permit requirement, and it usually has a validity window measured in
              months, so timing matters.
            </li>
            <li>
              <strong className="font-semibold text-foreground">Degree certificate and, often, a
              reference letter</strong> proving relevant experience. Teaching roles will also want a
              recognised teaching certificate.
            </li>
            <li>
              <strong className="font-semibold text-foreground">Marriage and birth certificates</strong>{' '}
              if family are coming — needed for dependent visas and for school enrolment.
            </li>
          </Ul>
          <P>
            Foreign documents generally need consular legalisation by the Vietnamese embassy or
            consulate in the country that issued them, plus a certified Vietnamese translation once
            you arrive. Vietnam is not a party to the Hague Apostille Convention, so an apostille on
            its own is usually not what is asked for — confirm the exact chain with the Vietnamese
            mission that will handle it, and with your employer, before you pay for anything.
          </P>
          <P>
            Two smaller ones that catch people out. Driving: Vietnam recognises an International
            Driving Permit issued under the 1968 Vienna Convention, and does not recognise one issued
            under the 1949 Geneva Convention — which is what the United States, among others, issues.
            If yours is the wrong kind, the answer is a Vietnamese licence, not an argument at the
            roadside. Medication: bring the prescription and a doctor’s letter, keep it in the
            original packaging, and check the specific drug, because several things sold over the
            counter elsewhere are controlled here.
          </P>
        </>
      ),
    },
    {
      id: 'ship-or-buy',
      title: 'What to ship, and what to buy once you land',
      body: (
        <>
          <P>
            Sea freight to Vietnam is measured in months and priced accordingly, and the thing people
            regret shipping is furniture. The international community here turns over constantly —
            contracts end, people move on — and what they leave behind is a steady supply of sofas,
            fridges, air conditioners and kitchen kit at a fraction of retail. It is worth looking at{' '}
            <VnLink href={marketplaceHref('moving-sales')}>what people leaving Vietnam are selling</VnLink> before
            you pay to move a wardrobe across an ocean.
          </P>
          <P>
            Mains power is 220V at 50Hz, with sockets that take flat two-pin, round two-pin and
            europlug. A 110V appliance needs a transformer and mostly is not worth the trouble.
            Anything with a motor or a compressor — washing machines, fridges — is cheaper to replace
            than to ship and service.
          </P>
          <P>
            What is genuinely worth bringing: your laptop and anything you rely on professionally,
            medication, prescription glasses, and shoes and clothing if you are at the larger end of
            local sizing, which is the complaint you will hear most often. Specialist hobby equipment
            too — it exists here, but the selection is thinner and the price is not always lower.
          </P>
        </>
      ),
    },
    {
      id: 'money',
      title: 'Money, and why the first month costs more than the ones after it',
      body: (
        <>
          <P>
            The currency is the dong, and prices are quoted in millions casually — “mười hai triệu”
            is 12,000,000₫. Cards work in most places in Ho Chi Minh City, Hanoi and Da Nang and
            rather fewer outside them; cash still runs markets, small restaurants and most landlords.
          </P>
          <P>
            Opening a Vietnamese bank account normally requires a passport plus evidence of legal
            residence — a visa or residence card, and sometimes a work permit or confirmation of your
            registered address. That is not something you do on day two, so plan on several weeks of
            living off a foreign card. Check your home bank’s foreign-transaction fee before you
            leave, and expect ATM withdrawal limits per transaction that make the fixed fee bite.
          </P>
          <P>
            Budget for the deposits rather than the rent. A flat typically wants one to two months
            up front on top of the first month, often in cash, and that lands in the same fortnight
            as furnishing the place and buying or renting transport. The first month is roughly
            double a normal one.
          </P>
        </>
      ),
    },
    {
      id: 'where-to-land',
      title: 'Book somewhere short, sign somewhere long later',
      body: (
        <>
          <P>
            Do not sign a year’s lease from abroad. Book two to four weeks of serviced accommodation
            near where you expect to work, then look properly. Districts differ enormously in noise,
            flood behaviour in the rainy season, commute time on a motorbike at 8am, and how far you
            are from the things you will actually use — and none of that is visible in photographs.
          </P>
          <P>
            When you are ready to look, <VnLink href={marketplaceHref('housing')}>apartments and houses for rent
            in Vietnam</VnLink> are listed by the people who own or manage them, so you can message
            directly and arrange a viewing rather than working through a chain of agents.
          </P>
          <P>
            One rule, and it is the one that saves money: never transfer a deposit for a place you
            have not stood inside, and never to somebody who will not meet you there. That is the
            scam, everywhere, every year. <HereLink href="/safety">How to keep a deal safe</HereLink>{' '}
            covers the rest of the pattern.
          </P>
        </>
      ),
    },
    {
      id: 'work',
      title: 'Lining up work before you arrive',
      body: (
        <>
          <P>
            Teaching, hospitality, tech, design and marketing are where most international hires
            land, and the market rewards being here — but a signed offer before you fly is what makes
            the work permit possible, because the company applies for it, not you. Ask the specific
            question early: will you sponsor the work permit, and who pays for the documents?
          </P>
          <P>
            <VnLink href={marketplaceHref('jobs')}>Roles in Vietnam that ask for English</VnLink> are worth watching
            for a few weeks before you move, if only to calibrate what salaries look like against the
            rent numbers you have been quoted.
          </P>
        </>
      ),
    },
    {
      id: 'first-week',
      title: 'What happens in the first week',
      body: (
        <>
          <P>
            Once you land, the list is short and mostly administrative: get your stay registered with
            the local police through whoever is housing you, buy a SIM registered to your passport,
            work out transport before committing to buying a bike, and start viewing flats.
          </P>
          <P>
            Getting around is the one worth not rushing. Ride-hailing covers the first fortnight
            cheaply, and renting a scooter monthly before you buy one tells you whether you actually
            want to own it — <VnLink href={marketplaceHref('motorbikes')}>motorbikes for sale and for monthly
            rent</VnLink> sit side by side, so the comparison is easy to make.
          </P>
          <P>
            The arrival half of this guide is separate, because it is long:{' '}
            <HereLink href="/first-month-in-vietnam">your first month in Vietnam</HereLink> walks
            through residence registration, the five things to check in a lease, and the deadlines
            that have real consequences.
          </P>
        </>
      ),
    },
  ],
  related: [
    ...expatGuidesExcept('moving-to-vietnam'),
    {
      href: evisaChildPath('official-process'),
      label: 'The official e-visa process, fees and limits',
      blurb: 'What the government portal does, what it costs, and what a service can and cannot add.',
    },
    {
      href: EVISA_HUB_PATH,
      label: 'Vietnam e-visa options',
      blurb: 'Entry types and processing speeds, each priced on its own listing.',
    },
  ],
  faqs: [
    {
      q: 'How long before I move should I start arranging things?',
      a: 'Three months is comfortable if a work permit is involved, because the criminal record check and document legalisation are the slow parts and both happen in your home country. The e-visa itself can be done in days.',
    },
    {
      q: 'Can I work in Vietnam on an e-visa?',
      a: 'No. An e-visa permits entry and a stay of up to 90 days; working legally requires a work permit sponsored by your employer, and a visa or residence card that matches it.',
    },
    {
      q: 'Is it cheaper to ship furniture or buy it there?',
      a: 'Buy it there, in almost every case. Secondhand furniture and appliances from departing residents cost a fraction of shipping, and there is a constant supply of it.',
    },
    {
      q: 'How much cash should I arrive with?',
      a: 'Enough for a rental deposit plus a month of living costs, because a local bank account usually needs a visa or residence card you will not have on day one. Deposits are frequently paid in cash.',
    },
    {
      q: 'Can I drive on my home country’s licence?',
      a: 'Only with an International Driving Permit issued under the 1968 Vienna Convention. A 1949 Geneva Convention permit — the type issued in the United States, among others — is not recognised, and the practical answer is to convert to a Vietnamese licence.',
    },
  ],
}

export const metadata: Metadata = {
  title: `Moving to Vietnam: What to Arrange Before You Fly | ${SITE_NAME}`,
  description:
    'A pre-departure guide to moving to Vietnam: which visa you need and what it costs officially, the documents to legalise at home, what to ship and what to buy secondhand, money for the first month, and where to stay while you look for a flat.',
  alternates: { canonical: '/moving-to-vietnam' },
  openGraph: {
    title: `Moving to Vietnam: What to Arrange Before You Fly | ${SITE_NAME}`,
    description:
      'The visa decision, the documents only your home country can issue, and what not to ship. The pre-departure half of moving to Vietnam.',
  },
}

export default function Page() {
  return <SeoArticle content={CONTENT} />
}
