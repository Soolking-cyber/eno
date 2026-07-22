import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentProfile } from '@/lib/admin'
import { getVisaShopSeller } from '@/lib/visa-shop'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Lightweight identity for the account dropdown: who am I + do I own a storefront.
export async function GET() {
  const profile = await getCurrentProfile()
  if (!profile) return NextResponse.json({ user: null })
  const seller = await db.seller.findUnique({ where: { ownerId: profile.id }, select: { id: true, name: true, phone: true } })
  // Am I the e-Visa storefront? The post wizard needs this to compose in USD instead of ₫
  // (listingMoneyFor), and it has to be answered HERE: the client must never learn the
  // shop's address and compare it itself — an email is guessable, so a client-side test
  // would let any account paint the dollar UI on a listing the server then stores in ₫.
  //
  // Same comparison the write path makes (storedMoneyFor in @/lib/core/listings.ts:
  // `getVisaShopSeller()?.id === sellerId`), against the same DB-resolved storefront, so
  // the compose view and the stored row cannot disagree. getVisaShopSeller() swallows its
  // own errors and answers null → false → ₫, which is the safe direction: a visa product
  // priced in ₫ is refused at checkout, a ₫ listing painted as USD would advertise 25 000×.
  //
  // Short-circuited on `seller`: the storefront IS a Seller row, so an account without one
  // cannot be it, and the vast majority of /api/me callers (buyers) pay no extra query.
  const visaShopOwner = !!seller && (await getVisaShopSeller())?.id === seller.id
  // Public @handles (user + shop) for the settings editors and share UI.
  const handles = await db.handle.findMany({
    where: { OR: [{ profileId: profile.id }, ...(seller ? [{ sellerId: seller.id }] : [])] },
    select: { handle: true, profileId: true },
  })
  const handle = handles.find((h) => h.profileId)?.handle ?? null
  const shopHandle = handles.find((h) => !h.profileId)?.handle ?? null
  return NextResponse.json({
    user: {
      displayName: profile.displayName,
      email: profile.email,
      phone: profile.phone ?? null,
      avatarUrl: profile.avatarUrl,
      avatarColor: profile.avatarColor,
      // Own trust standing for the native Account card (#45/#114).
      trustScore: profile.trustScore,
      trustTier: profile.trustTier,
      accountType: profile.accountType ?? null,
      businessName: profile.businessName ?? null,
      handle,
      shopHandle,
      sellerId: seller?.id ?? null,
      // True only for the account that owns the e-Visa storefront — the compose
      // currency switch (see above). A boolean, never the shop's identity.
      visaShopOwner,
      // Storefront contact for "post as" prefill.
      seller: seller ? { name: seller.name, phone: seller.phone } : null,
    },
  })
}
