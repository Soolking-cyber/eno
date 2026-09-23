import type { Metadata } from 'next'
import Link from 'next/link'
import { SITE_NAME } from '@/lib/edition'
import { marketplaceGuidesExcept } from '@/lib/expat-guides'
import { HereLink, P, SeoArticle, Ul, type ArticleContent } from '@/components/marketplace/seo-article'

/**
 * RENTAL DEPOSITS IN VIETNAM — the guide for "my landlord has not returned my deposit".
 *
 * ⛔ AN ORDINARY `page.tsx`, SO EVERY WORD COMPILES ON BOTH EDITIONS AND IS SUBJECT TO THE EDITION
 * RULE. Nothing here may name a visa, an itinerary or PayPal — the three surfaces the licensed
 * marketplace may not advertise. The subject is a residential tenancy and the money held against it,
 * which is marketplace-side by nature: rentals are a live category here and the deposit argument is
 * settled with furniture prices, which is the one number this site happens to own.
 *
 * ⚠️ WHY WE CAN WIN THIS QUERY AND A BLOG CANNOT. Every competing page says "document everything and
 * be polite". The two things here that are not available elsewhere are (a) real replacement prices
 * from the live secondhand market, so a deduction can be PRICED instead of argued about, and (b) the
 * machinery — a public trust score, a dispute centre, a report system — which is infrastructure we
 * actually ship rather than a promise. Both are checkable, which is the whole standard for this page.
 *
 * ⚠️ THE PRICE BANDS ARE MEASURED, NOT ILLUSTRATIVE (eno.vn/api/listings, 2026-09-23, n=300 sampled
 * from 3,201 live used furniture/appliance listings, ~all Ho Chi Minh City). They are ASKING prices
 * from HCMC sellers and the article says so; do not round them, do not extrapolate them to other
 * cities, and do not re-describe the stock as expat moving sales — the sample is dealer-supplied.
 */
