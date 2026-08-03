import 'server-only'

// ── VNPT eKYC authentication ────────────────────────────────────────────────────────────────────
//
// ⚠️ THE ACCESS TOKEN IS NOT A SECRET YOU CAN STORE. It is short-lived, and the two sources
// disagree on how short: the console states "expires in 8 hours", while the token issued
// 2026-08-03 carried an `exp` 24h out. THAT DISAGREEMENT IS EXACTLY WHY NOTHING HERE HARDCODES A
// LIFETIME — needsRefresh() reads `exp` off the token itself, so it is correct for 8h, 24h, or
// whatever VNPT changes it to. A token pasted into Secret Manager is dead within a day either way
// and takes seller verification down with it, silently, because an expired-token 401 is
// indistinguishable from a misconfigured request. Secret Manager holds the CREDENTIALS; this
// module mints the tokens.
//
// ⚠️ CACHE THE TOKEN IN POSTGRES, NOT IN MEMORY. Cloud Run runs many instances and recycles them;
// an in-process cache means every instance and every cold start mints its own token. On a FREE TIER
// that is a quota multiplier, and some providers also cap concurrent tokens per account — so the
// naive cache converts a scale-up into an outage. Postgres is already the shared-state substrate
// here (Upstash was fully replaced), and the Zalo ZNS refresh-token chain is the existing precedent.
//
// ⚠️ NEVER LOG THE TOKEN — not at debug, not in an error path, not in a Sentry breadcrumb. Cloud
// Logging is retained for a year and is readable by anyone with project access. Log the jti/expiry
// when you need to trace something; never the credential.

// ── The three VNPT security levels, and why only one of them works here ─────────────────────────
//
// The console (Token Management) offers three:
//   Mức 1 — a fixed Token id + Token key + a MANUALLY COPIED access token, pasted into API headers.
//   Mức 2 — a Client ID that MINTS access tokens programmatically.
//   Mức 3 — separate key material for app and for server.
//
// ⚠️ LEVEL 1 CANNOT BE OPERATED IN PRODUCTION, AND THIS IS THE WHOLE SETUP BLOCKER.
// Its access token expires in 8 hours and there is no self-serve endpoint to renew it — the console
// says to CONTACT VNPT to be provisioned the "API sinh Access Token". So level 1 means a human
// pastes a credential into Secret Manager three times a day, forever, and seller verification
// breaks whenever they sleep. The failure is also silent: an expired token returns an auth error
// indistinguishable from a misconfigured request.
//
// ⚠️ LEVEL 3'S SPLIT MATTERS FOR US SPECIFICALLY — because the app/server distinction is real here.
// eno.vn ships a Capacitor WebView, so there is a genuine temptation to call eKYC from the client
// to skip a hop. Never do that: any credential reaching the WebView is extractable, and on level 1
// that credential is the ONLY thing protecting the account. Every eKYC call goes server-side.
export const VNPT_SECURITY_LEVEL = { headerToken: 1, clientIdMinted: 2, splitAppServer: 3 } as const

/** ⚠️ Level 2+ required. Level 1 has no renewal API — see the note above. */
export const REQUIRED_SECURITY_LEVEL = VNPT_SECURITY_LEVEL.clientIdMinted

export type VnptCredentials = {
  /** Long-lived account identifiers from the VNPT console. */
  tokenId: string
  tokenKey: string
  /** Public key used to verify/decrypt provider responses. Public — safe to hold, still not logged. */
  publicKey: string
  /** Used to MINT access tokens. This is the actual secret. */
  clientId: string
  clientSecret: string
}

/**
 * ⚠️ READ CREDENTIALS AT CALL TIME, NEVER AT MODULE SCOPE. A module-scope read runs at import — so
 * a missing variable throws during the build, and Next bakes the value into the artifact. Both are
 * bad here: this repo already lost 9h of a live surface to a module-scope import of a native
 * dependency, and a build-time credential cannot be rotated without a redeploy.
 */
