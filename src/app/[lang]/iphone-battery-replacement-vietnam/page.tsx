import type { Metadata } from 'next'
import { SITE_NAME } from '@/lib/edition'
import { phoneGuideAlternates, phoneGuidesIn } from '@/lib/phone-guides'
import { HereLink, P, SeoArticle, Ul, type ArticleContent } from '@/components/marketplace/seo-article'

/**
 * iPHONE BATTERY REPLACEMENT IN VIETNAM — the English half of the pair; the Vietnamese half is
 * /thay-pin-iphone-o-dau and is written from scratch, not translated.
 *
 * ⛔ THE TWO PAGES DIVERGE BY READER, not by wording. This one is read by someone
 * living in or visiting Vietnam who does not know the local repair market at all: it spends its
 * length on what the Settings screens mean, whether a handset bought abroad can be serviced here,
 * the two Vietnamese words to say at the counter, and what a repair does to the phone's resale
 * record. The Vietnamese page assumes every one of those and answers the questions a local actually
 * types instead — pin zin bóc máy against pin công ty, IC lập trình, chống nước, bảo hành bao lâu.
 *
 * ⚠️ THE ADVICE IS SPECIFIC AND CHECKABLE. Every claim here is something a reader can verify on
 * their own phone in under a minute, because "choose a reputable repair shop" ranks for nothing.
 * Where a figure is a rating or an approximation rather than a fact, it says so.
 *
 * ⛔ NO SHOP IS NAMED OR RANKED. The marketplace lists several of these retailers and earns
 * affiliate revenue from some of them, so a ranking here would be an advertisement with an
 * editorial byline. What each KIND of service is good at is the honest version — and the version
 * that survives a chain changing its repair pricing next month.
 */
const SLUG = 'iphone-battery-replacement-vietnam'

