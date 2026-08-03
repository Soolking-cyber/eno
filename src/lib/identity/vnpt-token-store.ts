import 'server-only'
import { readTokenClaims, needsRefresh } from './vnpt-auth'

// ── The 8-hour access token, stored where it can be rotated without a deploy ─────────────────────
//
// Owner, 2026-08-03: run on the manual 8h token for now; the minting API is requested from VNPT.
//
// ⚠️ IT LIVES IN POSTGRES, NOT SECRET MANAGER, AND THAT IS THE WHOLE REASON THIS FILE EXISTS.
// Cloud Run reads secrets at REVISION START. A token in `eno-root-env` could only be rotated by
// cutting a new revision — three deploys a day, every day, forever, and a deploy is a deploy: full
// build, full rollout, on a live marketplace. A row is an UPDATE, live within the cache window
// below, with no build and no rollout. Same reasoning as zalo_oauth_token.
//
// ⚠️ THE ENV VAR IS A FALLBACK, NOT THE SOURCE. `VNPT_EKYC_ACCESS_TOKEN` stays supported for local
// development, but production reads the table — otherwise the two disagree and the one that wins
// depends on deploy timing, which is the worst possible way to resolve a credential.
//
// ⚠️ THIS IS TEMPORARY BY CONSTRUCTION. When VNPT provides the token-generation API, the mint call
// writes into this same row and `getAccessToken()` does not change. Nothing downstream knows the
// difference between a hand-pasted token and a minted one — which is the point of putting the
// indirection in now rather than after.

import { db } from '@/lib/db'

/** Rotation is visible within this window. Short enough to be operationally sane, long enough that
 *  a burst of verifications does not hammer the row. */
const CACHE_MS = 60_000

/** ⚠️ Refuse a token this close to expiry rather than start a call that will die mid-flight — an
 *  eKYC upload can take tens of seconds, and a 401 halfway through looks like a credential problem
 *  rather than a clock problem. */
const EXPIRY_SKEW_MS = 2 * 60_000

let cache: { token: string; expiresAt: Date; readAt: number } | null = null

export class VnptTokenUnavailable extends Error {
  constructor(readonly reason: 'missing' | 'expired', detail: string) {
    super(detail)
    this.name = 'VnptTokenUnavailable'
  }
}

/** Test seam + explicit reset after a rotation writes. */
export function clearTokenCache() { cache = null }

/**
 * The current access token, or a NAMED failure.
 *
 * ⚠️ THROWS RATHER THAN RETURNING EMPTY. A caller that receives `''` will happily send
 * `Authorization: Bearer ` and get a generic 401 from VNPT — indistinguishable from wrong
 * credentials, a wrong endpoint, or a revoked account. Naming the failure here is what turns a
 * three-hour debug into a one-line fix, and this WILL happen roughly three times a day until the
 * minting API lands.
 */
export async function getAccessToken(now: number = Date.now()): Promise<string> {
  if (cache && now - cache.readAt < CACHE_MS && cache.expiresAt.getTime() - now > EXPIRY_SKEW_MS) {
    return cache.token
  }

  const rows = await db.$queryRaw<{ access_token: string; expires_at: Date }[]>`
    SELECT access_token, expires_at FROM public.vnpt_access_token WHERE id = 1
  `
  const row = rows[0]

  if (!row) {
    // Local dev may still use the env var; production should not.
    const envToken = process.env.VNPT_EKYC_ACCESS_TOKEN
    if (envToken) return envToken
    throw new VnptTokenUnavailable(
      'missing',
      'No VNPT access token stored. Paste the 8h token from Token Management with:  ./scripts/vnpt-token.sh',
    )
  }

  if (row.expires_at.getTime() - now <= EXPIRY_SKEW_MS) {
    throw new VnptTokenUnavailable(
      'expired',
      `VNPT access token expired at ${row.expires_at.toISOString()}. It lasts 8 hours and there is ` +
      'no minting API yet — refresh it with:  ./scripts/vnpt-token.sh',
    )
  }

  cache = { token: row.access_token, expiresAt: row.expires_at, readAt: now }
  return row.access_token
}

/**
 * Store a token, deriving expiry from the JWT itself.
 *
 * ⚠️ READ `exp` FROM THE TOKEN, NEVER ASSUME 8 HOURS. The console says 8h and a token I measured
 * carried 24h — they disagree, and a hardcoded lifetime would either expire a valid token early or,
 * worse, keep using a dead one. The token is the authority on its own lifetime.
 */
export async function storeAccessToken(token: string, updatedBy: string): Promise<{ expiresAt: Date }> {
  const claims = readTokenClaims(token)
  if (!claims) throw new Error('Not a parseable JWT — refusing to store a token whose expiry cannot be read.')
  const expiresAt = new Date(claims.exp * 1000)
  if (needsRefresh(claims)) {
    // Storing an already-stale token would "succeed" and then fail on first use.
    throw new Error(`That token expires at ${expiresAt.toISOString()} — it is already stale. Copy a fresh one.`)
  }
  await db.$executeRaw`
    INSERT INTO public.vnpt_access_token (id, access_token, expires_at, updated_at, updated_by)
    VALUES (1, ${token}, ${expiresAt}, now(), ${updatedBy})
    ON CONFLICT (id) DO UPDATE
      SET access_token = EXCLUDED.access_token,
          expires_at   = EXCLUDED.expires_at,
          updated_at   = now(),
          updated_by   = EXCLUDED.updated_by
  `
  clearTokenCache()
  return { expiresAt }
}

/** For an ops/health surface: how long is left, without exposing the token. */
export async function tokenStatus(now: number = Date.now()): Promise<
  { state: 'missing' } | { state: 'ok' | 'expiring' | 'expired'; expiresAt: Date; minutesLeft: number }
> {
  const rows = await db.$queryRaw<{ expires_at: Date }[]>`
    SELECT expires_at FROM public.vnpt_access_token WHERE id = 1
  `
  if (!rows[0]) return { state: 'missing' }
  const ms = rows[0].expires_at.getTime() - now
  const minutesLeft = Math.floor(ms / 60_000)
  // ⚠️ WARN AT AN HOUR, NOT AT ZERO. With no minting API a human has to act, and telling them the
  // moment it breaks is telling them too late.
  const state = ms <= 0 ? 'expired' : ms < 60 * 60_000 ? 'expiring' : 'ok'
  return { state, expiresAt: rows[0].expires_at, minutesLeft }
}
