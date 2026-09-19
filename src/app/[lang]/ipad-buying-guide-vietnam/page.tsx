import type { Metadata } from 'next'
import { SITE_NAME } from '@/lib/edition'
import { phoneGuideAlternates, phoneGuidesIn } from '@/lib/phone-guides'
import { HereLink, P, SeoArticle, Ul, type ArticleContent } from '@/components/marketplace/seo-article'

/**
 * WHICH iPAD TO BUY IN VIETNAM — the English half of the pair; the Vietnamese half is
 * /mua-ipad-loai-nao-tot and is written from scratch rather than translated.
 *
 * ⛔ THE TWO HALVES ANSWER DIFFERENT QUESTIONS ON PURPOSE. This page is read by someone living in or
 * visiting Vietnam who is deciding between buying here and bringing one in: it spends its length on
 * the local/import split, on whether a cellular model earns its premium when data is cheap and Wi-Fi
 * is everywhere, and on what a passport is and is not enough for. The Vietnamese page assumes all of
 * that is already known and goes where a local buyer actually goes — which line suits a student, what
 * a refurbished unit is really being sold as, and whether a third-party stylus is good enough.
 *
 * ⚠️ NO PRICES IN THE PROSE. Apple's Vietnamese pricing moves with promotions and with the đồng, so a
 * figure typed here is wrong within a quarter and stays wrong for years. Where a number matters, the
 * page points at the live price page, which reads the marketplace's own listings.
 *
 * ⛔ NO SHOP IS RANKED OR NAMED AS "BEST". The marketplace lists several of these retailers and earns
 * affiliate revenue from some, so a ranking here would be an advertisement with an editorial byline.
 */
const SLUG = 'ipad-buying-guide-vietnam'

