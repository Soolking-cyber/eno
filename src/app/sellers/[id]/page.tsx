import { notFound, redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { loadSeller, SellerStorefront } from '@/components/marketplace/seller-storefront'

// Per-request render, like the canonical [handle] storefront (which is force-dynamic
// on purpose). Without this the page was STATICALLY cached — no dynamic API in scope,
// so Next froze the first render and profile edits (name/avatar/bio, presence) never
// showed on handleless storefronts, which are exactly the ones served here
// (handle-owners get redirected below). Owner-reported 2026-07-23.
export const dynamic = 'force-dynamic'

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
