import { db } from '@/lib/db'
import { ApiError, route } from '@/lib/api/handler'
import { GRANT_PREFIX, PENDING_AT } from '@/lib/api/oauth-grant'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * DELETE /api/connected-apps/<app> — Disconnect: revokes EVERY live grant of that app on this account (each device's),
 * so one tap ends the app's access, at once (resolveApiKey checks the grant on every call). Only this account's rows.
 * `<app>` is the 10-hex binding GET /api/connected-apps returns. Revoked, not deleted: the record of the connection
 * ages out with the grant (the privacy policy's "Connected apps" line).
 */
export const DELETE = route({ auth: 'userId', rateLimit: { bucket: 'connected-apps-revoke', limit: 30, window: '1 m' } }, async ({ params, userId }) => {
  const app = String(params.app || '')
  // 10 hex = an app (its client binding); 22 = one agent registration (its whole prefix — GET's row id for those).
  if (!/^[0-9a-f]{10}$|^[0-9a-f]{22}$/.test(app)) throw new ApiError('bad_request', 400)
  const r = await db.apiKey.updateMany({
    // ⛔ A PENDING sign-in too (Allow pressed, code not yet redeemed): left alive, the app's redemption would reconnect it
    // seconds after Disconnect (gate review 2026-11-17). redeemCode activates only a row still at PENDING_AT.
    where: { profileId: userId, prefix: { startsWith: `${GRANT_PREFIX}${app}` }, OR: [{ revokedAt: null }, { revokedAt: PENDING_AT }] },
    data: { revokedAt: new Date() },
  })
  if (r.count === 0) throw new ApiError('not_found', 404)
  return { disconnected: r.count }
})
