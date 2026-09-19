import type { Metadata } from 'next'
import { SITE_NAME } from '@/lib/edition'
import { phoneGuideAlternates, phoneGuidesIn } from '@/lib/phone-guides'
import { HereLink, P, SeoArticle, Ul, type ArticleContent } from '@/components/marketplace/seo-article'

/**
 * PHONES UNDER 10 MILLION ĐỒNG — the English half of the pair; the Vietnamese half is
 * /dien-thoai-duoi-10-trieu and is written from scratch, not translated.
 *
 * ⛔ THE PAIR DIVERGES BY READER, NOT BY LANGUAGE. This page is read by someone who already owns a
 * phone from another country and is deciding whether to buy a second one here: so it spends its
 * length on what a foreigner cannot assume — that the mid-range brands sold here are unfamiliar but
 * good, that an imported handset can miss a band or ship a regional software build without Google
 * services, that eSIM and NFC are not guaranteed at this price, and that a passport is enough to buy
 * outright. The Vietnamese article assumes all of that is known and argues the actual local
 * question instead: máy mới tầm trung or a used flagship, and which marketing numbers lie.
 *
 * ⛔ NO PRICES IN THE PROSE. A figure written into a guide is wrong within a quarter and then sits
 * there being quoted. The budget itself is the subject and stays; everything else points at
 * /iphone-18-vietnam, which reads live listings. No shop is ranked or named as "best" either — the
 * marketplace lists several retailers and earns affiliate revenue from some, so a ranking here would
 * be an advertisement wearing an editorial byline.
 */
const SLUG = 'phones-under-10-million-vietnam'

