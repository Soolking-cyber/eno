import 'server-only'

// ── VNPT eKYC authentication ────────────────────────────────────────────────────────────────────
//
// ⚠️ THE ACCESS TOKEN IS NOT A SECRET YOU CAN STORE. It is short-lived, and THREE SOURCES DISAGREE
// ABOUT HOW SHORT: the console states 8 hours, the level-1 token issued 2026-08-03 carried an `exp`
// 24h out, and a real mint on 2026-08-04 returned `expires_in: 7199` — two hours. THAT DISAGREEMENT
// IS EXACTLY WHY NOTHING HERE HARDCODES A LIFETIME: needsRefresh() reads `exp` off the token itself
// and effectiveExpiry() takes the earliest bound the response offers, so this is correct at 2h, 8h,
// 24h, or whatever VNPT changes it to next. Secret Manager holds the CREDENTIALS; this module mints
// the tokens.
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
// ⚠️ LEVEL 1 CANNOT BE OPERATED IN PRODUCTION — RESOLVED 2026-08-04 BY MOVING TO LEVEL 2.
// Level 1's access token has no self-serve renewal endpoint: the console says to CONTACT VNPT for
// the "API sinh Access Token". That made level 1 a human pasting a credential into a store several
// times a day, forever, with verification breaking whenever they slept — and failing SILENTLY,
// because an expired-token 401 is indistinguishable from a misconfigured request.
//
// VNPT supplied that API (doc "API Description Document for Access Token" v2.0), and mintAccessToken()
// below implements it. ⚠️ The token turned out to last TWO HOURS, not the 8 the console states —
// measured against the live endpoint — so the manual path was even less viable than it looked.
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
 * ⚠️ THERE IS NO read/write SCOPE GATE, AND ADDING ONE WOULD BLOCK EVERY VERIFICATION.
 *
 * This module used to export `REQUIRED_SCOPES = ['read','write']` and a `missingScopes()` guard, on
 * the reasoning that eKYC is a WRITE so a read-only token could not perform it. That reasoning came
 * from the level-1 token pasted on 2026-08-03, which carried `scope: ["read"]`.
 *
 * MEASURED 2026-08-04 against the real minting endpoint: a level-2 token minted from our client
 * credentials carries `scope: ["idgv2"]` — a SERVICE scope, not a permission verb. read/write is
 * not VNPT's taxonomy here. The guard was never wired into the flow (it existed only in a test), so
 * nothing was broken; but the plan for this change was to wire it, and that would have made
 * `missingScopes()` return BOTH values for every healthy token and refuse every verification.
 *
 * Gating on a provider's scope string is only safe once you know the provider's taxonomy. We do not,
 * so we do not gate. `readTokenClaims().scope` is still surfaced for tracing.
 */
export const OBSERVED_TOKEN_SCOPE = 'idgv2'

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
// ── Minting an access token ─────────────────────────────────────────────────────────────────────
//
// Per VNPT's "API Description Document for Access Token" v2.0:
//   POST /auth/oauth/token, Content-Type: application/json
//   { client_id, client_secret, grant_type: "client_credentials" } → { access_token, expires_in }
//
// ⚠️ MEASURED, NOT ASSUMED — AND THE DOCS WERE WRONG ABOUT THE LIFETIME. A real mint on 2026-08-04
// returned `expires_in: 7199` with a JWT `exp` 7200s out: TWO HOURS. The console says 8 hours and
// the level-1 token measured on 2026-08-03 carried 24h. All three disagree, which is why nothing
// here hardcodes a lifetime and why `effectiveExpiry` below takes the EARLIEST of the two the
// response actually gives us.
//
// ⚠️ A 2-HOUR LIFETIME IS WHY THIS EXISTS AT ALL. Hand-pasting a token twelve times a day is not an
// operating model; the manual path was only ever survivable on the (wrong) 8h assumption.
//
// ⚠️ RAW `fetch`, NEVER vnpt-client's post(). codex caught the re-entrancy: post() resolves an
// access token to build its headers, so minting through it would call getAccessToken() from inside
// getAccessToken(). This module must not import vnpt-client.
const TOKEN_PATH = '/auth/oauth/token'
const MINT_TIMEOUT_MS = 15_000

export type MintResult =
  | { ok: true; token: string; expiresAt: Date; claims: TokenClaims | null }
  | { ok: false; reason: string }

