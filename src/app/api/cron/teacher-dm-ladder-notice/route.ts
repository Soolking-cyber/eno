import { route } from '@/lib/api/handler'
import { db } from '@/lib/db'
import { kv } from '@/lib/ratelimit'
import { logError } from '@/lib/log'
import { pickLocale } from '@/lib/admin-macros'
import { IS_MARKETPLACE, SITE_NAME } from '@/lib/edition'
import { PRIVACY_TEXT_PUBLISHED } from '@/lib/compliance/privacy-updated'
import { PUBLISH_NOTICE_VERSION } from '@/lib/teachers/profile'
import { TEACHER_DM_NOTICE, TEACHER_DM_NOTICE_DAY } from '@/lib/teachers/dm-ladder-notice'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * ⛔ ONE-OFF, RUN BY HAND AFTER THE DEPLOY (owner, 2026-10-13 — "Notify + privacy", then "no email only notif"): tell every
 * teacher that any account can now message them (the teacher DM ladder) with ONE in-app notice — no email, no push. Not
 * on any timer — the owner runs it once on the box, `?dryRun=1` first:
 *   curl -H "Authorization: Bearer $(docker exec eno-vn-app printenv CRON_SECRET)" -H 'Host: eno.vn' \
 *     'http://127.0.0.1:3001/api/cron/teacher-dm-ladder-notice?dryRun=1'
 * ⛔ NEVER TWICE, per teacher: each teacher is CLAIMED first (kv, nx), so two overlapping runs never work on the same one,
 * and the notice is skipped when that teacher already has it (same type and title) — a logged row, so a re-run after
 * anything writes nothing again. Marketplace only: teachers live on eno.vn. Counts only in the answer.
 */
const CLAIM = (profileId: string) => `teacher-dm-ladder-notice:claim:${profileId}`

export const GET = route({ auth: 'cron' }, async ({ req }) => {
  if (!IS_MARKETPLACE) return { ok: true, skipped: 'marketplace_only' }
  // ⛔ A ONE-OFF, BOUND TO ITS DAY (gate review, 2026-10-13): it runs only while /privacy is dated that day (a slipped
  // deploy re-dates PRIVACY_TEXT_PUBLISHED, and a notice still printing the old day must not go out — re-date
  // TEACHER_DM_NOTICE_DAY with it; a later amendment moves it too), never before the day, and not 14 days after it.
  // Delete this route once it has run.
  if (PRIVACY_TEXT_PUBLISHED !== TEACHER_DM_NOTICE_DAY) return { ok: false, skipped: 'privacy_date_differs' }
  const since = Date.now() - Date.parse(`${TEACHER_DM_NOTICE_DAY}T00:00:00+07:00`)
  if (since < 0) return { ok: false, skipped: 'not_yet' }
  if (since > 14 * 86_400_000) return { ok: false, skipped: 'expired' }
  const dryRun = new URL(req.url).searchParams.get('dryRun') === '1'
  const teachers = await db.teacherProfile.findMany({
    // Hidden profiles too: the rule reaches them the day they show the profile again. And only teachers who agreed to an
    // OLDER publish notice than the one in force (or the old tick-box): one who published under the current notice was
    // told there (gate review, 2026-10-13). Versions are ISO days, so they order as strings.
    where: { status: { in: ['live', 'hidden'] }, OR: [{ consentPublicVersion: null }, { consentPublicVersion: { lt: PUBLISH_NOTICE_VERSION } }] },
    // The notice needs the language and nothing else — no name, no address.
    select: { profileId: true, profile: { select: { locale: true } } },
    orderBy: { createdAt: 'asc' },
  })
  if (dryRun) return { ok: true, dryRun: true, teachers: teachers.length }

  let notified = 0, already = 0, busy = 0, failed = 0
  for (const t of teachers) {
    // Another run is on this teacher right now: leave it to that run.
    if ((await kv.set(CLAIM(t.profileId), 1, { nx: true, ex: 900 })) === null) { busy++; continue }
    try {
      const seen = await db.notification.findFirst({
        where: { recipientId: t.profileId, type: 'system', title: { in: [TEACHER_DM_NOTICE.title.en, TEACHER_DM_NOTICE.title.vi] } },
        select: { id: true },
      })
      if (seen) { already++; continue }
      const l = pickLocale(t.profile.locale)
      await db.notification.create({
        data: { recipientId: t.profileId, type: 'system', title: TEACHER_DM_NOTICE.title[l], body: TEACHER_DM_NOTICE.body[l], actorName: SITE_NAME, url: '/privacy' },
      })
      notified++
    } catch (e) {
      failed++
      console.error('[teacher-dm-ladder-notice] teacher failed', { profileId: t.profileId, err: (e as Error)?.message })
    } finally {
      // Best-effort: a claim that is not released expires in 15 minutes.
      await kv.del(CLAIM(t.profileId)).catch((e) => logError(e, { op: 'teachers.dm_ladder_notice.release' }))
    }
  }
  // ok only when every teacher was reached: one that failed, or was left to another run, is for the operator to see.
  return { ok: failed === 0 && busy === 0, teachers: teachers.length, notified, already, busy, failed }
})
