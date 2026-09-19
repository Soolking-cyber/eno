import type { Metadata } from 'next'
import { SITE_NAME } from '@/lib/edition'
import { phoneGuideAlternates, phoneGuidesIn } from '@/lib/phone-guides'
import { HereLink, P, SeoArticle, Ul, type ArticleContent } from '@/components/marketplace/seo-article'

/**
 * FOLDABLE PHONES IN VIETNAM — the English half; Vietnamese half at /dien-thoai-gap-nen-mua-loai-nao.
 *
 * ⛔ THE ADVICE IS DELIBERATELY CAUTIOUS AND SAYS SO. A first-generation folding phone is the one
 * product category where this site's readers can lose a lot of money to a failure mode nobody can
 * assess at launch, and the honest position — wait unless you can absorb the repair — is worth more
 * than a confident recommendation that ages badly. No durability claim is made in either direction,
 * because none can be made truthfully four days after a launch.
 */
const SLUG = 'foldable-phones-vietnam'

const CONTENT: ArticleContent = {
  eyebrow: 'Comparison',
  h1: 'Foldable phones in Vietnam: Apple’s first against Samsung’s seventh',
  intro:
    'Apple’s folding iPhone Duo goes on sale in Vietnam on 23 October 2026, arriving in a category Samsung has been iterating on since 2019. This guide covers what folding phones actually cost here, what fails on them, what a repair costs when it does, and the specific reasons to wait for a second generation rather than buy a first.',
  canonical: `/${SLUG}`,
  published: '2026-09-19',
  lang: 'en',
  alternate: { lang: 'vi', href: '/dien-thoai-gap-nen-mua-loai-nao' },
  sections: [
    {
      id: 'whats-available',
      title: 'What is actually available here',
      body: (
        <>
          <P>
            <strong>Book-style folds</strong> — a compact outer screen opening to a tablet-sized inner
            display — are the expensive end: Samsung&rsquo;s Galaxy Z Fold line, several Chinese
            makers, and now the iPhone Duo. <strong>Flip-style folds</strong> like the Galaxy Z Flip
            fold the other way, into a pocket square, and cost considerably less.
          </P>
          <P>
            The iPhone Duo is sold under that name rather than as an &ldquo;iPhone 18 Fold&rdquo;,
            though Vietnamese retailers write it both ways in their own listings. Pre-orders open at
            7pm on 16 October and deliveries begin on 23 October; its top storage tier is the first
            iPhone sold officially in Vietnam above 100 million đồng. Live retailer prices are on{' '}
            <HereLink href="/iphone-duo-vietnam">the iPhone Duo page</HereLink>.
          </P>
        </>
      ),
    },
    {
      id: 'what-fails',
      title: 'What fails on a folding phone',
      body: (
        <>
          <P>
            Three things, in rough order of how often they are reported across the category as a
            whole. ⚠️ None of this is a claim about any specific 2026 model — it is what the category
            has done since 2019, and it is the risk you are accepting when you buy into it.
          </P>
          <Ul>
            <li>
              <strong>The inner display.</strong> The folding layer is softer than glass and the
              crease region is the weak point. It is also the most expensive part on the phone.
            </li>
            <li>
              <strong>The hinge.</strong> Grit is the enemy, and Vietnam supplies plenty of it — dust,
              sand, and the rain that carries both. Early generations across the category struggled
              here; recent designs are considerably better sealed.
            </li>
            <li>
              <strong>The screen protector.</strong> The factory-fitted inner film is part of the
              display assembly, not an accessory. Peeling it off yourself damages the screen, and that
              is not covered by any warranty.
            </li>
          </Ul>
        </>
      ),
    },
    {
      id: 'repair-cost',
      title: 'The question to ask before you pay',
      body: (
        <>
          <P>
            Ask the retailer: <strong>what does an out-of-warranty inner-screen replacement cost, and
            can it be done in Vietnam or does the unit ship abroad?</strong> Get the answer before
            buying, not after. On a first-generation device the answer is often that it ships, which
            means weeks without the phone on top of the repair bill.
          </P>
          <P>
            Wear-related failure of a folding screen is generally not a warranty matter — warranties
            cover defects, and a crease that develops over a year of folding is argued as wear. This
            is the one phone category where the extended-cover product genuinely changes the
            arithmetic, and it is worth pricing alongside the handset rather than declining at the
            counter.
          </P>
        </>
      ),
    },
    {
      id: 'who-should-buy',
      title: 'Who should buy one, and who should wait',
      body: (
        <>
          <Ul>
            <li>
              <strong>Wait</strong> if replacing the phone would hurt. First-generation hardware in a
              category defined by mechanical wear is the textbook case for letting somebody else find
              the problems.
            </li>
            <li>
              <strong>Samsung is the lower-risk fold</strong> today purely on iteration count — seven
              generations of hinge and screen revisions, a domestic manufacturing presence, and
              official service centres that handle folds routinely. It also discounts hard a few
              months after each launch, which a launch-week Apple product does not.
            </li>
            <li>
              <strong>A flip is the cheaper way in.</strong> If the appeal is the form factor rather
              than the tablet screen, the flip style costs far less and carries the same novelty.
            </li>
            <li>
              <strong>Buy the Duo</strong> if you want it, can absorb a repair, and value the iOS
              ecosystem enough that a Samsung fold is not a substitute. That is a legitimate position
              — just make it knowingly.
            </li>
          </Ul>
        </>
      ),
    },
  ],
  faqs: [
    {
      q: 'When does the iPhone Duo go on sale in Vietnam?',
      a: 'Pre-orders open at 7pm on 16 October 2026 and deliveries begin on 23 October 2026. Listings before that date are pre-orders whatever the retailer’s page says, and its top storage tier is the first iPhone sold officially in Vietnam above 100 million đồng.',
    },
    {
      q: 'Are folding phones durable enough for daily use in Vietnam?',
      a: 'Recent generations are considerably better sealed than early ones, but the inner screen and hinge remain the parts that fail, and dust, sand and rain are all plentiful here. No honest durability claim can be made about a model that launched days ago — which is itself the argument for waiting.',
    },
    {
      q: 'How much does it cost to repair a folding screen?',
      a: 'It is the most expensive component on the phone and wear-related failure is generally not covered by warranty. Ask the retailer for the specific out-of-warranty figure and whether the repair happens in Vietnam or the unit ships abroad — on a first-generation device it often ships.',
    },
    {
      q: 'iPhone Duo or Samsung Galaxy Z Fold?',
      a: 'On engineering maturity alone, Samsung — it is seven generations into the same problem, manufactures in Vietnam, and discounts substantially a few months after launch. Choose the Duo if iOS matters enough that a Samsung is not a substitute and you can absorb a repair.',
    },
    {
      q: 'Can I remove the screen protector on a folding phone?',
      a: 'No. The inner film is part of the display assembly rather than an accessory, and peeling it off damages the screen — a failure no warranty covers. If it lifts at the edges, take it to a service centre rather than pulling it.',
    },
    {
      q: 'Is a flip phone cheaper than a fold?',
      a: 'Considerably. Flip-style models fold into a pocket square rather than opening to a tablet screen, and they sit well below book-style folds on price while offering the same novelty. If the large inner display is not the point for you, it is the cheaper way into the category.',
    },
  ],
  related: phoneGuidesIn('en', SLUG).map((g) => ({ href: `/${g.slug}`, label: g.label, blurb: g.blurb })),
}

export const metadata: Metadata = {
  title: `Foldable phones in Vietnam — iPhone Duo vs Galaxy Z Fold | ${SITE_NAME}`,
  description:
    'What folding phones cost in Vietnam, what actually fails on them, what an out-of-warranty screen repair means here, and the case for waiting for a second generation rather than buying a first.',
  alternates: phoneGuideAlternates(SLUG),
}

export default function FoldablePhonesVietnamPage() {
  return <SeoArticle content={CONTENT} />
}
