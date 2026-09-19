import type { Metadata } from 'next'
import { SITE_NAME } from '@/lib/edition'
import { phoneGuideAlternates, phoneGuidesIn } from '@/lib/phone-guides'
import { HereLink, P, SeoArticle, Ul, type ArticleContent } from '@/components/marketplace/seo-article'

/**
 * CHÍNH HÃNG VS XÁCH TAY — the English half. The Vietnamese half is /iphone-chinh-hang-va-xach-tay.
 *
 * ⚠️ THE TERMS ARE KEPT IN VIETNAMESE ON PURPOSE. "chính hãng" and "xách tay" are what every shop
 * sign, every listing and every conversation actually says; translating them to "genuine" and
 * "hand-carried" would teach a reader words nobody here uses, and the page exists to make a
 * shopfront legible.
 */
const SLUG = 'chinh-hang-vs-xach-tay-vietnam'

const CONTENT: ArticleContent = {
  eyebrow: 'Buying guide',
  h1: 'Chính hãng VN/A vs xách tay: what the difference actually costs you',
  intro:
    'Two identical phones sit on the same shelf in Vietnam with a few million đồng between them. The hardware is the same; what differs is who is obliged to fix it. This guide explains the model-number suffixes, who honours which warranty, how to verify a claim in ten seconds, and the cases where the cheaper imported unit is genuinely the better buy.',
  canonical: `/${SLUG}`,
  published: '2026-09-19',
  lang: 'en',
  alternate: { lang: 'vi', href: '/iphone-chinh-hang-va-xach-tay' },
  sections: [
    {
      id: 'what-the-words-mean',
      title: 'What the two words mean',
      body: (
        <>
          <P>
            <strong>Chính hãng</strong> means officially distributed — a handset Apple Vietnam (or
            Samsung Vietnam, or Xiaomi Vietnam) imported, paid duty on, and stands behind. For iPhones
            the marker is the model-number suffix <code>VN/A</code>. The warranty is the
            manufacturer&rsquo;s, runs 12 months, and is honoured at any authorised service centre in
            the country regardless of which shop sold it.
          </P>
          <P>
            <strong>Xách tay</strong> literally means &ldquo;hand-carried&rdquo;: a handset bought
            abroad and brought in outside the official channel. It is entirely legal to buy and sell,
            it is the same factory hardware, and it is usually cheaper because it skips the
            distributor&rsquo;s margin and sometimes the duty. The warranty is the shop&rsquo;s own.
          </P>
          <P>
            The suffix tells you where a unit was destined: <code>LL/A</code> United States,{' '}
            <code>ZA/A</code> Singapore, <code>J/A</code> Japan, <code>ZP/A</code> Hong Kong,{' '}
            <code>KH/A</code> Korea. None of these is fake. They are simply not Apple Vietnam&rsquo;s
            problem when something fails.
          </P>
        </>
      ),
    },
    {
      id: 'what-actually-differs',
      title: 'What actually differs between them — and what does not',
      body: (
        <>
          <P>
            The chip, the camera, the screen and the build are identical. A VN/A iPhone is not a
            better phone. The real differences are narrower than the folklore suggests, and there are
            four of them.
          </P>
          <Ul>
            <li>
              <strong>Who repairs it.</strong> VN/A: any authorised service centre, free within
              warranty. Xách tay: the shop that sold it, on its own terms, usually 6&ndash;12 months
              and often &ldquo;1-for-1 exchange in the first month, repair after that&rdquo;.
            </li>
            <li>
              <strong>The invoice.</strong> VN/A comes with a red VAT invoice as a matter of course.
              Import shops frequently cannot issue one, which matters for company purchases and for
              the airport VAT refund.
            </li>
            <li>
              <strong>Resale.</strong> A VN/A unit sells faster and for more on the Vietnamese
              second-hand market, because the next buyer is making this same calculation. Budget a
              meaningful part of the price gap back at resale.
            </li>
            <li>
              <strong>Some Japanese units.</strong> <code>J/A</code> iPhones have a camera shutter
              sound that cannot be turned off, a regulatory requirement there. It is a small thing
              that annoys people daily.
            </li>
          </Ul>
          <P>
            What does <em>not</em> differ: network compatibility (all of them work on Viettel,
            VinaPhone, MobiFone and Vietnamobile), software updates, App Store access, or eSIM support
            on models that have it.
          </P>
        </>
      ),
    },
    {
      id: 'verify-in-ten-seconds',
      title: 'How to verify the claim in ten seconds',
      body: (
        <>
          <P>
            Do not rely on the sign, the listing or the salesperson. Open{' '}
            <strong>Settings › General › About</strong> and read the <strong>Model Number</strong>{' '}
            line. It is written at manufacture and no shop can change it. Then cross-check the IMEI
            shown on the phone against the box and against Apple&rsquo;s own coverage-check page,
            which also tells you the warranty expiry — the single most useful number when you are
            being told a unit is &ldquo;new&rdquo;.
          </P>
          <P>
            If the coverage page says the warranty started four months ago, the handset is not new
            whatever the box looks like. That is the check that catches a máy trưng bày (a display
            unit) being sold at a sealed-unit price.
          </P>
        </>
      ),
    },
    {
      id: 'when-to-buy-which',
      title: 'When the cheaper import is the right call',
      body: (
        <>
          <P>
            The honest answer is that it depends on how long you are staying and how much the risk
            costs you if it lands.
          </P>
          <Ul>
            <li>
              <strong>Buy VN/A</strong> if you are here more than a year, if the phone is for work, if
              you need the invoice, or if you would struggle to be without the handset for the weeks a
              non-warranty repair can take.
            </li>
            <li>
              <strong>An import is reasonable</strong> if you are visiting for a few months, the
              saving is material to you, and the shop has a physical address you could return to. Ask
              for the warranty terms in writing before paying.
            </li>
            <li>
              <strong>Avoid a locked unit</strong> — a máy lock is carrier-locked abroad and needs a
              SIM adapter or works with one network only. The discount is large and the ongoing
              annoyance is larger.
            </li>
          </Ul>
          <P>
            Current retailer prices for the newest models, VN/A and otherwise, are on{' '}
            <HereLink href="/iphone-18-vietnam">the iPhone 18 price page</HereLink>.
          </P>
        </>
      ),
    },
  ],
  faqs: [
    {
      q: 'Is xách tay the same as fake?',
      a: 'No. Xách tay handsets are genuine factory units brought in outside the official distribution channel — same hardware, same software. What they lack is the manufacturer’s Vietnamese warranty; the shop that sold it warrants it instead. Counterfeit phones are a separate problem and are rare at reputable shops.',
    },
    {
      q: 'How do I check if my iPhone is VN/A?',
      a: 'Settings › General › About, and read the Model Number. A unit distributed by Apple Vietnam ends in VN/A. LL/A is American, ZA/A Singaporean, J/A Japanese, ZP/A Hong Kong. The value is set at manufacture and cannot be edited by a seller.',
    },
    {
      q: 'Does a xách tay iPhone work on Vietnamese networks?',
      a: 'Yes, provided it is an unlocked international unit. All four Vietnamese networks are supported, including eSIM on models that have it. Two exceptions: a carrier-locked máy lock needs a SIM adapter or is tied to one network, and some mainland-China market variants ship without eSIM hardware at all.',
    },
    {
      q: 'How much cheaper is xách tay?',
      a: 'Typically a few million đồng on a current flagship, narrowing as official retailers discount through the launch quarter. On older models the gap can close entirely, which is worth checking before accepting the trade-off.',
    },
    {
      q: 'Can I get Apple warranty service in Vietnam on a phone bought abroad?',
      a: 'Apple’s limited warranty is generally honoured only in the country of purchase for iPhones, so an authorised centre here will usually decline a US or Singapore unit. That is the practical meaning of the price gap, and it is why the shop’s own warranty terms matter so much on an import.',
    },
    {
      q: 'Is it worth paying more for VN/A if I only stay six months?',
      a: 'Often not, if the saving is material to you and the import shop is established. The calculation changes if the phone is essential to your work, because a non-warranty repair here can take weeks and the replacement cost is yours.',
    },
  ],
  related: phoneGuidesIn('en', SLUG).map((g) => ({ href: `/${g.slug}`, label: g.label, blurb: g.blurb })),
}

export const metadata: Metadata = {
  title: `Chính hãng VN/A vs xách tay — what the price gap really buys | ${SITE_NAME}`,
  description:
    'VN/A, LL/A, ZA/A and J/A explained: who honours the warranty on each, how to verify a model number in ten seconds, what genuinely differs between an official and an imported handset, and when the cheaper import is the right buy.',
  alternates: phoneGuideAlternates(SLUG),
}

export default function ChinhHangVsXachTayPage() {
  return <SeoArticle content={CONTENT} />
}
