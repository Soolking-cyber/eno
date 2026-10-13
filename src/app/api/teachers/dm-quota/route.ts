// Where the signed-in account stands on the teacher DM ladder today (owner, 2026-10-13 — src/lib/teachers/dm-quota.ts):
// its rung, how many new teachers it has started a chat with, how many it has left, when that resets and what raises it.
// The teacher profile's contact block asks before it stashes an opener, so a refusal is said on the page, in place —
// the same count the create path refuses on, so the two can never disagree. Reads only the caller's own conversations.
import { NextResponse } from 'next/server'
import { route } from '@/lib/api/handler'
import { clientIp } from '@/lib/client-ip'
import { teacherDmStanding } from '@/lib/teachers/dm-quota'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = route(
  { auth: 'userId', rateLimit: { bucket: 'teacher-dm-quota', limit: 120, window: '1 h' } },
  // `userId` IS the profile id: auth 'userId' resolves getCurrentProfileId (src/lib/api/handler.ts) — the same id the
  // create route passes as profile.id.
  async ({ req, userId: profileId }) => {
    const listingId = new URL(req.url).searchParams.get('listingId')?.trim().slice(0, 64) || null
    const s = await teacherDmStanding(profileId, { ip: clientIp(req), listingId })
    return NextResponse.json(
      { tier: s.tier, limit: s.limit, used: s.used, remaining: s.remaining, resetAt: s.resetAt, next: s.next, nextLimit: s.nextLimit, reason: s.reason, hasThread: s.hasThread },
      { headers: { 'Cache-Control': 'private, no-store' } },
    )
  },
)
