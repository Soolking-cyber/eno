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

/**
 * The current access token, or a NAMED failure.
 *
 * ⚠️ THROWS RATHER THAN RETURNING EMPTY. A caller that receives `''` will happily send
 * `Authorization: Bearer ` and get a generic 401 from VNPT — indistinguishable from wrong
 * credentials, a wrong endpoint, or a revoked account. Naming the failure here is what turns a
 * three-hour debug into a one-line fix, and this WILL happen roughly three times a day until the
 * minting API lands.
 */
// ── Minting: single-flight, with a cooldown so an outage cannot become a storm ───────────────────
//
// ⚠️ ONE MINT PER INSTANCE PER BURST. Without this, a cold start that takes 40 concurrent requests
// mints 40 tokens. The shared Postgres row already stops OTHER instances minting (they read a valid
// token), so this in-process latch plus the row is the whole concurrency story.
//
// ⚠️ AND A COOLDOWN ON FAILURE, WHICH BOTH REVIEWERS INSISTED ON. Without it, a VNPT auth outage
// turns into a self-inflicted DDoS: every verification finds no usable token, mints, fails, and the
// next request does it again — amplifying their incident into ours, from every instance at once.
// A failed mint is remembered briefly and the failure is returned directly.
const MINT_COOLDOWN_MS = 60_000
let inFlight: Promise<{ token: string; expiresAt: Date } | { error: string }> | null = null
let lastFailure: { at: number; reason: string } | null = null

export function clearTokenCache() { cache = null; inFlight = null; lastFailure = null }

/**
 * ⚠️ THIS MUST NEVER REJECT — it must always RESOLVE to a value, and all three reviewers caught why.
 * A throw from `persist()` (a Postgres blip), or from the dynamic import, propagated straight out of
 * `getAccessToken()`, skipping BOTH the `lastFailure` cooldown and the still-valid-token fallback.
 * So a database hiccup during the refresh window killed verification outright AND left every
 * subsequent request free to hammer VNPT again. Converting the throw into `{ error }` puts those two
 * protections back on the path.
 */
async function mintAndStore(now: number): Promise<{ token: string; expiresAt: Date } | { error: string }> {
  try {
    const { mintAccessToken } = await import('./vnpt-auth')
    const r = await mintAccessToken(now)
    if (!r.ok) return { error: r.reason }
    // ⚠️ A FAILED PERSIST IS NOT A FAILED MINT. We hold a good token; failing to cache it in Postgres
    // costs efficiency (the next instance mints its own), not correctness. Returning the token is
    // strictly better than discarding it and reporting failure.
    try {
      await persist(r.token, r.expiresAt, 'auto-mint')
    } catch {
      cache = null
    }
    return { token: r.token, expiresAt: r.expiresAt }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'mint failed' }
  }
}

/** Single-flight wrapper. ⚠️ The latch is cleared in `finally` — a rejected promise left in place
 *  would make every later call replay the same failure forever (codex). */
function mintOnce(now: number): Promise<{ token: string; expiresAt: Date } | { error: string }> {
  if (!inFlight) {
    inFlight = mintAndStore(now).finally(() => { inFlight = null })
  }
  return inFlight
}