const CONTENT: ArticleContent = {
  eyebrow: 'Repair guide',
  h1: 'iPhone battery replacement in Vietnam',
  intro:
    'Battery replacement is the most common iPhone repair in Vietnam and the one where the parts vary most. This guide explains when the health percentage actually means replace, what you give up by going to an independent shop instead of an authorised one, exactly how a non-genuine cell announces itself in Settings, and the checks that stop a good battery being swapped for a worse one.',
  canonical: `/${SLUG}`,
  published: '2026-09-19',
  lang: 'en',
  alternate: { lang: 'vi', href: '/thay-pin-iphone-o-dau' },
  sections: [
    {
      id: 'when-the-number-means-replace',
      title: 'When battery health actually means replace',
      body: (
        <>
          <P>
            Open <strong>Settings › Battery › Battery Health &amp; Charging</strong>. Maximum Capacity
            is a percentage measured against the cell the phone left the factory with, not against
            any other phone. Apple treats a battery as consumed once it falls below 80%, and that is
            the threshold every service counter quotes at you &mdash; but the number on its own is
            not an instruction. A phone at 82% that still gets you to bedtime needs nothing. A phone
            at 88% that shuts down at 30% needs a battery today.
          </P>
          <P>
            The symptoms matter more than the percentage. Any one of these is a real trigger:
          </P>
          <Ul>
            <li>
              Sudden shutdowns with charge still showing &mdash; classically when the camera fires,
              or in a cold air-conditioned room.
            </li>
            <li>
              A message on that same screen saying performance management has been applied after an
              unexpected shutdown. That is iOS throttling peak speed to stop the phone dying again.
            </li>
            <li>Noticeable heat while the phone is doing nothing but charging.</li>
            <li>
              A screen or back glass lifted at one edge, or a case that no longer clips flat. That is
              a swelling cell. Stop charging it, do not press or puncture it, and have it replaced
              rather than posted anywhere.
            </li>
            <li>Visible drain while the phone sits idle in a pocket.</li>
          </Ul>
          <P>
            For context on what is normal wear: Apple rated older iPhone batteries to keep about 80%
            of capacity after roughly 500 full charge cycles, and rates the iPhone 15 generation and
            later at roughly 1,000. A cycle means a cumulative 100% discharged, not one plug-in, so
            two half-days count as one. On iPhone 15 and later you can read the count directly &mdash;{' '}
            <strong>Settings › General › About</strong> shows Cycle Count, Manufacture Date and
            First Use.
          </P>
          <P>
            Heat is what accelerates all of this in Vietnam, and it is worth naming because it is
            fixable. Apple gives 0&ndash;35°C as the ambient range for using an iPhone; a handset
            clipped to a motorbike mount in afternoon sun, or left on a car dashboard, is far past
            that, and lithium-ion cells degrade fastest when they are hot and charging at the same
            time. Losing a few points of capacity a year is ordinary. Losing ten over one summer is
            usually the mount, not the phone.
          </P>
        </>
      ),
    },
    {
      id: 'authorised-vs-independent',
      title: 'Authorised service against an independent shop',
      body: (
        <>
          <P>
            Apple operates no retail store of its own in Vietnam, so &ldquo;official&rdquo; here means
            an <strong>Apple Authorised Service Provider</strong> &mdash; usually a service counter
            inside one of the large chains, or a standalone centre. What that buys is a genuine cell
            <em> paired</em> to your handset in software, the Battery Health readout left intact, the
            repair written into the phone&rsquo;s own Parts and Service History, a fresh water-resistance
            gasket, and a warranty on the part that does not depend on one shop still existing. What
            it costs is time and money: they will want the serial or IMEI, an older model may mean
            ordering the part and waiting, and it is comfortably the most expensive route.
          </P>
          <P>
            Independent repair shops are everywhere, take about half an hour, and will do the job
            while you wait. Plenty of them are careful and honest. The variable is not their skill,
            it is which cell goes in and what happens to the phone afterwards, so settle three things
            before you agree to anything:
          </P>
          <Ul>
            <li>Which battery: a genuine cell pulled from another handset, or an aftermarket one.</li>
            <li>How long the shop itself warrants it, and whether that is written on the receipt.</li>
            <li>Whether the water-resistance adhesive is replaced as part of the job.</li>
          </Ul>
          <P>
            Choosing between them is mostly about the phone, not the shop. Still inside Apple&rsquo;s
            warranty or on AppleCare: authorised only, because anything else forfeits the cover you
            already paid for. A recent, expensive handset you intend to keep for years: authorised,
            because you want the health readout for the next decision. An older phone you are running
            until it dies: a well-established independent is a defensible trade. A phone you plan to
            sell soon: remember that the service record travels with the handset and that Vietnamese
            buyers check it, which is covered in{' '}
            <HereLink href="/buying-a-used-iphone-vietnam">the used-iPhone inspection guide</HereLink>.
          </P>
        </>
      ),
    },
    {
      id: 'what-settings-shows',
      title: 'How a non-genuine battery shows up in Settings',
      body: (
        <>
          <P>
            This is the part most people find out afterwards. Since iOS 15 and 16, a battery that is
            not paired to the phone it is sitting in produces an &ldquo;Important Battery
            Message&rdquo; saying iOS cannot verify the part, and the Battery Health screen stops
            reporting Maximum Capacity altogether: where the percentage used to be, you get
            <strong> Unknown Part</strong>. On iPhone 15 and later there is a second place to look
            &mdash; <strong>Settings › General › About</strong> gains a Parts and Service History row
            that reads either <em>Genuine Apple Part</em> or <em>Unknown Part</em> for the battery.
          </P>
          <P>
            Two things about that message are routinely misread. First, it is not a penalty: the
            phone is not locked, throttled or crippled, and it charges and runs normally. What you
            lose is the capacity readout itself &mdash; permanently, for that cell &mdash; which means
            you are now blind to exactly the number you were trying to fix. Second, a
            <em> genuine</em> Apple battery harvested from another iPhone triggers the same message,
            because the issue is the pairing rather than the cell. Apple has been opening up
            calibration for genuine used parts on recent models through its own repair flow, but that
            is a software step done to a defined process, and a walk-in swap generally does not
            include it.
          </P>
          <P>
            The other quiet loss is water resistance. Once the phone has been opened, the IP rating it
            shipped with is gone unless the adhesive seal is properly replaced &mdash; and even then,
            Apple&rsquo;s own position is that a repaired handset should not be treated as water
            resistant. In a city with a rainy season that is not an abstract point.
          </P>
        </>
      ),
    },
    {
      id: 'swapped-cell',
      title: 'The swapped-cell problem, and the checks that catch it',
      body: (
        <>
          <P>
            Two different things get lumped together under &ldquo;battery scam&rdquo;, and they leave
            different evidence. The first is a straight substitution: you are quoted one grade of
            part and given a cheaper one, or your own still-healthy original is harvested and resold
            while you get something worse. The second is subtler &mdash; an aftermarket cell whose
            battery-management board has been programmed to report whatever it is told. That phone
            shows a clean 100% Maximum Capacity, no warning message and no Unknown Part, which is
            precisely why it is worth knowing about.
          </P>
          <P>
            The tells for a programmed board are behavioural, and they take weeks rather than minutes:
            capacity pinned at exactly 100% for months without moving (a real cell usually gives up a
            point or two within the first few months), a cycle count that never advances, and runtime
            that does not match the flattering number on the screen.
          </P>
          <P>These checks are cheap, and a shop that objects to any of them has answered you:</P>
          <Ul>
            <li>
              Screenshot the Battery Health screen and the About page &mdash; serial and IMEI included
              &mdash; before the phone leaves your hand.
            </li>
            <li>
              Ask for the work to be done at the counter, in sight. A shop that must take the handset
              to a workshop elsewhere is a different proposition, and worth a different level of trust.
            </li>
            <li>Ask for the old battery back. It is an ordinary request and it removes the incentive.</li>
            <li>
              On iPhone 15 and later, check Cycle Count and Manufacture Date afterwards. A genuinely
              new cell reads a handful of cycles and a recent date.
            </li>
            <li>
              Before you leave, re-test Face ID, the front camera, the proximity sensor (the screen
              should blank when you hold a call to your ear) and the flashlight. Those cables run
              directly over the battery bay and are the usual collateral damage.
            </li>
            <li>Get the warranty period written on the receipt against the IMEI, not promised aloud.</li>
          </Ul>
        </>
      ),
    },
    {
      id: 'phones-bought-abroad',
      title: 'If you bought the phone outside Vietnam',
      body: (
        <>
          <P>
            A paid, out-of-warranty battery replacement is normally available at an authorised service
            provider whatever your model number is &mdash; <code>LL/A</code>, <code>ZA/A</code> and{' '}
            <code>J/A</code> handsets are serviced here routinely. What does not reliably travel is
            free in-warranty service: Apple&rsquo;s iPhone warranty is generally honoured in the
            country of purchase, so a battery replaced under warranty at home may well be a paid job
            here. Ask before you hand the phone over rather than after the quote. Independent shops do
            not care where a handset came from at all.
          </P>
          <P>
            Two Vietnamese words do most of the work at a counter. <em>Thay pin</em> is
            &ldquo;replace the battery&rdquo;. <em>Pin chính hãng</em> is a genuine part, as against{' '}
            <em>pin ngoài</em> for an aftermarket one; <em>bảo hành</em> is the warranty. Asking
            &ldquo;Pin chính hãng hay pin ngoài?&rdquo; is completely ordinary and nobody is offended
            by it.
          </P>
          <P>
            Take a backup before any repair, and enough charge left in the phone to test it afterwards.
            An independent battery swap does not require you to disable Find My, but an authorised
            centre may ask you to sign out of your Apple account before it accepts the handset, which
            is much easier to do calmly at home than standing at a counter.
          </P>
          <P>
            One last piece of arithmetic. When a tired battery is only one of several tired things
            &mdash; a dim screen, a rattling camera, a charging port that needs a wiggle &mdash; the
            replacement stops being an obvious yes, because you are spending real money on a handset
            near the end of its life. Put the quote next to what the phone is worth and what a newer
            one costs today on{' '}
            <HereLink href="/iphone-18-vietnam">the live iPhone 18 price page</HereLink>, which reads
            the marketplace&rsquo;s own listings rather than a press release.
          </P>
        </>
      ),
    },
  ],
  faqs: [
    {
      q: 'How much does it cost to replace an iPhone battery in Vietnam?',
      a: 'It varies by model and by which of the three routes you take, so ask for a quote against your exact model rather than a general figure. An Apple Authorised Service Provider is the most expensive by a wide margin, a genuine cell pulled from another handset sits in the middle, and an aftermarket cell at an independent shop is the cheapest. Whatever the quote, confirm whether it includes a new water-resistance gasket — that is where identical-sounding prices differ.',
    },
    {
      q: 'At what battery health percentage should I replace my iPhone battery?',
      a: 'Apple treats a battery as consumed below 80% Maximum Capacity, and that is the usual trigger. But symptoms override the number in both directions: replace at any percentage if the phone shuts down with charge remaining, runs hot while merely charging, or shows performance management applied after an unexpected shutdown — and do not bother at 82% if the phone still lasts your day.',
    },
    {
      q: 'Why does my iPhone say “Unknown Part” after a battery replacement?',
      a: 'Because the new cell is not paired to that specific phone, so iOS cannot verify it. The phone still works and charges normally, but the Maximum Capacity percentage disappears for good on that battery. It happens with aftermarket cells and also with genuine Apple batteries taken from another iPhone, since the issue is the pairing rather than the cell itself.',
    },
    {
      q: 'Can I get an iPhone bought overseas repaired in Vietnam?',
      a: 'Yes for a paid out-of-warranty battery replacement — authorised service providers handle LL/A, ZA/A and J/A handsets routinely, and independent shops do not care at all. Free in-warranty service is the exception, because Apple generally honours the iPhone warranty in the country of purchase. Ask which applies before you leave the phone.',
    },
    {
      q: 'Is it safe to replace an iPhone battery at a small shop in Vietnam?',
      a: 'Usually, and most shops are competent. Reduce what is left of the risk the way locals do: screenshot Battery Health and the About page first, have the work done at the counter in view, ask for the old battery back, get the warranty written on the receipt with your IMEI, and re-test Face ID, the front camera and the proximity sensor before you leave.',
    },
    {
      q: 'Does replacing the battery void my Apple warranty?',
      a: 'A replacement done by an Apple Authorised Service Provider does not. A third-party replacement forfeits cover on anything the non-genuine part contributes to, and Apple can decline a later repair if the part interferes with it. If the phone is still inside its warranty or on AppleCare, going independent means paying twice for the same protection.',
    },
    {
      q: 'How long does an iPhone battery replacement take in Vietnam?',
      a: 'An independent shop typically does it in about thirty minutes to an hour while you wait. An authorised service provider may finish the same day for a current model, or keep the phone for several days if the part has to be ordered — worth asking about before you commit, especially for an older handset.',
    },
  ],
  related: phoneGuidesIn('en', SLUG).map((g) => ({ href: `/${g.slug}`, label: g.label, blurb: g.blurb })),
}

export const metadata: Metadata = {
  title: `iPhone battery replacement in Vietnam — official vs independent | ${SITE_NAME}`,
  description:
    'When iPhone battery health actually means replace, what an authorised service centre gives you that an independent shop cannot, how a non-genuine cell shows up as Unknown Part in Settings, and the checks that catch a swapped battery.',
  alternates: phoneGuideAlternates(SLUG),
}

export default function IPhoneBatteryReplacementVietnamPage() {
  return <SeoArticle content={CONTENT} />
}
