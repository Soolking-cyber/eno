import type { Metadata } from 'next'
import { SITE_NAME } from '@/lib/edition'
import { marketplaceGuideAlternates, marketplaceGuidesExcept } from '@/lib/expat-guides'
import { HereLink, P, SeoArticle, Ul, type ArticleContent } from '@/components/marketplace/seo-article'

/**
 * SECONDHAND FURNITURE IN HO CHI MINH CITY — the English half; Vietnamese half at
 * /thanh-ly-do-gia-dung-cu-tphcm.
 *
 * ⛔ AN ORDINARY `page.tsx`, SO IT COMPILES ON BOTH EDITIONS AND THE EDITION RULE BINDS EVERY WORD.
 * Nothing here may name a visa, an itinerary or PayPal — the three surfaces the licensed marketplace
 * may not advertise. The subject is furniture, appliances and how they get up a stairwell, which is
 * exactly why it can live on eno.vn.
 *
 * ⚠️ THE PRICE BANDS ARE MEASURED, NOT ESTIMATED — 300 used furniture-and-appliance listings sampled
 * from /api/listings on 2026-09-23, out of 3,201 live in Ho Chi Minh City. Every figure in the prose
 * comes from that sample and nothing else. The competing pages for this query are a decade-old forum
 * thread and a machine-translated listicle with no numbers at all; the numbers ARE the differentiator,
 * so they must stay honest. When the stock changes, re-measure and restate — do not round a stale
 * figure forward.
 *
 * ⚠️ AND THE SUPPLY IS DEALER SUPPLY. A 40-item sample held only THREE distinct sellers, so this page
 * must never describe the stock as departing residents' moving sales. It is secondhand trade stock
 * from HCMC sellers, the article says so out loud, and the reader is told what that means for the
 * negotiation. Whole-home clearances are a different supply and live on /moving-sales-vietnam.
 */
const SLUG = 'secondhand-furniture-ho-chi-minh-city'

