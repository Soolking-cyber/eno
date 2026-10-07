import 'server-only'
import { db } from '@/lib/db'
import { rateLimit } from '@/lib/ratelimit'
import { sendPushToProfile } from '@/lib/push'

/**
 * A SCHOOL MESSAGED A TEACHER (2026-10-07, cover lessons) — the one chat event that rings a teacher's bell and
 * web push. Plain messages never notify on eno (src/lib/messages.ts — the unread badge carries them), which left
 * an urgent cover request unseen until the teacher happened to open the app. Two moments ring:
 *   · a NEW thread from a school (POST /api/conversations), and
 *   · a school's message into a thread that was QUIET for TEACHER_QUIET_HOURS — a fresh request in an old chat.
 * ⛔ BOUNDED: at most TEACHER_NOTIFY_DAILY rings per teacher per day, so a swarm of self-declared "business"
 * accounts cannot ring one teacher all day; the quiet rule allows each school one ring per quiet gap.
 * ⛔ NO SENDER NAME IN THE TEXT. A business name is self-declared and unscreened, and a push shows on a lock
 * screen. The row opens the thread, where the name is.
 * ⚠️ Web push only reaches a teacher who turned it on, and the native apps' push is dormant (v1) — so the bell row
 * and the unread badge are what every teacher gets. Promotion must not promise instant app alerts.
 */
export const TEACHER_QUIET_HOURS = 6
// = a business's own daily cap on new teacher threads (conversations route), so one ordinary sender never exhausts it.
export const TEACHER_NOTIFY_DAILY = 20

/** True when the thread's previous message is older than the quiet gap (or there was none). */
export function isQuietGap(previous: Date | string | null | undefined, now: Date = new Date()): boolean {
  if (!previous) return true
  const t = new Date(previous).getTime()
  return !Number.isFinite(t) || now.getTime() - t >= TEACHER_QUIET_HOURS * 3_600_000
}

/**
 * Persisted copy is a BILINGUAL COMPOSITE (the price-drop.ts idiom): it is stored server-side, where tr() cannot
 * run. eno's own words only — notification-text.ts lets the bell machine-translate this type for that reason.
 */
// "school or company": any business account may message a teacher (self-declared), so the alert claims no more.
const TITLE = 'Một trường học hoặc công ty đã nhắn tin cho bạn · A school or company messaged you'
const BODY = 'Mở để trả lời — có thể là lời mời dạy thay. · Open to reply — it may be a cover-lesson request.'

/** Best-effort and fail-quiet: a notification must never fail the message that caused it. */
export async function notifyTeacherOfSchoolMessage(args: { teacherProfileId: string; conversationId: string; listingId: string | null }): Promise<void> {
  try {
    // Re-read at RING time: a teacher who hid the profile since the message was sent is not rung (gate review). The
    // teacher's own switch (TeacherProfile.status, setTeacherStatus) — not a listing read (edition-lint Rule A).
    const tp = await db.teacherProfile.findUnique({ where: { profileId: args.teacherProfileId }, select: { status: true } })
    if (tp?.status !== 'live') return
    // One ring per thread per quiet gap, decided by the limiter's atomic count — two school messages racing past the
    // gap must not ring twice (gate review). '6 h' = TEACHER_QUIET_HOURS (the limiter takes a literal window).
    const pair = await rateLimit('teacher-notify-pair', `${args.teacherProfileId}:${args.conversationId}`, 1, '6 h')
    if (!pair.success) return
    const cap = await rateLimit('teacher-notify', args.teacherProfileId, TEACHER_NOTIFY_DAILY, '1 d')
    if (!cap.success) return
    await db.notification.create({
      data: { recipientId: args.teacherProfileId, type: 'teacher_message', title: TITLE, body: BODY, conversationId: args.conversationId, listingId: args.listingId },
    })
    await sendPushToProfile(args.teacherProfileId, { title: TITLE, body: BODY, url: `/messages/${args.conversationId}`, tag: `convo-${args.conversationId}` })
  } catch (e) {
    console.error('[teachers] notify', e)
  }
}
