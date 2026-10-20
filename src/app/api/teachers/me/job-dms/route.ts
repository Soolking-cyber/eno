// The signed-in teacher's JOB MESSAGES switch (owner, 2026-10-20) — "Message me matching jobs and cover lessons in eno
// chat", on its own page (/teachers/job-messages). ITS OWN ENDPOINT, never the profile save: like the "Identity verified"
// switch (identity-mark/route.ts), it saves on toggle and a withdrawal must succeed whatever else the profile holds.
// The rules and the evidence: src/lib/teachers/job-dms/consent.ts.
//
// GET — `{ on, noticeVersion, current, teacher }` for the session's account (consent.ts JobDmState): the stored switch,
//   the notice its last ON was given under, whether that ON counts under the notice in force (what the switch draws —
//   the only state in which the jobs desk messages), and whether the account has a teacher profile. Reads only.
// POST — the switch. Body:
//   · `{ on: false }` — SWITCH IT OFF. ⛔ ALWAYS SUCCEEDS (a withdrawal is never blocked, plan review D6): no notice, no
//     teacher profile, never rate-limited. Extra fields are ignored.
//   · `{ on: true, notice }` — SWITCH IT ON. `notice` is the JOB_DM_NOTICE_VERSION the page showed (its own bundle's
//     constant): any other → 409 `notice_changed` / notice 'job_dms' (reload and read the notice in force — nothing is
//     written). Only an account with a teacher profile (live or hidden): none → 404 teacher_profile_missing. Capped like
//     the cover panel's switch: 60 an hour per account, strict → 429.
// Answer: the GET's five fields, field by field (paused too — the page's "paused" line and its off button read it: codex +
// opus, gate 5a). 400 bad_request for a body that is not one of the two shapes.
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { route, ApiError } from '@/lib/api/handler'
import { IS_MARKETPLACE } from '@/lib/edition'
import { rateLimit } from '@/lib/ratelimit'
import {
  JobDmNoTeacherProfileError, JobDmNoticeChangedError, readJobDmState, setJobDmConsent, type JobDmState,
} from '@/lib/teachers/job-dms/consent'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Exactly these five — never a spread of what the save read. */
const answer = (s: JobDmState) => ({ on: s.on, noticeVersion: s.noticeVersion, current: s.current, teacher: s.teacher, paused: s.paused })

// eno.vn only (the page's rule): on eno.forum there is no switch to read or turn (codex, gate 5c).
const forumGone = () => NextResponse.json({ error: 'not_found' }, { status: 404 })
export const GET = route({ auth: 'profile' }, async ({ profile }) => (IS_MARKETPLACE ? answer(await readJobDmState(profile.id)) : forumGone()))

// z.object strips what it does not name: an OFF's `notice` (or anything else) never reaches the save.
const Body = z.discriminatedUnion('on', [
  z.object({ on: z.literal(false) }),
  z.object({ on: z.literal(true), notice: z.string().max(40) }),
])

export const POST = route(
  { auth: 'profile', body: Body },
  async ({ profile, body }) => {
    // eno.forum: no ON (the desk does not run there) — but an OFF always goes through, wherever it comes from.
    if (!IS_MARKETPLACE && body.on) return forumGone()
    // ⛔ AN OFF IS NEVER RATE-LIMITED: a spent bucket, or a limiter that errors, must never keep messages coming to a
    // teacher who asked us to stop (the identity mark's commit-gate rule, 2026-10-16). An ON is capped.
    if (body.on) {
      const rl = await rateLimit('teacher-job-dms', profile.id, 60, '1 h', { strict: true })
      if (!rl.success) throw new ApiError('rate_limited', 429)
    }
    try {
      return answer(await setJobDmConsent(profile.id, body.on, body.on ? body.notice : null))
    } catch (e) {
      if (e instanceof JobDmNoticeChangedError) return NextResponse.json({ error: 'notice_changed', notice: 'job_dms' }, { status: 409 })
      if (e instanceof JobDmNoTeacherProfileError) throw new ApiError('teacher_profile_missing', 404)
      throw e
    }
  },
)
