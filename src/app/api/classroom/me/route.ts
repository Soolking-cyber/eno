import { NextResponse } from 'next/server'
import { route } from '@/lib/api/handler'
import { classroomMe } from '@/lib/classroom/me'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/classroom/me — the signed-in account's classroom: its teacher side and the learners it owns (me.ts).
// Private and per-account: never cached anywhere.
export const GET = route({ auth: 'profile' }, async ({ profile }) => {
  return NextResponse.json(await classroomMe(profile.id), { headers: { 'cache-control': 'private, no-store' } })
})
