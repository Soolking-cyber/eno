import { SITE_NAME } from '@/lib/edition'
import type { Metadata } from 'next'
import { SeoLanding, type SeoContent } from '@/components/marketplace/seo-landing'

// 1h, not 7d. The copy IS static, but the page also renders a LIVE 8-listing rail and an
// "inventory is empty" branch — so at weekly regeneration a category that filled on Monday kept
// telling visitors "this part of the marketplace is just getting started" until the following
// Monday. One page per hour is a rounding error against the feed's own traffic; a week of wrong
// copy on the pages built to convert search traffic is not (astra).
export const revalidate = 3600

export const metadata: Metadata = {
  title: `Moving Sales & Secondhand Furniture in Vietnam | ${SITE_NAME}`,
  description:
    'Shop expat moving sales in Vietnam — secondhand furniture, appliances and home goods in Ho Chi Minh City. Every eno.vn seller has a public trust score and bad listings get reported.',
  alternates: { canonical: '/moving-sales-vietnam' },
  openGraph: {
    title: `Moving Sales & Secondhand Furniture in Vietnam | ${SITE_NAME}`,
    description:
      'Expat moving sales — furniture, appliances and home goods at great prices, with fewer fake photos and bait prices.',
  },
}

const CONTENT: SeoContent = {
  eyebrow: 'Moving Sales · Vietnam',
  h1: 'Moving Sales & Secondhand Furniture in Vietnam',
  intro:
    'Furnish your place for less. Expats and internationals leaving Vietnam sell quality furniture, appliances and home goods through moving sales — sofas, beds, fridges, washing machines, kitchenware and more, mostly in Ho Chi Minh City. Every eno.vn seller has a public trust score and bad listings get reported, so the items and prices are real.',
  categorySlug: 'moving-sale',
  cta: 'Browse moving sales',
  sections: [
    {
      title: 'What people sell',
      body: 'Sofas, dining sets, beds and wardrobes; fridges, washing machines, air conditioners and microwaves; plus TVs, kitchenware, plants and décor. Great quality at a fraction of retail because sellers need to clear out before they fly.',
    },
    {
      title: 'Move-out friendly',
      body: 'Many listings are available for pickup on a set date, and sellers are often happy to bundle multiple items. Message the seller in-app to arrange viewing and pickup.',
    },
    {
      title: 'Buy without the guesswork',
      body: 'Every seller has a public trust score and buyers can report bad listings, so misleading photos and prices get caught and penalized — and you don’t waste a trip across town on an item that’s already gone or not as described.',
    },
  ],
  faqs: [
    {
      q: 'What can I buy at expat moving sales?',
      a: 'Furniture, large and small appliances, kitchenware, electronics and home décor — usually well-kept and priced to sell quickly.',
    },
    {
      q: 'Can I arrange pickup?',
      a: 'Yes. Message the seller in-app to confirm the item, agree a price and arrange a pickup date — many will bundle several items together.',
    },
    {
      q: 'How does eno.vn keep listings genuine?',
      a: 'Every moving-sale seller has a public trust score and buyers can report bad listings, so misleading photos and prices get caught and penalized and reflect what’s actually available.',
    },
  ],
}

export default function Page() {
  return <SeoLanding content={CONTENT} />
}
