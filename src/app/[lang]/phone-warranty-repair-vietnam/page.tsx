import type { Metadata } from 'next'
import { SITE_NAME } from '@/lib/edition'
import { phoneGuideAlternates, phoneGuidesIn } from '@/lib/phone-guides'
import { HereLink, P, SeoArticle, Ul, type ArticleContent } from '@/components/marketplace/seo-article'

/**
 * PHONE WARRANTY AND REPAIR IN VIETNAM — the English half of the pair; the Vietnamese half is
 * /bao-hanh-sua-chua-dien-thoai and is written from scratch, not translated.
 *
 * ⚠️ THE TWO PAGES ANSWER DIFFERENT QUESTIONS ON PURPOSE. A foreigner arrives holding a handset
 * bought somewhere else and wants to know whether that warranty follows them here, who is even
 * allowed to touch the phone, how long they will be without it, and how to hand a locked device to
 * a stranger they cannot easily talk to. A Vietnamese reader knows all of that and is instead
 * deciding between ép kính and a full display swap, between màn zin bóc máy and màn lô, and
 * reading the exclusions on a phiếu bảo hành. Translating either page would answer the wrong
 * questions in both languages.
 *
 * ⛔ NO PRICES IN THE PROSE — repair quotes move faster than an article does, and a stale figure is
 * worse than none. Turnaround ranges are given as ranges and labelled as estimates. Live retail
 * figures live on /iphone-18-vietnam, which reads the marketplace's own listings.
 *
 * ⛔ NO SHOP OR CHAIN IS NAMED AS "BEST". The marketplace lists several of these retailers and
 * earns affiliate revenue from some, so a ranking here would be an advertisement with an editorial
 * byline. What each KIND of repairer is good at is the honest version, and it survives a chain
 * changing its service terms next month.
 */
const SLUG = 'phone-warranty-repair-vietnam'

