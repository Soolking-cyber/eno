import type { Metadata } from 'next'
import { SITE_NAME } from '@/lib/edition'
import { PROVIDER_OF_RECORD } from '@/lib/visa-provider'
import { expatGuidesExcept } from '@/lib/expat-guides'
import { evisaChildPath } from '@/app/vietnam-evisa/links'
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
 * "FIRST MONTH IN VIETNAM" — the arrival half, deliberately a SEPARATE page from the pre-departure
 * one.
 *
 * ⚠️ THE SPLIT IS WHAT KEEPS BOTH PAGES OFF THE THIN-CONTENT PILE, and it was the first thing to get
 * wrong. "Moving to Vietnam" and "first month in Vietnam" are close enough that the obvious build is
 * two pages saying the same thing in a different order — which is duplicate content dressed as a
 * cluster, and Google is explicit about consolidating or discounting exactly that. The line drawn
 * here is BEFORE YOU FLY versus AFTER YOU LAND, and it is enforced by subject rather than by tone:
 * document legalisation, shipping and the visa decision live only in the other guide; residence
 * registration, the lease, the licence and the deadlines live only here. Neither repeats the other's
 * sections. If a future edit finds itself explaining consular legalisation here, the edit belongs in
 * the other file.
 *
 * ⚠️ SERVICES EDITION ONLY (`page.svc.tsx`) — see the note in moving-to-vietnam for why the route
 * must not merely redirect on eno.vn but must not exist.
 *
 * ⚠️ NO ADMINISTRATIVE-DIVISION NAMES BELOW DISTRICT LEVEL, AND NO DISTRICT LISTS. Vietnam
 * restructured its provincial units in 2025 and a page naming units that have since merged reads as
 * out of date to the one reader who lives there. City names are stable; the rest is not worth the
 * risk on a page that is meant to last a year between edits.
 */

export const revalidate = 604800 // 7d — static editorial; nothing here is price- or stock-derived.

