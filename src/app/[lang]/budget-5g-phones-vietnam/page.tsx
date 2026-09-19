import type { Metadata } from 'next'
import { SITE_NAME } from '@/lib/edition'
import { phoneGuideAlternates, phoneGuidesIn } from '@/lib/phone-guides'
import { HereLink, P, SeoArticle, Ul, type ArticleContent } from '@/components/marketplace/seo-article'

/**
 * CHEAP 5G PHONES IN VIETNAM — the English half of the pair; the Vietnamese half is
 * /dien-thoai-5g-gia-re and is written from scratch, not translated.
 *
 * ⛔ THE TWO HALVES ANSWER DIFFERENT QUESTIONS. This page is read by someone who arrived with a
 * handset bought somewhere else, so it spends its length on what a foreigner cannot assume: which
 * bands Vietnamese 5G actually runs on and why an imported model number decides whether you ever
 * see it, that coverage is a city-core thing rather than a national one, what a passport is and is
 * not enough for, and that eSIM is patchy at the bottom of the range. A Vietnamese reader already
 * knows all of that and is asking whether to move to 5G at all this year — which is the other page.
 *
 * ⚠️ NO PRICES IN THE PROSE. The entry price for 5G moves every quarter and a number here would be
 * wrong within weeks; live retail figures come from the marketplace's own listings instead.
 *
 * ⚠️ NO SHOP IS RANKED OR NAMED AS "BEST". The marketplace lists several of these retailers and
 * earns affiliate revenue from some, so a ranking here would be an advertisement with a byline.
 */
const SLUG = 'budget-5g-phones-vietnam'