const CONTENT: ArticleContent = {
  eyebrow: 'Ownership guide',
  h1: 'Phone warranty and repair in Vietnam',
  intro:
    'Three different organisations can put a warranty on the phone in your pocket, and only one of them is the manufacturer. This guide explains which warranty you are actually holding, who is allowed to open the device without ending it, how long each kind of repair realistically takes, and the checks that tell you whether the part a shop fitted is genuine.',
  canonical: `/${SLUG}`,
  published: '2026-09-19',
  lang: 'en',
  alternate: { lang: 'vi', href: '/bao-hanh-sua-chua-dien-thoai' },
  sections: [
    {
      id: 'three-kinds-of-warranty',
      title: 'Three kinds of warranty, and which one you are holding',
      body: (
        <>
          <P>
            <strong>Manufacturer warranty</strong> applies to a handset distributed for the
            Vietnamese market &mdash; <em>chính hãng</em>. On a phone it is normally 12 months, it is
            attached to the IMEI rather than to a piece of paper, and any authorised service centre
            in the country will accept the device. Apple has no Apple Store in Vietnam, so every
            Apple warranty repair here runs through an authorised service provider; Samsung, Xiaomi
            and Oppo each operate their own centres in the major cities.
          </P>
          <P>
            <strong>Shop warranty</strong> is what an imported handset or a second-hand one comes
            with instead. It is typically 6&ndash;12 months on a new import and 1&ndash;6 months on a
            used device, it is honoured at that shop and nowhere else, and it is a contract with a
            business rather than with a manufacturer. Read the exclusions before the cover: the list
            of what is <em>not</em> covered is the real content of the slip.
          </P>
          <P>
            <strong>Extended or accidental-damage cover</strong> is sold separately at the counter
            and exists precisely because the other two exclude drops and liquid. If you buy it, ask
            three questions and get the answers in writing: the maximum payout, how many claims a
            year, and whether you contribute a share of each repair.
          </P>
          <P>
            The part that surprises people most: a manufacturer warranty from another country
            usually cannot be claimed here. Apple&rsquo;s limited warranty for iPhone is tied to the
            country of purchase, with regional exceptions that do not include Vietnam. Android
            makers vary &mdash; a few offer international cover on flagship models, most do not.
            Assume the answer is no, and check with the brand before you rely on it. For repair
            purposes, a phone brought from home is an out-of-warranty phone here.
          </P>
          <P>
            To find out what you have in about a minute: check the IMEI on the manufacturer&rsquo;s
            own coverage page, look for a <em>phiếu bảo hành</em> (warranty slip) in the box, and if
            the phone was bought here, check the model number under{' '}
            <strong>Settings › General › About</strong>. The difference between a Vietnam unit and an
            import is set out in{' '}
            <HereLink href="/chinh-hang-vs-xach-tay-vietnam">the chính hãng versus xách tay guide</HereLink>.
          </P>
        </>
      ),
    },
    {
      id: 'where-repairs-happen',
      title: 'Where a repair actually happens, and how long it takes',
      body: (
        <>
          <P>
            <strong>Authorised service centres</strong> fit genuine parts and leave your warranty
            intact, which is the entire reason to use one. They work by replacing modules rather than
            repairing them, so they are excellent at a screen, a battery, a camera or a charge port
            and generally will not attempt anything at board level. Turnaround, as a rough range
            rather than a promise: same day to two or three days when the part is in stock, and a
            week or more when it has to be ordered in or the device is sent on. Ask at intake whether
            the repair is being done on site or sent away &mdash; that single answer determines how
            long you are without the phone.
          </P>
          <P>
            <strong>Chain service counters</strong> are the intake desks at the large retailers. They
            are convenient when you bought the phone there, because they handle the paperwork with
            the manufacturer for you, and they also take out-of-warranty work on common models. Being
            an intermediary adds a day or two at each handover.
          </P>
          <P>
            <strong>Independent repair shops</strong> do the work the authorised network declines
            outright: microsoldering on the logic board, liquid-damage recovery, charging and power
            IC replacement, no-signal faults after a drop, data recovery from a phone that will not
            boot. They are also the fastest and the cheapest, and a screen or battery is often done
            while you wait. Two trade-offs come with that: part quality varies enormously between
            shops, and any repair here ends the manufacturer warranty on the device.
          </P>
          <P>
            The useful move is to match the fault to the tier rather than to shop around blindly:
          </P>
          <Ul>
            <li>In warranty, Vietnam-distributed handset, covered fault &mdash; authorised centre, always, and nowhere else first.</li>
            <li>Cracked glass or a tired battery on an out-of-warranty phone &mdash; every tier can do it; the difference is the part and the paperwork.</li>
            <li>Water damage, dead after a drop, no power, no signal, boot loop &mdash; an independent board-level specialist, because an authorised centre will quote you a whole replacement.</li>
            <li>A phone you intend to sell soon &mdash; a genuine part and a written parts warranty keep the resale value that a cheap panel quietly removes.</li>
          </Ul>
        </>
      ),
    },
    {
      id: 'what-voids-warranty',
      title: 'The repairs that cost you the rest of your warranty',
      body: (
        <>
          <P>
            A warranty ends the moment the manufacturer can show the device was opened or altered
            outside its network, and the evidence is usually physical and permanent. These are the
            triggers that come up most often in Vietnam:
          </P>
          <Ul>
            <li>
              <strong>Opening the device</strong> anywhere but an authorised centre &mdash; a broken
              seal sticker or chewed screws is enough on most brands.
            </li>
            <li>
              <strong>A non-genuine display or battery.</strong> On recent iPhones these components
              are serialised, so this is recorded by the phone itself rather than judged by a
              technician.
            </li>
            <li>
              <strong>Liquid.</strong> The liquid-contact indicator &mdash; on an iPhone, a small
              strip visible inside the SIM tray &mdash; turns red permanently, and liquid damage is
              excluded from every standard manufacturer warranty.
            </li>
            <li>
              <strong>Physical damage</strong>: cracked glass, a bent frame, crush damage. Not
              covered, and once a frame is deformed an authorised centre may decline further work on
              the device entirely.
            </li>
            <li>
              <strong>Jailbreaking, rooting or unofficial firmware</strong>, and an unreadable or
              tampered IMEI.
            </li>
          </Ul>
          <P>
            Parts pairing deserves its own paragraph because it changes the calculation. On current
            iPhones the display, battery and cameras carry serial numbers the operating system
            checks. Fit a part that is not genuine or not paired to that handset and the phone writes
            it into a <strong>Parts and Service History</strong> entry under Settings › General ›
            About, marked <em>Unknown Part</em>. True Tone stops working after a non-genuine display,
            the battery health percentage disappears after a non-genuine battery, and on some models
            Face ID stops unless the original component is transferred across. None of that can be
            cleared later. Samsung and the Chinese brands are less strict today, but the direction of
            travel across the industry is the same.
          </P>
          <P>
            So the rule is blunt: if the phone is still in warranty and the fault is a covered one,
            do not take it to an independent shop first. One battery swap outside the network can end
            the remaining cover on everything else in the device.
          </P>
        </>
      ),
    },
    {
      id: 'genuine-or-third-party',
      title: 'Telling a genuine part from a third-party one',
      body: (
        <>
          <P>
            A third-party part is not automatically a bad deal &mdash; on an older phone it is often
            the sensible one. What matters is knowing which you are buying and paying accordingly. On
            an iPhone the phone itself will tell you.
          </P>
          <Ul>
            <li>
              <strong>Settings › General › About › Parts and Service History.</strong> A genuine,
              correctly paired component reads <em>Genuine Apple Part</em>. <em>Unknown Part</em>
              {' '}means aftermarket, or genuine but harvested from another handset and never paired.
              No section at all, on a model that supports it, means nothing has been replaced.
            </li>
            <li>
              <strong>True Tone</strong> in Display &amp; Brightness. Missing after a screen job is a
              strong signal the panel is not an original.
            </li>
            <li>
              <strong>Battery Health</strong> showing an actual percentage rather than a service
              message.
            </li>
            <li>
              <strong>Face ID</strong> still enrolling and working after a display replacement.
            </li>
          </Ul>
          <P>
            On any brand, the physical tells are consistent: noticeably lower maximum brightness in
            sunlight, a colour cast or a green tint at low brightness, touch that misses near the
            edges, a panel that sits slightly proud of the frame or shows a hairline gap, and an
            oleophobic coating that smudges differently. A replacement battery that reaches full
            charge unusually fast and drains unusually fast is a small cell in a full-size shell.
          </P>
          <P>
            Ask three questions before agreeing to any repair, and put the answers on the intake
            slip: is the part genuine or aftermarket, how long is the part itself warranted, and may
            I have the old part back. A shop that answers all three plainly is telling you how it
            operates &mdash; and a shop that refuses the third is telling you the same thing.
          </P>
        </>
      ),
    },
    {
      id: 'handing-over-the-phone',
      title: 'Handing the phone over: data, activation lock and language',
      body: (
        <>
          <P>
            Back up before you go, and assume that anyone who can unlock the device can read
            everything on it. ⚠️ A screen passcode is not just a screen passcode: on a modern phone it
            unlocks saved passwords, mail, messages and every app that treats the handset as a second
            factor, so &ldquo;change it to something temporary&rdquo; does not contain the exposure.
            For anything beyond a battery or a screen, the safer sequence is a verified backup, then
            erase the device, then hand it over &mdash; and restore when it comes back.
          </P>
          <P>
            Turn <strong>Find My</strong> off yourself before handing the phone over. An authorised
            centre will refuse a device with activation lock enabled, and an independent shop cannot
            test a phone it cannot get past the lock screen on. Never give out your Apple ID or
            Google account password &mdash; disabling the lock is something you do, not something the
            shop needs credentials for. Most shops will ask for the device passcode so they can test
            after the repair. Ask first whether they can work without it, or whether the manufacturer
            offers a service mode that allows testing on a locked handset; where that is not possible,
            an erased device costs you a restore and gives away nothing. Never hand over the account
            that controls your backups under any circumstances.
          </P>
          <P>
            Get an intake slip (<em>phiếu tiếp nhận</em>) with the IMEI, the reported fault and the
            agreed price on it, and photograph the phone&rsquo;s condition before you let go of it.
            If the shop works on Zalo, a written quote in a message counts and is worth having.
          </P>
          <P>
            On language: most repair shops run their customer contact through Zalo rather than the
            phone, which is a gift if your spoken Vietnamese is thin &mdash; a photo of the fault plus
            the model number gets a usable quote faster than any conversation, and you can translate
            at your own pace. Bringing the model number in writing removes the most common
            misunderstanding, because several generations share a name in casual speech.
          </P>
          <P>
            If the repair quote approaches the resale value of the handset, price the alternative
            before committing: what a working example of the same model is going for second-hand
            (there is a checklist in{' '}
            <HereLink href="/buying-a-used-iphone-vietnam">the used-iPhone guide</HereLink>) and what
            retailers are asking for current stock, which you can see on{' '}
            <HereLink href="/iphone-18-vietnam">the live iPhone 18 price page</HereLink>.
          </P>
        </>
      ),
    },
  ],
  faqs: [
    {
      q: 'Is my phone warranty valid in Vietnam if I bought the phone abroad?',
      a: 'Usually not. Apple’s limited warranty for iPhone is bound to the country of purchase, and most Android makers are the same, with a few offering international cover on flagship models only. An authorised centre in Vietnam will normally treat a foreign handset as out of warranty and quote you for a paid repair, so budget for it rather than assuming cover.',
    },
    {
      q: 'How long does a screen or battery replacement take in Vietnam?',
      a: 'As a rough range: an independent shop often does a screen or battery while you wait, in under two hours. An authorised service centre is same day to two or three days when the part is in stock, and a week or more when it has to be ordered or the device is sent on. Ask at intake whether the work is done on site or sent away — that answer is what sets the timeline.',
    },
    {
      q: 'Does replacing a screen at a third-party shop void the warranty?',
      a: 'On the device, yes. Opening the phone outside the authorised network and fitting a non-genuine display ends the manufacturer warranty on the whole handset, not just on the screen. On recent iPhones it is also permanent and self-documenting: the phone records an Unknown Part entry in Settings › General › About that cannot be cleared.',
    },
    {
      q: 'How can I tell if a repair shop used a genuine part?',
      a: 'On an iPhone, open Settings › General › About and read Parts and Service History — a genuine paired component says so, and anything else shows as Unknown Part. Then check True Tone is still available after a screen job, Battery Health shows a real percentage, and Face ID still works. On any brand, compare maximum brightness in sunlight and touch response at the very edges of the panel.',
    },
    {
      q: 'Is it safe to leave my phone at a repair shop in Vietnam?',
      a: 'Generally yes, and most shops are straightforward. Reduce the remaining risk the way locals do: back up first, turn off Find My yourself rather than sharing account credentials, get an intake slip listing the IMEI and the agreed price, photograph the phone’s condition, and use a shop with a fixed address you could return to.',
    },
    {
      q: 'Can I get a warranty repair in Vietnam without the receipt?',
      a: 'For a manufacturer warranty on a Vietnam-distributed handset, usually yes — cover is registered against the IMEI, so the centre looks it up rather than reading your paperwork. A shop warranty is the opposite: it is a contract with that specific shop and the slip is the contract, so losing it generally loses the cover.',
    },
    {
      q: 'What does "bảo hành 1 đổi 1" mean on a Vietnamese warranty slip?',
      a: 'It is a shop commitment to swap the device rather than repair it if a covered fault appears inside a stated window, commonly the first 30 days. It comes from the seller, not the manufacturer, so the detail matters: ask whether the replacement is a new sealed unit or an equivalent one, and get that answer written on the slip.',
    },
  ],
  related: phoneGuidesIn('en', SLUG).map((g) => ({ href: `/${g.slug}`, label: g.label, blurb: g.blurb })),
}

export const metadata: Metadata = {
  title: `Phone warranty and repair in Vietnam — who covers what | ${SITE_NAME}`,
  description:
    'Which warranty you actually hold in Vietnam, whether a phone bought abroad is covered, what authorised centres and independent shops each do well, typical turnaround, the repairs that void everything, and how to check a fitted part is genuine.',
  alternates: phoneGuideAlternates(SLUG),
}

export default function PhoneWarrantyRepairVietnamPage() {
  return <SeoArticle content={CONTENT} />
}
