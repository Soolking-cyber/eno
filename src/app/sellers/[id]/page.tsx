import { notFound, redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { loadSeller, SellerStorefront } from '@/components/marketplace/seller-storefront'

type Props = { params: Promise<{ id: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params
  const seller = await loadSeller(id)
  // Call notFound() HERE (in generateMetadata, before any streaming/Suspense
  // boundary) so a missing seller returns a real HTTP 404 — not a soft-404 (200
  // with the not-found UI) that the root loading.tsx boundary would otherwise cause.
  if (!seller) notFound()
  const hostUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://eno.vn'
  return {
    title: `${seller.name} | eno.vn`,
    description: `${seller.name} — ${seller.reviewCount} reviews · ${seller.rating.toFixed(1)}★`,
    // The public @handle URL is canonical; the /sellers/<id> URL points at it.
    alternates: seller.handle ? { canonical: `${hostUrl}/${seller.handle.handle}` } : undefined,
  }
}

export default async function SellerPage({ params }: Props) {
  const { id } = await params
  const seller = await loadSeller(id)
  if (!seller) notFound()
  // A storefront's shareable identity is its handle (eno.vn/<name>). Redirect the
  // legacy id URL there so the clean handle is what shows in the address bar and
  // gets shared. Handleless (guest/seed) storefronts still render here directly.
  if (seller.handle) redirect(`/${seller.handle.handle}`)
  return <SellerStorefront id={id} />
}
