// The teacher's weekly check-in (owner, 2026-10-27 — src/lib/teachers/check-in.ts): GET what the page shows, POST "yes,
// I'm still available". Neither ever changes the profile's status; "hide my profile" is PATCH /api/teachers/me/status.
import { NextResponse } from 'next/server'
import { route } from '@/lib/api/handler'
import { checkInView, confirmTeacherCheckIn } from '@/lib/teachers/check-in'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = route({ auth: 'profile' }, async ({ profile }) => checkInView(profile.id))

export const POST = route(
  { auth: 'profile', rateLimit: { bucket: 'teacher-check-in', limit: 20, window: '1 h', strict: true } },
  async ({ profile }) => {
    const r = await confirmTeacherCheckIn(profile.id)
    // 404: no profile; 409: the request is fine, the profile's state (hidden, held, under review) refuses it — the page
    // then shows what the view says rather than a "thanks".
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.error === 'teacher_profile_missing' ? 404 : 409 })
    return r
  },
)
