import 'server-only'
import crypto from 'crypto'
import { SITE_NAME } from '@/lib/edition'

// ── Partner API · OAuth 2.0 client-credentials access tokens ──────────────────────
// An alternative to sending the raw `eno_live_` key on every request: a client exchanges
// its key (client_id = key prefix, client_secret = full key) at /api/v1/oauth/token for a
// short-lived, stateless **HS256 JWT** access token. resolveApiKey accepts either form.
//
// Signing key: derived via HKDF from SUPABASE_SECRET_KEY (always present) with a dedicated
// context label, so it is cryptographically separate from Supabase's own JWTs and needs NO
// new env var (which we can't provision). Tokens are stateless — revoking the underlying
// key takes effect within TTL_SECONDS (standard bearer-token semantics), so keep TTL short.

export const TOKEN_TTL_SECONDS = 3600 // 1 hour

/**
 * ⚠️ SAME DERIVATION AS layout.tsx, llms.txt AND api/v1/openapi.json — deliberately, and it is
 * the only one that describes THIS deployment. next.config.ts asserts NEXT_PUBLIC_APP_URL is
 * present and on the edition's expected host (`eno.vn` for marketplace, `www.eno.forum` for
 * services) whenever NEXT_PUBLIC_ENO_EDITION is set, so this value cannot silently be the other
 * domain's. The `https://${SITE_NAME}` fallback only covers the transitional case where neither
 * variable is set (local vitest, a pre-Phase-1 image); the older literal `'https://eno.vn'`
 * fallback used elsewhere in the repo would name the LICENSED marketplace on a forum build,
 * which is the leak class edition.ts exists to prevent.
 */
const SITE_ORIGIN = (process.env.NEXT_PUBLIC_APP_URL || `https://${SITE_NAME}`).replace(/\/+$/, '')

/**
 * The `iss` we MINT. Exported because the RFC 8414 / RFC 9728 metadata documents under
 * src/app/api/well-known/ must publish byte-identical values — a discovery document whose
 * `issuer` disagrees with the `iss` in the token it describes is worse than no document at all,
 * because a conforming client rejects the token rather than ignoring the metadata.
 *
 * ⛔ IT WAS HARDCODED `'https://eno.vn'` UNTIL 2026-08-23, ON BOTH EDITIONS. /api/v1 compiles into
 * the services build too, so every token eno.forum issued claimed to have been issued by the
 * licensed Vietnamese marketplace — the same shape as the openapi spec that pointed forum clients
 * at eno.vn, and the static llms.txt that introduced eno.forum as eno.vn.
 */
export const OAUTH_ISSUER = SITE_ORIGIN

