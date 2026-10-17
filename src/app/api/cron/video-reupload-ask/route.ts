import { route } from '@/lib/api/handler'
import { db } from '@/lib/db'
import { kv } from '@/lib/ratelimit'
import { logError } from '@/lib/log'
import { appendAudit } from '@/lib/compliance/audit'
import { sendMailOnce, mailEnabled } from '@/lib/mail'
import { pickLocale } from '@/lib/admin-macros'
import { IS_MARKETPLACE, SITE_NAME } from '@/lib/edition'
import { scopedListingWhere } from '@/lib/edition-scope'
import { clipAudioLevel, SILENT_MEAN_DB } from '@/lib/core/video-audio-level'
import { VIDEO_REUPLOAD_ASK, renderVideoReuploadAsk, videoReuploadBody, videoReuploadPath } from '@/lib/emails/video-reupload-ask'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 900

/**
 * THE VIDEOS THAT WENT UP SILENT (owner, 2026-10-17: "reupload those 4 with sound … you send them automatically that
 * leads to the load page so they can reupload" — "also email"). Until db7eac156 every clip the browser compressed (over
 * 50 MB) went up with an AAC track of digital silence; the original never reached us, so only the uploader can put it
 * right. ⛔ ONLY THE LISTINGS NAMED (`?ids=`, at most 10) — never a sweep of the site: a clip whose own sound is silence (a
 * muted export, a screen recording) is not our fault, and must never get an apology for one (gate review, 2026-10-17).
 * Each named listing's video has its sound MEASURED (src/lib/core/video-audio-level.ts — ffmpeg volumedetect over the whole
 * clip, eno's own storage only); a silent one (≤ −80 dB) gets ONE ask, in the app and by email, linking to where the video
 * is replaced (a teacher's edit form, else the listing's editor). Nobody is hidden for it.
 * Run BY HAND on the box after the deploy, `dryRun=1` first — it measures and lists, asks nobody, writes nothing:
 *   curl -H "Authorization: Bearer $(docker exec eno-vn-app printenv CRON_SECRET)" -H 'Host: eno.vn' \
 *     'http://127.0.0.1:3001/api/cron/video-reupload-ask?dryRun=1&ids=<listing id>,<listing id>'
 * Re-run until `unchecked` is 0: a clip that could not be measured is left for the next run, never asked on a guess.
 * ⛔ ONCE PER (listing, video), the photo recheck's pattern (teacher-photo-recheck): the durable record is the audit row
 * `listing.video.reupload_ask` {key, mail}; a re-uploaded video is a new key — and has its sound. A claim (kv, nx, 15 min)
 * keeps two runs off the same listing and the record is read again under it. THE EMAIL GOES FIRST (Resend idempotency key
 * per listing and video), then the bell + audit row in one transaction; an email that did not go is recorded as such and
 * tried again by the next run — the email alone, never a second bell.
 * Marketplace only: one database serves both editions. The answer names listing ids and levels — never a name or address.
 */
const ORIGIN = process.env.NEXT_PUBLIC_APP_URL || `https://${SITE_NAME}`
/** Each clip may take up to a minute to measure (video-audio-level.ts), and the route has 15: ten names a run. */
const MAX_IDS = 10
const ACTION = 'listing.video.reupload_ask'
const CLAIM = (listingId: string) => `video-reupload-ask:claim:${listingId}`
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
/** The email went, may have gone, or there is no address to send to: nothing more to do. */
const MAIL_DONE: ReadonlySet<string> = new Set(['sent', 'unknown', 'no_address'])

/** The last ask recorded for this video — its mail outcome says whether the email still has to go. */
async function lastAsk(listingId: string, key: string): Promise<{ mail: string } | null> {
  const row = await db.complianceAudit.findFirst({
    where: { action: ACTION, subjectType: 'listing', subjectId: listingId, detail: { path: ['key'], equals: key } },
    orderBy: { occurredAt: 'desc' },
    select: { detail: true },
  })
  if (!row) return null
  const mail = (row.detail as { mail?: unknown } | null)?.mail
  return { mail: typeof mail === 'string' ? mail : 'sent' }
}

/** A level for the JSON answer: −Infinity (digital zero) does not survive JSON.stringify. */
const shown = (v: number) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : '-inf')