export function vnptCredentials(): VnptCredentials | null {
  const tokenId = process.env.VNPT_EKYC_TOKEN_ID
  const tokenKey = process.env.VNPT_EKYC_TOKEN_KEY
  const publicKey = process.env.VNPT_EKYC_PUBLIC_KEY
  const clientId = process.env.VNPT_EKYC_CLIENT_ID
  const clientSecret = process.env.VNPT_EKYC_CLIENT_SECRET
  // ⚠️ ALL-OR-NOTHING. A half-configured provider that "mostly works" is worse than one that is
  // plainly off: it fails per-request, at verification time, for a subset of users.
  if (!tokenId || !tokenKey || !publicKey || !clientId || !clientSecret) return null
  return { tokenId, tokenKey, publicKey, clientId, clientSecret }
}

/** Is Tier A available at all? Callers degrade to manual review when false — never fail open. */
export function vnptConfigured(): boolean {
  return vnptCredentials() !== null
}

/**
 * ⚠️ REFRESH EARLY. A token that is technically still valid for 30 seconds will expire mid-flight
 * on a slow eKYC upload, and the resulting 401 is indistinguishable from a credential problem. The
 * skew also absorbs clock drift between us and the provider.
 */
export const REFRESH_SKEW_MS = 30 * 60 * 1000 // 30 minutes

/** Decoded, NON-SECRET claims. Used for cache bookkeeping and for tracing without leaking. */
export type TokenClaims = { exp: number; jti?: string; scope?: string[]; userName?: string }

/**
 * Parse the claims from a JWT without verifying it.
 *
 * ⚠️ THIS DOES NOT VERIFY THE SIGNATURE, AND MUST NEVER BE USED TO TRUST ANYTHING. It exists only
 * to read OUR OWN token's expiry so we know when to refresh. We received the token over TLS from
 * the issuer, so its authenticity is not in question — but this function must not creep into an
 * authorisation path, where an unverified `scope` claim would be attacker-controlled.
 */
export function readTokenClaims(jwt: string): TokenClaims | null {
  const part = jwt.split('.')[1]
  if (!part) return null
  try {
    const json = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'))
    if (typeof json?.exp !== 'number') return null
    return { exp: json.exp, jti: json.jti, scope: json.scope, userName: json.user_name }
  } catch {
    return null
  }
}

/** Should we mint a new token? Pure, so the refresh policy is testable without a network. */
export function needsRefresh(claims: TokenClaims | null, now: number = Date.now()): boolean {
  if (!claims) return true
  return claims.exp * 1000 - now <= REFRESH_SKEW_MS
}

/**
 * ⚠️ eKYC VERIFICATION IS A WRITE, SO A `read`-ONLY TOKEN CANNOT PERFORM IT.
 * The token issued on 2026-08-03 carried `scope: ["read"]`. If that is the scope the account mints
 * by default, every verification call will fail with an authorisation error that looks like a bug
 * in our request. Checking the scope up front turns a confusing 403 into a precise message.
 */
export const REQUIRED_SCOPES = ['read', 'write'] as const

export function missingScopes(claims: TokenClaims | null): string[] {
  const have = new Set(claims?.scope ?? [])
  return REQUIRED_SCOPES.filter((s) => !have.has(s))
}

/**
 * Headers every VNPT eKYC service call carries.
 *
 * ⚠️ NAMES TAKEN FROM THE CONSOLE'S OWN LABELS ("Token id", "Token key", "Access token") PLUS
 * CONVENTION — confirm against the API reference linked from Token Management before shipping.
 * Getting a header name wrong here surfaces as a generic auth failure, which is indistinguishable
 * from a bad credential and burns an afternoon.
 *
 * ⚠️ SERVER-SIDE ONLY. If this ever runs in the WebView, the credentials are extractable.
 */
export function vnptHeaders(c: VnptCredentials, accessToken: string): Record<string, string> {
  return {
    'Token-id': c.tokenId,
    'Token-key': c.tokenKey,
    Authorization: accessToken.toLowerCase().startsWith('bearer ') ? accessToken : `Bearer ${accessToken}`,
  }
}
