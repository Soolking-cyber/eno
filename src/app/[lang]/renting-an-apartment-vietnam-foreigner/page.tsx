import type { Metadata } from 'next'
import { SITE_NAME } from '@/lib/edition'
import { marketplaceGuidesExcept } from '@/lib/expat-guides'
import { HereLink, P, SeoArticle, Ul, type ArticleContent } from '@/components/marketplace/seo-article'

/**
 * RENTING AN APARTMENT IN VIETNAM AS A FOREIGNER — the marketplace's own long-form guide.
 *
 * ⛔ AN ORDINARY `page.tsx`, SO EVERY WORD IS SUBJECT TO THE EDITION RULE. This route compiles on BOTH
 * builds, which means nothing here may name a visa, an itinerary or PayPal — the three surfaces the
 * licensed marketplace may not advertise. The subject is a tenancy: listings, leases, deposits, meters
 * and handover. That is squarely marketplace territory (rentals is a category on this site), which is
 * exactly why this guide can live here when src/app/[lang]/moving-to-vietnam (services-only) cannot.
 *
 * ⚠️ THE RESIDENCE-DECLARATION SECTION IS DELIBERATELY WRITTEN AS A LANDLORD OBLIGATION, in tenancy
 * vocabulary only — who declares who lives at the address, and what the tenant needs that record for.
 * It carries no permission-to-stay vocabulary of any kind, and it must stay that way.
 *
 * ⚠️ THE NUMBERS ARE MEASURED, NOT ESTIMATED. The listing counts and the secondhand price bands come
 * from the 2026-09-23 inventory measurement against /api/listings (n=300 sampled for the bands). Where
 * a claim is a market convention rather than a measurement — the deposit shape, the notice period — it
 * says so in the sentence. Do not add a figure here that nobody measured.
 *
 * ⛔ THE DEPOSIT NORM HERE MUST MATCH src/app/[lang]/rental-deposit-vietnam. That page is the deep dive
 * (one month is the norm; two on serviced flats, expensive contents lists and terms over a year) and this
 * section is the summary that links to it. The first draft of this page said the usual shape was TWO
 * months, which had one site contradicting itself on the single fact both pages are read for. Summary
 * links to deep dive, one direction, and the number is stated the same way in both.
 *
 * ⚠️ COUNTS ARE ENGLISH-FORMATTED (3,201 · 19,359), MONEY IS VIETNAMESE-FORMATTED (2.480.000 đ), and both
 * appear in the same sentence deliberately. The prose is English, so a count written "3.201" reads as
 * three-point-two — while đồng always takes dot separators, per src/lib/vnd.ts.
 */
