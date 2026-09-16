import type { Metadata } from 'next'
import Link from 'next/link'
import { SITE_NAME } from '@/lib/edition'
import { marketplaceGuidesExcept } from '@/lib/expat-guides'
import { HereLink, P, SeoArticle, Ul, type ArticleContent } from '@/components/marketplace/seo-article'

/**
 * SELLING UP BEFORE YOU LEAVE — the departure half of the marketplace's guide pair.
 *
 * ⛔ ORDINARY `page.tsx`, SO THE EDITION RULE BINDS EVERY WORD: no visa, no itinerary, no PayPal. The
 * subject is the sale itself — timing, pricing, handover — which is the marketplace's own ground.
 *
 * ⚠️ IT IS WRITTEN FOR THE SELLER, AND THAT IS THE POINT. Every other page on this site courts buyers;
 * the constraint on a young marketplace is SUPPLY, and the people with a flat full of things to sell are
 * searching for exactly this six weeks before they fly.
 */
const CONTENT: ArticleContent = {
  eyebrow: 'Guide',
  h1: 'Selling up before you leave Vietnam',
  intro:
    'A flat takes longer to empty than anyone plans for. Six weeks out you can price properly and sell piece by piece; six days out you are giving things away and paying someone to remove the rest. This is the order that works, and the handover details that decide whether you keep your deposit.',
  canonical: '/selling-up-before-you-leave-vietnam',
  published: '2026-09-16',
  sections: [
    {
      id: 'timeline',
      title: 'The timeline that actually works',
      body: (
        <>
          <Ul>
            <li>
              <strong>Six weeks out:</strong> list the big, slow pieces — wardrobes, sofas, beds, desks,
              the fridge and the washing machine. These take the longest to sell and are the ones you
              cannot carry to a friend's flat at the last minute.
            </li>
            <li>
              <strong>Three weeks out:</strong> list everything small, in bundles. Kitchens, tools, bedding
              and plants move as lots, not as items; nobody crosses the city for a colander.
            </li>
            <li>
              <strong>One week out:</strong> re-price what has not moved rather than re-posting it, and
              start answering with "collection only, this weekend".
            </li>
            <li>
              <strong>Final days:</strong> what remains is a donation or a disposal, and both take longer
              than you think. Arrange them before you need them.
            </li>
          </Ul>
          <P>
            Keep one working chair, one lamp and the kettle back until the last day. Selling them early is
            the classic mistake — the last week in an empty flat is miserable enough.
          </P>
        </>
      ),
    },
    {
      id: 'pricing',
      title: 'Price against what is listed, not what you paid',
      body: (
        <>
          <P>
            What you paid is irrelevant to a buyer; what similar pieces are listed at today is the whole
            market. Search the same category here before you set a number, and notice which ones are still
            sitting there — those are the prices that are not working.
          </P>
          <P>
            As a rule of thumb, a piece in good condition that is a year or two old sells for roughly a
            third to a half of its retail price, and the figure is lower for anything that has to be
            dismantled to leave the building. Price a little above what you will take, in round numbers, and
            expect one round of negotiation. Bundles do the heavy lifting: "everything in the kitchen for
            one price" sells in a day where twelve separate listings sit for a fortnight.
          </P>
          <P>
            If a piece has to go by a fixed date, say so in the listing. A deadline is a reason to act, and
            it is the honest version of the pressure you are already under.
          </P>
        </>
      ),
    },
    {
      id: 'listing-well',
      title: 'What makes a listing sell',
      body: (
        <>
          <Ul>
            <li>
              <strong>Photograph in daylight, with the thing cleared.</strong> A sofa with laundry on it
              reads as a sofa nobody wanted.
            </li>
            <li>
              <strong>Measure it.</strong> Width, depth, height. Most questions are about whether it fits,
              and a listing that answers them is one the buyer commits to before travelling.
            </li>
            <li>
              <strong>Say what is wrong with it.</strong> The scratch you disclose is a detail; the scratch
              they find at the door is a renegotiation, usually a successful one.
            </li>
            <li>
              <strong>Name the district and the floor,</strong> and whether there is a lift. This decides
              who bothers, and it prevents the collection that falls apart on the doorstep.
            </li>
            <li>
              <strong>Bundle what belongs together</strong> — the desk with the chair, the bed with the
              mattress. Two items at one price beat two listings at two prices.
            </li>
          </Ul>
          <P>
            You can post from the app or the web in a couple of minutes:{' '}
            <Link href="/post" className="font-semibold text-accent-foreground hover:underline">
              post a listing
            </Link>
            , and the whole-flat case has its own page —{' '}
            <HereLink href="/moving-sales-vietnam">moving sales</HereLink>.
          </P>
        </>
      ),
    },
    {
      id: 'handover',
      title: 'Collection, payment and the deposit',
      body: (
        <>
          <P>
            Agree three things in the message thread before anyone travels: the price, the time, and who
            carries it. Written beats remembered, and the thread is the record if the story changes at the
            door.
          </P>
          <Ul>
            <li>
              <strong>Take payment when the item leaves,</strong> in person, not on a promise to transfer
              later. A held item with no deposit is not sold, and you have a deadline.
            </li>
            <li>
              <strong>Let buyers collect.</strong> Delivering across the city eats the margin on anything
              smaller than a wardrobe.
            </li>
            <li>
              <strong>Protect the building.</strong> Lifts, stairwells and doorframes are where deposits
              die — many buildings require a booking to move anything large, and a scratched lift wall is
              charged to whoever booked it.
            </li>
            <li>
              <strong>Photograph the flat empty,</strong> the same way you photographed it full on day one.
              That pair of photo sets is what a deposit dispute comes down to.
            </li>
          </Ul>
          <P>
            Leave the items the lease says stay. Selling something that came with the flat is the one
            mistake here that is expensive rather than annoying, and inventories are rarely as clear as the
            landlord remembers them being.
          </P>
        </>
      ),
    },
  ],
  related: marketplaceGuidesExcept('selling-up-before-you-leave-vietnam'),
  faqs: [
    {
      q: 'How long before leaving should I start selling?',
      a: 'Six weeks for large furniture and appliances, three for everything small. The last week is for re-pricing what has not moved and arranging donation or disposal for what will not sell at any price.',
    },
    {
      q: 'What price should I ask for used furniture?',
      a: 'Look at what comparable pieces are listed at now, not what you paid. A good-condition piece that is a year or two old generally clears at a third to a half of retail, less if it has to be dismantled to leave the building.',
    },
    {
      q: 'Is it better to sell items separately or as a bundle?',
      a: 'Large pieces separately, small things in bundles. "Everything in the kitchen for one price" sells in a day where a dozen individual listings sit for a fortnight.',
    },
    {
      q: 'How do I avoid losing my rental deposit on the way out?',
      a: 'Book the lift if the building requires it, protect stairwells and doorframes during collection, leave everything the lease says stays, and photograph the empty flat exactly as you photographed it at handover.',
    },
  ],
}

export const revalidate = 3600

export const metadata: Metadata = {
  title: `Selling Up Before You Leave Vietnam: A Six-Week Plan | ${SITE_NAME}`,
  description:
    'When to list, how to price against the market rather than what you paid, what makes a listing sell, and the collection and handover details that decide whether you keep your rental deposit.',
  alternates: { canonical: '/selling-up-before-you-leave-vietnam' },
  openGraph: {
    title: `Selling Up Before You Leave Vietnam: A Six-Week Plan | ${SITE_NAME}`,
    description:
      'Six weeks out you price properly. Six days out you give things away. The order that works, and the handover that protects your deposit.',
  },
}

export default function Page() {
  return <SeoArticle content={CONTENT} />
}
