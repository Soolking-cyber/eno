import type { Metadata } from 'next'
import { SITE_NAME } from '@/lib/edition'
import { phoneGuideAlternates, phoneGuidesIn } from '@/lib/phone-guides'
import { HereLink, P, SeoArticle, Ul, type ArticleContent } from '@/components/marketplace/seo-article'

/**
 * iPHONE OR SAMSUNG IN VIETNAM — the English half; Vietnamese half at /nen-mua-iphone-hay-samsung.
 *
 * ⛔ IT REFUSES THE SPEC-SHEET COMPARISON, deliberately. Every publication on earth has written
 * "iPhone vs Samsung" from a spec table, and none of it helps someone standing in a shop in Hồ Chí
 * Minh City, because the specs are the same everywhere and the things that differ are local:
 * resale, repair availability, what the local price actually is, and the fact that Samsung
 * manufactures here. That is the whole reason this page can be useful rather than a duplicate.
 */
const SLUG = 'iphone-vs-samsung-vietnam'

const CONTENT: ArticleContent = {
  eyebrow: 'Comparison',
  h1: 'iPhone or Samsung in Vietnam: the three things that decide it locally',
  intro:
    'The spec comparison is the same in every country and is not why this is a hard choice. What differs in Vietnam is resale value, where you can get the phone repaired, and how much each brand actually costs here — including the fact that Samsung builds a large share of its phones in this country. Those three settle it for most buyers.',
  canonical: `/${SLUG}`,
  published: '2026-09-19',
  lang: 'en',
  alternate: { lang: 'vi', href: '/nen-mua-iphone-hay-samsung' },
  sections: [
    {
      id: 'resale',
      title: '1. Resale: the difference that compounds',
      body: (
        <>
          <P>
            iPhones hold their value better in Vietnam than any Android, and the gap is wider here
            than in most markets because the second-hand tier is so active. A two-year-old iPhone has
            a reliable price and a deep pool of buyers; a two-year-old Android flagship sells more
            slowly and for a smaller share of what it cost.
          </P>
          <P>
            That changes the real cost of ownership, not just the exit. If you replace your phone
            every two or three years, the iPhone&rsquo;s higher purchase price is partly refunded
            later, while the Android&rsquo;s lower price is partly an illusion. If you keep a phone
            until it dies, this argument does not apply to you at all — and a Samsung mid-range is
            then genuinely the cheaper way to live.
          </P>
        </>
      ),
    },
    {
      id: 'repair',
      title: '2. Repair and parts',
      body: (
        <>
          <P>
            Both brands are well served in the big cities, and this is not a reason to avoid either.
            The difference shows up at the edges: independent repair for iPhones is everywhere,
            including small shops in every district, because the parts supply is enormous. Samsung has
            official service centres and a strong network of its own, and being a domestic
            manufacturer helps parts availability for current models.
          </P>
          <P>
            The practical question is which model you buy rather than which brand. A current flagship
            from either is easy to fix; an obscure mid-range Android or a US-market iPhone variant is
            where you start waiting for parts.
          </P>
        </>
      ),
    },
    {
      id: 'price',
      title: '3. What each actually costs here',
      body: (
        <>
          <P>
            Samsung assembles a significant share of its global output in Vietnam, and its local
            pricing reflects a domestic presence: promotions are aggressive, mid-range models are
            strong value, and discounting through the year is deeper than Apple&rsquo;s. Apple has no
            Vietnamese manufacturing and its pricing is closer to recommended retail for longer after
            launch.
          </P>
          <P>
            At the very top of the range the two converge — a folding Samsung and a folding iPhone are
            both expensive. Below that, Samsung covers price points Apple simply does not compete at,
            which is why the honest recommendation for a tight budget is almost always Android.
          </P>
        </>
      ),
    },
    {
      id: 'which-to-buy',
      title: 'So which should you buy',
      body: (
        <>
          <Ul>
            <li>
              <strong>Replacing every 2&ndash;3 years, budget for a flagship:</strong> iPhone, on
              resale economics alone.
            </li>
            <li>
              <strong>Keeping the phone until it dies:</strong> Samsung, and probably a mid-range one.
              You will never realise the iPhone&rsquo;s resale premium, so you are just paying more.
            </li>
            <li>
              <strong>Already deep in one ecosystem</strong> — watch, earbuds, laptop, family sharing
              — stay. The switching cost is real and neither phone is better enough to justify it.
            </li>
            <li>
              <strong>Want a folding phone:</strong> Samsung is several generations in and discounts
              hard a few months after launch; Apple&rsquo;s is first-generation. See{' '}
              <HereLink href="/foldable-phones-vietnam">the foldables guide</HereLink>.
            </li>
          </Ul>
          <P>
            Whichever you choose, the VN/A-versus-import question applies to both brands — the
            warranty logic is identical, and it is covered in{' '}
            <HereLink href="/chinh-hang-vs-xach-tay-vietnam">the chính hãng guide</HereLink>.
          </P>
        </>
      ),
    },
  ],
  faqs: [
    {
      q: 'Which holds its value better in Vietnam, iPhone or Samsung?',
      a: 'iPhone, clearly, and by a wider margin than in most markets because the second-hand tier here is so deep. A two-year-old iPhone sells quickly at a predictable price; an Android flagship of the same age sells more slowly for a smaller share of its original cost.',
    },
    {
      q: 'Is Samsung cheaper in Vietnam because it is made here?',
      a: 'Samsung manufactures a large share of its global output in Vietnam and its local pricing and promotions are notably aggressive, particularly in the mid-range. That is a real advantage at most price points, though the two brands converge at the very top of the range.',
    },
    {
      q: 'Which is easier to repair in Vietnam?',
      a: 'Both are well covered in the major cities. iPhone parts and independent repair shops are everywhere; Samsung has strong official service plus good parts availability as a domestic manufacturer. The bigger factor is the specific model — a current flagship from either is easy, an obscure variant is not.',
    },
    {
      q: 'Should I switch from Android to iPhone in Vietnam?',
      a: 'Only if you were going to anyway. The switching cost — apps, watch, earbuds, family sharing — is real, and neither platform is enough better to justify it on its own. The local arguments are about resale and price, not about which phone is superior.',
    },
    {
      q: 'What is the best value phone in Vietnam?',
      a: 'For most budgets, a Samsung or Xiaomi mid-range bought new with a full local warranty, or a previous-generation flagship from either brand in the weeks after a launch. The outgoing flagship is consistently the best value moment in this market.',
    },
  ],
  related: phoneGuidesIn('en', SLUG).map((g) => ({ href: `/${g.slug}`, label: g.label, blurb: g.blurb })),
}

export const metadata: Metadata = {
  title: `iPhone or Samsung in Vietnam — resale, repair and real prices | ${SITE_NAME}`,
  description:
    'Not another spec sheet: the three things that actually decide iPhone versus Samsung in Vietnam — how much each holds its value in a deep second-hand market, where you can get it repaired, and what each really costs in a country where Samsung manufactures.',
  alternates: phoneGuideAlternates(SLUG),
}

export default function IPhoneVsSamsungVietnamPage() {
  return <SeoArticle content={CONTENT} />
}