export async function getAccessToken(now: number = Date.now()): Promise<string> {
  if (cache && now - cache.readAt < CACHE_MS && cache.expiresAt.getTime() - now > EXPIRY_SKEW_MS) {
    return cache.token
  }

  const rows = await db.$queryRaw<{ access_token: string; expires_at: Date }[]>`
    SELECT access_token, expires_at FROM public.vnpt_access_token WHERE id = 1
  `
  const row = rows[0]
  const usable = row && row.expires_at.getTime() - now > EXPIRY_SKEW_MS

  if (usable) {
    cache = { token: row.access_token, expiresAt: row.expires_at, readAt: now }
    return row.access_token
  }

  // ⚠️ THE ENV VAR IS A FALLBACK FOR A MISSING ROW, NOT AN OVERRIDE THAT WINS. codex caught that
  // "the env var wins if set" (which the plan said) creates a poison path: a stale
  // VNPT_EKYC_ACCESS_TOKEN would beat every freshly minted token, deleting the row would change
  // nothing, and the only cure would be a new Cloud Run revision. It is also checked for expiry now
  // — an unchecked env token is exactly the silent 401 source this module exists to remove.
  if (!row) {
    const envToken = process.env.VNPT_EKYC_ACCESS_TOKEN
    if (envToken && process.env.NODE_ENV !== 'production') {
      const claims = readTokenClaims(envToken)
      if (claims && claims.exp * 1000 - now > EXPIRY_SKEW_MS) return envToken
    }
  }

  // ⚠️ ORDER MATTERS HERE AND I GOT IT WRONG FIRST — all three reviewers caught the same thing.
  // The cooldown guard used to sit ABOVE this, with a comment claiming that reaching it "means we
  // genuinely have nothing". That was false: `usable` demands MORE than EXPIRY_SKEW_MS of life, so
  // a token with 60 seconds left is not "usable" but is very much alive. With `lastFailure` set,
  // every request for the next 60s threw while a working token sat in the row — the cooldown (added
  // for codex) silently cancelling the still-valid fallback (added for agy). Two individually
  // correct fixes that were wrong together.
  //
  // So: exhaust every token we ALREADY HAVE before considering whether we may mint.
  const stillAlive = row && row.expires_at.getTime() > now ? row.access_token : null

  if (lastFailure && now - lastFailure.at < MINT_COOLDOWN_MS) {
    if (stillAlive) return stillAlive
    throw new VnptTokenUnavailable('missing', `VNPT token mint failed recently: ${lastFailure.reason}`)
  }

  const minted = await mintOnce(now)
  if ('token' in minted) {
    lastFailure = null
    cache = { token: minted.token, expiresAt: minted.expiresAt, readAt: now }
    return minted.token
  }

  lastFailure = { at: now, reason: minted.error }

  // ⚠️ A FAILED REFRESH FALLS BACK TO THE STILL-VALID TOKEN. We refresh 2 minutes before expiry, so
  // a mint that fails in that window (a 429, a blip) would otherwise send every verification to
  // manual review while a perfectly good token sat in the row.
  if (stillAlive) return stillAlive

  throw new VnptTokenUnavailable(
    row ? 'expired' : 'missing',
    `Could not obtain a VNPT access token: ${minted.error}`,
  )
}

/**
 * Drop a token that the provider has just rejected.
 *
 * ⚠️ CONDITIONAL ON THE EXACT TOKEN THAT FAILED — both reviewers caught this independently. An
 * unconditional delete lets a slow request holding token A return 401 *after* another instance
 * stored a freshly minted token B, and wipe B. The next call mints again, and under load that
 * oscillates. Deleting only when the stored token is still the failing one makes a late 401 a no-op.
 */
export async function invalidateAccessToken(failed: string): Promise<void> {
  // ⚠️ DROP THE IN-PROCESS CACHE FIRST, BEFORE THE DATABASE (codex). The caller swallows errors from
  // this function, so with the order reversed a Postgres failure would leave a token we KNOW is dead
  // sitting in `cache`, resent on every request until the 60s cache window lapsed — turning one 401
  // into a minute of them. Forgetting a live token locally is free; remembering a dead one is not.
  if (cache?.token === failed) cache = null
  await db.$executeRaw`
    DELETE FROM public.vnpt_access_token WHERE id = 1 AND access_token = ${failed}
  `
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
  await persist(token, expiresAt, updatedBy)
  return { expiresAt }
}

/**
 * The write itself, shared by the manual paste path and the auto-mint path.
 *
 * ⚠️ THE CALLER SUPPLIES THE EXPIRY; THIS DOES NOT RE-DERIVE IT FROM THE JWT. codex caught that the
 * old body recomputed `exp` internally, which would have silently discarded the `expires_in` half of
 * `effectiveExpiry()` on every minted token — so the MIN() rule would have been decorative.
 *
 * ⚠️ LAST WRITE WINS, NOT "LATER EXPIRY WINS". The plan had a conditional upsert keyed on
 * `expires_at`; codex pointed out that expiry is not a validity ordering — a revoked token with a
 * later expiry would then permanently block a freshly minted valid one. Every write here comes from
 * a mint that just succeeded or a human pasting deliberately, so newest is the right answer.
 */
async function persist(token: string, expiresAt: Date, updatedBy: string): Promise<void> {
  await db.$executeRaw`
    INSERT INTO public.vnpt_access_token (id, access_token, expires_at, updated_at, updated_by)
    VALUES (1, ${token}, ${expiresAt}, now(), ${updatedBy})
    ON CONFLICT (id) DO UPDATE
      SET access_token = EXCLUDED.access_token,
          expires_at   = EXCLUDED.expires_at,
          updated_at   = now(),
          updated_by   = EXCLUDED.updated_by
  `
  // ⚠️ Reset the READ cache only. Using clearTokenCache() here would also null `inFlight` while the
  // mint that is calling us is still settling, so a concurrent caller would start a second mint —
  // defeating the single-flight latch from inside it.
  cache = null
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
