import type { Metadata } from 'next'
import Link from 'next/link'
import { SITE_NAME } from '@/lib/edition'
import { marketplaceGuidesExcept } from '@/lib/expat-guides'
import { HereLink, P, SeoArticle, Ul, type ArticleContent } from '@/components/marketplace/seo-article'

/**
 * FURNISHING A HOME IN VIETNAM — the marketplace's own long-form guide.
 *
 * ⛔ AN ORDINARY `page.tsx`, AND EVERY WORD HERE IS SUBJECT TO THE EDITION RULE. This route compiles on
 * BOTH builds, so nothing on this page may name a visa, an itinerary or PayPal — the three surfaces the
 * licensed marketplace may not advertise. The subject is furniture and appliances, which is exactly why
 * it can live here when src/app/moving-to-vietnam (services-only) cannot.
 *
 * ⚠️ THE ADVICE IS DELIBERATELY SPECIFIC AND CHECKABLE. A guide that says "shop around and be careful"
 * ranks for nothing and helps nobody; the numbers below are the ones a newcomer actually asks about —
 * what a landlord normally supplies, what a used fridge is worth against a new one, what to test before
 * paying. Where a claim is a range rather than a fact, it says so.
 */
const CONTENT: ArticleContent = {
  eyebrow: 'Guide',
  h1: 'Furnishing a home in Vietnam without overpaying',
  intro:
    'Most rentals here arrive with more furniture than newcomers expect and fewer of the things they actually need. This guide covers what a landlord normally supplies, what is worth buying new, what is far better bought secondhand, and how to check a used piece before any money moves.',
  canonical: '/furnishing-a-home-in-vietnam',
  published: '2026-09-16',
  sections: [
    {
      id: 'what-the-landlord-supplies',
      title: 'Start with what the lease already covers',
      body: (
        <>
          <P>
            A serviced apartment is usually let fully furnished: bed, wardrobe, sofa, dining table, air
            conditioning, fridge, washing machine, often a microwave. An unfurnished house or an older
            apartment may come with nothing but the air conditioners and the kitchen cabinets. Between
            those two extremes sits the common case — furnished, but with a mattress you would not sleep
            on and no oven, because ovens are rare in Vietnamese kitchens.
          </P>
          <P>
            Before buying anything, get the inventory in writing. Photograph every item at handover,
            including the state of it, and keep the photos: at move-out the deposit conversation is about
            exactly this list. Ask specifically whether the landlord will replace a tired mattress or add
            a water heater — a request made before you sign is routine, and the same request a month later
            is a favour.
          </P>
        </>
      ),
    },
    {
      id: 'new-versus-used',
      title: 'What to buy new, and what never to',
      body: (
        <>
          <P>
            The split is not about money, it is about what wears out and what does not. Buy new where
            hygiene or warranty is the whole value; buy used where the item is a box with legs.
          </P>
          <Ul>
            <li>
              <strong>New:</strong> mattresses and anything upholstered you sleep on, kitchen knives and
              pans, and any appliance whose warranty you will realistically use — a washing machine that
              fails in month four is a service visit, not a project.
            </li>
            <li>
              <strong>Used, without hesitation:</strong> wardrobes, shelving, desks, dining tables and
              chairs, bed frames, bar stools, standing lamps, drying racks. Solid wood costs a fraction of
              its retail price second-hand and does not deteriorate on a shelf.
            </li>
            <li>
              <strong>Used with a test:</strong> fridges, washing machines, microwaves, air purifiers,
              televisions and monitors. Working ones are commonly half the new price or less; the test
              below is what separates the two.
            </li>
          </Ul>
          <P>
            The reason so much good furniture is available is turnover: people leave, and a flat's worth of
            furniture has to go in a fortnight. That is also why timing matters — the end of a month, and
            the end of a school year, are when the most is listed at once.
          </P>
        </>
      ),
    },
    {
      id: 'checking-a-used-piece',
      title: 'How to check a used appliance in five minutes',
      body: (
        <>
          <P>
            Insist on seeing it working, in the flat it is in, plugged into a wall. A seller who will not
            demonstrate an appliance is telling you something.
          </P>
          <Ul>
            <li>
              <strong>Fridge:</strong> it should already be cold when you arrive, not switched on as you
              walk in. Check the door seal grips a sheet of paper all the way round, and smell the inside —
              a mould smell never leaves.
            </li>
            <li>
              <strong>Washing machine:</strong> run the shortest cycle end to end. Listen at the spin, which
              is where worn bearings announce themselves, and look underneath for water marks.
            </li>
            <li>
              <strong>Air conditioner:</strong> ask when it was last cleaned and check the outdoor unit is
              reachable. A cheap unit in an unreachable position costs more to maintain than it saved.
            </li>
            <li>
              <strong>Wood:</strong> lift one corner. Solid wood is heavy and the joints stay tight;
              particle board flexes, and in this humidity a swollen edge never recovers.
            </li>
            <li>
              <strong>Everything:</strong> agree who moves it, and up which stairs, before agreeing the
              price. Delivery for a wardrobe to a fourth floor with no lift is a real cost and it is
              routinely the part that goes wrong.
            </li>
          </Ul>
        </>
      ),
    },
    {
      id: 'where-to-look',
      title: 'Where the stock actually is',
      body: (
        <>
          <P>
            Three sources, in the order most people end up using them. Departing residents sell whole flats
            at once and price to clear, which is where the bargains are, but the window is short and you
            take everything as it stands. Secondhand dealers hold stock in warehouses, mostly around the
            outer districts, and will deliver for a fee — more expensive than a private sale, less
            expensive than new, and you can see fifty wardrobes in an afternoon. New retail is worth it for
            the short list above, and January and the weeks before Tết are when the discounts are real.
          </P>
          <P>
            On this site, the two places to start are{' '}
            <Link href="/c/furniture-appliances" className="font-semibold text-accent-foreground hover:underline">
              furniture &amp; appliances
            </Link>{' '}
            and the{' '}
            <HereLink href="/moving-sales-vietnam">moving sales</HereLink> page, which collects whole-home
            clearances. Every seller carries a public trust score, so a listing with no history reads as
            exactly that before you travel across town for it.
          </P>
        </>
      ),
    },
    {
      id: 'budget',
      title: 'What a first flat actually costs to fill',
      body: (
        <>
          <P>
            For a one-bedroom that already has the big pieces, expect to spend on a mattress, a small
            appliance or two, lighting, and the kitchen. For an unfurnished flat, the list is long and the
            secondhand route is usually the difference between one month's rent and three.
          </P>
          <P>
            Two costs newcomers forget: delivery and disposal. Getting a sofa up a narrow staircase is
            quoted separately, and getting rid of whatever it replaces is your problem — which is the
            single best argument for buying the size that actually fits, measured, before you buy it.
          </P>
        </>
      ),
    },
  ],
  related: marketplaceGuidesExcept('furnishing-a-home-in-vietnam'),
  faqs: [
    {
      q: 'Is secondhand furniture in Vietnam actually cheaper than new?',
      a: 'For the large solid pieces, substantially — wardrobes, tables, bed frames and shelving are the classic case, because they hold their usefulness and lose their price. For mattresses, upholstery and anything under warranty the saving is usually not worth it.',
    },
    {
      q: 'What should a furnished rental already include?',
      a: 'Typically air conditioning, a bed and wardrobe, a sofa, a dining set, a fridge and a washing machine. Ovens, microwaves, water filters and a decent mattress are the common gaps — agree them in writing before you sign, not after.',
    },
    {
      q: 'When is the best time to buy secondhand?',
      a: 'When other people are leaving: the end of a month, and the end of the school year. Whole-flat clearances are listed at once and priced to clear within a fortnight.',
    },
    {
      q: 'How do I avoid a broken appliance?',
      a: 'See it running in the flat it is in, not switched on as you arrive. A fridge should already be cold, a washing machine should complete its shortest cycle, and anything that cannot be demonstrated should be priced as if it does not work.',
    },
  ],
}

export const revalidate = 3600

export const metadata: Metadata = {
  title: `Furnishing a Home in Vietnam Without Overpaying | ${SITE_NAME}`,
  description:
    'What a landlord should already supply, what is worth buying new, what to buy secondhand, and how to check a used fridge, washing machine or wardrobe before you pay for it.',
  alternates: { canonical: '/furnishing-a-home-in-vietnam' },
  openGraph: {
    title: `Furnishing a Home in Vietnam Without Overpaying | ${SITE_NAME}`,
    description:
      'What to buy new, what to buy used, and the five-minute test that separates a working secondhand appliance from an expensive one.',
  },
}

export default function Page() {
  return <SeoArticle content={CONTENT} />
}
