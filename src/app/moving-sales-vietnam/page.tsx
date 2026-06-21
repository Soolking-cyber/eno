import type { Metadata } from 'next'
import { SeoLanding, type SeoContent } from '@/components/marketplace/seo-landing'

export const revalidate = 3600

export const metadata: Metadata = {
  title: 'Moving Sales & Secondhand Furniture in Vietnam | ENO Forum',
  description:
    'Shop expat moving sales in Vietnam — secondhand furniture, appliances and home goods in Ho Chi Minh City. Verified listings on ENO Forum, checked before they go live.',
  alternates: { canonical: '/moving-sales-vietnam' },
  openGraph: {
    title: 'Moving Sales & Secondhand Furniture in Vietnam | ENO Forum',
    description:
      'Expat moving sales — furniture, appliances and home goods at great prices, verified before they go live.',
  },
}

const CONTENT: SeoContent = {
  eyebrow: 'Moving Sales · Vietnam',
  h1: 'Moving Sales & Secondhand Furniture in Vietnam',
  intro:
    'Furnish your place for less. Expats and internationals leaving Vietnam sell quality furniture, appliances and home goods through moving sales — sofas, beds, fridges, washing machines, kitchenware and more, mostly in Ho Chi Minh City. Every ENO Forum listing is checked before it goes live, so the items and prices are real.',
  categorySlug: 'moving-sale',
  cta: 'Browse verified moving sales',
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
      body: 'Photos and prices are verified before a moving sale goes live, so you don’t waste a trip across town on an item that’s already gone or not as described.',
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
      q: 'Are listings genuine?',
      a: 'Every moving-sale listing is verified before it goes live, so the photos and prices reflect what’s actually available.',
    },
  ],
}

export default function Page() {
  return <SeoLanding content={CONTENT} />
}