const CONTENT: ArticleContent = {
  eyebrow: 'Buying guide · Ho Chi Minh City',
  h1: 'Secondhand furniture in Ho Chi Minh City: what it costs, what to test',
  intro:
    'Used furniture in Saigon is cheap and plentiful, and almost nobody publishes what it actually sells for — so most people negotiate blind. This guide is built from 3,201 used furniture and appliance listings live in Ho Chi Minh City: the real price band for each kind of item, what to test on a used air conditioner, washing machine or sofa before money moves, what delivery up a stairwell really costs, and who is on the other side of the chat.',
  canonical: `/${SLUG}`,
  published: '2026-09-23',
  lang: 'en',
  alternate: { lang: 'vi', href: '/thanh-ly-do-gia-dung-cu-tphcm' },
  sections: [
    {
      id: 'what-it-costs',
      title: 'What used furniture actually costs here',
      body: (
        <>
          <P>
            These are asking prices from 300 used furniture and appliance listings in Ho Chi Minh City,
            sampled on 23 September 2026 out of 3,201 live. The median is the middle price; the band
            beside it is where the middle half of listings sit, so a quarter are cheaper than the low
            figure and a quarter are dearer than the high one. Across everything, the median is{' '}
            <strong>2.480.000 đ</strong> and the middle half runs from 1.050.000 đ to 4.100.000 đ.
          </P>
          <Ul>
            <li>
              <strong>Wardrobe — 6.200.000 đ</strong> (middle half 3.980.000–7.800.000 đ). The most
              expensive thing on the list, and the hardest to get through a door.
            </li>
            <li>
              <strong>Air conditioner — 4.298.000 đ</strong> (3.948.000–5.498.000 đ). The tightest band
              of any category, which is informative in itself; see below.
            </li>
            <li>
              <strong>Washing machine — 2.730.000 đ</strong> (1.648.000–3.480.000 đ).
            </li>
            <li>
              <strong>Sofa — 2.515.000 đ</strong> (1.390.000–4.510.000 đ). A wide band, because a sofa
              is a frame plus foam plus a cover and all three age differently.
            </li>
            <li>
              <strong>Shelving and cabinets — 1.980.000 đ</strong> (1.180.000–3.380.000 đ).
            </li>
            <li>
              <strong>Tables and desks — 1.650.000 đ</strong> (1.050.000–3.200.000 đ). The deepest
              supply in the sample by a distance, which is where your negotiating room is.
            </li>
            <li>
              <strong>Air purifier — 6.000.000 đ</strong>, and <strong>robot vacuum —
              9.000.000 đ</strong>. Only six listings each, so read these as an indication rather
              than a band.
            </li>
          </Ul>
          <P>
            Two things the table cannot tell you. These are what sellers ask, not what buyers pay — on
            the larger pieces there is usually room, and on the deep-supply categories there is a lot
            of it. And the spread inside a category is mostly age and brand, not condition: a
            nearly new inverter washing machine and one several years older both photograph clean.
          </P>
        </>
      ),
    },
    {
      id: 'before-you-buy',
      title: 'Check the lease before you buy anything',
      body: (
        <>
          <P>
            Most places let in Ho Chi Minh City already have the expensive items in them. Air
            conditioners are effectively universal and belong to the flat, not to you; a furnished
            apartment normally adds a bed, a wardrobe, a sofa, a dining set, a fridge and a washing
            machine. What is missing is usually the mattress you would actually sleep on, an oven,
            a water filter and storage. With 19,359 rental listings live across the HCMC districts,
            you can compare furnished against unfurnished at the same rent before committing to buy
            a single thing.
          </P>
          <P>
            So do it in that order: photograph the inventory at handover, ask in writing what the
            landlord will add or replace <em>before</em> you sign — routine then, a favour a month
            later — and only then write the shopping list. The long version, including what is worth
            buying new, is in{' '}
            <HereLink href="/furnishing-a-home-in-vietnam">furnishing a home in Vietnam</HereLink>.
          </P>
        </>
      ),
    },
    {
      id: 'used-or-new',
      title: 'Where used pays, and where the numbers say be careful',
      body: (
        <>
          <P>
            The bands above are not just a budget, they are a signal. Read them sideways and three
            things fall out.
          </P>
          <Ul>
            <li>
              <strong>Tables, desks, shelving and cabinets are the easy win.</strong> They are the
              cheapest categories and the deepest supply, they are boxes with legs, and nothing about
              them wears out invisibly. Walking away from one costs you nothing because there are
              dozens more — which is exactly why an asking price there is soft.
            </li>
            <li>
              <strong>A tight band means a settled market.</strong> Used air conditioners sit inside a
              1.550.000 đ spread from the 25th to the 75th percentile — far tighter than anything
              else. A unit listed well under that is not a bargain that everyone else missed; it is
              old, it is small, or the price excludes taking it off one wall and putting it on yours.
            </li>
            <li>
              <strong>The high-priced small appliances carry a second bill.</strong> A used air
              purifier at a median 6.000.000 đ needs a filter, and a used robot vacuum at
              9.000.000 đ needs a battery within its remaining life. Neither is in the asking price, and
              on both the consumable is a meaningful fraction of what you just paid. Ask when the
              filter was last changed and how many hours the battery has done.
            </li>
          </Ul>
          <P>
            The one category to think twice about is the wardrobe. At a median of 6.200.000 đ it is
            the most expensive item here and the most likely not to fit — through your door, around
            your stairwell, into your lift. Measure the alcove, the stairwell turn and the lift
            diagonal before you fall in love with a photograph.
          </P>
        </>
      ),
    },
    {
      id: 'testing-before-you-pay',
      title: 'The tests that matter, in the seller’s own room',
      body: (
        <>
          <P>
            See it working where it stands, plugged into a wall. Anything that cannot be demonstrated
            should be priced as if it does not work, because sometimes it does not.
          </P>
          <Ul>
            <li>
              <strong>Air conditioner.</strong> Ask for it to be running before you arrive, then put
              your hand at the outlet: cold air within a couple of minutes, and cold enough to be
              uncomfortable. Look under the indoor unit for water marks — a dripping unit is a blocked
              drain at best. Listen to the outdoor compressor for a rattle or a cycle that cuts in and
              out. Then ask the two questions that decide the real price: what year is it, and does the
              price include removal and installation? Moving a split unit means an installer, new pipe,
              a vacuum and often a gas top-up, all quoted separately.
            </li>
            <li>
              <strong>Washing machine.</strong> Run the shortest cycle from start to finish. The spin
              is the test — worn drum bearings announce themselves there and nowhere else. Check under
              the machine for water marks, pull back the door seal and smell it, and turn the empty
              drum by hand to feel for play. Ask whether it is an inverter model; the older ones are
              cheap for a reason and you pay it back monthly.
            </li>
            <li>
              <strong>Sofa.</strong> Sit in every seat including the corners, and press the arms where
              the frame is thinnest. Foam that does not come back up is a re-upholstery job. Look
              underneath: solid timber that is screwed and braced versus stapled board is the whole
              difference in this category, and it is the only honest explanation for why the top
              quarter of sofas here ask more than 4.510.000 đ. And smell it — in this humidity a
              mould smell in a cushion never leaves.
            </li>
            <li>
              <strong>Fridge.</strong> It must already be cold when you walk in, not switched on as you
              arrive. Check the door seal grips a sheet of paper all the way round.
            </li>
            <li>
              <strong>Any warranty.</strong> A dealer will often promise a short guarantee out loud.
              Get the length and what it covers written in the chat thread before you pay, so there is
              a record of it that is not your memory.
            </li>
          </Ul>
        </>
      ),
    },
    {
      id: 'delivery-and-pickup',
      title: 'Delivery, stairwells and the bill nobody quotes',
      body: (
        <>
          <P>
            Small items travel by motorbike courier for very little. Anything larger goes on a
            three-wheeler or a small truck, and the item is only half the quote — the other half is carrying
            it. Ask for the delivery price by district <em>and</em> by floor, and ask it before you
            agree the price of the thing itself, not after. A seller who has already banked the sale
            has no reason to be generous about the fourth floor.
          </P>
          <P>
            Three Saigon-specific traps. Many addresses are down a narrow alley a truck cannot enter,
            so the last fifty metres is carried and it costs. Older buildings have lifts too small for
            a wardrobe or a three-seater, and the stairwell turn is the real constraint, not the width.
            And getting rid of what you are replacing is your problem — agree that with the seller, or
            with the building, before the new one arrives and you own two.
          </P>
          <P>
            Pay on delivery for anything large, and keep the conversation in the chat thread so the
            price, the floor and the promised condition sit in one place. A deposit asked for on an
            item you have not seen is a request to carry a risk the seller is not carrying.
          </P>
        </>
      ),
    },
    {
      id: 'who-is-selling',
      title: 'Who is actually on the other side',
      body: (
        <>
          <P>
            Be clear about where this stock comes from, because it changes how you negotiate. It is
            overwhelmingly trade stock: a 40-item sample of the used furniture here held only three
            distinct sellers. These are Ho Chi Minh City secondhand dealers who buy in bulk, store in a
            warehouse and sell at a spread — not households clearing a flat.
          </P>
          <P>
            That is genuinely useful. A dealer has depth, so you can see a row of wardrobes instead of
            one; a dealer will deliver; and a dealer is still there next week if the machine dies on
            Thursday. But know the incentive. Condition grades like &ldquo;like new&rdquo; or
            &ldquo;barely used&rdquo; are sales language, not a standard. The photo may be of a similar
            unit rather than the one in the warehouse — so ask for a photo or a short video taken
            today, of the exact item, running. A seller with a warehouse of them will not mind; a
            seller with a stock photo will change the subject.
          </P>
          <P>
            If you want the other kind of supply — one household, everything at once, priced to clear
            by a deadline — that is a different page:{' '}
            <HereLink href="/moving-sales-vietnam">moving sales and household clearances</HereLink>.
            The bargains are better and the window is shorter, and you generally take it as it stands.
            Either way, every seller here carries a public trust score, so a listing with no history
            reads as exactly that before you ride across town for it.
          </P>
        </>
      ),
    },
  ],
  related: marketplaceGuidesExcept(SLUG),
  faqs: [
    {
      q: 'How much does secondhand furniture cost in Ho Chi Minh City?',
      a: 'From 300 used listings sampled on 23 September 2026, the median asking price is 2.480.000 đ and the middle half runs 1.050.000–4.100.000 đ. By item: wardrobes around 6.200.000 đ, air conditioners around 4.298.000 đ, washing machines around 2.730.000 đ, sofas around 2.515.000 đ, shelving around 1.980.000 đ and tables or desks around 1.650.000 đ. These are asking prices, so there is usually room on the larger pieces.',
    },
    {
      q: 'Is a used air conditioner worth buying?',
      a: 'Usually yes, but the price is not the whole price. Used units cluster tightly between about 3.948.000 đ and 5.498.000 đ, and moving a split unit needs an installer, new pipe and often a gas top-up, all billed separately. Ask the year, ask whether removal and installation are included, and insist on seeing it blowing genuinely cold before you agree anything.',
    },
    {
      q: 'Where does secondhand furniture on eno.vn come from?',
      a: 'Almost all of it is trade stock from Ho Chi Minh City secondhand dealers — a 40-item sample held only three distinct sellers. That means depth, delivery and a seller who is still there next week, but it also means condition grades are sales language. Household clearances, where one family sells everything at once, are listed separately on the moving sales page.',
    },
    {
      q: 'Who pays for delivery, and how much is it?',
      a: 'The buyer, nearly always, and it is quoted separately from the item. It depends on the district, the vehicle and above all the floor — carrying a wardrobe up four flights is a real cost. Agree the delivery figure and who carries it up before you agree the price of the item, and check the lift and stairwell dimensions first, because a wardrobe that will not turn the corner is the classic Saigon failure.',
    },
    {
      q: 'What should I test before I pay?',
      a: 'See it running where it stands. A fridge should already be cold when you arrive, a washing machine should complete its shortest cycle with no noise at the spin, an air conditioner should blow cold within a couple of minutes with no water dripping from the indoor unit, and a sofa should have a frame you can see is screwed timber rather than stapled board. Get any promised guarantee written into the chat thread before money moves.',
    },
  ],
}

export const revalidate = 3600

export const metadata: Metadata = {
  title: `Secondhand Furniture in Ho Chi Minh City: Real Prices | ${SITE_NAME}`,
  description:
    'What used furniture and appliances actually cost in HCMC, measured from 3,201 live listings — median prices for wardrobes, sofas, air conditioners and washing machines, what to test before paying, and how delivery really works.',
  alternates: marketplaceGuideAlternates(SLUG),
  openGraph: {
    title: `Secondhand Furniture in Ho Chi Minh City: Real Prices | ${SITE_NAME}`,
    description:
      'Measured price bands from 3,201 used furniture and appliance listings in Ho Chi Minh City, plus the checks to run on a used air conditioner, washing machine or sofa before you pay.',
  },
}

export default function SecondhandFurnitureHoChiMinhCityPage() {
  return <SeoArticle content={CONTENT} />
}
