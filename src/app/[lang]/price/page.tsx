import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { ModelPriceHub, modelPriceHubMetadata } from '@/components/marketplace/model-price-page'

/** The English hub of the model price pages (2026-11-27, src/lib/model-pages.ts); /gia is its Vietnamese twin. */
export const revalidate = 3600

type Props = { params: Promise<{ lang: string }> }

export async function generateMetadata(): Promise<Metadata> {
  return modelPriceHubMetadata('en')
}

export default async function Page({ params }: Props) {
  // Only the pinned address renders here (lang-pinned.ts pins /price to English for everyone).
  if ((await params).lang !== 'en') notFound()
  return <ModelPriceHub lang="en" />
}
