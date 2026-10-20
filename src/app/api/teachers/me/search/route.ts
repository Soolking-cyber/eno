// The signed-in teacher's "Hide my profile from search engines" (owner decision 14, 2026-10-20) — ITS OWN ENDPOINT, saved
// on toggle, never with the profile save (the "Identity verified" switch's pattern: a switch saved with the whole profile
// could not be flipped while anything else in the profile refused to save). Rules: src/lib/teachers/search-visibility.ts;
// what it does: src/lib/teachers/search-floor.ts.
//
// Body: `{ hidden: boolean }`. Answer: `{ hidden }` as saved. 404 teacher_profile_missing without a profile; 400
// bad_request for any other body.
// ⛔ HIDING IS NEVER RATE-LIMITED: a privacy request must always go through — a spent bucket, or a limiter backend that
// errors, must never leave a profile offered to search engines after its teacher asked otherwise. Showing it again purges
// the page too, so that direction is capped like the other teacher switches (60 an hour).
import { z } from 'zod'
import { route, ApiError } from '@/lib/api/handler'
import { rateLimit } from '@/lib/ratelimit'
import { setTeacherSearchHidden } from '@/lib/teachers/search-visibility'

export const runtime = 'nodejs'

const Body = z.object({ hidden: z.boolean() })

export const PUT = route(
  { auth: 'profile', body: Body },
  async ({ profile, body }) => {
    if (!body.hidden) {
      const rl = await rateLimit('teacher-search-visibility', profile.id, 60, '1 h', { strict: true })
      if (!rl.success) throw new ApiError('rate_limited', 429)
    }
    const saved = await setTeacherSearchHidden(profile.id, body.hidden)
    if (!saved) throw new ApiError('teacher_profile_missing', 404)
    return { hidden: saved.hidden }
  },
)