const CONTENT: ArticleContent = {
  eyebrow: 'Guide',
  h1: 'Renting an apartment in Vietnam as a foreigner',
  intro:
    'Almost everything written about renting here is written by someone who earns a commission when you sign. This guide is the other half: how listings and viewings actually work in Ho Chi Minh City, what a normal lease says, what the deposit is for and how it comes back, who has to declare your residence at the address, which bills sit outside the rent, and the clauses that are genuinely negotiable.',
  canonical: '/renting-an-apartment-vietnam-foreigner',
  published: '2026-09-23',
  sections: [
    {
      id: 'how-listings-work',
      title: 'How listings and viewings actually work',
      body: (
        <>
          <P>
            The first thing to understand is that one apartment is not one listing. A landlord hands the
            same unit to several agents at once, each of whom photographs it, writes their own headline
            and posts it, so the flat you save on Monday reappears three times by Friday at three prices.
            Matching photos across listings before you message anyone is the single cheapest hour in the
            whole search: it tells you the real asking price and it tells you who is closest to the owner.
          </P>
          <P>
            Viewings are clustered, not booked one by one. An agent will line up four or five units in one
            building or one street and walk you through them in an afternoon, which is efficient and also
            means you will be asked to decide quickly. In Ho Chi Minh City the landlord customarily pays
            the agent, so a fee asked of you as the tenant — a viewing fee, a finder's fee, a
            "paperwork" fee — is worth questioning before you pay it rather than after.
          </P>
          <P>
            Go at the hour you would actually be home. Afternoon sun on a west-facing wall decides your
            electricity bill; the lane outside decides whether you sleep. Check mobile signal inside the
            flat, run a tap while another is running, and look at the ceiling corners of the bathroom for
            the stains that say the unit above leaks. There are{' '}
            <HereLink href="/c/rentals">19,359 rental listings</HereLink> live on this site, every one of
            them in a Ho Chi Minh City district, so walking away from a flat with a bad tell costs you
            nothing but the afternoon.
          </P>
        </>
      ),
    },
    {
      id: 'the-lease',
      title: 'What a normal lease contains',
      body: (
        <>
          <P>
            A standard residential lease here runs twelve months and is written in Vietnamese and English
            in parallel columns. Read the Vietnamese column, or have someone read it: the contract itself
            names which column governs where the two disagree, it is usually the Vietnamese one, and that
            sentence is worth finding before you sign rather than after. Before anything else, check the
            three things that make the contract real:
          </P>
          <Ul>
            <li>
              <strong>The person signing owns the property.</strong> Ask to see the ownership certificate
              and an ID whose name and number match the landlord named in the contract. If you are renting
              from someone who is themselves renting, ask for the owner's written permission to sublet —
              without it, your lease can be ended by a person who never signed it.
            </li>
            <li>
              <strong>The rent is a fixed number in đồng, for the whole term.</strong> Rent quoted in
              dollars and "converted at the rate on the day" is a rent that rises without a renegotiation.
              Fix the figure, fix the payment date, and fix the cadence — monthly is normal for smaller
              units, quarterly in advance is common in serviced buildings and is a real cash-flow
              difference in the first month.
            </li>
            <li>
              <strong>The inventory is attached.</strong> A furnished flat should arrive with a list of
              what is in it, item by item, with condition noted. That list is what the deposit
              conversation is about a year later, and it is much easier to add to it on the day you sign
              than to argue about it on the day you leave.
            </li>
          </Ul>
          <P>
            Furnished and unfurnished are not two price points for the same thing — an unfurnished unit
            hands you the whole fit-out. Against the secondhand stock in Ho Chi Minh City that is a real
            number rather than a vague one: there are 3,201 used furniture and appliance listings from
            HCMC sellers on this site, and a 300-item sample of them puts the median piece at 2.480.000 đ,
            with the middle half between 1.050.000 đ and 4.100.000 đ — a wardrobe around 6.200.000 đ, an
            air conditioner around 4.298.000 đ, a washing machine around 2.730.000 đ, a desk or table
            around 1.650.000 đ. Price the gap before you sign, not after — the{' '}
            <HereLink href="/furnishing-a-home-in-vietnam">furnishing guide</HereLink> has the tests that
            separate a working secondhand appliance from an expensive one.
          </P>
        </>
      ),
    },
    {
      id: 'the-deposit',
      title: 'The deposit, and how it comes back',
      body: (
        <>
          <P>
            One month of rent as the deposit is the norm on a residential lease here, handed to the
            landlord directly at signing, with the first month's rent paid in advance on top of it. Two
            months turns up on serviced apartments, on furnished flats with an expensive contents list,
            and on terms longer than a year; more than two is unusual, and the moment to ask why is before
            you sign. None of this is law — it is convention, which is another way of saying it is
            negotiable. There is no escrow: the money sits with the landlord, so the only protection you
            have is the paperwork you insisted on at the start.
          </P>
          <P>
            The deposit covers damage beyond fair wear, unpaid bills, and — this is the part that
            surprises people — the remainder of the term if you leave early. A twelve-month lease broken
            in month five ordinarily forfeits the whole deposit unless the contract says otherwise. That
            single clause is worth more attention than the rent.
          </P>
          <P>
            Getting it back is mechanical if you set it up. Put a return window in the contract (a number
            of days after handover, not "after the landlord has checked"), agree in writing that final
            electricity and water readings are settled against the deposit rather than held open
            indefinitely, and ask for a walk-through a week before you leave so anything contested can be
            fixed while you still have time and access. Expect the landlord to refuse to let you live out
            the last month against the deposit, and expect a deduction for professional cleaning, which is
            normal and should be a stated figure, not a surprise. Where the wear-and-tear line sits in this
            climate, how to price a deduction instead of arguing about it, and what to do when the money
            does not come back are in the{' '}
            <HereLink href="/rental-deposit-vietnam">deposit guide</HereLink>.
          </P>
        </>
      ),
    },
    {
      id: 'residence-declaration',
      title: 'Who declares your residence at the address',
      body: (
        <>
          <P>
            When a foreigner moves into a Vietnamese property, the person responsible for declaring it to
            the local ward authority is the property owner or the building manager — not the tenant. It is
            an ordinary landlord obligation attached to letting a home, most of it now done online, and it
            should take the landlord minutes. Ask, before you sign, who will do it and how quickly.
          </P>
          <P>
            It matters to you for practical reasons. The address on record is what utility accounts in
            your own name, deliveries, a building access card, bank and school paperwork all hang on, and
            a landlord who is evasive about declaring a tenant usually has a reason — an unregistered
            conversion, a building let on paperwork that does not cover residential tenancy, an owner who
            is not the person collecting your rent. The reluctance is the signal, and it is much better to
            meet it at the viewing than in month three.
          </P>
          <P>
            Ask for a copy or photo of the confirmation once it is done, and keep it with the lease and
            the handover photos. It costs nothing and it is the document you will be asked for at the
            least convenient moment.
          </P>
        </>
      ),
    },
    {
      id: 'bills',
      title: 'What the rent does not include',
      body: (
        <>
          <P>
            The headline rent is rarely the monthly cost. Ask for each of these as a separate line before
            you sign, and ask specifically whether the landlord bills you at the meter or at a rate they
            set themselves — that distinction is the most common quiet markup in the market.
          </P>
          <Ul>
            <li>
              <strong>Electricity.</strong> The household tariff is tiered, so each additional block of
              usage is charged at a higher rate — which is why an air conditioner running all night is not
              a linear cost. Ask to be billed at the meter reading against the utility's own bill, and ask
              to see that bill. A flat per-unit rate is set by the landlord rather than by the tariff, so
              treat it as a price to negotiate and not as a given.
            </li>
            <li>
              <strong>Water, and often waste and cable.</strong> Small individually, and usually metered
              per apartment in newer buildings and estimated per person in older houses. Ask which.
            </li>
            <li>
              <strong>The management or service fee.</strong> In a managed building this is charged per
              square metre per month and covers security, lifts, corridors and pool. Whether the landlord
              or the tenant pays it is negotiable and should be written down — it is a meaningful sum in
              the compounds foreigners usually end up in.
            </li>
            <li>
              <strong>Parking.</strong> Charged per vehicle per month, with a car costing many times a
              motorbike, and in some buildings capped at one space per unit. Confirm availability before
              you sign if you own either.
            </li>
            <li>
              <strong>Internet.</strong> Sometimes included in a serviced unit, usually not in a plain
              lease. If it is included, check what speed and whether it is shared across the building.
            </li>
          </Ul>
          <P>
            Serviced apartments bundle differently — cleaning, linen and sometimes utilities to a capped
            amount are inside the rent, and the cap is the number to ask for.
          </P>
        </>
      ),
    },
    {
      id: 'handover-and-clauses',
      title: 'Handover photos, and the clauses worth negotiating',
      body: (
        <>
          <P>
            Handover day is fifteen minutes of work that decides the argument you have a year later. Photograph
            everything, date-stamped, and send the set to the landlord in a message the same day so there
            is a record that they received it.
          </P>
          <Ul>
            <li>
              <strong>The meters.</strong> Electricity and water, close enough to read every digit. This
              is the one most people skip and the one that costs the most.
            </li>
            <li>
              <strong>Every appliance running.</strong> Air conditioners cooling, washing machine on a
              cycle, water heater hot, extractor fan on, every hob ring lit.
            </li>
            <li>
              <strong>Existing damage, in close-up and in context.</strong> Scuffed walls, chipped
              worktops, a cracked tile, stained upholstery, a warped door. A close-up alone does not prove
              where it was.
            </li>
            <li>
              <strong>Keys, cards and remotes,</strong> laid out and counted, plus the access card numbers.
            </li>
            <li>
              <strong>The inventory list itself,</strong> signed, with the date visible.
            </li>
          </Ul>
          <P>
            And the clauses that are genuinely worth pushing on, in the order they tend to matter: a break
            clause with thirty days' written notice after an initial minimum period, so a job change does
            not cost you the whole deposit; a repair threshold that puts small fixes on you and anything
            structural, electrical or plumbing on the landlord; air-conditioner servicing at the
            landlord's cost at a stated frequency, because in this climate it is maintenance rather than a
            repair; a deposit return window in days; notice before the landlord enters; and a renewal rent
            capped or fixed in advance, which is far easier to agree in month one than in month eleven.
            For the areas themselves — where the international schools, the managed compounds and the
            cheaper edges of the city sit — the{' '}
            <HereLink href="/housing-vietnam-expats">housing overview</HereLink> is the place to start.
          </P>
        </>
      ),
    },
  ],
  related: marketplaceGuidesExcept('renting-an-apartment-vietnam-foreigner'),
  faqs: [
    {
      q: 'How much deposit is normal when renting in Vietnam?',
      a: 'One month of rent is the norm, held by the landlord directly with no escrow, with the first month of rent paid in advance on top of it. Two months turns up on serviced apartments, on furnished flats with an expensive contents list, and on terms longer than a year. It is convention rather than a legal requirement, so it is negotiable — and the clause that decides whether you see the money again is the one covering early termination.',
    },
    {
      q: 'Can a foreigner sign a residential lease in Vietnam?',
      a: 'Yes. Renting a home is an ordinary contract between you and the owner. What matters is that the person signing is the owner named on the ownership certificate, or holds written consent from that owner to sublet, and that the rent is a fixed figure in đồng for the whole term.',
    },
    {
      q: 'Who has to declare my residence at the address?',
      a: 'The property owner or the building manager, not the tenant. It is a landlord obligation that comes with letting a home and is mostly handled online. Ask who will do it before you sign, and ask for a copy of the confirmation afterwards — the address on record is what utility accounts, deliveries, and bank and school paperwork depend on.',
    },
    {
      q: 'What is usually excluded from the rent?',
      a: 'Electricity and water almost always, and typically the building management fee, parking and internet. Ask whether electricity is billed at the meter on the household tariff or at a rate the landlord sets, because a landlord-set per-unit rate is normally above the tariff and it is the most common quiet markup in the market.',
    },
    {
      q: 'Is it cheaper to rent unfurnished?',
      a: 'Monthly, yes — but you are buying the fit-out. There are 3,201 secondhand furniture and appliance listings from Ho Chi Minh City sellers on this site; a 300-item sample puts the median piece at 2.480.000 đ, with the middle half between 1.050.000 đ and 4.100.000 đ, a wardrobe around 6.200.000 đ and an air conditioner around 4.298.000 đ. Price the specific gaps in the flat you are looking at before you decide, not after you sign.',
    },
  ],
}

export const revalidate = 3600

export const metadata: Metadata = {
  title: `Renting an Apartment in Vietnam as a Foreigner | ${SITE_NAME}`,
  description:
    'How listings and viewings really work in Ho Chi Minh City, what a normal lease contains, the deposit norm and how it comes back, who declares your residence, which bills sit outside the rent, and the clauses worth negotiating.',
  alternates: { canonical: '/renting-an-apartment-vietnam-foreigner' },
  openGraph: {
    title: `Renting an Apartment in Vietnam as a Foreigner | ${SITE_NAME}`,
    description:
      'The half a brokerage leaves out: lease terms, what the deposit really covers and how to get it back, metered bills, handover photos and the clauses that are actually negotiable.',
  },
}

export default function Page() {
  return <SeoArticle content={CONTENT} />
}
