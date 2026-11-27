import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { ModelPriceHub, modelPriceHubMetadata } from '@/components/marketplace/model-price-page'

/** The Vietnamese hub of the model price pages (2026-11-27, src/lib/model-pages.ts); /price is its English twin. */
export const revalidate = 3600

type Props = { params: Promise<{ lang: string }> }

export async function generateMetadata(): Promise<Metadata> {
  return modelPriceHubMetadata('vi')
}

export default async function Page({ params }: Props) {
  // Only the pinned address renders here (lang-pinned.ts pins /gia to Vietnamese for everyone).
  if ((await params).lang !== 'vi') notFound()
  return <ModelPriceHub lang="vi" />
}
