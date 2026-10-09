import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { route } from '@/lib/api/handler'
import { isAllowedPushEndpoint } from '@/lib/ssrf'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Is this browser's Web Push subscription registered to the signed-in account? (F7)
 *
 * ⛔ A BROWSER KEEPS ITS SUBSCRIPTION ACROSS ACCOUNTS. Only signOut() tore it down, so after a switch with no sign-out
 * between — a sign-in from the thread page's "session ended" card, a sign-in in another tab, or the previous account's
 * session expiring while the page was closed and the next one signing in after a reload — the endpoint stayed
 * registered to the previous account. Its offers, answers and alerts kept showing on the device the next person was
 * using, and the service worker set that account's badge. The client asks this on every sign-in
 * (src/lib/push-account-guard.ts) and drops a subscription that is not the caller's, so the next account can opt in
 * itself — never re-homed silently: it did not consent on this device.
 *
 * POST with the endpoint in the BODY: a push endpoint is a capability URL and must not travel in a query string (logs).
 * `mine`: a row with this endpoint is the caller's. `known`: a row exists at all. Only `known && !mine` is a subscription
 * another account receives through — with no row nothing is pushed to it (a fresh opt-in still posting, an unsaved one,
 * a pruned one), and the client keeps it. Neither says WHOSE a row is; the caller already holds the endpoint.
 * `me` names the account the answer was made for; the client acts only when that is still the account that asked.
 * `auth: 'userId'` — nothing is written here.
 */
export const POST = route({ auth: 'userId' }, async ({ req, userId }) => {
  let body: { endpoint?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }
  const endpoint = typeof body?.endpoint === 'string' ? body.endpoint : ''
  if (!endpoint || !isAllowedPushEndpoint(endpoint)) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  const row = await db.pushSubscription.findUnique({ where: { endpoint }, select: { profileId: true } })
  return { me: userId, mine: row?.profileId === userId, known: !!row }
})
