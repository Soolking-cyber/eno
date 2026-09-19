import type { Metadata } from 'next'
import { SITE_NAME } from '@/lib/edition'
import { phoneGuideAlternates, phoneGuidesIn } from '@/lib/phone-guides'
import { HereLink, P, SeoArticle, Ul, type ArticleContent } from '@/components/marketplace/seo-article'

/**
 * WHICH SAMSUNG GALAXY TO BUY IN VIETNAM — the English half of the pair; the Vietnamese half is
 * /mua-samsung-galaxy-dong-nao and is written from scratch, not translated.
 *
 * ⛔ THE PAIR DIVERGES ON PURPOSE, AND THE DIVERGENCE IS THE READER. This page is read by someone
 * who arrived with an iPhone habit, does not know what the letter in front of the number means,
 * cannot assume the warranty they know from home applies here, and is weighing the purchase against
 * how long they are staying. The Vietnamese page answers what a local actually argues about: an
 * older S against a newer A at the same money, máy Hàn and the shutter sound that cannot be turned
 * off, which month of the year the discount lands, and how to read the firmware region code at the counter.
 * Machine-translating either one would answer the wrong questions in both languages.
 *
 * ⚠️ NO PRICES IN THE PROSE. A number in an article is stale within a quarter, and Galaxy numbers
 * go stale faster than most — which is itself the subject of a section here. Live figures come from
 * the marketplace's own listings, linked in the body.
 *
 * ⛔ NO SHOP IS RANKED OR RECOMMENDED BY NAME. The marketplace lists several of these retailers and
 * earns affiliate revenue from some, so a ranking here would be an advertisement with an editorial
 * byline. Naming what each KIND of shop is good at is the honest version.
 */
const SLUG = 'samsung-galaxy-buying-guide-vietnam'

