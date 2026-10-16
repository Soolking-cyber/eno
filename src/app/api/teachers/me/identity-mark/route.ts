// The signed-in teacher's "Identity verified" switch (owner, 2026-10-15; AUTOMATIC since 2026-10-16) — ITS OWN ENDPOINT,
// never the profile save (plan review R2: a switch saved with the whole profile could not be hidden while anything else in
// the profile refused to save). The mark shows by itself while the identity check is live and the name matches the ID;
// this switch HIDES it and shows it again, and saves on toggle. Rules: src/lib/teachers/publish.ts
// saveTeacherIdentityMark; what the mark is: src/lib/teachers/identity-mark.ts.
//
// Body:
//   · `{ on: false }` — HIDE it. ⛔ ALWAYS SUCCEEDS (a hide is never blocked): no base, no notice, never rate-limited,
//     nothing else in the profile is screened or validated, no identity is read. Extra fields are ignored.
//   · `{ on: true, base: { at, withdrawnAt } }` — SHOW it again. `base` is the switch's last show and last hide as the form
//     loaded them (GET /api/teachers/me `identityMarkStamps`, or the last answer's `stamps`), ISO 8601 or null — 409
//     `identity_mark_changed` when they no longer match the stored ones, so a stale tab can never un-hide over a newer
//     hide (nothing is written). ⚠️ `notice` — what a form from the opt-in (before 2026-10-16) still sends beside it — is
//     IGNORED: the schema strips it, whatever it holds. A show consents to nothing (the consent is the identity
//     declaration), so there is no `notice_changed` here any more.
// Answer: `{ identityMark: { shown, reason }, stamps: { at, withdrawnAt } }` — the mark's state for the teacher's OWN
// state line (auth 'profile': the reason never reaches anyone else) and the form's next base. 404 teacher_profile_missing
// without a profile; 400 bad_request for a body that is not one of the two shapes.
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { route, ApiError } from '@/lib/api/handler'
import { saveTeacherIdentityMark, TeacherIdentityMarkConflictError } from '@/lib/teachers/publish'
import { rateLimit } from '@/lib/ratelimit'

export const runtime = 'nodejs'

/** A stamp as the GET handed it over: an ISO 8601 instant (compared by instant, so any offset), or null for "never". */
const Stamp = z.string().max(40).datetime({ offset: true }).nullable()
// z.object strips what it does not name: `notice` from an older form never reaches the save.
const Body = z.discriminatedUnion('on', [
  z.object({ on: z.literal(false) }),
  z.object({ on: z.literal(true), base: z.object({ at: Stamp, withdrawnAt: Stamp }) }),
])

export const PUT = route(
  { auth: 'profile', body: Body },
  async ({ profile, body }) => {
    // Each show purges the teacher's pages (revalidate.ts), so showing it again is capped like the cover panel's switch.
    // ⛔ A HIDE IS NEVER RATE-LIMITED (commit gate, 2026-10-16): it must always succeed — a spent bucket, or a limiter
    // backend that errors, must never leave a public claim up that the teacher has asked to take down.
    if (body.on) {
      const rl = await rateLimit('teacher-identity-mark', profile.id, 60, '1 h', { strict: true })
      if (!rl.success) throw new ApiError('rate_limited', 429)
    }
    try {
      const saved = await saveTeacherIdentityMark(profile.id, body.on ? { on: true, base: body.base } : { on: false })
      if (!saved) throw new ApiError('teacher_profile_missing', 404)
      // Exactly these two, field by field — never a spread of anything the save read.
      return { identityMark: { shown: saved.identityMark.shown, reason: saved.identityMark.reason }, stamps: { at: saved.stamps.at, withdrawnAt: saved.stamps.withdrawnAt } }
    } catch (e) {
      // The switch changed in another window since this form loaded it: reload — never a show over a newer hide.
      if (e instanceof TeacherIdentityMarkConflictError) return NextResponse.json({ error: 'identity_mark_changed' }, { status: 409 })
      throw e
    }
  },
)
