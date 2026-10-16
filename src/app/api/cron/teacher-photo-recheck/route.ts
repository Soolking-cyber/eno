import { route } from '@/lib/api/handler'
import { db } from '@/lib/db'
import { kv } from '@/lib/ratelimit'
import { logError } from '@/lib/log'
import { appendAudit } from '@/lib/compliance/audit'
import { sendMailOnce, mailEnabled } from '@/lib/mail'
import { pickLocale } from '@/lib/admin-macros'
import { IS_MARKETPLACE, SITE_NAME } from '@/lib/edition'
import { HOME_HIDDEN_TEACHER_LISTING_IDS } from '@/lib/teachers/constants'
import { PhotoCheckUnavailable, photoOverridden, teacherPhotoKey, teacherPhotoVerdict } from '@/lib/teachers/photo-verdict'
import { TEACHER_PHOTO_ASK, TEACHER_PHOTO_ASK_PATH, renderTeacherPhotoAsk, teacherPhotoAskBody } from '@/lib/emails/teacher-photo-ask'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 900

/**
 * THE PHOTOS ALREADY ON THE SITE (owner, 2026-10-16: "ask current ones to reupload the ones that dont have face or
 * unrelated to image like https://eno.vn/listings/cmv6pv9yh002p01o3k4wh2ora"). Every teacher profile — shown, or hidden
 * by the teacher (relisting never re-checks) — has its CURRENT photo checked (photo-verdict.ts: an admin's override,
 * the cache, then the check); a photo that fails gets ONE ask, in the app and by email. Nobody is hidden: it asks.
 * Run BY HAND on the box after the deploy, `?dryRun=1` first — the dry run asks nobody and writes no record (it does check
 * the photos, so their verdicts are cached for the real run), and lists the listings it would ask:
 *   curl -H "Authorization: Bearer $(docker exec eno-vn-app printenv CRON_SECRET)" -H 'Host: eno.vn' \
 *     'http://127.0.0.1:3001/api/cron/teacher-photo-recheck?dryRun=1'
 * Re-run it until `unchecked` is 0: a check that cannot run leaves that teacher for the next run, never asked on a guess.
 * ⛔ ONCE PER (teacher, photo): the durable record is the audit row `teacher.photo.ask` {key, mail} — and a NEW photo
 * (a new key) passed the save's own check. A claim (kv, nx, 15 min) keeps two overlapping runs off the same teacher, and
 * the record is read again UNDER the claim (gate review, 2026-10-16: a run that read "not asked" before another finished
 * would ask twice). THE EMAIL GOES FIRST, then the bell + audit row in one transaction: a crash between them leaves no
 * record, so the next run sends again — and Resend's idempotency key (per teacher and photo) makes that the same email.
 * An email that did not go (mail off, refused, the run stopped emailing) is recorded as such and TRIED AGAIN by the next
 * run — the email alone, never a second bell (gate review: "asked" must never mean "never emailed").
 * Marketplace only: one database serves both editions. The answer names listing ids and reasons — never a name or address.
 */
const ORIGIN = process.env.NEXT_PUBLIC_APP_URL || `https://${SITE_NAME}`
const CLAIM = (profileId: string) => `teacher-photo-ask:claim:${profileId}`
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
/** The email went, may have gone, or there is no address to send to: nothing more to do. */
const MAIL_DONE: ReadonlySet<string> = new Set(['sent', 'unknown', 'no_address'])

/** The last ask recorded for this photo — its mail outcome says whether the email still has to go. */
async function lastAsk(profileId: string, key: string): Promise<{ mail: string } | null> {
  const row = await db.complianceAudit.findFirst({
    where: { action: 'teacher.photo.ask', subjectType: 'profile', subjectId: profileId, detail: { path: ['key'], equals: key } },
    orderBy: { occurredAt: 'desc' },
    select: { detail: true },
  })
  if (!row) return null
  const mail = (row.detail as { mail?: unknown } | null)?.mail
  return { mail: typeof mail === 'string' ? mail : 'sent' }
}

