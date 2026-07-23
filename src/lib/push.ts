import 'server-only'
import webpush from 'web-push'
import { db } from './db'
import { sendNativePushToProfile } from './native-push'
import { badgeCountFor } from './unread'

// Configure VAPID once per process. If the keys aren't set (e.g. local dev
// without push configured), sending becomes a safe no-op rather than throwing.
const PUBLIC = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
const PRIVATE = process.env.VAPID_PRIVATE_KEY
const SUBJECT = process.env.VAPID_SUBJECT || 'mailto:support@eno.vn'
let configured = false
if (PUBLIC && PRIVATE) {
  webpush.setVapidDetails(SUBJECT, PUBLIC, PRIVATE)
  configured = true
} else if (process.env.NODE_ENV === 'production') {
  console.warn('[push] VAPID keys not set — web push disabled.')
}

export type PushPayload = { title: string; body?: string; url?: string; tag?: string; badge?: number }

/**
 * Send a Web Push to every device a profile registered. Dead endpoints (410
 * Gone / 404) are pruned so the table self-cleans. Best-effort: failures are
 * swallowed per-subscription so one bad endpoint never aborts the rest.
 * Returns the number of successful deliveries.
 */
export async function sendPushToProfile(profileId: string, payload: PushPayload): Promise<number> {
  // Fan out to NATIVE (Capacitor) devices too — a no-op until FCM/APNs is configured (see
  // native-push.ts). Fire-and-forget so it never changes web-push latency or the return value,
  // and so it still fires even when web push (VAPID) isn't configured.
  // Part of the AWAITED work (audit P2): callers run this inside after(), which only
  // keeps the lambda alive until the returned promise settles — a detached native
  // branch was frozen mid-flight on serverless whenever web-push finished first.
  const native = sendNativePushToProfile(profileId, payload).catch(() => {})
  if (!configured) return 0
  const subs = await db.pushSubscription.findMany({ where: { profileId } })
  if (subs.length === 0) return 0

  // Stamp the recipient's CURRENT unread total so the service worker (public/sw.js) can set the
  // home-screen app-icon badge while the PWA is closed. Done centrally here so EVERY call site
  // (message, offer, price-drop, dispute, enforcement, reminders) carries a correct absolute count
  // with no per-site edits — the same badgeCountFor() the native aps.badge path already uses. It
  // never throws; on a null count we omit the field and the SW leaves the badge untouched. Placed
  // after the empty-subs return so we never pay for the two aggregates when there's nothing to send.
  let badge = payload.badge
  if (badge == null) {
    const c = await badgeCountFor(profileId)
    if (c != null) badge = c
  }
  const body = JSON.stringify(badge == null ? payload : { ...payload, badge })
  const dead: string[] = []
  let sent = 0

  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body)
        sent++
      } catch (e: unknown) {
        const code = (e as { statusCode?: number })?.statusCode
        if (code === 404 || code === 410) dead.push(s.endpoint)
      }
    }),
  )

  // Scope the prune to THIS profile's rows so a concurrent re-home of the same
  // endpoint to another account isn't clobbered by our stale 410.
  if (dead.length) await db.pushSubscription.deleteMany({ where: { profileId, endpoint: { in: dead } } })
  await native
  return sent
}
