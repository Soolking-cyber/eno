import type { Metadata } from 'next'
import { SITE_NAME } from '@/lib/edition'
import { phoneGuideAlternates, phoneGuidesIn } from '@/lib/phone-guides'
import { HereLink, P, SeoArticle, Ul, type ArticleContent } from '@/components/marketplace/seo-article'

/**
 * PHONE ACCESSORIES WORTH BUYING IN VIETNAM — the English half of the pair; the Vietnamese half is
 * /phu-kien-dien-thoai-nen-mua and is written from scratch, not translated.
 *
 * ⛔ THE PAIR DIVERGES BY READER, NOT BY LANGUAGE. This page is read by someone who arrived
 * recently: it spends its length on what the climate does to the cheap things bolted to a phone,
 * whether a charger from home plugs in here at all, what a scooter mount costs a camera, and which
 * accessories are sold on every corner and worth nothing. The Vietnamese page assumes all of that
 * is obvious and answers a shopper's questions instead — full keo or keo viền, what to check before
 * leaving the counter after a fitting, which brand's fast charge dies with someone else's brick,
 * and what a 10.000 mAh power bank actually delivers.
 *
 * ⚠️ NO PRICES IN THE PROSE. Accessory pricing moves weekly and a figure written into an article is
 * wrong within a season; the live handset page carries current numbers instead.
 *
 * ⛔ NO SHOP IS RANKED OR NAMED AS "BEST". The marketplace lists several of these retailers and
 * earns affiliate revenue from some, so a ranking here would be an advertisement with an editorial
 * byline. Describing what each KIND of counter is good at survives that, and survives a shop
 * changing hands next month.
 */
const SLUG = 'phone-accessories-vietnam'

