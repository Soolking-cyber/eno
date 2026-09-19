import type { Metadata } from 'next'
import { SITE_NAME } from '@/lib/edition'
import { phoneGuideAlternates, phoneGuidesIn } from '@/lib/phone-guides'
import { HereLink, P, SeoArticle, Ul, type ArticleContent } from '@/components/marketplace/seo-article'

/**
 * SELLING YOUR PHONE IN VIETNAM — the English half of the pair; the Vietnamese half is
 * /ban-dien-thoai-cu-duoc-gia and is written from scratch, not translated.
 *
 * ⛔ THE TWO HALVES ANSWER DIFFERENT QUESTIONS, because the two readers arrive with different gaps.
 * A foreign resident or visitor does not know that the LL/A handset they brought from home is worth
 * less here than an identical VN/A one, does not know an English-only listing halves the audience,
 * and is the person most likely to erase a phone while still signed in to iCloud and then discover
 * it from another country. This page spends its length there. The Vietnamese half assumes all of
 * that is obvious and spends its length on ký gửi, on how a shop grades "zin" versus "đã bung", and
 * on the transfer-confirmation scam — questions a local actually types.
 *
 * ⛔ NO PRICES IN THE PROSE. Figures go stale and this page is meant to be right next year; the live
 * numbers live on /iphone-18-vietnam, which reads the marketplace's own listings. No shop is named
 * as the best place to sell either — the marketplace lists several of these retailers.
 */
const SLUG = 'selling-your-phone-vietnam'