export const GET = route({ auth: 'cron' }, async ({ req }) => {
  if (!IS_MARKETPLACE) return { ok: true, skipped: 'marketplace_only' }
  const dryRun = new URL(req.url).searchParams.get('dryRun') === '1'
  const teachers = await db.teacherProfile.findMany({
    where: {
      status: { in: ['live', 'hidden'] },
      listingId: { notIn: [...HOME_HIDDEN_TEACHER_LISTING_IDS] },
      listing: { status: { not: 'removed' } },
    },
    select: { profileId: true, listingId: true, fullName: true, photoUrl: true, private: { select: { email: true } }, profile: { select: { email: true, locale: true } } },
    orderBy: { createdAt: 'asc' },
  })

  const flagged: Array<{ listingId: string | null; reason: string; asked: boolean }> = []
  let passed = 0, overridden = 0, already = 0, unchecked = 0, noPhoto = 0, asked = 0, emailed = 0, uncertain = 0, mailPending = 0, busy = 0, failed = 0
  let stop = !mailEnabled()
  let unknownRun = 0
  for (const t of teachers) {
    const key = teacherPhotoKey(t.photoUrl)
    if (!key || !t.photoUrl) { noPhoto++; continue }
    try {
      if (await photoOverridden(t.profileId, key)) { overridden++; continue }
      const before = await lastAsk(t.profileId, key)
      if (before && MAIL_DONE.has(before.mail)) { already++; continue }
      let reason: 'not_photo' | 'no_face'
      if (before) {
        // Asked before, the email not gone yet: the reason is the one asked about (the photo has not changed — same key).
        const prior = await db.complianceAudit.findFirst({
          where: { action: 'teacher.photo.ask', subjectType: 'profile', subjectId: t.profileId, detail: { path: ['key'], equals: key } },
          orderBy: { occurredAt: 'asc' },
          select: { detail: true },
        })
        reason = (prior?.detail as { reason?: string } | null)?.reason === 'not_photo' ? 'not_photo' : 'no_face'
      } else {
        let verdict: Awaited<ReturnType<typeof teacherPhotoVerdict>>
        try {
          verdict = await teacherPhotoVerdict(t.profileId, t.photoUrl, 'recheck')
        } catch (e) {
          if (e instanceof PhotoCheckUnavailable) { unchecked++; continue }
          throw e
        }
        // No Vertex client on this server: nothing can be checked — said, never guessed.
        if (verdict === 'off') return { ok: false, skipped: 'no_vertex_client' }
        if (verdict.ok) { passed++; continue }
        reason = verdict.reason
      }
      if (dryRun) { flagged.push({ listingId: t.listingId, reason, asked: !!before }); continue }

      // Another run is on this teacher right now: leave it to that run.
      if ((await kv.set(CLAIM(t.profileId), 1, { nx: true, ex: 900 })) === null) { busy++; continue }
      try {
        // Read again under the claim: another run may have asked between the read above and the claim.
        const now = await lastAsk(t.profileId, key)
        if (now && MAIL_DONE.has(now.mail)) { already++; continue }
        const bellToo = !now
        const l = pickLocale(t.profile.locale)
        const to = t.profile.email || t.private?.email
        // A retry that still cannot email (mail off, or this run stopped emailing) writes nothing: one more "skipped" row
        // per teacher per run would only grow the audit log (gate review, 2026-10-16).
        if (!bellToo && (!to || stop)) { mailPending++; continue }
        let mailOutcome: string = to ? 'skipped' : 'no_address'
        if (to && !stop) {
          const mail = renderTeacherPhotoAsk({ origin: ORIGIN, siteName: SITE_NAME, recipientName: t.fullName, locale: l, reason })
          const idempotencyKey = `teacher-photo-ask:${t.profileId}:${key}`
          let res = await sendMailOnce({ to, ...mail }, { idempotencyKey })
          // An 'unknown' first try may have gone out — the retry carries the same key (mail.ts).
          const mayHaveSent = res.outcome === 'unknown'
          if (mayHaveSent) { await sleep(5000); res = await sendMailOnce({ to, ...mail }, { idempotencyKey, afterUnknown: true }) }
          mailOutcome = mayHaveSent && res.outcome !== 'sent' ? 'unknown' : res.outcome
          if (res.outcome === 'sent') { emailed++; unknownRun = 0 } else if (mailOutcome === 'unknown') {
            uncertain++; unknownRun++
            console.warn('[teacher-photo-recheck] uncertain send', { profileId: t.profileId, outcome: res.outcome })
          } else { unknownRun = 0 }
          if (res.stopRun) stop = true
          // Two in a row that may or may not have gone out: Resend is likely down — stop emailing (the bell still goes).
          if (unknownRun >= 2) stop = true
          await sleep(150)
        }
        await db.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT set_config('lock_timeout', '5000ms', true)`
          if (bellToo) {
            await tx.notification.create({
              data: { recipientId: t.profileId, type: 'system', title: TEACHER_PHOTO_ASK.title[l], body: teacherPhotoAskBody(reason, l), actorName: SITE_NAME, url: TEACHER_PHOTO_ASK_PATH },
            })
          }
          await appendAudit(tx, {
            actorType: 'system', actorId: null, action: 'teacher.photo.ask', subjectType: 'profile', subjectId: t.profileId,
            detail: { key, reason, listingId: t.listingId, mail: mailOutcome, ...(bellToo ? {} : { retry: true }) },
          })
        })
        if (bellToo) asked++
        if (!MAIL_DONE.has(mailOutcome)) mailPending++
        flagged.push({ listingId: t.listingId, reason, asked: true })
      } finally {
        // Best-effort: a claim that is not released expires in 15 minutes.
        await kv.del(CLAIM(t.profileId)).catch((e) => logError(e, { op: 'teachers.photo_recheck.release' }))
      }
    } catch (e) {
      failed++
      console.error('[teacher-photo-recheck] teacher failed', { profileId: t.profileId, err: (e as Error)?.message })
    }
  }
  return {
    ok: failed === 0 && unchecked === 0 && busy === 0 && uncertain === 0 && mailPending === 0,
    dryRun, teachers: teachers.length, passed, flagged, asked, emailed, uncertain, mailPending, already, overridden, unchecked, noPhoto, busy, failed,
    mail: mailEnabled(),
  }
})
