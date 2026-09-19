import type { Metadata } from 'next'
import { SITE_NAME } from '@/lib/edition'
import { phoneGuideAlternates, phoneGuidesIn } from '@/lib/phone-guides'
import { HereLink, P, SeoArticle, Ul, type ArticleContent } from '@/components/marketplace/seo-article'

/**
 * THE BEST-VALUE PHONES IN VIETNAM — the English half of the pair; the Vietnamese half is
 * /dien-thoai-tam-trung-dang-mua and is written from scratch, not translated.
 *
 * ⛔ THE PAIR DIVERGES ON PURPOSE. This page is read by someone who did not grow up with this
 * shelf: they arrive with a phone bought elsewhere, they do not know which brands have an official
 * presence here, and their real questions are about bands, eSIM, warranty that does not travel, and
 * how long a handset lasts in this climate. The Vietnamese page assumes all of that is obvious and
 * spends its length where a local buyer actually hesitates — chip tier versus resale liquidity,
 * how long a brand's update promise survives contact with reality, and whether a used previous-gen
 * flagship beats a new mid-ranger. Translating either one would answer the wrong questions twice.
 *
 * ⛔ NO PRICES IN THE PROSE. Phone pricing moves monthly and a stale number is worse than none;
 * live figures come from the marketplace's own listings, which is what /iphone-18-vietnam reads.
 *
 * ⛔ NO SHOP IS NAMED OR RANKED. The marketplace lists several retailers and earns affiliate
 * revenue from some, so a ranking here would be an ad with an editorial byline.
 */
const SLUG = 'best-value-phones-vietnam'