const CONTENT: ArticleContent = {
  eyebrow: 'Buying guide',
  h1: 'Cheap 5G phones in Vietnam',
  intro:
    '5G has fallen a long way down the price list in Vietnam, and the entry ticket now costs a fraction of a flagship. What has not fallen is the amount of coverage, which is concentrated in a handful of places. This guide covers where Vietnamese 5G is genuinely usable, which bands your handset needs to reach it, and which specs at the bottom of the range decide whether the phone is still worth carrying in three years.',
  canonical: `/${SLUG}`,
  published: '2026-09-19',
  lang: 'en',
  alternate: { lang: 'vi', href: '/dien-thoai-5g-gia-re' },
  sections: [
    {
      id: 'what-5g-here-actually-is',
      title: 'What 5G in Vietnam actually is right now',
      body: (
        <>
          <P>
            Commercial 5G arrived in Vietnam in late 2024, after the spectrum auctions earlier that
            year, and the rollout since has followed density rather than geography. The city cores of
            Hanoi, Ho Chi Minh City and Da Nang came first, then industrial parks, airports,
            university districts and the busier central wards of the larger provincial cities. A few
            streets outside those, the phone quietly drops back to 4G &mdash; which in Vietnam is
            dense, fast and everywhere, and is the reason nobody here treats 5G as urgent.
          </P>
          <P>
            The second thing to know is that Vietnamese 5G is mid-band. There is no low-band layer of
            the kind that blankets rural areas in some countries, and no meaningful mmWave. Mid-band
            travels less far and penetrates walls less well than the 4G layer underneath it, so it is
            completely normal to hold 5G on the street and sit on 4G inside an alley house, an older
            apartment block or the back of a concrete shophouse in the same district.
          </P>
          <P>
            Where it earns its keep is crowded places and sustained upload: an airport terminal, a
            stadium, a night market on a weekend, a video call from a café that is also serving forty
            other people. If your day is messaging, maps, music and scrolling, you will struggle to
            tell the two apart, and you should buy the better phone rather than the 5G one.
          </P>
          <P>
            Coverage maps from the operators exist but lag reality in both directions, so treat them
            as a claim rather than a check. The reliable test is your own status bar: if you already
            live here, watch what your current phone reports over a normal week in the places you
            actually spend time, and let that decide how much 5G is worth to you.
          </P>
        </>
      ),
    },
    {
      id: 'bands-before-price',
      title: 'Check the bands before you check the price',
      body: (
        <>
          <P>
            Vietnamese 5G sits in the mid-band neighbourhoods around 2.6 GHz and 3.5 GHz, which appear
            on a phone spec sheet as <code>n41</code> and <code>n78</code>. Different operators hold
            different blocks, which has a consequence people find surprising: the same handset can
            show 5G on one Vietnamese network and never show it on another, with no fault anywhere. If
            you plan to switch networks or run two SIMs, you want both bands, not one.
          </P>
          <P>
            This matters almost entirely for imported handsets. Phones are specified per market, and
            at the budget end manufacturers trim the band list to hit a price &mdash; so two phones
            with the same marketing name and different model numbers can carry different radios. A
            cheap 5G phone bought in the US, Japan, Korea or Europe may well be a 4G phone here in
            practice.
          </P>
          <Ul>
            <li>
              Find the exact model number, not the marketing name: it is on the box and in
              <strong> Settings › About phone</strong>. The band list belongs to that number.
            </li>
            <li>
              Read the band list on the manufacturer&rsquo;s own regional spec page rather than a
              shop listing. &ldquo;5G&rdquo; on a box or a price tag is not a band list.
            </li>
            <li>
              A phone sold in Vietnam is specified for Vietnamese networks, which is why buying
              locally makes this whole section irrelevant.
            </li>
            <li>
              On a dual-SIM phone, 5G is usually available on one slot at a time &mdash; check which,
              if you are keeping a home number in the other.
            </li>
            <li>
              Test with the SIM you will actually use, in the district you will actually use it. One
              5G icon in one place proves very little.
            </li>
          </Ul>
        </>
      ),
    },
    {
      id: 'specs-that-matter',
      title: 'The four specs that decide how long a budget 5G phone lasts',
      body: (
        <>
          <P>
            At the bottom of the range the phone is usually fine on day one and the question is what
            it feels like in year three. Four things decide that, and all four are checkable before
            you pay.
          </P>
          <Ul>
            <li>
              <strong>Chipset, and the update promise attached to it.</strong> Ask for the chip name,
              not &ldquo;octa-core&rdquo;, and then ask how many Android versions and how many years
              of security patches the brand commits to for that specific model. Those commitments are
              published, they vary widely at this tier, and they are the single most honest longevity
              number on the sheet. A phone that stops getting patches is the one you replace.
            </li>
            <li>
              <strong>Battery, and how hard 5G works it.</strong> A 5G radio draws more than a 4G one,
              and it draws most at the edge of coverage where it keeps hunting for a signal &mdash;
              which, given the coverage picture above, is where a lot of Vietnam sits. Large batteries
              are standard in this segment; treat the quoted charging wattage as a peak rather than a
              sustained rate.
            </li>
            <li>
              <strong>Screen brightness, ahead of refresh rate.</strong> Daylight here is punishing
              and a dim panel is unreadable at a junction at noon. Budget phones often make you choose
              between a fast LCD and a slower AMOLED; outdoors, the brighter, higher-contrast panel
              usually wins, and indoors you will adapt to either refresh rate within a day.
            </li>
            <li>
              <strong>Storage type, ahead of storage size.</strong> A cheap phone that feels sluggish
              after a year is very often its storage rather than its chip. The generation matters more
              than the number of gigabytes, and the base tier fills quickly once photos and video
              accumulate.
            </li>
          </Ul>
          <P>
            If your budget is tight enough that these trade-offs are painful, it is worth reading the
            mid-range comparison in{' '}
            <HereLink href="/best-value-phones-vietnam">the best-value phones guide</HereLink>, which
            covers the point where paying a little more stops buying you anything.
          </P>
        </>
      ),
    },
    {
      id: 'marketing-to-ignore',
      title: 'What the spec sheet is selling that is not there',
      body: (
        <>
          <P>
            The budget segment is where spec sheets work hardest, because the differences between
            competing models are small and the marketing has to manufacture some. These are the claims
            worth discounting.
          </P>
          <Ul>
            <li>
              <strong>Virtual or extended RAM.</strong> A figure like &ldquo;12GB (8+4)&rdquo; means
              eight. The rest is storage borrowed as swap: it helps a little with keeping apps alive
              in the background, does nothing for speed, and writes constantly to the storage that is
              already the weakest part of the phone.
            </li>
            <li>
              <strong>Very high megapixel counts.</strong> A large sensor number at this price bins
              down to a much smaller image anyway, and the result is limited by the lens and the
              processing rather than the pixel count. The 2MP macro and depth cameras beside it exist
              to make the list longer.
            </li>
            <li>
              <strong>&ldquo;AI&rdquo; branding.</strong> At this tier it is usually cloud features
              that any phone with the same app can run, not something the hardware does.
            </li>
            <li>
              <strong>Water resistance that is not an IP rating.</strong> &ldquo;Splash resistant&rdquo;
              is a sentence, not a standard. In a Vietnamese rainy season the difference between that
              and a rated phone is a real one.
            </li>
            <li>
              <strong>&ldquo;Up to&rdquo; refresh rates.</strong> A panel that reaches its top refresh
              rate in a handful of apps is quoted at that rate on the box regardless.
            </li>
          </Ul>
        </>
      ),
    },
    {
      id: 'buying-one-here',
      title: 'Buying one here as a foreigner',
      body: (
        <>
          <P>
            A passport is enough to buy any phone outright, anywhere in Vietnam &mdash; no residence
            card, no local ID, no Vietnamese bank account. Instalment plans are the exception: they
            generally need a Vietnamese ID or a residence card plus proof of income, because a finance
            company rather than the shop is taking the risk. How those plans are structured is covered
            in{' '}
            <HereLink href="/phone-instalments-vietnam">the instalments guide</HereLink>.
          </P>
          <P>
            A Vietnamese SIM must be registered to a real identity document, and for a foreigner that
            means presenting a passport in person at an operator shop or an authorised counter. A
            pre-activated SIM bought from a street kiosk skips that step, which is exactly the problem
            &mdash; the number stays registered to someone else, and recovering it later is not your
            call to make.
          </P>
          <P>
            eSIM support is the one thing to check before anything else if you want to keep a home
            number alive alongside a Vietnamese one, because it is frequently the feature cut from a
            cheaper variant. Which networks issue eSIM and what registering one involves is in{' '}
            <HereLink href="/esim-vietnam-guide">the eSIM guide</HereLink>.
          </P>
          <P>
            Finally, warranty. A locally bought phone from a mainstream brand has a real service
            network in the cities, and at this price a repair is a large share of what the phone cost
            &mdash; which makes warranty coverage worth more here, proportionally, than it is on an
            expensive handset. An imported budget phone usually has no local manufacturer warranty at
            all; what that leaves you with is set out in{' '}
            <HereLink href="/phone-warranty-repair-vietnam">the warranty and repair guide</HereLink>.
            For a sense of what Vietnamese retailers are asking today at the other end of the market,{' '}
            <HereLink href="/iphone-18-vietnam">the live iPhone 18 price page</HereLink> reads the
            marketplace&rsquo;s own listings rather than a press release.
          </P>
        </>
      ),
    },
  ],
  faqs: [
    {
      q: 'Is 5G available in Vietnam?',
      a: 'Yes, commercially since late 2024, but unevenly. Coverage is concentrated in the cores of Hanoi, Ho Chi Minh City and Da Nang, in industrial parks, airports and busy central districts. Outside those, and often indoors within them, phones fall back to 4G, which is dense and fast nationwide.',
    },
    {
      q: 'Which 5G bands does Vietnam use?',
      a: 'Vietnamese 5G is mid-band, around 2.6 GHz and 3.5 GHz — n41 and n78 on a spec sheet. Operators hold different blocks, so a handset that supports only one of the two may see 5G on one network and never on another. There is no significant low-band or mmWave layer.',
    },
    {
      q: 'Will my 5G phone from the US or Europe work on 5G in Vietnam?',
      a: 'Sometimes. Phones are specified per market and budget models often carry a trimmed band list, so check n41 and n78 against your exact model number — the one on the box and in Settings › About phone — on the manufacturer’s spec page. Calls and 4G will work regardless; 5G is what the bands decide.',
    },
    {
      q: 'Is a cheap 5G phone worth it in Vietnam, or should I just buy 4G?',
      a: 'Buy the better phone and take 5G if it comes attached. Given where coverage actually is, 5G changes crowded places and heavy uploads and very little else day to day. Screen brightness, battery, storage type and the update commitment will affect you far more over three years.',
    },
    {
      q: 'How much does the cheapest 5G phone cost in Vietnam?',
      a: 'The entry point has dropped to a small fraction of a flagship and keeps moving, usually downward, every quarter — which is exactly why a figure written into a guide is wrong within weeks. Check current listings for the model you are considering rather than a published number.',
    },
    {
      q: 'Do budget 5G phones support eSIM?',
      a: 'Often not. eSIM is one of the first features cut from a cheaper variant, and support at the bottom of the range is inconsistent even within a single brand. If you need a Vietnamese number alongside a home one, confirm eSIM on the exact model before considering anything else.',
    },
    {
      q: 'Can a foreigner buy a phone and a SIM in Vietnam with a passport?',
      a: 'Yes to both. Any shop will sell you a phone outright on a passport, and an operator shop will register a SIM to your passport in person. Instalment plans are the exception and generally require a Vietnamese ID or residence card plus proof of income.',
    },
  ],
  related: phoneGuidesIn('en', SLUG).map((g) => ({ href: `/${g.slug}`, label: g.label, blurb: g.blurb })),
}

export const metadata: Metadata = {
  title: `Cheap 5G phones in Vietnam — coverage, bands and the specs that matter | ${SITE_NAME}`,
  description:
    'Where Vietnamese 5G coverage actually reaches, which bands a handset needs to use it, the four budget specs that decide how long a phone lasts, and the spec-sheet claims worth ignoring.',
  alternates: phoneGuideAlternates(SLUG),
}

export default function Budget5GPhonesVietnamPage() {
  return <SeoArticle content={CONTENT} />
}