const CONTENT: ArticleContent = {
  eyebrow: 'Buying guide',
  h1: 'The best phones under 10 million đồng in Vietnam',
  intro:
    'This is the most contested budget in the Vietnamese phone market, and it splits cleanly in two: a brand-new mid-range Android with a warranty and a full battery, or a flagship from two to four years ago that somebody else has already used. They are different phones with different failure modes, and which one is better depends far more on how you use a phone than on any spec sheet.',
  canonical: `/${SLUG}`,
  published: '2026-09-19',
  lang: 'en',
  alternate: { lang: 'vi', href: '/dien-thoai-duoi-10-trieu' },
  sections: [
    {
      id: 'what-new-buys',
      title: 'What the budget buys brand new',
      body: (
        <>
          <P>
            New, at this level, means an Android from one of the brands that dominate the Vietnamese
            mid-range &mdash; Xiaomi and its Redmi and POCO lines, Oppo, Vivo, Realme, Honor &mdash; or
            a Samsung from the A series. No current iPhone lives here, and neither does a current
            Galaxy S. If those brands are unfamiliar, that unfamiliarity is a foreigner&rsquo;s problem
            rather than a quality problem: they are the mainstream here, they have service centres in
            every city, and parts for them are cheap and everywhere.
          </P>
          <P>
            What this segment genuinely does well is the part of a phone you touch all day. Battery
            life is excellent, because mid-range chips are efficient and the phones are thick enough to
            carry a large cell. Charging is fast &mdash; often faster than on far more expensive
            phones. Screens are large, bright and high-refresh. The main camera takes very good
            daylight photos. For maps, messaging, banking apps, ride-hailing and scrolling, the gap to
            a flagship is small and shrinking.
          </P>
          <P>What gets cut is consistent enough to predict before you walk into a shop:</P>
          <Ul>
            <li>
              <strong>Every camera except the main one.</strong> The ultrawide is weak, the
              &ldquo;macro&rdquo; sensor exists to lengthen the spec list, and there is no usable
              telephoto at this price. Judge one of these phones on its main camera only.
            </li>
            <li>
              <strong>Low light and video.</strong> This is the clearest gap of all. Night photos are
              soft and slow, and stabilisation and dynamic range in video sit a generation or two
              behind what a used flagship will give you for the same money.
            </li>
            <li>
              <strong>Water resistance.</strong> Ratings at this level generally cover splashes and
              rain rather than immersion &mdash; which in a country with an afternoon monsoon is
              genuinely useful, but is not the same promise a flagship makes.
            </li>
            <li>
              <strong>Software support.</strong> Update policies here are shorter than flagship
              policies, and they differ a lot between brands. Ask how many years of OS and security
              updates are promised, because it decides how long the phone stays safe to bank on.
            </li>
            <li>
              <strong>The unglamorous hardware.</strong> A single speaker, a buzzy vibration motor and
              slower storage &mdash; the last of which shows up as apps opening more slowly than the
              headline RAM figure suggests.
            </li>
          </Ul>
        </>
      ),
    },
    {
      id: 'what-second-hand-buys',
      title: 'What the same money buys second-hand',
      body: (
        <>
          <P>
            The same budget in the used market buys a phone that was a flagship two to four years ago:
            an older iPhone, an older Galaxy S, occasionally a Pixel. Buying used is completely
            mainstream in Vietnam &mdash; every city has shops that grade, test and warrant used
            handsets, alongside the private sellers on marketplaces like this one &mdash; so this is
            not a fringe option, it is the other half of the market.
          </P>
          <P>
            What ages well on an old flagship is most of what makes a phone feel expensive. The screen
            does: a three-year-old flagship OLED still outclasses a new mid-range panel on contrast and
            on sunlight brightness. The chip does; it will still be quicker than anything new at this
            budget, and it will still run demanding apps that the newer phone stumbles over. The main
            camera does, and the processing behind it in dim light is usually a step change rather than
            an improvement. So do stereo speakers, a metal-and-glass body, a real immersion rating and
            a vibration motor that feels like a click instead of a rattle.
          </P>
          <P>
            What does not age well is the battery, always and without exception. Assume a used flagship
            will need a replacement cell sooner rather than later, price that in as part of the
            purchase, and treat a seller claiming perfect battery health on a phone that old as a
            reason to check rather than a reason to relax. The manufacturer warranty has normally
            expired; what you get instead is the shop&rsquo;s own, usually measured in months. And some
            of the phone&rsquo;s supported software life has already been spent.
          </P>
          <P>
            One vocabulary note that saves money here: the grades you will see advertised &mdash;
            &ldquo;99%&rdquo;, &ldquo;likenew&rdquo; &mdash; describe the cosmetics, not the internals.
            A phone can be flawless outside and rebuilt from salvaged parts inside. The four things
            that actually go wrong are a replaced screen, a rebuilt body, a network-locked handset, and
            an account still signed in: an iCloud or Google account left on a device turns it into a
            paperweight, and it is the most common way a used-phone purchase fails in this market.
          </P>
        </>
      ),
    },
    {
      id: 'which-is-better',
      title: 'Which of the two is the better phone to own',
      body: (
        <>
          <P>
            Neither wins outright, and anyone who says otherwise is selling one of them. The honest
            version is that the new mid-ranger wins on certainty and the used flagship wins on
            capability, so the decision is really about which of those two you are short of.
          </P>
          <Ul>
            <li>
              <strong>You want it to be boring.</strong> New. A full-life battery, a manufacturer
              warranty honoured anywhere in the country, and no inspection to get right.
            </li>
            <li>
              <strong>You care about photos, particularly indoors and at night.</strong> Used
              flagship, by a wide margin. This is the single biggest difference between the two.
            </li>
            <li>
              <strong>You will keep it three or four years.</strong> New. You are buying update runway
              and battery life, and both of those are things the used phone has already spent.
            </li>
            <li>
              <strong>You change phones often, or expect to sell before you leave.</strong> An older
              iPhone holds its value here noticeably better than a mid-range Android, which
              depreciates hard the moment its successor lands.
            </li>
            <li>
              <strong>You break things, or the phone lives in a pocket on a motorbike.</strong> New.
              Parts for current mid-rangers are cheap and available in every repair street; a screen
              for a discontinued flagship is not.
            </li>
          </Ul>
          <P>
            There is a third answer that people talk themselves out of too quickly: keep the phone you
            already own, buy a local SIM, and spend nothing. If your current handset takes a Vietnamese
            SIM and holds a charge, the budget is better kept for the point at which it actually fails.
          </P>
        </>
      ),
    },
    {
      id: 'compromises-that-only-matter-here',
      title: 'The compromises that only show up once you are here',
      body: (
        <>
          <P>
            Some of what decides this purchase has nothing to do with the phone being good. These are
            the ones that catch people who bought the handset abroad, or bought a grey-import unit
            cheaply without asking which market it was built for.
          </P>
          <Ul>
            <li>
              <strong>Network bands.</strong> A phone sold in Vietnam is configured for the networks
              here. An imported model can be missing a band, and the symptom is undramatic: it sits on
              4G in a place where a locally bought phone shows 5G, or it drops signal in a building
              where nobody else does.
            </li>
            <li>
              <strong>eSIM and dual SIM.</strong> eSIM is common at the top of this budget and far
              from universal at the bottom. If you want to keep a home number alive alongside a
              Vietnamese one, confirm the phone supports eSIM before you pay &mdash; it is the feature
              most often missing at this price.
            </li>
            <li>
              <strong>NFC.</strong> Also not guaranteed in the budget segment, and worth checking if
              you want contactless payments rather than QR codes.
            </li>
            <li>
              <strong>Regional software builds.</strong> A unit built for the Chinese domestic market
              runs a different software build without Google services preinstalled. It can usually be
              worked around; it is a bad surprise if you were not expecting it, so ask which market
              the handset was made for.
            </li>
            <li>
              <strong>Heat, sun and humidity.</strong> Screen brightness matters more here than in a
              cooler, greyer country, and a cheap phone throttles harder in the heat. If you will use
              it outdoors at midday, test it outdoors before buying.
            </li>
            <li>
              <strong>Where the warranty lives.</strong> An officially distributed handset is warranted
              nationally. A grey import is warranted by the shop that sold it &mdash; a promise only as
              good as that shop, and worth nothing once you move city.
            </li>
          </Ul>
        </>
      ),
    },
    {
      id: 'buying-it-as-a-foreigner',
      title: 'Buying one as a foreigner, and the ten minutes that protect you',
      body: (
        <>
          <P>
            A passport is enough to buy any phone outright, anywhere in Vietnam. No residence card, no
            local ID, no Vietnamese bank account. Instalment plans are the exception: they generally
            require a Vietnamese ID or residence card plus proof of income, because a finance company
            rather than the shop is carrying the risk.
          </P>
          <P>
            Where you buy changes what you are buying more than the price does. A large chain gives you
            the listed price, a return window of a few days and official warranty handling. A
            specialist import shop is usually cheaper and warrants the phone itself. A used-phone
            dealer tests and grades stock and will let you inspect it properly. A private seller is the
            cheapest of all and offers nothing but the phone. What each kind of shop is good at is laid
            out in{' '}
            <HereLink href="/best-place-to-buy-iphone-vietnam">the guide to where to buy</HereLink>.
          </P>
          <P>
            If it is used, the inspection is the whole purchase, and a shop that will not let you do it
            has answered your question. Check the IMEI on the handset, on the box and on the
            manufacturer&rsquo;s own coverage page, and make sure all three match. Read the battery
            health where the phone reports it. Confirm the previous account is fully signed out. Shoot
            with every camera, test the fingerprint or face unlock, plug in a charger, play audio,
            record a voice memo, and look at a plain white and a plain black screen for a replaced
            panel. The full version of that inspection is in{' '}
            <HereLink href="/buying-a-used-iphone-vietnam">the used-phone guide</HereLink>, and it
            applies to Android just as well.
          </P>
          <P>
            For what things actually cost this week rather than what a guide claimed last quarter,{' '}
            <HereLink href="/iphone-18-vietnam">the live price page</HereLink> reads the
            marketplace&rsquo;s own listings. Bank transfer and cash are both normal; get the warranty
            terms in writing with the IMEI on them, and meet in person for anything bought privately.
          </P>
        </>
      ),
    },
  ],
  faqs: [
    {
      q: 'What is the best phone under 10 million đồng in Vietnam?',
      a: 'There is no single answer, because the budget buys two different classes of phone. New, it buys a mid-range Android from Xiaomi, Oppo, Vivo, Realme, Honor or Samsung’s A series, with a full warranty and a fresh battery. Used, it buys a flagship from two to four years ago with a much better screen, chip and camera. Pick on capability versus certainty, not on a spec sheet.',
    },
    {
      q: 'Is a new mid-range phone or a used flagship better value?',
      a: 'The used flagship is the better phone and the new mid-ranger is the safer purchase. The flagship wins clearly on screen, low-light photography and performance; the new phone wins on battery life, warranty, remaining software updates and the fact that nothing about it needs inspecting. Budget for a battery replacement on anything used and the two get closer.',
    },
    {
      q: 'Can a foreigner buy a phone in Vietnam with just a passport?',
      a: 'Yes, for an outright purchase at any retailer or from a private seller. Instalment plans are different: they normally require a Vietnamese ID or a residence card plus proof of income, because a finance company rather than the shop is underwriting it.',
    },
    {
      q: 'Can you buy a new iPhone for under 10 million đồng in Vietnam?',
      a: 'Not a current model. At this budget an iPhone means a second-hand one that is several generations old, or an older model still being sold through clearance channels. Check the live listings rather than a fixed figure, since where the line falls moves every time Apple releases a new generation.',
    },
    {
      q: 'How do I check a used phone’s battery health before buying?',
      a: 'On an iPhone it is reported in Settings under Battery, as a maximum-capacity percentage. Android is less consistent: many phones do not expose a percentage at all, so ask how old the phone is, whether the battery has ever been replaced, and watch the charge level while you spend ten minutes testing everything else. Assume any three-year-old phone will need a new cell.',
    },
    {
      q: 'Do cheap phones in Vietnam support 5G and eSIM?',
      a: '5G is common in this segment now. eSIM is not — it is usual at the top of the budget and often missing at the bottom, so confirm it on the specific model if you want to run a home number and a Vietnamese number at the same time. NFC is also not guaranteed at this price.',
    },
    {
      q: 'Will a phone bought in Vietnam work when I go home?',
      a: 'Phones sold here are not network-locked, so it will work on a foreign SIM. Two caveats: band support is tuned for Vietnamese networks, so coverage abroad can be patchier than a locally bought handset, and the warranty is Vietnamese — a fault after you leave is your problem, not a service centre’s.',
    },
  ],
  related: phoneGuidesIn('en', SLUG).map((g) => ({ href: `/${g.slug}`, label: g.label, blurb: g.blurb })),
}

export const metadata: Metadata = {
  title: `The best phones under 10 million đồng in Vietnam | ${SITE_NAME}`,
  description:
    'What 10 million đồng buys new, what it buys second-hand, which of the two is the better phone to own, and the compromises — bands, eSIM, battery health, warranty — that decide it in Vietnam.',
  alternates: phoneGuideAlternates(SLUG),
}

export default function PhonesUnder10MillionVietnamPage() {
  return <SeoArticle content={CONTENT} />
}
