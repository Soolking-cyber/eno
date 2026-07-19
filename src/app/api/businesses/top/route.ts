import { NextResponse } from 'next/server'
import { topBusinessListings } from '@/lib/core/business-rail'

export const dynamic = 'force-dynamic'

// "Outstanding businesses" — rewards the highest-trust business storefronts by featuring
// ONE of each one's best listing (their most-viewed active product/service). Business
// accounts are included regardless of score; high-trust storefronts (Exceptional+, ≥110)
// fill in so the rail is populated before many businesses sign up. One card per seller,
// ordered by the seller's trust. Public-safe.
export async function GET() {
  const listings = await topBusinessListings()

  return NextResponse.json(
    { listings },
    { headers: { 'Cache-Control': 'public, max-age=120, s-maxage=300, stale-while-revalidate=900' } },
  )
}
