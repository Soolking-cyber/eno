import 'server-only'
import webpush from 'web-push'
import { db } from './db'

// Configure VAPID once per process. If the keys aren't set (e.g. local dev
// without push configured), sending becomes a safe no-op rather than throwing.
const PUBLIC = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
const PRIVATE = process.env.VAPID_PRIVATE_KEY
const SUBJECT = process.env.VAPID_SUBJECT || 'mailto:support@eno.forum'
let configured = false
if (PUBLIC && PRIVATE) {
  webpush.setVapidDetails(SUBJECT, PUBLIC, PRIVATE)
  configured = true
} else if (process.env.NODE_ENV === 'production') {
  console.warn('[push] VAPID keys not set — web push disabled.')
}

export type PushPayload = { title: string; body?: string; url?: string; tag?: string }

/**
 * Send a Web Push to every device a profile registered. Dead endpoints (410
 * Gone / 404) are pruned so the table self-cleans. Best-effort: failures are
 * swallowed per-subscription so one bad endpoint never aborts the rest.
 * Returns the number of successful deliveries.
 */
export async function sendPushToProfile(profileId: string, payload: PushPayload): Promise<number> {
  if (!configured) return 0
  const subs = await db.pushSubscription.findMany({ where: { profileId } })
  if (subs.length === 0) return 0

  const body = JSON.stringify(payload)
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
  return sent
}
