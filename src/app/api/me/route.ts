import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentProfile } from '@/lib/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Lightweight identity for the account dropdown: who am I + do I own a storefront.
export async function GET() {
  const profile = await getCurrentProfile()
  if (!profile) return NextResponse.json({ user: null })
  const seller = await db.seller.findUnique({ where: { ownerId: profile.id }, select: { id: true } })
  return NextResponse.json({
    user: {
      displayName: profile.displayName,
      email: profile.email,
      avatarUrl: profile.avatarUrl,
      avatarColor: profile.avatarColor,
      accountType: profile.accountType ?? null,
      sellerId: seller?.id ?? null,
    },
  })
}
