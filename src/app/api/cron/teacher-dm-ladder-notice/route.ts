import { route } from '@/lib/api/handler'
import { db } from '@/lib/db'
import { kv } from '@/lib/ratelimit'
import { logError } from '@/lib/log'
import { sendMailOnce, mailEnabled } from '@/lib/mail'
import { pickLocale } from '@/lib/admin-macros'
import { IS_MARKETPLACE, SITE_NAME } from '@/lib/edition'
import { PRIVACY_TEXT_PUBLISHED } from '@/lib/compliance/privacy-updated'
import { PUBLISH_NOTICE_VERSION } from '@/lib/teachers/profile'
import { TEACHER_DM_NOTICE, TEACHER_DM_NOTICE_DAY, renderTeacherDmLadderNotice } from '@/lib/emails/teacher-dm-ladder-notice'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 900

/**
 * ⛔ ONE-OFF, RUN BY HAND ON DEPLOY DAY (owner, 2026-10-13 — "Notify + privacy"): tell every LIVE teacher that any account
 * can now message them (the teacher DM ladder), in the app and by email. Not on any timer — the owner runs it once on
 * the box after the deploy, `?dryRun=1` first:
 *   curl -H "Authorization: Bearer $(docker exec eno-vn-app printenv CRON_SECRET)" -H 'Host: eno.vn' \
 *     'http://127.0.0.1:3001/api/cron/teacher-dm-ladder-notice?dryRun=1'
 * ⛔ NEVER TWICE, per teacher: each teacher is CLAIMED first (kv, nx), so two overlapping runs never work on the same one;
 * the in-app notice is skipped when that teacher already has it (same type and title); the email carries an idempotency
 * key per teacher, and leaves a kv marker, with no expiry, when it was sent — or MAY have been (an 'unknown' try:
 * mail.ts keeps the claim then, because Resend may already have sent it) — so a second run, or one months later, sends
 * nothing again. Only a refused email leaves no marker, so a later run tries it again (pre-review, 2026-10-13).
 * ⚠️ kv_store is UNLOGGED: a Postgres crash between two runs would drop the markers. The in-app notice — a logged row —
 * still never repeats; an email could, once, if a second run came after both a crash and Resend's 24 h. Accepted for a
 * one-off. Sequential and paced (Resend's 10 requests/second are shared).
 * Marketplace only: teachers live on eno.vn. Counts only in the answer (under 200 bytes) — no address is logged.
 */
const ORIGIN = process.env.NEXT_PUBLIC_APP_URL || `https://${SITE_NAME}`
const MARK = (profileId: string) => `teacher-dm-ladder-notice:sent:${profileId}`
const CLAIM = (profileId: string) => `teacher-dm-ladder-notice:claim:${profileId}`
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

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
    select: { profileId: true, fullName: true, private: { select: { email: true } }, profile: { select: { email: true, locale: true } } },
    orderBy: { createdAt: 'asc' },
  })
  const withEmail = teachers.filter((t) => t.profile.email || t.private?.email).length
  if (dryRun) return { ok: true, dryRun: true, teachers: teachers.length, withEmail, mail: mailEnabled() }

  let notified = 0, emailed = 0, uncertain = 0, already = 0, busy = 0, failed = 0
  let stop = false
  let unknownRun = 0
  for (const t of teachers) {
    // Another run is on this teacher right now: leave it to that run.
    if ((await kv.set(CLAIM(t.profileId), 1, { nx: true, ex: 900 })) === null) { busy++; continue }
    try {
      const l = pickLocale(t.profile.locale)
      const title = TEACHER_DM_NOTICE.title[l]
      const seen = await db.notification.findFirst({
        where: { recipientId: t.profileId, type: 'system', title: { in: [TEACHER_DM_NOTICE.title.en, TEACHER_DM_NOTICE.title.vi] } },
        select: { id: true },
      })
      if (!seen) {
        await db.notification.create({ data: { recipientId: t.profileId, type: 'system', title, body: TEACHER_DM_NOTICE.body[l], actorName: SITE_NAME, url: '/privacy' } })
        notified++
      }
      const to = t.profile.email || t.private?.email
      if (!to || stop) continue
      if (await kv.get(MARK(t.profileId))) { already++; continue }
      const mail = renderTeacherDmLadderNotice({ origin: ORIGIN, siteName: SITE_NAME, recipientName: t.fullName, locale: l })
      const key = `teacher-dm-ladder-notice:${t.profileId}`
      let res = await sendMailOnce({ to, ...mail }, { idempotencyKey: key })
      // An 'unknown' first try may have gone out — whatever the retry then says (gate review, 2026-10-13).
      const mayHaveSent = res.outcome === 'unknown'
      if (mayHaveSent) { await sleep(5000); res = await sendMailOnce({ to, ...mail }, { idempotencyKey: key, afterUnknown: true }) }
      if (res.outcome === 'sent' || res.outcome === 'unknown' || mayHaveSent) {
        // Marked like a send, never retried (mail.ts), and for good: no expiry, so a run months later sends nothing again.
        if (res.outcome === 'sent') { emailed++; unknownRun = 0 } else {
          uncertain++; unknownRun++
          // Named, so the operator can check those few by hand (Resend's log) — the id only, never the address.
          console.warn('[teacher-dm-ladder-notice] uncertain send, marked', { profileId: t.profileId, outcome: res.outcome })
        }
        await kv.set(MARK(t.profileId), res.outcome)
        if (res.stopRun) stop = true
        // Two in a row that may or may not have gone out: Resend itself is likely down. Stop emailing, so the rest stay
        // unmarked and a later run sends them — never every teacher marked through an outage (gate review, 2026-10-13).
        if (unknownRun >= 2) stop = true
      } else { failed++; unknownRun = 0; if (res.stopRun) stop = true }
      await sleep(150)
    } catch (e) {
      failed++
      console.error('[teacher-dm-ladder-notice] teacher failed', { profileId: t.profileId, err: (e as Error)?.message })
    } finally {
      // Best-effort: a claim that is not released expires in 15 minutes.
      await kv.del(CLAIM(t.profileId)).catch((e) => logError(e, { op: 'teachers.dm_ladder_notice.release' }))
    }
  }
  // ok only when every email is confirmed: one stopped early, uncertain or left to another run is for the operator to see.
  return { ok: failed === 0 && !stop && uncertain === 0 && busy === 0, teachers: teachers.length, notified, emailed, uncertain, already, busy, failed, stopped: stop }
})