/**
 * ⛔ VERIFICATION ACCEPTS THE OLD ISSUER TOO, AND THAT IS A DELIBERATE TRANSITION WINDOW — NOT
 * sloppiness, and not permanent.
 *
 * Tokens are STATELESS with a 1-hour TTL (TOKEN_TTL_SECONDS), so at the instant this change is
 * deployed there is up to an hour of already-minted, still-valid tokens in partners' hands
 * carrying `iss: "https://eno.vn"`. If verifyAccessToken only accepted the new value, every one
 * of those 401s mid-flight — a partner's sync job dies halfway through, on a deploy that changed
 * nothing they can see. The forum is the obvious victim (its issuer changes to
 * https://www.eno.forum), but the marketplace is affected too if its NEXT_PUBLIC_APP_URL ever
 * carries a `www.` prefix, since next.config.ts's host assertion is www-INSENSITIVE.
 *
 * ⚠️ THIS COSTS NOTHING SECURITY-WISE, WHICH IS WHY IT IS SAFE TO DO AT ALL. Both editions derive
 * the signing key by HKDF from the SAME SUPABASE_SECRET_KEY (one Supabase project serves both), so
 * the `iss` check was NEVER a cross-edition boundary — a forum-issued token already verified on
 * eno.vn and vice versa, before and after this change. What the check actually defends against is
 * a token minted by some OTHER system that happens to share our secret material, which the
 * two-value allowlist still rejects (see the evil.example case in oauth.test.ts).
 *
 * ⏱ IT CLOSES ITSELF, AND IT IS ANCHORED TO THE DEPLOY RATHER THAN TO A DATE. Two reviewers
 * caught successive versions of this, and the second catch is the interesting one.
 *
 * First version: no cutoff at all, just a comment saying "remove this later". That is not a
 * transition window, it is a permanent widening with a TODO attached.
 *
 * Second version: a hardcoded `Date.parse('2026-08-25…')`. That is worse than it looks, because
 * deploys here are OWNER-GATED and commit-to-deploy gaps of days or weeks are normal. Ship this
 * after the hardcoded date and the window is already shut on arrival — every in-flight token
 * carrying the old issuer 401s at the swap, which is EXACTLY the mid-job partner breakage the
 * window exists to prevent. The slack was measured from the wrong end: authoring time.
 *
 * This version anchors to PROCESS START. The tokens that need protecting are the ones minted by
 * the PREVIOUS revision, and they cannot outlive it by more than TOKEN_TTL_SECONDS. So once this
 * process has been up for one TTL, no pre-swap token can still be valid and the allowlist narrows
 * to a single value on its own — correct whether the deploy happens tonight or in March, and with
 * no date to keep in sync.
 *
 * ⚠️ `Date.now()` HERE IS DELIBERATE AND IS NOT THE CLOCK THE CALLER OWNS. The injected `now`
 * dates the TOKEN; this one dates the PROCESS. Deriving the process anchor from the caller's
 * clock would let a token claiming a future `iat` widen its own acceptance window.
 */
const LEGACY_ISSUER = 'https://eno.vn'
const PROCESS_START_SEC = Math.floor(Date.now() / 1000)

// ⛔ TWO BOUNDS, AND THE SECOND ONE IS WHY THIS IS NOT JUST `processStart + TTL`.
// Anchoring to process start alone survives a delayed deploy — but it also RE-OPENS the window for
// an hour on every restart, every autoscale event, forever. A reviewer put it plainly: that is not
// a transition window, it is a permanent one that happens to be intermittent, which is worse
// because it is harder to notice. So the window is the INTERSECTION: it must be within an hour of
// this process starting AND before a fixed outer date, after which no restart can revive it.
// The outer date is deliberately far out — the cost of it arriving early is real partner breakage,
// the cost of it arriving late is an allowlist entry that was already harmless.
// (Harmless because, as the note above records, both editions derive the signing key by HKDF from
// the SAME secret, so `iss` was never a cross-edition boundary — it rejects foreign issuers, not
// sibling ones. This is hygiene, not a security control.)
const LEGACY_ISSUER_HARD_STOP = Math.floor(Date.parse('2026-12-31T23:59:59Z') / 1000)
// Exported ONLY so oauth.test.ts can ask whether the window is open rather than assuming it is —
// see the calendar-bomb note in that test. Nothing else should read it.
export const LEGACY_ISSUER_UNTIL = Math.min(PROCESS_START_SEC + TOKEN_TTL_SECONDS, LEGACY_ISSUER_HARD_STOP)

function issuerAccepted(iss: string, now: number): boolean {
  if (iss === OAUTH_ISSUER) return true
  return iss === LEGACY_ISSUER && now < LEGACY_ISSUER_UNTIL
}

/**
 * The scopes this API actually GRANTS AND ENFORCES, as the single source of truth for the
 * discovery documents.
 *
 * ⚠️ HARVESTED FROM THE ENFORCEMENT SITES, NOT FROM THE DOCS — `resolveApiKey(req, '<scope>')` in
 * src/app/api/v1/** is the only thing that can deny a request, so it is the only honest definition
 * of "supported". Verified 2026-08-23 across all 17 guarded v1 handlers; the openapi spec's prose
 * list agreed exactly. (/api/mcp calls resolveApiKey with NO required scope — it authenticates but
 * does not scope-gate, so it adds nothing to this list.)
 *
 * ⛔ DO NOT ADD A SCOPE HERE THAT NO HANDLER CHECKS. Advertising `orders:read` when nothing reads
 * it means a partner mints a token that appears to carry a permission, and the failure surfaces as
 * a 403 from a route they were told they could call.
 */
