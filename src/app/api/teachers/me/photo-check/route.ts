// THE PROFILE PHOTO CHECK, ASKED BY THE FORM (owner, 2026-10-16: "check uploaded profile pictures so it clearly shows
// face of the teacher") — the moment a photo is on the last step, so a tree or a game character is caught there, not at
// Publish. The save runs the same verdict itself (src/lib/teachers/publish.ts), so skipping this call skips nothing:
// it only answers sooner, and its answer is cached for the save.
// ⛔ Signed in only: the limits are per account, and a refusal is recorded against a person (the admin queue reads it).
import { route, ApiError } from '@/lib/api/handler'
import { clientIp } from '@/lib/client-ip'
import { logWarn } from '@/lib/log'
import { rateLimit } from '@/lib/ratelimit'
import { imageOwner } from '@/lib/image-owner'
import { PhotoCheckUnavailable, recordPhotoRefusal, teacherPhotoKey, teacherPhotoVerdict } from '@/lib/teachers/photo-verdict'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** A teacher tries a photo or three; anything more is a loop. */
const PER_HOUR = 30
const PER_DAY = 100
/** Per connection a day — a school's shared network fits; a handful of throwaway accounts on one does not drain the day. */
const PER_IP_PER_DAY = 200

export const POST = route({ auth: 'profile' }, async ({ req, profile }) => {
  const body = (await req.json().catch(() => null)) as { url?: unknown } | null
  const key = teacherPhotoKey(body?.url)
  if (!key) throw new ApiError('photo_check_invalid', 400)
  const url = String(body?.url)
  // ⛔ ONLY THIS ACCOUNT'S OWN PHOTO (gate review, 2026-10-16): one it uploaded in the last 7 days, or its account photo —
  // never any public listing photo a caller names, which would spend checks and fill the admin queue with others'
  // images. (The save checks whatever photo it is given, owned or not: this only answers sooner.)
  if ((await imageOwner(url)) !== profile.id && url !== profile.avatarUrl) throw new ApiError('photo_check_invalid', 403)
  // One after another (a denied attempt still counts — ratelimit.ts); strict: an unreachable limiter refuses.
  if (!(await rateLimit('teacher-photo-check', profile.id, PER_HOUR, '1 h', { strict: true })).success) throw new ApiError('photo_check_rate', 429)
  if (!(await rateLimit('teacher-photo-check-day', profile.id, PER_DAY, '1 d', { strict: true })).success) throw new ApiError('photo_check_rate', 429)
  if (!(await rateLimit('teacher-photo-check-ip', clientIp(req), PER_IP_PER_DAY, '1 d', { strict: true })).success) throw new ApiError('photo_check_rate', 429)

  let verdict: Awaited<ReturnType<typeof teacherPhotoVerdict>>
  try {
    // The early check's own budget: draining it never fails a Publish (photo-verdict.ts PHOTO_CHECK_BUDGETS).
    verdict = await teacherPhotoVerdict(profile.id, url, 'check')
  } catch (e) {
    if (e instanceof PhotoCheckUnavailable) {
      logWarn('[teacher-photo] check unavailable', { why: e.why })
      throw new ApiError('photo_check_unavailable', 503)
    }
    throw e
  }
  if (verdict === 'off') return { checked: false }
  if (!verdict.ok) {
    // The admin queue's record of the refusal — what "Photo is fine" needs (photo-verdict.ts recordPhotoRefusal).
    await recordPhotoRefusal(profile.id, key, verdict.reason)
    return { checked: true, ok: false, reason: verdict.reason }
  }
  return { checked: true, ok: true }
})
