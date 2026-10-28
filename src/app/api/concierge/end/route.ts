import { NextResponse } from 'next/server'
import { z } from 'zod'
import { route } from '@/lib/api/handler'
import { endSession, liveSession } from '@/lib/concierge/config'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** POST /api/concierge/end { session } — ✕ or the page going away: the session ends now (its tokens stop being renewed) and
 *  the time it did not use goes back to the account's day (config.ts endSession — once, however many ends arrive). */
export const POST = route({ auth: 'profile', body: z.object({ session: z.string().max(40) }) }, async ({ profile, body }) => {
  const s = await liveSession(body.session, profile.id)
  if (s) await endSession(s)
  return new NextResponse(null, { status: 204 })
})