const CONTENT: ArticleContent = {
  eyebrow: 'Buying guide',
  h1: 'The best-value phones in Vietnam',
  intro:
    'A mid-range phone in Vietnam is not a compromised flagship — in this market it is the segment the brands fight hardest over, and for most people it is the better buy. This guide explains where the mid-range genuinely wins, the three specifications that decide how a phone feels in its third year, and the one situation where last year’s flagship beats both.',
  canonical: `/${SLUG}`,
  published: '2026-09-19',
  lang: 'en',
  alternate: { lang: 'vi', href: '/dien-thoai-tam-trung-dang-mua' },
  sections: [
    {
      id: 'what-mid-range-means-here',
      title: 'What “mid-range” means on a Vietnamese shelf',
      body: (
        <>
          <P>
            The tier that sells in volume here is not the same tier that sells in volume in Europe or
            North America, and that changes the value calculation. Vietnam is a phone market where
            most buyers pay cash for a handset they intend to keep for years, so the brands compete
            hardest in the middle: large AMOLED panels, high refresh rates, fast charging and a
            charger in the box are ordinary at this level, not exceptional. A mid-range handset here
            is specified better than a mid-range handset in a market where carriers subsidise the top
            end.
          </P>
          <P>
            The second thing to know is which brands actually have an official presence. Samsung,
            Apple, Xiaomi, OPPO, vivo, realme and Honor are all distributed here, which means
            authorised service centres, stocked spare parts and a manufacturer warranty that any
            authorised centre will honour. Brands with no official Vietnamese distribution &mdash;
            Google&rsquo;s Pixel line is the one most expats ask about &mdash; reach the country as
            imports only. The handset works perfectly well; the warranty is the importing
            shop&rsquo;s promise rather than the manufacturer&rsquo;s, and a screen replacement means
            waiting for a part rather than walking into a service centre.
          </P>
          <P>
            So &ldquo;best value&rdquo; here is not a single model. It is the intersection of three
            things: a chipset that will still feel fine in year three, an update window that has not
            already half expired, and a repair network that exists in the city you live in.
          </P>
        </>
      ),
    },
    {
      id: 'where-mid-range-wins',
      title: 'Where a mid-range genuinely beats a flagship',
      body: (
        <>
          <P>
            On several axes that matter daily, the mid-range is not merely adequate &mdash; it is
            better. This is not a consolation-prize argument:
          </P>
          <Ul>
            <li>
              <strong>Battery life.</strong> Mid-range phones routinely carry larger batteries than
              flagships and drive a less power-hungry display, so screen-on time is often longer,
              not shorter.
            </li>
            <li>
              <strong>Charging speed.</strong> Several mid-range lines charge dramatically faster
              than the flagship iPhones and Galaxies sold alongside them, and most still include a
              suitable charger in the box.
            </li>
            <li>
              <strong>Cost of an accident.</strong> In a city you cross by motorbike, in a climate
              that rains sideways for months, the replacement cost of a screen is a real
              specification. Mid-range glass costs a fraction of flagship glass, and the parts are
              everywhere.
            </li>
            <li>
              <strong>Two physical SIMs.</strong> Useful if you are keeping a home number alive
              alongside a Vietnamese one &mdash; although every Vietnamese network now issues eSIM,
              so this matters less than it used to.
            </li>
          </Ul>
          <P>
            What you give up is narrower than the price gap suggests, but it is real: sustained
            performance under load (gaming and video export, where a mid-range chip throttles and a
            flagship does not), low-light photography, ingress protection ratings, haptics and
            speakers, and &mdash; most importantly &mdash; the length of the software support window.
            If none of those are how you use a phone, the flagship premium is buying you very little.
          </P>
        </>
      ),
    },
    {
      id: 'three-specs-that-age-worst',
      title: 'The three specs that age worst',
      body: (
        <>
          <P>
            Almost everything on a spec sheet is either fine forever or irrelevant by year two. Three
            things are neither, and they are the three that decide whether you are shopping again in
            2028.
          </P>
          <P>
            <strong>1. The chipset.</strong> It is the only component you cannot upgrade, replace or
            work around, and it ages in a way the benchmark score at launch does not predict. A
            mid-tier chip is comfortable with today&rsquo;s apps; three years of software bloat later
            it is the reason the phone feels tired. It also carries the modem and the image
            processor, so it quietly determines signal quality in a weak-coverage building and how
            good the camera is in bad light, regardless of how many megapixels the sensor claims.
            When comparing two phones at the same price, the chip tier is the single most predictive
            number on the page.
          </P>
          <P>
            <strong>2. The battery.</strong> Lithium-ion cells lose capacity with charge cycles and,
            more importantly here, with heat &mdash; and Vietnam supplies heat generously. Fast
            charging, a phone left on a scooter mount in direct sun, and a handset that gets warm
            while navigating all shorten the same clock. Apple rates the batteries in its recent
            iPhones to hold about 80% of their capacity after 1,000 full cycles, roughly double the
            rating on older models; Android makers publish this less consistently, and real-world
            outcomes vary widely. The consoling part is that a battery is a serviceable part and
            replacing one costs a small fraction of replacing a phone. Budget for one replacement
            during the life of any phone you intend to keep four years.
          </P>
          <P>
            <strong>3. The update window.</strong> This is the specification most buyers never check
            and the one that actually ends the phone&rsquo;s life. The top of the Android market now
            commits to around seven years of OS and security updates on flagships; mid-range
            commitments are commonly shorter, often in the region of four OS versions and five years
            of security patches, and they vary by brand and by individual model. Apple does not
            publish a commitment, but iPhones have historically received major iOS updates for
            roughly five to six years. Two rules follow. First, check the window for the exact model,
            not the brand. Second, the clock starts at the model&rsquo;s release date, not your
            purchase date &mdash; buying a two-year-old phone spends two years of the window before
            you open the box.
          </P>
        </>
      ),
    },
    {
      id: 'last-years-flagship',
      title: 'When last year’s flagship beats both',
      body: (
        <>
          <P>
            One generation back, bought new from official stock while the retailer is clearing it, is
            frequently the strongest value buy in this market. You get a flagship chipset, the larger
            camera sensors, the ingress rating, the better screen and the longer update commitment
            &mdash; at money the current mid-range is asking. Vietnamese retailers keep previous-year
            flagships on the shelf far longer than retailers in markets driven by carrier upgrade
            cycles, so this option is unusually available here.
          </P>
          <P>The arithmetic only works if you check three things before paying:</P>
          <Ul>
            <li>
              <strong>Update window remaining.</strong> Subtract the model&rsquo;s age from its
              committed window. A flagship with seven years of support and two years on the clock
              still beats a mid-ranger with four.
            </li>
            <li>
              <strong>Whether it is new or used.</strong> New old stock carries a fresh manufacturer
              warranty and an untouched battery. A used unit carries neither, and battery health is
              the number that decides whether it is a bargain.
            </li>
            <li>
              <strong>Parts and service.</strong> A flagship two generations old is still serviceable
              at authorised centres for mainstream brands; a discontinued model from a brand with no
              local distribution may not be.
            </li>
          </Ul>
          <P>
            Going two or more generations back is a used-phone purchase, not a discount purchase, and
            it should be treated as one. The inspection that separates a good used handset from an
            expensive mistake is in{' '}
            <HereLink href="/buying-a-used-iphone-vietnam">the used-phone inspection guide</HereLink>
            , and it applies to Android just as well.
          </P>
        </>
      ),
    },
    {
      id: 'buying-here-as-a-foreigner',
      title: 'Buying here when you did not grow up with this shelf',
      body: (
        <>
          <P>
            A passport is enough to buy any handset outright anywhere in Vietnam &mdash; no residence
            card, no local ID, no Vietnamese bank account. What is worth checking before you pay is
            everything that does not show up on a price tag.
          </P>
          <Ul>
            <li>
              <strong>Bands and 5G.</strong> A handset bought abroad will make calls and use 4G here
              in almost every case, but 5G band coverage varies by model, and 5G in Vietnam is
              concentrated in the cities. If 5G matters to you, check the specific model&rsquo;s band
              list rather than assuming; the{' '}
              <HereLink href="/budget-5g-phones-vietnam">cheap 5G phones guide</HereLink> covers what
              the entry level actually supports.
            </li>
            <li>
              <strong>Warranty that does not travel.</strong> A manufacturer warranty bought in
              Vietnam is serviced in Vietnam. A handset bought abroad and brought here is usually not
              covered by a Vietnamese service centre, even for a brand sold here. If you are staying
              more than a year, buying locally is worth more than the sticker difference suggests.
            </li>
            <li>
              <strong>Imported units.</strong> Shops selling grey-market stock are entirely normal
              here, the handsets are genuine, and the warranty is the shop&rsquo;s own &mdash;
              typically six to twelve months, honoured at that shop and nowhere else.
            </li>
            <li>
              <strong>Keep the invoice.</strong> It is what a warranty claim starts from, and the
              only route to an airport VAT refund if you leave within the qualifying window.
            </li>
          </Ul>
          <P>
            For what things actually cost this week rather than what they cost when this was written,
            the live figures on <HereLink href="/iphone-18-vietnam">the iPhone 18 price page</HereLink>{' '}
            read the marketplace&rsquo;s own listings, which is the only price that is ever current.
          </P>
        </>
      ),
    },
  ],
  faqs: [
    {
      q: 'Are mid-range phones worth it in Vietnam?',
      a: 'For most people, yes. Vietnam’s mid-range is the segment brands compete hardest in, so large AMOLED screens, high refresh rates, fast charging and big batteries are ordinary at this level. You give up sustained performance under load, low-light photography, water resistance ratings and — the one that matters long term — years of software support.',
    },
    {
      q: 'Which phone specs matter most for longevity?',
      a: 'Three: the chipset, because it is the only part you cannot upgrade and it decides how the phone feels in year three; the battery, because heat and charge cycles degrade it on a fixed clock; and the update window, because when security patches stop, apps and services eventually follow. Everything else on the spec sheet ages far more gracefully.',
    },
    {
      q: 'How long do Android phones get software updates?',
      a: 'It varies by brand and by model. Flagships at the top of the Android market now commit to around seven years of OS and security updates. Mid-range commitments are typically shorter, often in the region of four OS versions and five years of security patches. Check the exact model, and remember the clock starts at the model’s release date, not your purchase date.',
    },
    {
      q: 'Is it better to buy an older flagship or a new mid-range phone?',
      a: 'One generation back, bought new while a retailer is clearing stock, is often the better buy: flagship chipset, better camera hardware, ingress rating and a longer support window at mid-range money. Two or more generations back is a used-phone purchase and should be inspected like one, with battery health checked before you pay.',
    },
    {
      q: 'How long does a phone battery last in Vietnam?',
      a: 'Shorter than the datasheet implies, because heat degrades lithium-ion cells as surely as charge cycles do, and this climate supplies plenty of it. Apple rates recent iPhone batteries at about 80% capacity after 1,000 full cycles; Android figures are published less consistently. A replacement costs a small fraction of a new phone, so plan for one rather than replacing the handset.',
    },
    {
      q: 'Do phones bought abroad work in Vietnam?',
      a: 'Calls and 4G work in almost every case. 5G depends on the model’s band support, and 5G coverage here is concentrated in cities. Every Vietnamese network issues eSIM, so an eSIM-only handset is usable. The real catch is warranty: a phone bought abroad is generally not serviced by a Vietnamese service centre, even for a brand sold here.',
    },
    {
      q: 'Which phone brand is the best value in Vietnam?',
      a: 'There is no single answer, and anyone giving you one is selling something. Compare on the three axes that decide the outcome: chip tier for the price, the committed update window for that exact model, and whether the brand has authorised service centres and stocked parts in your city. A brand with no official Vietnamese distribution can still be a good phone, but it is an import with a shop warranty.',
    },
  ],
  related: phoneGuidesIn('en', SLUG).map((g) => ({ href: `/${g.slug}`, label: g.label, blurb: g.blurb })),
}

export const metadata: Metadata = {
  title: `The best-value phones in Vietnam — mid-range, flagship or last year’s? | ${SITE_NAME}`,
  description:
    'Where a mid-range phone genuinely beats a flagship in Vietnam, the three specs that age worst — chipset, battery and update window — and when last year’s flagship is the better buy than either.',
  alternates: phoneGuideAlternates(SLUG),
}

export default function BestValuePhonesVietnamPage() {
  return <SeoArticle content={CONTENT} />
}
