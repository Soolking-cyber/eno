import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { ModelPricePage, modelPriceMetadata } from '@/components/marketplace/model-price-page'

/** A model's price page in English (src/lib/model-pages.ts); /gia/<slug> is its Vietnamese twin. */
export const revalidate = 3600

export function generateStaticParams() {
  return []
}

type Props = { params: Promise<{ lang: string; slug: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return modelPriceMetadata((await params).slug, 'en')
}

export default async function Page({ params }: Props) {
  const { lang, slug } = await params
  // Only the pinned address renders here (lang-pinned.ts); a path that negotiated (`/price/Apple-X`) is not a model page.
  if (lang !== 'en') notFound()
  return <ModelPricePage slug={slug} lang="en" />
}