const CONTENT: ArticleContent = {
  eyebrow: 'Buying guide',
  h1: 'Phone accessories worth buying in Vietnam',
  intro:
    'A phone survives Vietnam easily. The accessories bolted to it do not: clear cases yellow, leather grows mould, adhesive peels, and a cheap charger is the one component with a real failure mode. This guide covers what the heat and humidity here actually demand from a case, a screen protector, a charger and a cable — and which accessories sold on every corner do nothing at all.',
  canonical: `/${SLUG}`,
  published: '2026-09-19',
  lang: 'en',
  alternate: { lang: 'vi', href: '/phu-kien-dien-thoai-nen-mua' },
  sections: [
    {
      id: 'what-the-climate-does',
      title: 'What the climate actually does to your accessories',
      body: (
        <>
          <P>
            Vietnam is harder on plastic and glue than most newcomers expect. Across most of the
            country the heat is constant rather than seasonal, humidity rarely drops far, the north
            gets a damp spell in late winter and early spring where surfaces visibly sweat, and the
            southern wet season brings an hour of heavy rain most afternoons from roughly May to
            November. None of that breaks a modern phone. It quietly destroys the cheap things
            attached to it.
          </P>
          <P>
            Three failures account for most of it. <strong>Clear flexible cases go yellow</strong>{' '}
            &mdash; UV and skin oils both do it, and here it happens over months rather than years.{' '}
            <strong>Leather and PU-leather cases grow mould</strong> along the seams if they are put
            away damp, which during the northern damp spell means most days.{' '}
            <strong>Adhesive lets go</strong>: back skins, wrap films and stick-on card wallets lift
            at the corners once the glue has cycled through enough hot afternoons in a bag.
          </P>
          <P>
            Heat matters for the battery underneath too. Sustained high temperature is what lithium
            cells age fastest under, and the hottest place your phone will ever be is clamped to
            handlebars in direct sun. A thick case makes that worse by trapping heat during fast
            charging, so take a heavy case off when you charge at full speed or game for an hour. If
            the battery is already tired,{' '}
            <HereLink href="/iphone-battery-replacement-vietnam">replacing it</HereLink> does more
            than any accessory will.
          </P>
        </>
      ),
    },
    {
      id: 'cases-and-glass',
      title: 'Cases and screen protection: what matters, what is marketing',
      body: (
        <>
          <P>
            Material decides how long a case looks acceptable. Soft clear TPU is the cheapest and
            the first to yellow. A hybrid &mdash; flexible frame, hard polycarbonate back &mdash;
            stays clear noticeably longer. Solid silicone grips well, which is useful when your
            hands are wet or sweaty, but collects dust and lint. Leather looks best and needs the
            most care in this humidity. A hybrid in a colour rather than clear ages least visibly.
          </P>
          <P>
            The drop that actually happens here is a phone sliding off a motorbike seat or out of a
            pocket onto tile, landing on a corner. Corner padding and a lip standing proud of both
            the screen and the camera ring are worth more than any label on the box: treat
            &ldquo;military grade&rdquo; and &ldquo;MIL-STD-810&rdquo; as marketing, because that
            standard is self-declared by the manufacturer and no independent body certifies phone
            cases against it. If you use a magnetic mount, buy a case with magnets built in &mdash;
            a stick-on magnet ring must have an open centre or it sits over the wireless-charging
            coil.
          </P>
          <P>
            On tempered glass, the number everybody quotes is the least useful one.
            &ldquo;9H&rdquo; is a pencil-hardness rating, not a position on the Mohs scale: tempered
            glass sits around 6 to 7 on Mohs, and ordinary sand contains quartz at 7. That is why a
            phone that has been to the beach picks up fine scratches whatever the box claims. What
            genuinely differs between protectors:
          </P>
          <Ul>
            <li>
              <strong>Full adhesive versus edge adhesive.</strong> Edge-glued protectors leave an air
              gap that shows as rainbow patches and pops loose after a knock. Ask for full adhesive
              by name; curved screens need UV-cured glue.
            </li>
            <li>
              <strong>Matte</strong> hides fingerprints and cuts reflections in sun, at the cost of
              slightly softer text. <strong>Privacy glass</strong> reduces perceived brightness,
              which makes the screen harder to read outdoors here than anywhere you came from.
            </li>
            <li>
              <strong>Under-display fingerprint compatibility.</strong> A thick or poorly matched
              protector makes an in-screen reader miss. Check the packaging says it is supported, and
              test it before you leave the counter.
            </li>
            <li>
              <strong>The oleophobic coating.</strong> On cheap glass it wears off within months, and
              the tell is a surface that feels draggy rather than slippery. The protector is a
              consumable.
            </li>
          </Ul>
          <P>
            Almost every accessory counter will fit the glass for you, usually free with the
            purchase. Take that offer &mdash; a dust speck under the film is the commonest reason a
            protector gets replaced twice &mdash; and check the edges and the keyboard&rsquo;s bottom
            row before you walk away.
          </P>
        </>
      ),
    },
    {
      id: 'chargers-and-cables',
      title: 'Chargers and cables: plugs, standards and the fake risk',
      body: (
        <>
          <P>
            The mains here runs at 220 volts and 50 hertz, and wall sockets take two flat pins or
            two round pins, so most chargers brought from the United States or continental Europe
            plug straight in; UK three-pin plugs need an adapter. Check the brick for{' '}
            <code>Input 100&ndash;240V</code> &mdash; every modern phone charger has it, and a plug
            adapter changes the pin shape and nothing else.
          </P>
          <P>
            For fast charging, the standard on the box matters more than the wattage. USB Power
            Delivery over USB-C is the common language that iPhones and most Android phones speak.
            PPS is the extension several Android makers need for their highest speeds, and a few
            brands sold heavily here run their own protocol entirely &mdash; those hit full speed
            only with their own brick and their own cable, and fall back to ordinary PD with anything
            else. A phone draws what it negotiates, so a larger charger will not overdrive it, while
            a charger that names no standard at all almost certainly implements none.
          </P>
          <Ul>
            <li>
              Above 60 watts a USB-C cable needs an e-marker chip in the connector. A cheap cable
              without one caps your speed whatever the brick can supply.
            </li>
            <li>
              Most inexpensive cables carry USB 2.0 data at 480 Mbps even when they charge perfectly,
              which only shows up when you move video off the phone or plug into a display.
            </li>
            <li>
              Wireless charging is slower and runs hotter than a cable, and in this climate heat is
              the worse of the two for the battery. Treat the pad as a convenience.
            </li>
            <li>
              GaN chargers are smaller and cooler for the same output, and a multi-port one replaces
              two or three bricks.
            </li>
          </Ul>
          <P>
            The real risk with a counterfeit charger is not slow charging, it is the isolation
            between mains voltage and the cable in your hand. Buy the brick where you can go back
            &mdash; an accessory counter inside a chain store, or a specialist shop with a physical
            address &mdash; keep the receipt, and be suspicious of one that feels unusually light for
            its claimed output. What each kind of shop stands behind is in the{' '}
            <HereLink href="/phone-warranty-repair-vietnam">warranty and repair guide</HereLink>.
          </P>
        </>
      ),
    },
    {
      id: 'riding-and-rain',
      title: 'Riding with your phone, and getting it wet',
      body: (
        <>
          <P>
            Mounting a phone on a motorbike is normal here and mostly fine, with one exception worth
            knowing before you clamp it on. Apple has published guidance that high-amplitude
            vibration &mdash; the kind a high-power motorcycle engine sends through the chassis
            &mdash; can degrade the optical image stabilisation and autofocus in iPhone cameras, and
            advises against attaching an iPhone to such a bike. Small scooters vibrate less, but not
            nothing. A mount with rubber damping between clamp and handlebars is the cheap insurance,
            and it is not the mount most stalls hand you first.
          </P>
          <P>
            The other cost of riding with the phone out is heat. Direct sun, full brightness and
            charging from the bike at once is the worst combination available: the phone dims, stops
            charging, then shows a temperature warning and goes unusable until it cools. One incident
            breaks nothing; repeating it daily for a year is real battery wear. Charge before you
            ride rather than while you ride, and park the phone in shade when you stop.
          </P>
          <P>
            For rain, be clear about what a water-resistance rating means. IP68 is tested by
            immersion in still, clean fresh water on a factory-new device: it says nothing about
            pressurised spray or road grit, and it degrades as seals age and after a drop. That makes
            a cheap waterproof pouch genuinely useful in wet season, accepting that touchscreens work
            poorly through a wet film. If the port gets wet the phone will refuse to charge and say
            so; leave it port-down in moving air for a few hours. Rice does nothing.
          </P>
        </>
      ),
    },
    {
      id: 'pure-markup',
      title: 'The accessories that are pure markup',
      body: (
        <>
          <P>
            Camera lens protectors are sold as obviously sensible and often are not. A glass surface
            in front of a lens adds reflections, which show up as flare and ghosting around bright
            points at night &mdash; in a city this well lit, a large share of the photos you take. If
            the rear glass sits flush, or the case lip already stands proud of it, skip them.
          </P>
          <Ul>
            <li>
              <strong>Liquid or &ldquo;nano&rdquo; screen coatings</strong> sold as 9H liquid glass.
              It is a thin coating: no impact protection, and nothing you can inspect once applied.
            </li>
            <li>
              <strong>Passive &ldquo;cooling&rdquo; cases.</strong> A back panel with fins moves no
              meaningful heat. Clip-on fan coolers do work for sustained gaming, need their own
              power, and are useless for anything else.
            </li>
            <li>
              <strong>Anti-radiation stickers and battery-saver chips.</strong> These do nothing;
              there is no mechanism behind the claim.
            </li>
            <li>
              <strong>Cables branded &ldquo;super fast charge&rdquo;</strong> with no standard and no
              wattage printed anywhere. If it does not say PD, PPS or a number of watts, assume it is
              an ordinary cable with a pattern on the braid.
            </li>
            <li>
              <strong>Free accessory bundles</strong> thrown in with a handset. The case, glass and
              cable are priced into the phone; ask what it costs without them and compare.
            </li>
          </Ul>
          <P>
            Where the money is worth spending is short and dull: a properly fitted full-adhesive
            protector, a charger that names its standard, one good cable, a case with real corner
            protection and a raised lip, and a damped mount if you ride. Keeping the box and the
            original accessories matters later too, because a complete phone sells for meaningfully
            more &mdash; the{' '}
            <HereLink href="/selling-your-phone-vietnam">guide to selling a phone here</HereLink>{' '}
            covers what moves that number. For what handsets are going for today,{' '}
            <HereLink href="/iphone-18-vietnam">the live price page</HereLink> reads the
            marketplace&rsquo;s own listings rather than a press release.
          </P>
        </>
      ),
    },
  ],
  faqs: [
    {
      q: 'Do I need a plug adapter for my phone charger in Vietnam?',
      a: 'Usually not. Sockets take two flat pins or two round pins, so US and continental European chargers fit directly; UK three-pin plugs need an adapter. The mains is 220V/50Hz, so check the brick says Input 100–240V — every modern phone charger does, and an adapter changes only the pin shape, never the voltage.',
    },
    {
      q: 'Is it safe to buy a phone charger in Vietnam?',
      a: 'Yes, if you buy where you can return it. The risk with a counterfeit brick is the isolation between mains voltage and the cable, not charging speed. An accessory counter inside a chain store or a specialist shop with a physical address will exchange a faulty one; keep the receipt, and be wary of a charger that feels unusually light for the wattage printed on it.',
    },
    {
      q: 'Are tempered glass screen protectors worth it here?',
      a: 'Yes, and fitting matters more than the brand. Ask for full adhesive rather than edge adhesive, have the counter apply it — most do it free with the purchase — and check the edges and the bottom row of the keyboard before you leave. Ignore the 9H figure: that is a pencil-hardness rating, and tempered glass still scratches against sand.',
    },
    {
      q: 'Will a motorbike phone mount damage my camera?',
      a: 'It can. Apple has published guidance that high-amplitude vibration from high-power motorcycle engines can degrade optical image stabilisation and autofocus, and advises against attaching an iPhone to such a bike. Small scooters produce less vibration but not none, so use a mount with rubber damping between the clamp and the handlebars.',
    },
    {
      q: 'Do camera lens protectors affect photo quality?',
      a: 'Often, yes. An extra glass surface in front of the lens adds reflections, which appear as flare and ghosting around bright lights at night — exactly the conditions you photograph most in a Vietnamese city. They make sense mainly if the rear glass is exposed and the case lip does not stand proud of it.',
    },
    {
      q: 'Why does my phone get so hot in Vietnam, and does a case make it worse?',
      a: 'Direct sun plus a bright screen plus charging is the combination that overheats a phone, and a handlebar mount arranges all three at once. A thick case does make it worse by trapping heat during fast charging. The phone protects itself by dimming and pausing charging; nothing is damaged in one incident, but repeated sustained heat is what ages a lithium battery fastest.',
    },
    {
      q: 'Do I need a special cable for fast charging?',
      a: 'Above 60 watts, yes — the USB-C cable needs an e-marker chip, and a cheap one without it caps your speed regardless of the charger. Below that, most USB-C cables charge fine, but most also carry only USB 2.0 data at 480 Mbps, which matters when you move video off the phone or connect it to a display.',
    },
  ],
  related: phoneGuidesIn('en', SLUG).map((g) => ({ href: `/${g.slug}`, label: g.label, blurb: g.blurb })),
}

export const metadata: Metadata = {
  title: `Phone accessories worth buying in Vietnam | ${SITE_NAME}`,
  description:
    'What Vietnam’s heat and humidity do to cases, glass and cables, which fast-charging standard your phone actually needs, whether your charger plugs in here, and the accessories that are pure markup.',
  alternates: phoneGuideAlternates(SLUG),
}

export default function PhoneAccessoriesVietnamPage() {
  return <SeoArticle content={CONTENT} />
}