const CONTENT: ArticleContent = {
  eyebrow: 'Buying guide',
  h1: 'Which Samsung Galaxy to buy in Vietnam',
  intro:
    'Samsung sells four separate phone lines here and the letter in front of the number tells you more than the number does. This guide explains what S, A, M and Z actually are, why a Galaxy loses value faster in Vietnam than an iPhone does, and which line fits which kind of buyer — including what changes if you are only here for a year.',
  canonical: `/${SLUG}`,
  published: '2026-09-19',
  lang: 'en',
  alternate: { lang: 'vi', href: '/mua-samsung-galaxy-dong-nao' },
  sections: [
    {
      id: 'what-the-letters-mean',
      title: 'What S, A, M and Z actually mean',
      body: (
        <>
          <P>
            Samsung&rsquo;s naming looks arbitrary until you learn that the letter sets the tier and
            the number sets the position within it. Four lines matter in Vietnam, and they are not
            four price points on one ladder &mdash; they are built to different standards.
          </P>
          <P>
            <strong>Galaxy S</strong> is the flagship line: the best chip Samsung ships that year,
            the most capable camera system, the brightest display, and the longest software support
            commitment of any Android family on sale here. The <strong>Ultra</strong> model in each
            S generation is the large one with the built-in stylus and the longest telephoto reach.
            A plain <strong>S</strong> and an <strong>S Plus</strong> differ mostly in screen and
            battery size rather than in capability.
          </P>
          <P>
            <strong>Galaxy S FE</strong> &mdash; &ldquo;Fan Edition&rdquo; &mdash; is the flagship
            line&rsquo;s cheaper cousin, built by reusing parts from the previous generation in a
            simpler body. It is the closest thing to an S at a mid-range price, and it is usually a
            better buy than the entry tier of a newer line.
          </P>
          <P>
            <strong>Galaxy A</strong> is the mid-range, and in unit terms it is what Vietnam actually
            buys. Within the line the number is the tier: an A0-something is entry level, the A1 and
            A2 ranges are lower-mid, and the A3 and A5 ranges are the upper-mid phones that carry
            proper displays, usable cameras and several years of security patches. The jump in
            quality between an A2 and an A5 is far larger than the jump between an A5 and an S.
          </P>
          <P>
            <strong>Galaxy M</strong> is effectively an A-series sibling sold through online channels
            rather than shop floors. The trade is deliberate: larger batteries and sharper pricing in
            exchange for less in-store promotion, fewer bundled accessories and a thinner retail
            presence if something goes wrong.
          </P>
          <P>
            <strong>Galaxy Z</strong> is the foldable line &mdash; <strong>Z Fold</strong> opens like
            a book into a tablet-sized screen, <strong>Z Flip</strong> folds a normal phone in half.
            They are a separate decision with separate durability and repair questions, covered in{' '}
            <HereLink href="/foldable-phones-vietnam">the foldable guide</HereLink>.
          </P>
        </>
      ),
    },
    {
      id: 'why-samsung-falls-further',
      title: 'Why Samsung prices fall further here than Apple’s',
      body: (
        <>
          <P>
            Anyone who watches both brands in Vietnam notices the same thing: a Galaxy flagship is
            meaningfully cheaper a few months after launch, while an iPhone drifts down slowly and
            holds most of its price until the next generation arrives. That is not a coincidence and
            it is not a Vietnam-only quirk, but it is sharper here. Four things drive it.
          </P>
          <Ul>
            <li>
              <strong>Samsung assembles phones in Vietnam at enormous scale.</strong> Stock is
              plentiful, spare parts are local, and service centres are dense even in smaller
              provinces. This does <em>not</em> make the launch price lower &mdash; phones sold
              domestically still carry VAT and a full distribution margin &mdash; but it removes the
              scarcity that would otherwise keep a price propped up.
            </li>
            <li>
              <strong>Android flagship pricing is promotional by design.</strong> Trade-in bonuses,
              bundled accessories, pre-order gifts and scheduled price steps are part of how the line
              is sold. Apple&rsquo;s Vietnamese pricing moves mostly through retailer margin, which
              is a much narrower lever.
            </li>
            <li>
              <strong>The second-hand market prices iPhones higher.</strong> Demand is broader, the
              model line is shorter and buyers recognise every model on sight. A used Galaxy sells
              into a thinner, more fragmented market, and weak resale pulls new prices down too as
              shops clear stock ahead of the next launch.
            </li>
            <li>
              <strong>Samsung ships many tiers at once.</strong> Every new A-series wave pushes the
              previous wave down, and an FE arriving mid-cycle undercuts the S it borrows from.
            </li>
          </Ul>
          <P>
            The practical consequence: the first three to six months of a Galaxy flagship&rsquo;s
            life is the most expensive window to buy in, and the phone you get later is commercially
            a different product but physically the same one. If you are comparing brands rather than
            models, the live Apple side of the picture is on{' '}
            <HereLink href="/iphone-18-vietnam">the iPhone 18 price page</HereLink>, which reads the
            marketplace&rsquo;s own listings rather than a press release, and{' '}
            <HereLink href="/iphone-vs-samsung-vietnam">the iPhone-or-Samsung guide</HereLink> works
            through resale and repair side by side.
          </P>
        </>
      ),
    },
    {
      id: 'which-line-suits-which-buyer',
      title: 'Which line suits which buyer',
      body: (
        <>
          <P>
            The honest version of this advice is not a ranking. Each line is genuinely the right
            answer for somebody, and the deciding factor is usually how long you keep phones rather
            than what you do with them.
          </P>
          <Ul>
            <li>
              <strong>Keeping it four or five years, and the camera matters:</strong> the S line. The
              long update commitment is the reason, not the specification sheet &mdash; a phone that
              stops getting security patches is a banking device you should not be using.
            </li>
            <li>
              <strong>Want most of a flagship for much less:</strong> an FE, or last year&rsquo;s S.
              Both are normally better value than the newest mid-range at the same money.
            </li>
            <li>
              <strong>The phone is a tool</strong> &mdash; banking apps, ride-hailing, maps, Zalo,
              photos of the family: an upper-mid A. This is the sweet spot of the whole range in
              Vietnam and the tier most people over-spend past.
            </li>
            <li>
              <strong>Battery life above everything, and you buy online anyway:</strong> the M line.
              Accept the thinner retail support as part of the deal.
            </li>
            <li>
              <strong>Leaving within a year or two:</strong> think about the exit before the entry. A
              Galaxy gives back less at resale than an iPhone does, so either buy lower down the
              range or buy something already a generation old and let the first owner absorb the
              drop. <HereLink href="/selling-your-phone-vietnam">Selling a phone here</HereLink>{' '}
              covers what actually moves the price.
            </li>
          </Ul>
        </>
      ),
    },
    {
      id: 'checking-a-galaxy-in-the-shop',
      title: 'Checking a Galaxy before you pay',
      body: (
        <>
          <P>
            Vietnam sells locally distributed units alongside imported ones, exactly as it does with
            iPhones, and the difference is who fixes the phone. A unit distributed for the Vietnamese
            market carries the Samsung Vietnam warranty, honoured by Samsung&rsquo;s own service
            centres against the IMEI. An imported handset is warranted by the shop that sold it, for
            whatever period that shop states, at that shop and nowhere else. Ask which one you are
            looking at &mdash; it is an ordinary question here and nobody takes offence.
          </P>
          <P>
            Then verify rather than trust. Three codes do most of the work, and every one of them can
            be typed into the dialler while you stand at the counter:
          </P>
          <Ul>
            <li>
              <strong>*#06#</strong> shows the IMEI. It must match the box and the retailer&rsquo;s
              paperwork, and you can check it against Samsung Vietnam&rsquo;s own warranty lookup
              before you pay.
            </li>
            <li>
              <strong>*#0*#</strong> opens Samsung&rsquo;s hardware self-test: solid colour screens
              for dead pixels and OLED burn-in, touch grid, speakers, vibration motor, sensors and
              both cameras. On a used phone this is the single most useful two minutes available.
            </li>
            <li>
              <strong>*#1234#</strong> shows the firmware, including the region code the phone is
              running. A unit sold for the Vietnamese market runs Vietnamese-market firmware; a
              Korean or US import does not. The code is set by the firmware, not by a sticker on the
              box, which is why it settles the question.
            </li>
          </Ul>
          <P>
            One thing that catches iPhone switchers: Samsung has no battery-health percentage in
            Settings the way iOS does. Battery condition lives in the pre-installed{' '}
            <strong>Samsung Members</strong> app, under its diagnostics section, and on a second-hand
            phone you should insist on seeing it. Buying used is a discipline of its own &mdash;{' '}
            <HereLink href="/buying-a-used-iphone-vietnam">the used-phone inspection guide</HereLink>{' '}
            is written around iPhones but most of the checks transfer directly.
          </P>
        </>
      ),
    },
    {
      id: 'buying-as-a-foreigner',
      title: 'What changes if you are a foreigner here',
      body: (
        <>
          <P>
            A passport is enough to buy any Galaxy outright, anywhere in the country. No residence
            card, no local ID, no Vietnamese bank account. Instalment plans are the exception, and
            they normally require a Vietnamese ID or a residence card plus proof of income, because a
            finance company rather than the shop is carrying the risk.
          </P>
          <P>
            Treat the warranty as national rather than global. A Samsung Vietnam warranty is
            serviced in Vietnam; do not assume a service centre in your home country will take a
            handset distributed here, and do not assume a phone you brought with you is covered while
            you are living here. If the phone will move countries with you within its first year,
            that asymmetry is worth more thought than the price difference.
          </P>
          <P>
            On connectivity: eSIM is standard on the S and Z lines and patchy further down the A and
            M ranges, varying by tier and by year, so confirm it on the exact model rather than
            assuming. Every Vietnamese network issues eSIM, and{' '}
            <HereLink href="/esim-vietnam-guide">the eSIM guide</HereLink> covers what registering
            one requires. Vietnamese retail units ship with English available as a system language,
            and Samsung&rsquo;s own apps are fully translated, so there is no setup barrier.
          </P>
          <P>
            Finally, decide where you are buying before you decide what. Authorised dealers and the
            large chains issue a red VAT invoice as a matter of course, which is what a company
            expense claim needs; import specialists and private sellers usually cannot. ⚠️ An airport
            refund needs more than that invoice &mdash; see{' '}
            <HereLink href="/vat-refund-phone-vietnam">the VAT refund guide</HereLink> for the
            document to ask for at the till.{' '}
            <HereLink href="/best-place-to-buy-iphone-vietnam">The five kinds of phone shop</HereLink>{' '}
            in Vietnam applies to Galaxy buying unchanged.
          </P>
        </>
      ),
    },
  ],
  faqs: [
    {
      q: 'Which Samsung Galaxy should I buy in Vietnam?',
      a: 'For most people an upper-mid Galaxy A — the A3 or A5 range — is the tier that stops feeling like a compromise, and it is where the majority of Vietnamese buyers land. Choose the S line instead if you keep phones four or five years or if the camera genuinely matters, and the M line if battery life outranks everything and you are happy buying online.',
    },
    {
      q: 'What is the difference between Galaxy S and Galaxy A?',
      a: 'The S line is the flagship: the fastest chip of its year, the most capable cameras, the brightest screen and the longest software-update commitment. The A line is the mid-range, built to a price, with a shorter support window and simpler camera hardware. Within the A line the number is the tier — the gap between an A2 and an A5 is wider than the gap between an A5 and an S.',
    },
    {
      q: 'Are Samsung phones cheaper in Vietnam because they are made there?',
      a: 'Not at launch. Phones sold domestically still carry VAT and a full distribution margin, so local assembly does not discount the sticker price. What it does deliver is abundant stock, local spare parts and a dense service-centre network — and, indirectly, faster discounting afterwards, because no importer has to protect a scarce supply.',
    },
    {
      q: 'Do Samsung phones hold their value in Vietnam?',
      a: 'Less well than iPhones do, consistently. The used market here is deeper and more liquid for Apple, so a Galaxy sells into a thinner market and gives back a smaller share of what you paid. That argues for buying a generation-old Galaxy or a lower tier rather than a launch-week flagship, especially if you will not keep it long.',
    },
    {
      q: 'Can a foreigner buy a Samsung phone in Vietnam with a passport?',
      a: 'Yes, for an outright purchase at any retailer — no residence card or local bank account is needed. Instalment plans are different and generally require a Vietnamese ID or residence card plus proof of income, because a finance company rather than the shop underwrites them.',
    },
    {
      q: 'How do I check a Samsung phone is a Vietnam model?',
      a: 'Dial *#1234# and read the firmware region code — a unit distributed for the Vietnamese market runs Vietnamese-market firmware, and an import does not. Confirm the IMEI with *#06# against the box and Samsung Vietnam’s warranty lookup, and run *#0*# to test the screen, touch layer, speakers, sensors and cameras before paying.',
    },
    {
      q: 'Should I buy a Galaxy S now or wait for the price to drop?',
      a: 'Galaxy flagships discount on a schedule, so the first three to six months after launch is the most expensive window. If you do not need the phone this month, waiting past that window usually gets the same handset for noticeably less. If you do need it now, the Fan Edition or the previous generation are the two ways to skip the premium entirely.',
    },
  ],
  related: phoneGuidesIn('en', SLUG).map((g) => ({ href: `/${g.slug}`, label: g.label, blurb: g.blurb })),
}

export const metadata: Metadata = {
  title: `Which Samsung Galaxy to buy in Vietnam — S, A, M and Z explained | ${SITE_NAME}`,
  description:
    'What the S, A, M and Z lines actually are, why Galaxy prices fall further in Vietnam than Apple’s do, which line fits which buyer, and the three dialler codes that verify a handset before you pay.',
  alternates: phoneGuideAlternates(SLUG),
}

export default function SamsungGalaxyBuyingGuideVietnamPage() {
  return <SeoArticle content={CONTENT} />
}