export const GET = route({ auth: 'cron' }, async ({ req }) => {
  if (!IS_MARKETPLACE) return { ok: true, skipped: 'marketplace_only' }
  const params = new URL(req.url).searchParams
  const dryRun = params.get('dryRun') === '1'
  const ids = [...new Set((params.get('ids') ?? '').split(',').map((x) => x.trim()).filter((x) => /^[a-z0-9]{20,40}$/.test(x)))]
  if (!ids.length || ids.length > MAX_IDS) return { ok: false, error: 'ids_required', max: MAX_IDS }
  // The marketplace scope (edition-lint Rule A — the e-visa desk's rows never reach eno.vn's code), teachers INCLUDED: two
  // of the silent videos are teacher intros, and scopedListingWhere leaves teachers out unless asked.
  const listings = await db.listing.findMany({
    where: await scopedListingWhere({ id: { in: ids }, video: { not: null }, status: { not: 'removed' } }, { teachers: true }),
    select: {
      id: true,
      video: true,
      seller: { select: { ownerId: true, owner: { select: { email: true, locale: true, displayName: true } } } },
      teacherProfile: { select: { fullName: true, private: { select: { email: true } } } },
    },
    orderBy: { createdAt: 'asc' },
  })

  const silent: Array<{ listingId: string; meanDb: number | string; asked: boolean }> = []
  let withSound = 0, noAudio = 0, unchecked = 0, noOwner = 0, already = 0, replaced = 0, asked = 0, emailed = 0, uncertain = 0, mailPending = 0, busy = 0, failed = 0
  let stop = !mailEnabled()
  let unknownRun = 0
  for (const l of listings) {
    const key = l.video
    if (!key) continue
    try {
      const level = await clipAudioLevel(key)
      if (!level) { unchecked++; continue }
      // A clip that never had a sound track is not this fault (a screen recording, a muted export): nothing to ask.
      if (!level.hasAudio) { noAudio++; continue }
      if (level.meanDb > SILENT_MEAN_DB) { withSound++; continue }
      const ownerId = l.seller?.ownerId
      const owner = l.seller?.owner
      // A guest seller with no claimed account cannot be reached (admin/message's rule): listed, never asked.
      if (!ownerId || !owner) { noOwner++; silent.push({ listingId: l.id, meanDb: shown(level.meanDb), asked: false }); continue }
      const before = await lastAsk(l.id, key)
      if (before && MAIL_DONE.has(before.mail)) { already++; silent.push({ listingId: l.id, meanDb: shown(level.meanDb), asked: true }); continue }
      if (dryRun) { silent.push({ listingId: l.id, meanDb: shown(level.meanDb), asked: !!before }); continue }

      // Another run is on this listing right now: leave it to that run.
      if ((await kv.set(CLAIM(l.id), 1, { nx: true, ex: 900 })) === null) { busy++; continue }
      try {
        // Read again under the claim: another run may have asked between the read above and the claim — and the uploader
        // may have replaced the video since it was measured (a new one goes up with its sound): then nothing to ask.
        const now = await lastAsk(l.id, key)
        if (now && MAIL_DONE.has(now.mail)) { already++; continue }
        // …and the listing must still be the same owner's, and not removed: a measurement can take a minute (gate review).
        // The address and language are read HERE too, not from before the measurement: one changed meanwhile is the one used.
        const current = await db.listing.findFirst({
          where: await scopedListingWhere({ id: l.id }, { teachers: true }),
          select: { video: true, status: true, seller: { select: { ownerId: true, owner: { select: { email: true, locale: true } } } }, teacherProfile: { select: { private: { select: { email: true } } } } },
        })
        if (current?.video !== key || current.status === 'removed' || current.seller?.ownerId !== ownerId) { replaced++; continue }
        const bellToo = !now
        const loc = pickLocale(current.seller?.owner?.locale)
        const to = current.seller?.owner?.email || current.teacherProfile?.private?.email
        const path = videoReuploadPath(l.id, !!l.teacherProfile)
        // A retry with nobody to email (the address is gone) is done — recorded as such, never pending forever (gate review).
        if (!bellToo && stop && to) { mailPending++; continue }
        let mailOutcome: string = to ? 'skipped' : 'no_address'
        if (to && !stop) {
          const mail = renderVideoReuploadAsk({ origin: ORIGIN, siteName: SITE_NAME, recipientName: l.teacherProfile?.fullName || owner.displayName, locale: loc, path })
          const idempotencyKey = `video-reupload-ask:${l.id}:${key.split('/').pop()}`
          let res = await sendMailOnce({ to, ...mail }, { idempotencyKey })
          // An 'unknown' first try may have gone out — the retry carries the same key (mail.ts).
          const mayHaveSent = res.outcome === 'unknown'
          if (mayHaveSent) { await sleep(5000); res = await sendMailOnce({ to, ...mail }, { idempotencyKey, afterUnknown: true }) }
          mailOutcome = mayHaveSent && res.outcome !== 'sent' ? 'unknown' : res.outcome
          if (res.outcome === 'sent') { emailed++; unknownRun = 0 } else if (mailOutcome === 'unknown') {
            uncertain++; unknownRun++
            console.warn('[video-reupload-ask] uncertain send', { listingId: l.id, outcome: res.outcome })
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
              data: { recipientId: ownerId, type: 'system', title: VIDEO_REUPLOAD_ASK.title[loc], body: videoReuploadBody(loc), actorName: SITE_NAME, listingId: l.id, url: path },
            })
          }
          await appendAudit(tx, {
            actorType: 'system', actorId: null, action: ACTION, subjectType: 'listing', subjectId: l.id,
            detail: { key, meanDb: shown(level.meanDb), mail: mailOutcome, ...(bellToo ? {} : { retry: true }) },
          })
        })
        if (bellToo) asked++
        if (!MAIL_DONE.has(mailOutcome)) mailPending++
        silent.push({ listingId: l.id, meanDb: shown(level.meanDb), asked: true })
      } finally {
        // Best-effort: a claim that is not released expires in 15 minutes.
        await kv.del(CLAIM(l.id)).catch((e) => logError(e, { op: 'video_reupload_ask.release' }))
      }
    } catch (e) {
      failed++
      console.error('[video-reupload-ask] listing failed', { listingId: l.id, err: (e as Error)?.message })
    }
  }
  return {
    ok: failed === 0 && unchecked === 0 && busy === 0 && uncertain === 0 && mailPending === 0,
    dryRun, named: ids.length, videos: listings.length, withSound, noAudio, silent, asked, emailed, uncertain, mailPending, already, replaced, noOwner, unchecked, busy, failed,
    mail: mailEnabled(),
  }
})
