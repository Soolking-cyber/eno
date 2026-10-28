// The signed-in teacher's "Zalo for urgent cover" (owner, 2026-10-28) — ITS OWN ENDPOINT, saved on its own (the search
// switch's pattern: never with the profile save). Rules and the teacher's record: src/lib/teachers/zalo.ts.
//
// GET → the teacher's own state (their number, the notice version, every school that saw it). PUT `{ on: true, zalo,
// zaloNotice, base: { at, withdrawnAt } }` or `{ on: false }` → the state as saved. Answers:
//   404 teacher_profile_missing · 409 zalo_notice_changed (reload: the notice moved) · 409 zalo_changed (another window)
//   · 400 zalo_invalid (not a VN mobile) · 400 cover_off (switch cover on first).
// ⛔ SWITCHING OFF IS NEVER RATE-LIMITED — a withdrawal must always go through; switching on is capped (60 an hour).
// ⛔ private, no-store on every answer: it carries the teacher's own number.
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { route, ApiError } from '@/lib/api/handler'
import { clientIp } from '@/lib/client-ip'
import { rateLimit } from '@/lib/ratelimit'
import { ZaloChangedError, ZaloInvalidError, ZaloNoticeChangedError, readCoverZalo, saveCoverZalo } from '@/lib/teachers/zalo'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'private, no-store' }

export const GET = route(
  { auth: 'profile', rateLimit: { bucket: 'teacher-cover-zalo-read', limit: 120, window: '1 h' } },
  async ({ profile }) => {
    const s = await readCoverZalo(profile.id)
    if (!s.hasProfile) throw new ApiError('teacher_profile_missing', 404)
    return NextResponse.json(s, { headers: NO_STORE })
  },
)

const Body = z.union([
  z.object({
    on: z.literal(true),
    zalo: z.string().max(32),
    zaloNotice: z.string().max(32),
    base: z.object({ profile: z.string().max(64).nullable(), at: z.string().max(40).nullable(), withdrawnAt: z.string().max(40).nullable() }),
  }),
  z.object({ on: z.literal(false) }),
])

export const PUT = route(
  { auth: 'profile', body: Body },
  async ({ req, profile, body }) => {
    if (body.on) {
      const rl = await rateLimit('teacher-cover-zalo', profile.id, 60, '1 h', { strict: true })
      if (!rl.success) throw new ApiError('rate_limited', 429)
    }
    try {
      const s = await saveCoverZalo(profile.id, body, clientIp(req))
      if (!s.hasProfile) throw new ApiError('teacher_profile_missing', 404)
      return NextResponse.json(s, { headers: NO_STORE })
    } catch (e) {
      if (e instanceof ZaloNoticeChangedError) throw new ApiError('zalo_notice_changed', 409)
      if (e instanceof ZaloChangedError) throw new ApiError('zalo_changed', 409)
      if (e instanceof ZaloInvalidError && e.field === 'cover') throw new ApiError('cover_off', 400)
      if (e instanceof ZaloInvalidError) throw new ApiError('zalo_invalid', 400)
      throw e
    }
  },
)