const CONTENT: ArticleContent = {
  eyebrow: 'Guide · After you land',
  h1: 'Your first month in Vietnam: the checklist that actually matters',
  intro:
    'The first month is mostly admin, and the order matters more than the length of the list — a few of these unlock the others, and two of them have deadlines with real consequences. This is what to do in roughly what order, from the day you land to the day you stop feeling like a visitor.',
  canonical: '/first-month-in-vietnam',
  published: '2026-08-01',
  disclosure: PROVIDER_OF_RECORD.en,
  crossSitePromo: true,
  sections: [
    {
      id: 'residence-registration',
      title: 'Days 1–3: get your stay registered with the local police',
      body: (
        <>
          <P>
            Vietnamese law puts the duty on whoever is housing you: a hotel, a serviced apartment or
            a landlord must declare a foreign guest’s temporary residence to the local police. Hotels
            do it automatically, which is why nobody notices the requirement until they move into a
            private flat, where it is often left undone.
          </P>
          <P>
            It matters later rather than immediately, which is precisely why it gets forgotten.
            Confirmation of your registered address is the sort of thing asked for when you extend a
            stay, apply for a residence card, complete work-permit paperwork or open a bank account —
            and sorting it out retrospectively is slower than doing it on day two. Ask your landlord
            directly whether they have registered you, and ask for evidence rather than a yes.
          </P>
        </>
      ),
    },
    {
      id: 'sim-and-apps',
      title: 'Days 1–3: a phone number that banks will accept',
      body: (
        <>
          <P>
            Get a SIM from an official carrier store with your passport, not a pre-activated one from
            a kiosk. Vietnamese SIMs are registered to an identity document, and a number registered
            to a stranger is a number that can stop working without warning — and one you cannot
            transfer or recover.
          </P>
          <P>
            The number is the key to everything else: banking one-time codes, ride-hailing, food
            delivery, and the account verification on most local services. Doing it properly on day
            two costs an hour. Doing it badly costs the account you attached it to.
          </P>
        </>
      ),
    },
    {
      id: 'getting-around',
      title: 'Week 1: get around before you buy anything',
      body: (
        <>
          <P>
            Ride-hailing apps cover the first fortnight cheaply and let you learn the city before you
            commit. When you are ready for your own transport, rent monthly before you buy: a month
            on a scooter tells you whether you actually want to own one, what size suits the traffic
            where you live, and whether you enjoy the rainy season on two wheels. Both options sit
            side by side under{' '}
            <VnLink href={marketplaceHref('motorbikes')}>motorbikes for sale and for monthly rent</VnLink>,
            which makes the comparison easy to make honestly.
          </P>
          <P>
            The licence question is not optional and is widely ignored: to ride legally you need a
            Vietnamese licence, or an International Driving Permit issued under the 1968 Vienna
            Convention. A 1949 Geneva Convention permit — the United States among others — is not
            recognised here. Riding without a valid licence is what turns a minor accident into an
            uninsured one, which is the real cost. Helmets are compulsory for rider and passenger.
          </P>
          <P>
            Buying secondhand: ride it before you pay, get the blue registration card (cà vẹt) in the
            seller’s name, and do the handover somewhere public.{' '}
            <HereLink href="/safety">The safety guide</HereLink> covers the rest of the pattern, and
            it is the same pattern for every private sale.
          </P>
        </>
      ),
    },
    {
      id: 'the-lease',
      title: 'Weeks 2–3: the lease, and the five things to check in it',
      body: (
        <>
          <P>
            View in person, ideally twice and once in the evening. Then read the contract for these
            five, because they are where the surprises live:
          </P>
          <Ul>
            <li>
              <strong className="font-semibold text-foreground">Term and break clause.</strong> Six or
              twelve months is normal. What happens if you leave early is the clause worth arguing
              about before you sign, not after.
            </li>
            <li>
              <strong className="font-semibold text-foreground">Deposit and the conditions for
              getting it back.</strong> One to two months is standard. Get the condition of the place
              photographed on the day you move in, and agree in writing what counts as fair wear.
            </li>
            <li>
              <strong className="font-semibold text-foreground">Electricity, in writing, per kWh.</strong>{' '}
              Some landlords bill the state rate and some bill a markup, and in a country where air
              conditioning runs most of the year the difference is a real monthly number. Ask for the
              rate, not for an estimate of the bill.
            </li>
            <li>
              <strong className="font-semibold text-foreground">What the rent includes.</strong>{' '}
              Building management fee, water, internet, parking for a motorbike, cleaning — all of
              these are sometimes included and sometimes not.
            </li>
            <li>
              <strong className="font-semibold text-foreground">Registration and invoices.</strong>{' '}
              Whether the landlord will register your temporary residence, and whether they can issue
              a red invoice (hóa đơn) if your employer reimburses rent. Both are easier to secure
              before signing than after.
            </li>
          </Ul>
          <P>
            When you are ready to look,{' '}
            <VnLink href={marketplaceHref('housing')}>apartments and houses listed by their owners
            and managers</VnLink> let you message directly and arrange the viewing yourself.
          </P>
        </>
      ),
    },
    {
      id: 'furnishing',
      title: 'Weeks 2–4: furnish it for a fraction of retail',
      body: (
        <>
          <P>
            Unfurnished in Vietnam usually means genuinely empty, and semi-furnished can mean a bed
            and an air conditioner. The good news is that the international community turns over
            constantly, so there is a permanent supply of sofas, fridges, washing machines, desks and
            kitchen equipment from people whose contracts have ended —{' '}
            <VnLink href={marketplaceHref('moving-sales')}>moving sales and secondhand
            furniture</VnLink> is where most of it surfaces, usually at a fraction of shop prices and
            often with the delivery already arranged because the seller wants it gone.
          </P>
          <P>
            Two rules for appliances: plug it in and run it before money changes hands, and never pay
            a deposit in advance to hold something you have not seen. Pay on collection.
          </P>
        </>
      ),
    },
    {
      id: 'bank-and-cover',
      title: 'Month 1: bank account, health cover, and the paperwork with a deadline',
      body: (
        <>
          <P>
            A local bank account typically needs your passport plus evidence of lawful residence — a
            valid visa or residence card, sometimes a work permit or your registered address. That is
            why this sits in week three or four rather than week one, and why the guide on{' '}
            <HereLink href="/moving-to-vietnam">what to arrange before you fly</HereLink> argues for
            arriving with enough cash to cover a deposit without it.
          </P>
          <P>
            Health cover is the decision people postpone until they need it. Employees on qualifying
            contracts are generally enrolled in the state scheme through their employer; everyone
            else is choosing between a local policy and an international one, and the difference
            shows up in which hospitals will bill directly. Decide while you are well.
          </P>
          <P>
            The paperwork with actual deadlines is the work permit and, if you are staying, the
            temporary residence card. Both are employer- or sponsor-driven and both take longer than
            anyone estimates. Ask for the current status in writing, monthly, until it is issued —
            the failure mode is discovering in month five that nothing was filed.
          </P>
        </>
      ),
    },
    {
      id: 'visa-clock',
      title: 'Month 1: know the last day of your visa',
      body: (
        <>
          <P>
            Put the expiry date in your calendar with a fortnight’s warning, on the day you arrive.
            Overstaying is treated as an administrative offence with a fine, it is resolved at
            departure when you have a flight to catch, and a record of it makes the next application
            harder. Nobody plans to overstay; they lose track of a date.
          </P>
          <P>
            Whether a stay can be extended from inside Vietnam, and on what terms, depends on the
            visa you hold and is decided by the Immigration Department — check the current position
            on{' '}
            <OfficialLink href="https://evisa.gov.vn">evisa.gov.vn</OfficialLink> or with the
            department rather than on a forum. If a fresh application is the answer,{' '}
            <HereLink href={evisaChildPath('official-process')}>the official process and what it
            costs</HereLink> sets out what is a government fee and what is a service fee.
          </P>
        </>
      ),
    },
    {
      id: 'settling-in',
      title: 'And the part nobody puts on a checklist',
      body: (
        <>
          <P>
            The admin above takes a month; feeling settled takes longer, and the thing that shortens
            it is having somewhere to ask small questions. Which district floods. Who fixes an air
            conditioner. Whether that rent is normal. Most of that knowledge sits with people who
            arrived a year before you did.
          </P>
          <P>
            <VnLink href={marketplaceHref('jobs')}>Work listings aimed at internationals</VnLink> are
            a decent barometer of which industries are hiring if your plans are still open, and the
            marketplace’s housing and secondhand sections are, in practice, where a lot of that
            local knowledge gets exchanged one message at a time.
          </P>
        </>
      ),
    },
  ],
  related: [
    ...expatGuidesExcept('first-month-in-vietnam'),
    {
      href: evisaChildPath('official-process'),
      label: 'The official e-visa process, fees and limits',
      blurb: 'What the government portal does, what it costs, and what a service can and cannot add.',
    },
    {
      href: '/safety',
      label: 'Buying and selling safely',
      blurb: 'How to handle a viewing, a handover and a deposit so a private deal stays a good one.',
    },
  ],
  faqs: [
    {
      q: 'Do I have to register my address in Vietnam?',
      a: 'Your accommodation provider does — hotels and serviced apartments handle it automatically, private landlords often do not. Confirm with your landlord and ask for evidence, because proof of temporary residence is requested later for visa, residence-card and banking paperwork.',
    },
    {
      q: 'How soon can I open a Vietnamese bank account?',
      a: 'Usually once you hold a valid visa or residence card, and sometimes not until a work permit or registered address is in place. Plan for several weeks on a foreign card.',
    },
    {
      q: 'Should I buy or rent a motorbike?',
      a: 'Rent monthly first. A month tells you whether you want to own one at all, and rental and sale listings sit side by side so the comparison is easy.',
    },
    {
      q: 'What is the most common surprise in a Vietnamese lease?',
      a: 'The electricity rate. Some landlords bill the state rate and some add a markup, and with air conditioning running most of the year the difference is significant. Get the per-kWh figure in writing before signing.',
    },
    {
      q: 'What happens if I overstay my visa?',
      a: 'It is an administrative offence with a fine, dealt with at departure, and it makes future applications harder. Set a calendar reminder a fortnight before expiry on the day you arrive.',
    },
  ],
}

export const metadata: Metadata = {
  title: `Your First Month in Vietnam: The Arrival Checklist | ${SITE_NAME}`,
  description:
    'What to do in your first month in Vietnam, in order: registering your stay with the local police, a SIM that banks accept, the licence rules for riding, the five things to check in a lease, furnishing cheaply, and the deadlines that have consequences.',
  alternates: { canonical: '/first-month-in-vietnam' },
  openGraph: {
    title: `Your First Month in Vietnam: The Arrival Checklist | ${SITE_NAME}`,
    description:
      'Residence registration, a working phone number, the lease clauses that cost money, and the two deadlines nobody warns you about.',
  },
}

export default function Page() {
  return <SeoArticle content={CONTENT} />
}
