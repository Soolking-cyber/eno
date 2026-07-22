import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentProfile } from '@/lib/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Lightweight identity for the account dropdown: who am I + do I own a storefront.
export async function GET() {
  const profile = await getCurrentProfile()
  if (!profile) return NextResponse.json({ user: null })
  const seller = await db.seller.findUnique({ where: { ownerId: profile.id }, select: { id: true, name: true, phone: true } })
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
      // Storefront contact for "post as" prefill.
      seller: seller ? { name: seller.name, phone: seller.phone } : null,
    },
  })
}