export const OAUTH_SCOPES = ['listings:read', 'listings:write', 'analytics:read', 'media:write'] as const

let cachedKey: Buffer | null = null
function signingKey(): Buffer | null {
  if (cachedKey) return cachedKey
  const ikm = process.env.SUPABASE_SECRET_KEY || process.env.CRON_SECRET
  if (!ikm) return null // no base secret → token endpoint reports unavailable
  // HKDF-SHA256 with a fixed salt + info label → a 32-byte key used ONLY for these tokens.
  cachedKey = Buffer.from(crypto.hkdfSync('sha256', Buffer.from(ikm), Buffer.from('eno-oauth-v1'), Buffer.from('partner-api-access-token'), 32))
  return cachedKey
}

const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64url')
function sign(input: string, key: Buffer): string {
  return crypto.createHmac('sha256', key).update(input).digest('base64url')
}

export type AccessClaims = { keyId: string; sellerId: string; profileId: string; scopes: string[] }

// Mint a signed access token for the resolved client. `now` is injected (seconds) so the
// caller controls the clock. Returns null if no signing key is available.
export function issueAccessToken(c: AccessClaims, now: number): string | null {
  const key = signingKey()
  if (!key) return null
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const payload = b64url(JSON.stringify({
    // ⚠️ MINT ONE ISSUER, ACCEPT TWO. Never widen this side to the legacy value.
    iss: OAUTH_ISSUER, sub: c.keyId, sid: c.sellerId, pid: c.profileId,
    scope: c.scopes.join(' '), iat: now, exp: now + TOKEN_TTL_SECONDS, jti: crypto.randomUUID(),
  }))
  const data = `${header}.${payload}`
  return `${data}.${sign(data, key)}`
}

export type VerifiedToken = { keyId: string; sellerId: string; profileId: string; scopes: Set<string> }

// Verify an access token: shape, HMAC signature (constant-time), issuer, and expiry against
// `now` (seconds). Returns the claims or null. Never throws.
export function verifyAccessToken(token: string, now: number): VerifiedToken | null {
  const key = signingKey()
  if (!key) return null
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [header, payload, sig] = parts
  const expected = sign(`${header}.${payload}`, key)
  // Constant-time compare; bail if lengths differ (timingSafeEqual throws otherwise).
  const a = Buffer.from(sig), b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null
  let claims: Record<string, unknown>
  try { claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) } catch { return null }
  // Issuer must be one this deployment recognises — the current one, or (until
  // LEGACY_ISSUER_UNTIL) the pre-2026-08-23 literal still riding in unexpired tokens. See
  // issuerAccepted for why that window exists and why it closes on a clock rather than on a
  // future commit. `typeof` guard first: it keeps the intent readable next to the other claim
  // validations below, and narrows `claims.iss` to string for the call.
  if (typeof claims.iss !== 'string' || !issuerAccepted(claims.iss, now)) return null
  if (typeof claims.exp !== 'number' || claims.exp <= now) return null
  if (typeof claims.sub !== 'string' || typeof claims.sid !== 'string' || typeof claims.pid !== 'string') return null
  return {
    keyId: claims.sub, sellerId: claims.sid, profileId: claims.pid,
    scopes: new Set(String(claims.scope || '').split(/\s+/).filter(Boolean)),
  }
}

// Is this bearer value an access token (JWT) rather than a raw `eno_live_` key? Cheap shape
// check so resolveApiKey can route without trying the DB.
export function looksLikeAccessToken(raw: string): boolean {
  return raw.split('.').length === 3 && !raw.includes(' ')
}
