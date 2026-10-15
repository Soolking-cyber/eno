// The signed-in teacher's "Identity verified" switch (owner, 2026-10-15) — ITS OWN ENDPOINT, never the profile save
// (plan review R2: a switch saved with the whole profile could not be withdrawn while anything else in the profile refused
// to save). The switch saves on toggle. Rules: src/lib/teachers/publish.ts saveTeacherIdentityMark; what the mark is:
// src/lib/teachers/identity-mark.ts.
//
// Body:
//   · `{ on: false }` — switch it off. ⛔ ALWAYS SUCCEEDS (a withdrawal is never blocked): no notice, no base, nothing else
//     in the profile is screened or validated. Extra fields are ignored.
//   · `{ on: true, notice, base: { at, withdrawnAt } }` — switch it on. `notice` is the IDENTITY_MARK_NOTICE_VERSION the
//     page showed beside the switch (409 `notice_changed` + `notice: 'identity'` otherwise — "reload"); `base` is the two
//     consent stamps the form loaded (GET /api/teachers/me `identityMarkStamps`, or the last answer's `stamps`), ISO 8601
//     or null — 409 `identity_mark_changed` when they no longer match the stored ones, so a stale tab can never re-grant a
//     withdrawal made in another (nothing is written).
// Answer: `{ identityMark: { shown, reason }, stamps: { at, withdrawnAt } }` — the mark's state for the teacher's OWN
// state line (auth 'profile': the reason never reaches anyone else) and the form's next base. 404 teacher_profile_missing
// without a profile; 400 bad_request for a body that is not one of the two shapes.
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { route, ApiError } from '@/lib/api/handler'
import { saveTeacherIdentityMark, TeacherIdentityMarkConflictError, TeacherNoticeChangedError } from '@/lib/teachers/publish'
import { rateLimit } from '@/lib/ratelimit'

export const runtime = 'nodejs'

/** A consent stamp as the GET handed it over: an ISO 8601 instant (compared by instant, so any offset), or null for "never". */
const Stamp = z.string().max(40).datetime({ offset: true }).nullable()
const Body = z.discriminatedUnion('on', [
  z.object({ on: z.literal(false) }),
  z.object({
    on: z.literal(true),
    // Optional HERE so a missing notice is the "reload" answer (409 notice_changed), not a bare 400.
    notice: z.string().max(40).nullable().optional(),
    base: z.object({ at: Stamp, withdrawnAt: Stamp }),
  }),
])

export const PUT = route(
  { auth: 'profile', body: Body },
  async ({ profile, body }) => {
    // Each switch purges the teacher's pages (revalidate.ts), so switching ON is capped like the cover panel's switch.
    // ⛔ A WITHDRAWAL IS NEVER RATE-LIMITED (commit gate, 2026-10-16): OFF must always succeed — a spent bucket, or a
    // limiter backend that errors, must never leave a public claim up that the teacher has asked to take down.
    if (body.on) {
      const rl = await rateLimit('teacher-identity-mark', profile.id, 60, '1 h', { strict: true })
      if (!rl.success) throw new ApiError('rate_limited', 429)
    }
    try {
      const saved = await saveTeacherIdentityMark(profile.id, body.on ? { on: true, notice: body.notice ?? null, base: body.base } : { on: false })
      if (!saved) throw new ApiError('teacher_profile_missing', 404)
      // Exactly these two, field by field — never a spread of anything the save read.
      return { identityMark: { shown: saved.identityMark.shown, reason: saved.identityMark.reason }, stamps: { at: saved.stamps.at, withdrawnAt: saved.stamps.withdrawnAt } }
    } catch (e) {
      // The page showed older words beside the switch (or none): reload, and switch it on under today's.
      if (e instanceof TeacherNoticeChangedError) return NextResponse.json({ error: 'notice_changed', notice: e.notice }, { status: 409 })
      // The switch changed in another window since this form loaded it: reload — never a re-grant over a withdrawal.
      if (e instanceof TeacherIdentityMarkConflictError) return NextResponse.json({ error: 'identity_mark_changed' }, { status: 409 })
      throw e
    }
  },
)