/**
 * The expiry we will actually honour: the EARLIEST of the JWT's own `exp` and
 * `receivedAt + expires_in`.
 *
 * ⚠️ EARLIEST WINS, DELIBERATELY. Trusting `expires_in` alone ignores that the JWT is the thing the
 * server validates; trusting `exp` alone ignores a provider that revokes early. Taking the minimum
 * can only make us refresh sooner than necessary — the failure it prevents (using a dead token, and
 * reading the resulting 401 as a document problem) is far worse than an extra mint.
 * ⚠️ COMPUTED FROM RECEIPT TIME, not from when the caller got round to storing it.
 */
export function effectiveExpiry(claims: TokenClaims | null, expiresIn: unknown, receivedAt: number): Date | null {
  const candidates: number[] = []
  if (claims && Number.isFinite(claims.exp) && claims.exp > 0) candidates.push(claims.exp * 1000)
  // ⚠️ VALIDATE, do not coerce: a null/NaN/negative expires_in must not become `receivedAt + NaN`
  // (an Invalid Date that compares false against everything and therefore never looks expired).
  if (typeof expiresIn === 'number' && Number.isFinite(expiresIn) && expiresIn > 0) {
    candidates.push(receivedAt + expiresIn * 1000)
  }
  if (!candidates.length) return null
  return new Date(Math.min(...candidates))
}

/**
 * Exchange the client credentials for an access token.
 *
 * ⚠️ NEVER LOGS OR RETURNS THE SECRET, AND NEVER PUTS THE RESPONSE BODY IN AN ERROR STRING — an
 * error path that echoes the body would write the access token into Cloud Logging, which is
 * retained for a year and readable by anyone with project access.
 */
export async function mintAccessToken(now: number = Date.now()): Promise<MintResult> {
  const c = vnptCredentials()
  if (!c) return { ok: false, reason: 'VNPT credentials not configured' }

  // ⚠️ NEVER SEND client_secret OVER PLAINTEXT (qwen). This is the ONE request that carries the
  // long-lived secret rather than a 2-hour token, so a mistyped or hostile VNPT_EKYC_BASE_URL here
  // exfiltrates the credential that mints every future token. Refuse anything but https, except an
  // explicit localhost loopback for a test double.
  const base = process.env.VNPT_EKYC_BASE_URL || 'https://api.idg.vnpt.vn'
  let origin: URL
  try {
    origin = new URL(base)
  } catch {
    return { ok: false, reason: 'VNPT_EKYC_BASE_URL is not a valid URL' }
  }
  const loopback = origin.hostname === 'localhost' || origin.hostname === '127.0.0.1'
  if (origin.protocol !== 'https:' && !loopback) {
    return { ok: false, reason: `refusing to send client_secret over ${origin.protocol}//` }
  }

  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), MINT_TIMEOUT_MS)
  try {
    const res = await fetch(`${base}${TOKEN_PATH}`, {
      method: 'POST',
      signal: ctl.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: c.clientId, client_secret: c.clientSecret, grant_type: 'client_credentials' }),
    })
    if (!res.ok) return { ok: false, reason: `token endpoint returned HTTP ${res.status}` }

    let body: Record<string, unknown>
    try {
      body = JSON.parse(await res.text()) as Record<string, unknown>
    } catch {
      return { ok: false, reason: 'token endpoint returned a non-JSON body' }
    }

    const token = body.access_token
    if (typeof token !== 'string' || !token) return { ok: false, reason: 'token endpoint returned no access_token' }

    const claims = readTokenClaims(token)
    const expiresAt = effectiveExpiry(claims, body.expires_in, now)
    // ⚠️ NO EXPIRY MEANS WE CANNOT SCHEDULE A REFRESH, so we would use it until it 401s — the exact
    // silent-failure shape this whole module exists to remove. Refuse it instead.
    if (!expiresAt) return { ok: false, reason: 'token carried neither a readable exp nor a usable expires_in' }
    // ⚠️ AND IT MUST BE IN THE FUTURE (qwen). A JWT whose `exp` is already past, paired with a
    // positive `expires_in`, yields a past date that MIN() faithfully preserves — and the store
    // would then cache a dead token and hand it out. A born-expired token is a provider fault, not
    // a credential we may use.
    if (expiresAt.getTime() <= now) {
      return { ok: false, reason: `token was already expired on arrival (${expiresAt.toISOString()})` }
    }
    return { ok: true, token, expiresAt, claims }
  } catch (e) {
    // Includes the AbortError from the timeout above.
    return { ok: false, reason: e instanceof Error ? e.message : 'token request failed' }
  } finally {
    clearTimeout(timer)
  }
}

export function vnptHeaders(c: VnptCredentials, accessToken: string): Record<string, string> {
  return {
    'Token-id': c.tokenId,
    'Token-key': c.tokenKey,
    Authorization: accessToken.toLowerCase().startsWith('bearer ') ? accessToken : `Bearer ${accessToken}`,
  }
}
