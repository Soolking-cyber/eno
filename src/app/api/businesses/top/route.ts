import { NextResponse } from 'next/server'
import { topBusinessListings } from '@/lib/core/business-rail'
import { route } from '@/lib/api/handler'

export const dynamic = 'force-dynamic'

// "Outstanding businesses" — rewards the highest-trust business storefronts by featuring
// ONE of each one's best listing (their most-viewed active product/service). Business
// accounts are included regardless of score; high-trust storefronts (Exceptional+, ≥110)
// fill in so the rail is populated before many businesses sign up. One card per seller,
// ordered by the seller's trust. Public-safe.
//
// ⚠️ WS6 MIGRATION. `auth: 'public'` — the rail renders for guests on the home page; `'userId'` here
// would 401 every anonymous visitor. Nothing else to hand over: no rate limit, no body.
//
// ⚠️ ACCEPTED WIRE CHANGE, FAILURE PATH ONLY. `topBusinessListings()` (a seller findMany plus a
// Promise.all of 12 listing reads, and `marketplaceListingScope()` which throws DeskResolutionError)
// had no try/catch, so a failure was Next's default 500. It now answers
// `{"error":"internal_error"}` 500 with an `op` in the log.
//
// Success stays a NextResponse so the Cache-Control header survives — it is what keeps the home
// page's rail off the DB on repeat views.
export const GET = route({ auth: 'public' }, async () => {
  const listings = await topBusinessListings()

  return NextResponse.json(
    { listings },
    { headers: { 'Cache-Control': 'public, max-age=120, s-maxage=300, stale-while-revalidate=900' } },
  )
})