const CONTENT: ArticleContent = {
  eyebrow: 'Buying guide',
  h1: 'Which iPad to buy in Vietnam',
  intro:
    'Four iPad lines, names that describe price tiers rather than jobs, and a set of accessories that can cost more than the tablet they attach to. This guide works through which line genuinely suits which kind of use, whether a cellular model earns its premium in a country where mobile data is cheap and Wi-Fi is everywhere, which storage tier you will regret, and what the keyboard and the Pencil add to the bill.',
  canonical: `/${SLUG}`,
  published: '2026-09-19',
  lang: 'en',
  alternate: { lang: 'vi', href: '/mua-ipad-loai-nao-tot' },
  sections: [
    {
      id: 'what-each-model-is-for',
      title: 'What each line is actually for',
      body: (
        <>
          <P>
            <strong>The base iPad</strong> is the cheapest way to get a big Apple screen, and for
            watching, reading, browsing, video calls and schoolwork it is not meaningfully worse than
            anything above it. Its compromises are specific rather than general: on recent generations
            the cover glass sits slightly above the panel instead of being bonded to it, which you
            notice when a Pencil tip taps it and essentially never otherwise, and it does not support
            the top-tier Pencil. Buying for a child, a parent, a kitchen or a sofa? Stop here and spend
            the difference on storage.
          </P>
          <P>
            <strong>The iPad Air</strong> is the default answer for most adults buying one device for
            themselves: an M-series chip, a bonded and colour-accurate display, the current Pencil with
            pressure and tilt, and Apple&rsquo;s own keyboard with a trackpad. It comes in two sizes,
            and the size matters more than the chip &mdash; the smaller one is a tablet you hold, the
            larger one is a laptop replacement you put on a desk. Almost nobody outgrows an Air on
            performance. People outgrow it on screen size or storage.
          </P>
          <P>
            <strong>The iPad mini</strong> gets dismissed and then quietly becomes somebody&rsquo;s
            favourite. It is a reading device, a note-taking device and a one-handed map; it fits a
            jacket pocket or a bag that will not take an 11-inch tablet, and in Vietnamese heat it is
            the one you actually carry. It takes the current Pencil. It is a poor choice for typing,
            for split-screen work, and for anyone who wanted a small laptop.
          </P>
          <P>
            <strong>The iPad Pro</strong> buys a better display, a faster chip, better speakers and a
            thinner body. On recent generations the two largest storage tiers have also carried more
            memory than the smaller ones, which is worth checking on the exact model in front of you if
            you edit video. The honest summary: the Pro is right for colour work, multi-track video and
            people whose tablet is their main computer, and for everyone else it is an Air with a nicer
            screen &mdash; a real difference, just not a productive one.
          </P>
          <Ul>
            <li>Media, browsing, homework, a shared family device &mdash; base iPad, more storage.</li>
            <li>Notes, reading, drawing, light work, one device for everything &mdash; Air.</li>
            <li>Reading and carrying it all day, or a second screen &mdash; mini.</li>
            <li>Video editing, colour-critical work, tablet as primary computer &mdash; Pro.</li>
            <li>Replacing a laptop &mdash; the larger size in whichever line, plus a keyboard.</li>
          </Ul>
        </>
      ),
    },
    {
      id: 'cellular-or-wifi',
      title: 'Cellular or Wi-Fi, in a country with cheap data',
      body: (
        <>
          <P>
            Vietnam is close to the worst possible market for a cellular iPad, and that is a compliment
            to the infrastructure. Data is cheap, city coverage is dense, and every café, office,
            co-working desk and apartment you will sit in has Wi-Fi. Tethering from a phone takes about
            four seconds and, on most local plans, costs nothing extra. The cellular model costs more
            at purchase, forever, on a device you keep for five years.
          </P>
          <P>
            Three cases still earn it. Volume of use: open the tablet ten times a day in ten different
            places and tethering stops being a four-second task and becomes the reason the iPad stays
            home. A device someone else uses &mdash; a child or a parent with no data plan of their
            own. And the technical one, which is why most people who genuinely need cellular need it:{' '}
            <strong>only cellular iPads have a GPS receiver</strong>. A Wi-Fi iPad positions itself
            from nearby networks, which is fine in District 1 and useless on a road in Hà Giang. If the
            iPad is going to be a navigation or field-survey device, that alone settles it.
          </P>
          <P>
            If you do go cellular, recent models support eSIM and every Vietnamese network issues them,
            so you can add a local data line without a shop visit and without giving up a physical SIM
            slot in your phone. The{' '}
            <HereLink href="/esim-vietnam-guide">eSIM guide</HereLink> covers which networks support
            what and how activation actually goes.
          </P>
          <P>
            One practical note: tethering drains the phone, and the phone is the thing you cannot
            afford to run flat. If your answer to cellular is &ldquo;I&rsquo;ll just hotspot&rdquo;,
            budget for a power bank rather than for the cellular premium.
          </P>
        </>
      ),
    },
    {
      id: 'storage-tiers',
      title: 'Storage is the one decision you cannot undo',
      body: (
        <>
          <P>
            There is no card slot and no upgrade path. An external USB-C drive works for files, photos
            and footage, but apps, the system and anything you want available offline live on the
            internal storage and nowhere else. This is the single most common regret, and the one that
            forces a second purchase rather than an adjustment.
          </P>
          <P>
            The entry tier is genuinely enough for streaming, browsing, email, documents, notes and
            occasional drawing. It stops being enough faster than people expect once any of the
            following is true:
          </P>
          <Ul>
            <li>You download video to watch offline on long flights or overnight buses.</li>
            <li>You draw seriously &mdash; layered canvases at print resolution are hundreds of megabytes each, and the app keeps them all.</li>
            <li>You edit video, even casually: footage, project and export need room three times over.</li>
            <li>You install large games, which are routinely several gigabytes each.</li>
            <li>You keep an offline music library, or offline maps for the whole country.</li>
          </Ul>
          <P>
            Two arguments for going one tier up beyond raw need. The system takes a slice out of the
            advertised figure, so the entry tier is smaller in practice than it looks on the box. And
            storage holds its value on resale here: a higher tier comes back to you as a visibly better
            listing in three years, which is not true of a keyboard or a case. Hesitating between one
            more storage tier and one line up in the range? Take the storage.
          </P>
        </>
      ),
    },
    {
      id: 'keyboard-and-pencil',
      title: 'The keyboard and the Pencil are the real budget',
      body: (
        <>
          <P>
            Apple&rsquo;s own keyboard with a trackpad is a large fraction of the price of the tablet it
            attaches to, and the current Pencil is not a rounding error either. Work out the total
            before you decide which line to buy: a base iPad with both accessories and a mid storage
            tier can land near an Air on its own, and the Air is the better machine.
          </P>
          <P>
            On keyboards there are three honest options. Apple&rsquo;s trackpad keyboard is the best of
            them and also the heaviest and most expensive &mdash; it turns the tablet into a small
            laptop, including the weight. Third-party keyboard cases are sold everywhere here, from
            international brands down to a long tail of local ones, typically at a fraction of the
            price; the good ones are fine, the cheap ones have mushy keys and hinges that give up, and
            many have no trackpad. The third option is the one most people end up happiest with: a
            separate Bluetooth keyboard and a folding stand, which weighs less, costs least, and can be
            left at home on the days you only want a tablet.
          </P>
          <P>
            Whatever you buy, check the <em>generation</em>, not just the screen size. Keyboard cases
            are cut for a specific model year &mdash; camera bumps and port positions move &mdash; and
            &ldquo;fits 11-inch iPad&rdquo; on a listing is not a specification.
          </P>
          <P>
            On the Pencil, three generations are in circulation at once and they are not
            interchangeable. The current top model adds pressure, tilt, hover and a squeeze gesture and
            is what you want if you draw &mdash; and the base iPad does not support it. The USB-C
            Pencil is cheaper, charges through its own USB-C port with a cable (it attaches
            magnetically for storage only, which is the part people get wrong), and has
            <strong> no pressure sensitivity</strong>, which is irrelevant for handwriting and disqualifying for drawing.
            Older Pencils pair only with older hardware. Third-party styluses with palm rejection are
            perfectly good for notes; none reproduce pressure properly, so they are a false economy for
            art.
          </P>
          <P>
            Buy the tablet, live with it for two weeks, then buy the accessories you have discovered you
            actually want. The{' '}
            <HereLink href="/phone-accessories-vietnam">accessories guide</HereLink> covers what is
            worth buying locally.
          </P>
        </>
      ),
    },
    {
      id: 'buying-here-or-bringing-one',
      title: 'Buying here, or bringing one with you',
      body: (
        <>
          <P>
            Vietnamese retail includes 10% VAT, so local prices generally sit above US, Japanese and
            Singaporean pricing once converted &mdash; the same picture as phones. And the same split
            applies: shops sell both chính hãng VN/A stock distributed by Apple Vietnam and xách tay
            units imported privately, sometimes on the same shelf. Ask{' '}
            <em>&ldquo;máy này là VN/A hay xách tay?&rdquo;</em>, then verify it yourself in{' '}
            <strong>Settings › General › About</strong>: the model number ends in <code>VN/A</code> for
            a Vietnam unit, <code>LL/A</code> for a US one, <code>ZA/A</code> Singapore, <code>J/A</code>
            {' '}Japan. A shop cannot change that string.
          </P>
          <P>
            What it buys you is who fixes it. A VN/A unit is covered by Apple Vietnam and any
            authorised service centre will take it; an imported unit is warranted by the shop that sold
            it, usually for months rather than a year. Whether extended Apple cover can be added, and
            on which units, varies by retailer &mdash; ask before paying, because it generally cannot
            be bought later. The{' '}
            <HereLink href="/chinh-hang-vs-xach-tay-vietnam">chính hãng versus xách tay guide</HereLink>
            {' '}goes through the trade-off in full.
          </P>
          <P>
            A passport is enough to buy any iPad outright, anywhere in the country. Instalment plans are
            the exception and generally need a Vietnamese ID or residence card plus proof of income. If
            you are leaving within 60 days, an ordinary red VAT invoice is NOT by itself enough
            &mdash; you need the combined invoice-and-refund-declaration issued at the till by a shop
            registered for the scheme, which is covered in{' '}
            <HereLink href="/vat-refund-phone-vietnam">the VAT refund guide</HereLink>. Ask for it
            when you pay, and claim at the
            departure terminal &mdash; the{' '}
            <HereLink href="/vat-refund-phone-vietnam">VAT refund guide</HereLink> has the thresholds.
          </P>
          <P>
            Second-hand, an iPad is a better used purchase than a phone: the batteries are large and
            lightly cycled, and the chips stay current for years. Check battery health, confirm the unit
            is fully signed out of iCloud before money moves, and match the serial on Apple&rsquo;s
            coverage page. One iPad-specific check phones do not need: sight down the edge of the
            glass against a light and look for a raised lip or a gap at the bezel, the tell for a
            swollen battery. ⛔ Look, do not press &mdash; a swollen cell is a damaged cell, and
            pressing one is how it vents. If you see a lift, walk away rather than testing it. For a current read
            on Apple pricing here, the{' '}
            <HereLink href="/iphone-18-vietnam">live price page</HereLink> reads the
            marketplace&rsquo;s own listings rather than a press release.
          </P>
        </>
      ),
    },
  ],
  faqs: [
    {
      q: 'Should I buy an iPad in Vietnam or bring one from home?',
      a: 'Vietnamese retail includes 10% VAT and usually sits above US, Japanese and Singaporean pricing once converted, so bringing one in is normally cheaper. The trade is warranty: only a VN/A unit distributed by Apple Vietnam is covered by Apple here. If you are staying more than a year, the local warranty is usually worth the gap; if you are here for a few months, it usually is not.',
    },
    {
      q: 'Do I need a cellular iPad in Vietnam or is Wi-Fi enough?',
      a: 'Wi-Fi is enough for most people. Coverage is dense, data is cheap, and tethering from a phone takes seconds. Buy cellular if you open the tablet constantly in different places, if it is used by someone with no data plan of their own, or if you need real GPS — only cellular iPads have a GPS receiver, so the Wi-Fi model cannot navigate away from known networks.',
    },
    {
      q: 'Is 128GB enough for an iPad?',
      a: 'It is enough for streaming, browsing, documents, notes and light drawing. It is not enough if you download video to watch offline, draw on layered canvases at print resolution, edit video, or install several large games. The system takes a slice of the advertised figure too, so the usable space is less than the number on the box.',
    },
    {
      q: 'Which iPad is best for taking notes and drawing?',
      a: 'For handwriting, any current iPad with a Pencil works and the mini is the most carryable. For drawing, you want pressure sensitivity and a bonded display, which means the Air or the Pro with the current top-tier Pencil — the base iPad does not support that Pencil, and the cheaper USB-C Pencil has no pressure sensitivity at all.',
    },
    {
      q: 'Can a foreigner buy an iPad in Vietnam with just a passport?',
      a: 'Yes, for an outright purchase at any retailer — no residence card, no local ID, no Vietnamese bank account. Instalment plans are different and normally require a Vietnamese ID or residence card plus proof of income, because a finance company rather than the shop is taking the risk.',
    },
    {
      q: 'Can an iPad replace a laptop?',
      a: 'For writing, email, research, presentations, note-taking and photo work, yes, with a keyboard. It does not replace a laptop for desktop-only software, multiple external monitors, local development environments, or heavy file management. Buy the larger screen size if this is the plan — the small models are tablets that accept a keyboard, not laptops.',
    },
    {
      q: 'Does an iPad bought in Vietnam work in other countries?',
      a: 'Yes. Wi-Fi models are identical worldwide, and recent cellular models support broad band coverage plus eSIM, so they work on foreign networks. Apple’s warranty terms differ by region, so a VN/A unit serviced abroad may be handled differently — check before you rely on it. An older imported cellular unit is the one case worth checking band support on.',
    },
  ],
  related: phoneGuidesIn('en', SLUG).map((g) => ({ href: `/${g.slug}`, label: g.label, blurb: g.blurb })),
}

export const metadata: Metadata = {
  title: `Which iPad to buy in Vietnam — Air, Pro, mini or base | ${SITE_NAME}`,
  description:
    'What each iPad line is genuinely for, whether a cellular model is worth it where data is cheap and Wi-Fi is everywhere, which storage tier you will regret, what the keyboard and Pencil really add, and buying locally versus bringing one in.',
  alternates: phoneGuideAlternates(SLUG),
}

export default function IPadBuyingGuideVietnamPage() {
  return <SeoArticle content={CONTENT} />
}