const CONTENT: ArticleContent = {
  eyebrow: 'Guide',
  h1: 'Rental deposits in Vietnam: what is fair, and how to get yours back',
  intro:
    'A rental deposit here is normally one month of rent, handed over at signing and returned within days of a clean handover. When it is not returned, the argument is almost never about the law — it is about who has the photographs, who has the keys, and what a scratched wardrobe is actually worth. This guide covers what a deposit may legitimately cover, where the wear-and-tear line sits in this climate, the handover routine that ends the argument before it starts, and the escalation path when the money does not come back.',
  canonical: '/rental-deposit-vietnam',
  published: '2026-09-23',
  sections: [
    {
      id: 'what-the-deposit-is-for',
      title: 'What the deposit is for, and how big it should be',
      body: (
        <>
          <P>
            One month of rent is the norm on a residential lease in Vietnam. Two months turns up on
            serviced apartments, on furnished flats with an expensive contents list, and on fixed terms
            longer than a year. More than two months is unusual, and the moment to ask why is before you
            sign, in writing, not a year later when you want it back.
          </P>
          <P>
            Pay it in a way that leaves a record. A bank transfer with the flat address in the reference
            documents itself; cash needs a signed receipt naming the amount, the date and what it is for.
            Check too that the person taking the money is the person on the contract — if you are renting
            from a master tenant who sublets, your deposit is with someone who can hand the flat back to
            its owner and vanish. And a landlord who will not register the tenancy with the local
            authorities as the law requires is a landlord who does not want a record that you lived
            there, which is exactly the record you may need later.
          </P>
          <P>A deposit legitimately covers four things:</P>
          <Ul>
            <li>
              <strong>Unpaid rent, and the final utility bills.</strong> Electricity and water are billed
              in arrears, so the last bills arrive after you have gone. Holding an amount against them is
              normal and honest — holding the whole deposit against them is not.
            </li>
            <li>
              <strong>Damage beyond fair wear and tear.</strong> The next two sections are entirely about
              where that line sits and what crossing it costs.
            </li>
            <li>
              <strong>Missing items from the signed inventory:</strong> remotes, keys, access cards, the
              gas cylinder, the second set of curtains that ended up somewhere.
            </li>
            <li>
              <strong>An early-termination penalty, if the contract says so.</strong> This one is
              contractual rather than disputable. Sign a twelve-month term, leave in month seven, and
              forfeiting the deposit is usually precisely what you agreed to.
            </li>
          </Ul>
          <P>
            What it does not cover, unless the contract says so in words you read before signing:
            repainting between tenancies, a blanket cleaning charge, the replacement of an appliance that
            died of age, or the landlord&apos;s own maintenance.
          </P>
        </>
      ),
    },
    {
      id: 'fair-wear-and-tear',
      title: 'What "fair wear and tear" means in practice here',
      body: (
        <>
          <P>
            Nobody defines the phrase precisely, and in this climate it does more work than it does
            elsewhere. Two years of Saigon humidity does things to a flat that no tenant caused, and the
            argument usually starts because a landlord is charging a tenant for the weather.
          </P>
          <Ul>
            <li>
              <strong>Wear and tear:</strong> sun-bleached curtains and faded sofa fabric, mould spotting
              on a wall behind a wardrobe that was never meant to be moved, a swollen particle-board edge
              in a kitchen unit, grout gone grey, a dripping tap washer, dropped hinges, a flattened
              mattress. Light bulbs and air-conditioner filters are consumables, not damage.
            </li>
            <li>
              <strong>Not wear and tear:</strong> a burn, a cracked basin or toilet, a hole drilled for a
              television mount or a shelf, a torn screen door, a stain that soaked in, a lost key.
            </li>
            <li>
              <strong>The honest middle:</strong> an air conditioner that failed in your second year.
              Compressors die of age and of never being cleaned. Who was responsible for servicing it,
              how often it was done, and what the contract said decides this one — which is why keeping
              the servicing receipts is worth the five minutes it takes.
            </li>
          </Ul>
          <P>
            The test that resolves most cases: is this the passage of time, a consumable, or an act? Time
            and consumables are the landlord&apos;s. Acts are yours.
          </P>
        </>
      ),
    },
    {
      id: 'what-a-deduction-is-worth',
      title: 'Price the deduction instead of arguing about it',
      body: (
        <>
          <P>
            The most common unfair deduction is not invented damage. It is real damage charged at the
            price of a brand-new replacement — a six-year-old wardrobe with a chipped door billed as a
            new wardrobe. You owe an equivalent item of a comparable age, not an upgrade. In Ho Chi Minh
            City that number is public, which is the part most tenants do not realise they can use.
          </P>
          <P>
            This marketplace currently carries 3,201 live secondhand furniture and appliance listings,
            and every one of a 100-listing sample was posted by a Ho Chi Minh City seller. Across a
            300-listing sample the middle of that market sits at 2.480.000 đ, with a quarter under
            1.050.000 đ and a quarter above 4.100.000 đ. By item, the medians and the number of listings
            each one rests on:
          </P>
          <Ul>
            <li>
              <strong>Air conditioner</strong> — 4.298.000 đ, with most listings between 3.948.000 đ and
              5.498.000 đ (24 listings).
            </li>
            <li>
              <strong>Wardrobe</strong> — 6.200.000 đ, between 3.980.000 đ and 7.800.000 đ (13 listings).
            </li>
            <li>
              <strong>Washing machine</strong> — 2.730.000 đ, between 1.648.000 đ and 3.480.000 đ (10
              listings).
            </li>
            <li>
              <strong>Sofa</strong> — 2.515.000 đ, between 1.390.000 đ and 4.510.000 đ (12 listings).
            </li>
            <li>
              <strong>Shelf or cabinet</strong> — 1.980.000 đ, between 1.180.000 đ and 3.380.000 đ (37
              listings).
            </li>
            <li>
              <strong>Table or desk</strong> — 1.650.000 đ, between 1.050.000 đ and 3.200.000 đ (87
              listings).
            </li>
            <li>
              <strong>Air purifier</strong> — 6.000.000 đ, and a <strong>robot vacuum</strong> 9.000.000 đ.
              Six listings each, so treat those two as an indication rather than a market.
            </li>
          </Ul>
          <P>
            Two caveats, so you can use these honestly. They are asking prices from Ho Chi Minh City
            sellers rather than a record of what each item sold for, and they are a snapshot taken on 23
            September 2026. What they have that a landlord&apos;s round number does not is a date, a
            public URL and a photograph. Open{' '}
            <Link href="/c/furniture-appliances" className="font-semibold text-accent-foreground hover:underline">
              furniture &amp; appliances
            </Link>{' '}
            and send three live listings for the same item. A wardrobe billed at the price of a new one
            is a different conversation once three comparable wardrobes around the 6.200.000 đ median are
            on the screen.
          </P>
          <P>
            Then ask for the quote rather than the figure. A repair that is real has an invoice or a
            quotation with a company name on it. A round number is a negotiating position, and naming it
            as one — politely, once — usually moves it.
          </P>
        </>
      ),
    },
    {
      id: 'handover-photos',
      title: 'The handover photo routine that settles arguments',
      body: (
        <>
          <P>
            This is the part that decides the outcome, and it costs twenty minutes on the day you move
            in. Do it before a single box is unpacked.
          </P>
          <Ul>
            <li>
              <strong>Shoot in a fixed order</strong>, room by room, and keep that order. A wide shot of
              each wall first, then close-ups of every chip, stain, scratch and water mark — the close-up
              proves the damage, the wide shot proves where it is.
            </li>
            <li>
              <strong>Photograph the electricity and water meters</strong> with the digits legible, and
              write the readings into the handover document.
            </li>
            <li>
              <strong>Open everything:</strong> inside the fridge and the freezer, the washing-machine
              drum, under the sink, behind the toilet, inside every wardrobe.
            </li>
            <li>
              <strong>Count the contents against the signed inventory</strong> — remotes, keys, access
              cards, chairs, curtains, the gas cylinder — and photograph them together in one frame.
            </li>
            <li>
              <strong>Take a two-minute video walk-through.</strong> It beats two hundred photographs for
              proving the general state of a flat, because it is continuous and hard to argue is from
              another day.
            </li>
            <li>
              <strong>Send the whole set to the landlord that day</strong>, in the message thread you
              already use, and ask them to confirm receipt. A photo on your phone carries a date you
              could have changed; a photo you sent the other party on your first day is dated by somebody
              who is not you. That single habit is worth more than the photographs.
            </li>
          </Ul>
          <P>
            At move-out, repeat the same shot list in the same order — once before you clean, once after.
            A pair of sets taken at both ends of a tenancy is evidence. One set taken as you leave is an
            assertion, and the other side has one too.
          </P>
        </>
      ),
    },
    {
      id: 'before-you-move-out',
      title: 'What to put in writing before you hand back the keys',
      body: (
        <>
          <Ul>
            <li>
              <strong>Give notice in the form the contract names</strong>, in writing, and get an
              acknowledgement in writing. &quot;I told him last month&quot; is not notice.
            </li>
            <li>
              <strong>Two to four weeks out, ask everything in one message:</strong> what condition do
              you want the flat in, is professional cleaning required and at whose cost, when will the
              final meters be read, how much will be held against the last bills, on what date will the
              balance be returned, and to which account. Asked together, the answer arrives as one
              document you can hold them to.
            </li>
            <li>
              <strong>Settle the utilities you can, and cap the hold on the ones you cannot.</strong>{' '}
              Agree a specific amount to hold against the final bill — an open-ended hold has no end
              date, and that is how a deposit quietly becomes a gift.
            </li>
            <li>
              <strong>Do the walk-through with the landlord physically present</strong>, following your
              own shot list. Agree the deductions there, item by item, out loud.
            </li>
            <li>
              <strong>Sign the handover on the day:</strong> meter readings, inventory as returned,
              deductions agreed, balance owed, the date it will be paid, the account it goes to.
            </li>
            <li>
              <strong>Hand the keys back last.</strong> Once they are gone you cannot re-photograph
              anything, and the only person with access to the evidence is the person deciding your
              deduction. This is the single most common mistake and it is the one that cannot be undone.
            </li>
          </Ul>
        </>
      ),
    },
    {
      id: 'if-it-is-withheld',
      title: 'If the deposit is withheld',
      body: (
        <>
          <P>
            Start by being clear about the other side&apos;s incentive, because it changes what works.
            Most withheld deposits are not fraud. They are a landlord who already holds your money, faces
            no deadline, and finds keeping it easier than returning it — especially when the tenant is
            leaving the country and has stopped replying. Nothing about that changes until keeping it
            starts to cost something: a written record, a third party, and a demand specific enough that
            it has to be answered.
          </P>
          <Ul>
            <li>
              <strong>One calm written message.</strong> The amount, the clause it is owed under, the date
              that was agreed, the photo pairs, a deadline. Nothing else. Anger reads as leverage you do
              not have; specificity reads as somebody who will keep going.
            </li>
            <li>
              <strong>Itemise their deductions and answer each one</strong> with a replacement cost and a
              live comparable listing. Concede the fair ones explicitly — granting the two that are real
              makes the three that are not much harder to hold on to.
            </li>
            <li>
              <strong>Bring in whoever has a continuing relationship with them:</strong> the agent who
              placed you, the building management, or the owner if you rented from a master tenant. They
              have leverage you do not and an interest in the building&apos;s reputation.
            </li>
            <li>
              <strong>If the rental came through a listing here, use the machinery.</strong> Every seller
              on this site carries a public, evidence-based{' '}
              <HereLink href="/trust">trust score</HereLink>, a bad listing can be reported from the
              listing itself, and a case can be opened in the{' '}
              <HereLink href="/disputes">dispute centre</HereLink>, which puts your evidence in front of
              an administrator rather than in front of the other party — a respondent never sees the
              other side&apos;s evidence. The{' '}
              <HereLink href="/safety">safe-trading checklist</HereLink> is the standing version of all
              of this, worth reading before money moves rather than after.
            </li>
            <li>
              <strong>Off the platform</strong>, a residential tenancy dispute is normally mediated at
              ward level before it goes anywhere else, and a written lease is enforceable in the people&apos;s
              court. Be realistic about the arithmetic: for one month of rent, the time and cost of a
              court case exceed the amount at stake. What actually recovers deposits here is a
              documented, itemised, witnessed claim that is cheaper to pay than to keep arguing with.
            </li>
          </Ul>
          <P>
            Whatever happens, keep it in writing. A deposit conversation that lives in a message thread
            is one you can still win a month after you have left; one that lived in phone calls is gone
            the moment somebody stops answering. If you are also selling up, the same photo discipline is
            what protects the flat on the way out —{' '}
            <HereLink href="/selling-up-before-you-leave-vietnam">selling up before you leave</HereLink>{' '}
            covers the collection day in detail.
          </P>
        </>
      ),
    },
  ],
  related: marketplaceGuidesExcept('rental-deposit-vietnam'),
  faqs: [
    {
      q: 'How much is a normal rental deposit in Vietnam?',
      a: 'One month of rent on most residential leases. Two months is common on serviced apartments and on long fixed terms with an expensive contents list; more than that is unusual and worth questioning before you sign. Whatever the figure, get the amount and the date acknowledged in writing — a deposit that exists only in a conversation is the easiest one to lose.',
    },
    {
      q: 'My landlord wants the price of a brand-new appliance for a damaged one. Is that fair?',
      a: 'No. You owe an equivalent replacement of a comparable age, not an upgrade. The Ho Chi Minh City secondhand market is public: median asking prices are 4.298.000 đ for an air conditioner, 2.730.000 đ for a washing machine, 2.515.000 đ for a sofa and 6.200.000 đ for a wardrobe. Send three live listings for the same item, and ask for the repair quotation rather than accepting a round number.',
    },
    {
      q: 'Can a landlord deduct for repainting?',
      a: 'Marks from ordinary living are wear and tear, and repainting between tenancies is maintenance — so a whole-flat repaint charged to a tenant of two years is a deduction to push back on. A specific wall you damaged is a different matter, and should be costed as that one wall rather than as the whole flat.',
    },
    {
      q: 'What do I do if my landlord simply stops replying?',
      a: 'Send one written message stating the amount, the contract clause, the deadline and the evidence, then involve whoever has an ongoing relationship with them: the agent who placed you, the building management, or the owner if you rented from a master tenant. Keep everything in writing. A documented, itemised claim with a third party attached recovers far more deposits than a court case over one month of rent ever will.',
    },
    {
      q: 'Do I have to accept a cleaning charge?',
      a: 'Only if the contract provides for it, and only at a real cost — ask for the cleaning company invoice. Where cleaning is required, doing it yourself before the walk-through is almost always cheaper than the figure that gets deducted for it afterwards.',
    },
  ],
}

export const revalidate = 3600

export const metadata: Metadata = {
  title: `Rental Deposit in Vietnam: What Is Fair and How to Get It Back | ${SITE_NAME}`,
  description:
    'What a rental deposit in Vietnam covers, where the fair wear and tear line sits in this climate, real secondhand replacement prices to answer a deduction with, and what to do when a landlord does not return it.',
  alternates: { canonical: '/rental-deposit-vietnam' },
  openGraph: {
    title: `Rental Deposit in Vietnam: What Is Fair and How to Get It Back | ${SITE_NAME}`,
    description:
      'The handover photo routine that settles deposit arguments, real replacement prices for a damaged item, and the escalation path when the money is withheld.',
  },
}

export default function Page() {
  return <SeoArticle content={CONTENT} />
}
