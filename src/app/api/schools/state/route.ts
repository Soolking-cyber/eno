// GET /api/schools/state?ids=a,b,c[&reviews=x,y] — live eligible counts + the caller's own votes.
// ⛔ no-store: the page HTML is cached (ISR + edge) and must stay anonymous; this is the per-visitor layer.
import { NextResponse } from 'next/server'
import { route } from '@/lib/api/handler'
import { getCurrentProfileId } from '@/lib/admin'
import { liveReviewCounts, liveState, myReviewVotes } from '@/lib/schools/queries'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ID = /^[A-Za-z0-9_-]{8,64}$/ // cuids today; hyphens and underscores allowed so a seeded id is not dropped

// Generous: a public read keyed by IP, and a school's staff Wi-Fi or a carrier NAT puts many visitors on one.
export const GET = route({ auth: 'public', rateLimit: { bucket: 'school-state', limit: 1200, window: '1 h' } }, async ({ req }) => {
  const u = new URL(req.url)
  const ids = (u.searchParams.get('ids') ?? '').split(',').filter((x) => ID.test(x)).slice(0, 400)
  const reviewIds = (u.searchParams.get('reviews') ?? '').split(',').filter((x) => ID.test(x)).slice(0, 400)
  const profileId = await getCurrentProfileId()
  const state = await liveState(ids, profileId)
  const [myReviews, reviewCounts] = await Promise.all([
    profileId && reviewIds.length ? myReviewVotes(reviewIds, profileId) : Promise.resolve({}),
    liveReviewCounts(reviewIds),
  ])
  return NextResponse.json({ ...state, myReviews, reviewCounts, signedIn: !!profileId }, { headers: { 'Cache-Control': 'no-store' } })
})