const CONTENT: ArticleContent = {
  eyebrow: 'Selling guide',
  h1: 'Selling your phone in Vietnam',
  intro:
    'Vietnam resells phones at a scale that surprises people arriving from markets where an old handset goes in a drawer. Three routes will take yours off your hands and they pay very differently — and most of the gap between the best and worst outcome is not negotiation, it is which route you pick, what state the phone is in, and the week you decide to sell.',
  canonical: `/${SLUG}`,
  published: '2026-09-19',
  lang: 'en',
  alternate: { lang: 'vi', href: '/ban-dien-thoai-cu-duoc-gia' },
  sections: [
    {
      id: 'trade-in-or-private-sale',
      title: 'Trade-in, dealer buy-back, or private sale',
      body: (
        <>
          <P>
            <strong>Trade-in at a chain</strong> &mdash; thu cũ đổi mới &mdash; is the fastest and
            pays the least. You bring the old handset in, a technician grades it in about ten
            minutes, and the value comes off a new phone bought there and then. The trap is that a
            generous-looking trade-in number is often a promotional subsidy attached to that
            chain&rsquo;s own price for the new handset. Compare the <strong>total you walk out
            paying</strong>, never the trade-in figure on its own.
          </P>
          <P>
            <strong>Selling outright to a second-hand dealer</strong> pays cash the same day with no
            obligation to buy anything. Expect a thorough inspection and a firm number: the dealer is
            pricing in their margin, the warranty they will offer the next buyer, and any
            refurbishment. It normally beats a trade-in quote and sits clearly below private-sale
            money. It also needs no Vietnamese at all, which matters more than it should.
          </P>
          <P>
            <strong>Selling privately</strong> &mdash; to another person, on a marketplace like this
            one &mdash; pays the most. You are absorbing the work the dealer would otherwise be paid
            for: photographing, answering the same three questions twenty times, meeting, and sitting
            there while a stranger tests the phone. On a mid-range handset that margin may not be
            worth several evenings; on a recent flagship it usually is.
          </P>
          <P>
            Two things narrow the choice for a foreign resident specifically. The first is how much
            time you have &mdash; if you are leaving the country next week, a listing that takes four
            days to sell is not a route you own, and the dealer counter exists for exactly that. The
            second is language. A listing written only in English reaches a small slice of the buyers
            here; put the description in Vietnamese as well, even a plain one, or the price you can
            ask quietly adjusts to match the smaller audience.
          </P>
        </>
      ),
    },
    {
      id: 'what-raises-the-price',
      title: 'What actually raises the price',
      body: (
        <>
          <P>
            Dealers and private buyers grade a phone on the same short list. Knowing it before you
            list is worth more than any negotiating tactic.
          </P>
          <Ul>
            <li>
              <strong>Battery health</strong> is the first thing anyone asks about an iPhone
              (Settings › Battery › Battery Health &amp; Charging). Above roughly 90% it is a selling
              point; under 80% iOS shows a service message and buyers price in a replacement. Put the
              figure and a screenshot in the listing &mdash; leaving it out reads as hiding it. If
              yours sits near the line,{' '}
              <HereLink href="/iphone-battery-replacement-vietnam">replacing the battery first</HereLink>{' '}
              sometimes returns more than it costs, but only a genuine replacement does; a cheap
              third-party cell usually lowers the grade instead of raising it.
            </li>
            <li>
              <strong>Original parts.</strong> The local word is &ldquo;zin&rdquo;, and it means
              nothing has been swapped. Settings › General › About lists Parts and Service History,
              and a screen or battery fitted outside the official channel stays on that list
              permanently. Declare it rather than let a buyer find it at the meeting, which costs you
              the sale and the afternoon.
            </li>
            <li>
              <strong>VN/A or import.</strong> This is the buying question turned around, and it is
              the one foreigners are least prepared for. A handset distributed by Apple Vietnam
              carries a warranty any authorised centre honours, and buyers here pay a premium for
              that. The LL/A unit you brought from home is worth visibly less on identical hardware.
              It is not a haggling trick, it is the warranty gap. Bring the original receipt if you
              have it and expect the discount anyway.
            </li>
            <li>
              <strong>The box, with an IMEI that matches the phone.</strong> A complete box is worth
              real money to a buyer who plans to resell later; the bundled cable is worth close to
              nothing. If you are three years in and still have the box, that was a good decision.
            </li>
            <li>
              <strong>Cosmetics, in the order they get noticed:</strong> the screen first (scratches,
              a dark patch, uneven backlight at the edges), then frame corners, then the back glass.
              Corner dents read as &ldquo;dropped&rdquo;, which makes a buyer suspect the inside as
              well as the outside.
            </li>
            <li>
              <strong>Warranty remaining</strong> transfers with the device. Quote the activation date
              rather than &ldquo;about a year left&rdquo; &mdash; it is checkable in seconds on
              Apple&rsquo;s coverage page, and a checkable claim sells better than a promise.
            </li>
          </Ul>
          <P>
            What barely moves the number: colour, the charger, a case you are throwing in, and
            anything you paid for that the next owner cannot verify. Storage does matter, but the
            premium a larger tier holds second-hand is smaller than the premium it cost new. For where
            the market sits this week, the{' '}
            <HereLink href="/iphone-18-vietnam">live iPhone price page</HereLink> reads the
            marketplace&rsquo;s own listings rather than a press release.
          </P>
        </>
      ),
    },
    {
      id: 'wipe-and-unlink',
      title: 'Wiping and unlinking, in the order that matters',
      body: (
        <>
          <P>
            More sales collapse at the handover over this than over price, and it is almost always the
            same mistake: the phone was erased while still signed in to its owner&rsquo;s Apple
            Account, so the buyer reaches the Activation Lock screen and nobody can move past it
            &mdash; not the buyer, not a shop, not Apple. If you have already left the country when
            that message arrives, you are fixing it from a laptop in another time zone.
          </P>
          <Ul>
            <li>Back up first, to iCloud or a computer, and confirm the backup finished.</li>
            <li>
              <strong>Move your eSIM before anything else.</strong> Transfer it to the new handset
              from that phone&rsquo;s setup flow. Deleting an eSIM from the old phone without
              transferring it usually means going back to the network to have it re-issued.
            </li>
            <li>Unpair an Apple Watch, which has to be done from the phone that is still signed in.</li>
            <li>
              <strong>Deregister banking, e-wallet and authenticator apps from inside each app</strong>,
              not by deleting them. Several of them bind to the device and the phone number together,
              and re-registering from a new handset can mean a counter visit.
            </li>
            <li>
              Sign out of iCloud: Settings › [your name] › Sign Out. That is the step that removes
              Activation Lock. Only then Settings › General › Transfer or Reset iPhone › Erase All
              Content and Settings.
            </li>
            <li>
              Afterwards, check the phone has disappeared from your Apple Account&rsquo;s device list.
              A device still listed there can be re-locked, and a buyer who knows that will walk.
            </li>
          </Ul>
          <P>
            Android is the same shape with one extra trap: removing your Google account and factory
            resetting handles Google&rsquo;s own reset protection, but a Samsung handset has a
            separate reactivation lock tied to a Samsung account that has to be switched off on its
            own. Either platform, finish the job <strong>in front of the buyer</strong>: let them take
            the erased phone to a home screen on Wi-Fi before money moves. It takes four minutes and
            it is the only proof either of you needs.
          </P>
          <P>
            ⚠️ SETTLE HOW YOU WILL CONFIRM PAYMENT BEFORE YOU ERASE ANYTHING. If the handset you are
            selling is the one your banking app and its OTPs live on, wiping it first leaves you
            unable to verify that a transfer actually arrived &mdash; and &ldquo;I have sent
            it&rdquo; plus a screenshot is the oldest trick in this market. Either take cash, or
            bring a second device that is already enrolled for your bank, or complete the transfer
            and see it clear on that second device first, and only then erase.
          </P>
        </>
      ),
    },
    {
      id: 'meeting-and-getting-paid',
      title: 'Meeting safely and getting paid',
      body: (
        <>
          <P>
            Meet somewhere public with Wi-Fi and a power socket &mdash; a coffee chain, a mall food
            court. If the buyer asks to meet at a repair shop so a technician can check the handset,
            that is a normal, good-faith request here rather than an insult; they pay the small
            inspection fee, and a phone somebody else has verified sells faster.
          </P>
          <P>
            Write your IMEI down before you leave home and check that exact number again right before
            the final handover. The oldest swap in this market is a phone carried a few steps away
            &ldquo;into the light to check the screen&rdquo; and returned as a different unit in the
            same colour.
          </P>
          <Ul>
            <li>
              <strong>Trust only the balance in your own banking app.</strong> A screenshot of a
              completed transfer takes thirty seconds to fake. Domestic transfers land almost
              instantly, so &ldquo;it&rsquo;s pending, interbank is slow today&rdquo; at the moment of
              handover is a script &mdash; sit there until it clears.
            </li>
            <li>
              No Vietnamese bank account? Cash at the meeting is the clean answer. Do not route the
              payment through someone else&rsquo;s account you have no claim on.
            </li>
            <li>
              Do not ship a phone to a stranger, and do not accept a deposit followed by a request to
              send it ahead.
            </li>
            <li>
              Keep the conversation inside the marketplace&rsquo;s own messaging. If anything is
              disputed later, that thread is the only thing anyone can check.
            </li>
            <li>Hand over the box and any receipt last, once the payment has actually cleared.</li>
          </Ul>
        </>
      ),
    },
    {
      id: 'timing',
      title: 'The timing that costs the most',
      body: (
        <>
          <P>
            The most expensive decision in the whole process is not the route or the haggling, it is
            the calendar. Used prices for a generation step down around the announcement of its
            successor, and that step is passed back through every older generation in the weeks after.
            If you intend to upgrade anyway, list <strong>before</strong> the new model is announced,
            not after the queue has formed at the shop.
          </P>
          <P>
            Two smaller cycles are worth knowing. Demand for used handsets tends to be strongest in
            the weeks before Tet, when year-end bonuses land and phones get bought as gifts, and
            noticeably softer in the month after it. Late summer, before the school year, is a second
            and milder window.
          </P>
          <P>
            The 80% battery threshold is a step, not a slope: a phone reading 81% is a good phone, and
            the same phone at 79% is one the operating system has started nagging about. If yours is
            in the low eighties and you are thinking of waiting a few months, you are really choosing
            to sell on the other side of that step.
          </P>
          <P>
            Under all of it sits the cost of holding. A phone you have stopped using loses value every
            month it sits in a drawer, and on a recent flagship the gap between selling the week you
            switch and selling six months later is usually larger than the entire gap between a
            trade-in quote and a private sale. The buyer&rsquo;s side of this transaction is worth
            reading too &mdash;{' '}
            <HereLink href="/buying-a-used-iphone-vietnam">the inspection a used-phone buyer runs</HereLink>{' '}
            is exactly what you will be asked to sit through.
          </P>
        </>
      ),
    },
  ],
  faqs: [
    {
      q: 'How do I sell my phone in Vietnam as a foreigner?',
      a: 'Three routes: trade it in against a new handset at a chain, sell it outright to a second-hand dealer for same-day cash, or list it privately on a marketplace. The dealer counter needs no Vietnamese and no local bank account, which is why it suits someone leaving soon. A private sale pays the most but takes days and works far better if the listing is written in Vietnamese as well as English.',
    },
    {
      q: 'Is it better to trade in or sell my phone privately in Vietnam?',
      a: 'Privately, if you have the time — the margin over a trade-in quote is real on a recent flagship. Trade-in wins on speed and certainty, and it is the right call when the phone is mid-range, heavily marked, or when you are about to leave the country. Compare the total you pay for the new phone after the trade-in, not the trade-in number itself: the headline figure is often tied to that chain’s own price on the new handset.',
    },
    {
      q: 'Does battery health affect the resale price of an iPhone?',
      a: 'Yes, and it is usually the first question a buyer asks. Above roughly 90% it is a selling point. Below 80% iOS shows a service message and buyers deduct the cost of a replacement, so the drop across that threshold is bigger than the two percentage points suggest. Put the number in the listing with a screenshot — the buyer will check it within a minute of meeting you.',
    },
    {
      q: 'Do I need the original box to sell my phone in Vietnam?',
      a: 'You do not need it, but a complete box whose IMEI matches the handset genuinely raises what buyers will pay, because it helps them resell later. The charger cable inside it adds almost nothing. Missing box, matching IMEI on the phone and a checkable warranty date still makes an easy sale.',
    },
    {
      q: 'How do I remove Activation Lock before selling my iPhone?',
      a: 'Sign out of iCloud on the device first — Settings › [your name] › Sign Out — and only then erase it with Settings › General › Transfer or Reset iPhone › Erase All Content and Settings. Erasing while still signed in leaves the phone locked to your Apple Account, and no shop or buyer can bypass that. Afterwards confirm the device is gone from your Apple Account’s device list.',
    },
    {
      q: 'Can I sell my phone in Vietnam without a Vietnamese bank account?',
      a: 'Yes. Cash at the meeting is normal and is the simplest answer, and a dealer buy-back pays cash by default. Avoid having a buyer pay into a friend’s account on your behalf, and never hand over the phone against a screenshot of a transfer you cannot see in your own app.',
    },
    {
      q: 'When is the worst time to sell a used phone in Vietnam?',
      a: 'The weeks right after a new generation is announced, when used prices for the outgoing model step down and drag the older ones with them. The month after Tet is also soft. The other quiet cost is simply waiting: a phone sitting unused loses value every month, often more than the difference between a trade-in and a private sale.',
    },
  ],
  related: phoneGuidesIn('en', SLUG).map((g) => ({ href: `/${g.slug}`, label: g.label, blurb: g.blurb })),
}

export const metadata: Metadata = {
  title: `Selling your phone in Vietnam — trade-in vs private sale | ${SITE_NAME}`,
  description:
    'Trade-in, dealer buy-back or private sale in Vietnam, what battery health and VN/A status do to the price, how to wipe and unlink so the sale does not collapse at the handover, and the timing that costs the most.',
  alternates: phoneGuideAlternates(SLUG),
}

export default function SellingYourPhoneVietnamPage() {
  return <SeoArticle content={CONTENT} />
}
