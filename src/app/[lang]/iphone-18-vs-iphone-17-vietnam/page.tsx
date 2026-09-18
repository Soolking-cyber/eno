import type { Metadata } from 'next'
import { SITE_NAME } from '@/lib/edition'
import { phoneGuideAlternates, phoneGuidesIn } from '@/lib/phone-guides'
import { HereLink, P, SeoArticle, Ul, type ArticleContent } from '@/components/marketplace/seo-article'

/**
 * iPHONE 18 VS iPHONE 17 — the English half; Vietnamese half at /co-nen-len-doi-iphone-18.
 *
 * ⛔ IT DOES NOT PRINT PRICES. The live figures belong on /iphone-18-vietnam, which reads them from
 * the marketplace's own listings hourly; a number typed into an evergreen article goes stale in
 * weeks and this repo has already paid for a stale price once. The article links there instead and
 * talks about the things that do not move — what changed, who should care, and how the upgrade
 * economics work in a market with a deep second-hand tier.
 */
const SLUG = 'iphone-18-vs-iphone-17-vietnam'

const CONTENT: ArticleContent = {
  eyebrow: 'Comparison',
  h1: 'iPhone 18 vs iPhone 17: is the upgrade worth it in Vietnam?',
  intro:
    'The honest answer for most people holding a 17 Pro is no, and the interesting question is what to do instead. Vietnam has an unusually deep second-hand market, which changes the maths: the cost of upgrading is not the new phone’s price, it is the gap between that and what your current handset will fetch this month.',
  canonical: `/${SLUG}`,
  published: '2026-09-19',
  lang: 'en',
  alternate: { lang: 'vi', href: '/co-nen-len-doi-iphone-18' },
  sections: [
    {
      id: 'what-changed',
      title: 'What actually changed',
      body: (
        <>
          <P>
            Apple split its 2026 year in two. The iPhone 18 Pro and Pro Max were announced on 9
            September and reached Vietnamese buyers on 18 September; the folding iPhone Duo followed,
            on sale from 23 October. There is no plain iPhone 18 this autumn — the non-Pro models moved
            to a spring release — so &ldquo;iPhone 18&rdquo; in a Vietnamese shop today means a Pro or
            a Pro Max.
          </P>
          <P>
            Against the 17 Pro the changes are the ordinary one-generation set: a faster chip, camera
            processing improvements, display and battery refinements. Real, measurable, and not the
            kind of jump that makes a two-year-old phone feel obsolete. If your 17 Pro does what you
            need, it will keep doing it for years — Apple supports its phones far longer than the
            upgrade cycle suggests.
          </P>
        </>
      ),
    },
    {
      id: 'the-real-cost',
      title: 'The real cost of upgrading here',
      body: (
        <>
          <P>
            Work it out as a subtraction, not an addition. The 17 Pro line still sells strongly
            second-hand in Vietnam and a clean, boxed VN/A unit with good battery health holds value
            noticeably better than an imported one. Get a realistic sale figure for your handset
            first, subtract it from the new price, and judge the upgrade on that number.
          </P>
          <Ul>
            <li>Sell privately for the most money and the most effort; a trade-in at a chain is faster and pays less.</li>
            <li>Battery health above 90% and the original box measurably raise what a private buyer will pay.</li>
            <li>Sell sooner rather than later — the steepest depreciation on the outgoing flagship happens in the weeks right after a launch.</li>
          </Ul>
        </>
      ),
    },
    {
      id: 'who-should-upgrade',
      title: 'Who should actually upgrade',
      body: (
        <>
          <P>
            <strong>Worth it:</strong> coming from an iPhone 15 or older, where three generations of
            camera, battery and brightness improvements compound into a phone that feels genuinely
            different. Also worth it if you shoot video for work, where the encoding and storage
            changes earn their keep.
          </P>
          <P>
            <strong>Not worth it:</strong> coming from a 17 Pro, unless you are selling it promptly
            into a strong second-hand market and the net cost is small. A one-generation step is the
            textbook case for skipping.
          </P>
          <P>
            <strong>Worth considering instead:</strong> the 17 Pro itself, bought now. It is the
            single best value in the Vietnamese market in the weeks after a launch — the outgoing
            flagship, heavily discounted new and plentiful second-hand, with years of software support
            ahead of it.
          </P>
        </>
      ),
    },
    {
      id: 'storage-and-variant',
      title: 'If you do upgrade: which variant',
      body: (
        <>
          <P>
            The Pro and Pro Max share a chip and a camera system; the difference is size and the
            battery behind it, at roughly 3 million đồng per storage tier. In Vietnam the deciding
            factor is usually the commute — a 6.9-inch phone is a liability on a motorbike and the
            6.3-inch Pro is easier to live with, while the Pro Max wins a long day of navigation and
            video.
          </P>
          <P>
            On storage, 256GB suits most people using iCloud, and the jump to 2TB roughly doubles the
            price here. There is no card slot, so the decision is permanent — but it is also the tier
            that holds resale value best, which argues against over-buying.
          </P>
          <P>
            Live prices for every variant are on{' '}
            <HereLink href="/iphone-18-vietnam">the iPhone 18 price page</HereLink>, with{' '}
            <HereLink href="/iphone-18-pro-vietnam">the Pro</HereLink> and{' '}
            <HereLink href="/iphone-18-pro-max-vietnam">the Pro Max</HereLink> broken out by tier.
          </P>
        </>
      ),
    },
  ],
  faqs: [
    {
      q: 'Is the iPhone 18 Pro worth upgrading to from the 17 Pro?',
      a: 'For most people, no. It is a one-generation step — a faster chip, better camera processing, display and battery refinements — and the 17 Pro remains an excellent phone with years of support left. The case improves if you can sell the 17 Pro quickly, because the net cost is what matters.',
    },
    {
      q: 'Is there a normal iPhone 18 without the Pro?',
      a: 'Not this autumn. Apple moved the non-Pro models to a spring release, so the plain iPhone 18, an 18e and a second iPhone Air are expected in the first half of 2027. Anything sold as an “iPhone 18” in Vietnam today is a Pro or a Pro Max.',
    },
    {
      q: 'Should I buy the iPhone 17 Pro instead now that it is cheaper?',
      a: 'It is often the smartest buy in the Vietnamese market. The outgoing flagship is discounted new, plentiful second-hand, and has years of iOS support ahead of it — the difference in daily use against the 18 Pro is small for most people.',
    },
    {
      q: 'How much will my iPhone 17 Pro sell for in Vietnam?',
      a: 'It depends on condition, battery health, whether it is a VN/A unit and whether you have the box — and it falls fastest in the weeks right after a new launch. Check current listings for your exact model and storage rather than relying on a general figure, and sell sooner rather than later.',
    },
    {
      q: 'iPhone 18 Pro or Pro Max?',
      a: 'They share a chip, cameras and storage tiers, so it is a choice about size and battery. The 6.3-inch Pro is easier one-handed and on a motorbike; the 6.9-inch Pro Max lasts longer on a heavy day of navigation and video and costs roughly 3 million đồng more per tier.',
    },
    {
      q: 'How long will the iPhone 17 keep getting updates?',
      a: 'Apple has historically supported iPhones with major iOS releases for five to six years from launch, plus security updates beyond that. A 17 Pro bought today has most of that window ahead of it.',
    },
  ],
  related: phoneGuidesIn('en', SLUG).map((g) => ({ href: `/${g.slug}`, label: g.label, blurb: g.blurb })),
}

export const metadata: Metadata = {
  title: `iPhone 18 vs iPhone 17 in Vietnam — worth the upgrade? | ${SITE_NAME}`,
  description:
    'What actually changed between the iPhone 18 Pro and the 17 Pro, how to work out the real cost of upgrading in a market with a deep second-hand tier, who should skip it, and why the outgoing flagship is often the smarter buy.',
  alternates: phoneGuideAlternates(SLUG),
}

export default function IPhone18VsIPhone17VietnamPage() {
  return <SeoArticle content={CONTENT} />
}
