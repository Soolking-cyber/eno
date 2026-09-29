import { SITE_NAME } from '@/lib/edition'
import { notFound, redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { loadSeller, SellerStorefront, storefrontMetaDescription } from '@/components/marketplace/seller-storefront'
import { storefrontCanonical } from '@/lib/storefront'

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
    title: `${seller.name} | ${SITE_NAME}`,
    /**
     * ⚠️ THE SAME COMPOSITION AS `/<handle>` (src/lib/storefront-description.ts). This used to be
     * `${name} — ${reviewCount} reviews · ${rating}★`, and `Seller.rating` defaults to 5, so an
     * importer nobody had reviewed was described as "Nhatot.com — 0 reviews · 5.0★".
     */
    description: (await storefrontMetaDescription(id)) ?? `${seller.name} on ${SITE_NAME}`,
    /**
     * The handle's canonical is this page's canonical — `storefrontCanonical`, the one answer the
     * handle page, Share and pages.xml give (the subdomain when it serves the shop, else the path), so
     * this is never a canonical that points at a page which canonicalises somewhere else.
     * ⚠️ AND A HANDLE-LESS SELLER SELF-CANONICALISES rather than declaring nothing. `undefined` left
     * this page with no canonical at all — and it is `force-dynamic`, reachable by id, and submitted
     * to the sitemap under exactly this shape, so the only signal Google had for which URL to keep was
     * its own guess (astra). Handle-less storefronts are the minority, but they are the ones with no
     * second URL to inherit a canonical from.
     */
    alternates: { canonical: seller.handle ? await storefrontCanonical(seller.handle.handle, hostUrl) : `${hostUrl}/sellers/${id}` },
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
