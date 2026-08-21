import 'server-only'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { isLoopbackHost, loopbackOrigin, serverAuthUsesRequestOrigin } from '@/lib/auth-origin'

// ── FIRST-PARTY GOOGLE SIGN-IN ──────────────────────────────────────────────────────────────────
//
// ⛔ WHY THIS EXISTS, AFTER TWO OTHER ATTEMPTS. Google prints the OAuth client's REDIRECT HOST on
// its consent screen, and nothing in the Console changes that line:
//   · supabase.auth.signInWithOAuth redirects via <ref>.supabase.co, so it reads
//     "to continue to xihiryllwmjoouipkyhw.supabase.co" — our project ref, in front of every new
//     user, on the highest-intent screen in the funnel.
//   · Google Identity Services' renderButton fixes the NAME (its flow has no redirect_uri at all)
//     but is a cross-origin iframe whose interior cannot be styled, and it silently refuses to act
//     when it is not visible — measured in production.
// Running the code flow against OUR OWN client with redirect_uri on eno.vn gives both: our own
// <Button>, and our own domain on the consent screen.
//
// ⚠️ THE FALLBACK IS NOT OPTIONAL. Both external reviewers refuted the first plan on the same
// ground: replacing a working sign-in with an unproven one, with no way back, means a single
// misconfiguration (a missing secret, an unregistered redirect URI) is a GLOBAL outage. Every exit
// below is designed so the caller can drop to signInWithOAuth — unbranded, but working.

/** Unset ⇒ the whole flow is off and callers fall back. Never throw for a missing secret. */
const CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID?.trim() || null
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET?.trim() || null

export const GOOGLE_AUTHORIZE = 'https://accounts.google.com/o/oauth2/v2/auth'
export const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token'

/** 10 minutes: long enough to pick an account, short enough that a leaked transaction is stale. */
export const TX_TTL_SECONDS = 10 * 60

export function googleOauthConfigured(): boolean {
  return Boolean(CLIENT_ID && CLIENT_SECRET)
}

/**
 * The origin every URL in this flow must agree on.
 *
 * ⛔ THE VISITOR'S OWN HOST, FROM AN ALLOW-LIST — not a single hardcoded canonical, and all three
 * reviewers refuted the first version for this. It returned `NEXT_PUBLIC_APP_URL || 'https://eno.vn'`,
 * which breaks in two ways at once:
 *   · CROSS-EDITION. The services edition's APP_URL is `https://www.eno.forum` (measured), so a
 *     hardcoded eno.vn would have sent forum visitors to the marketplace's callback — a licensing
 *     boundary crossed by a redirect.
 *   · THE COOKIE. /auth/google/start sets a HOST-ONLY cookie on whatever host the visitor is on.
 *     If the callback is canonicalised to a different host, that cookie is simply absent and every
 *     sign-in fails state verification — after the account has been chosen.
 * Echoing the visitor's own host keeps the two ends on the same origin, so the cookie is there and
 * each edition stays on its own domain.
 *
 * ⚠️ AN ALLOW-LIST, BECAUSE `host` IS CLIENT-SUPPLIED. Without it a forged Host header would point
 * redirect_uri at an attacker's domain. Anything unrecognised falls back to the configured app URL.
 *
 * ⚠️ AND MY COMMENT HERE USED TO CLAIM "we always send the apex, so only one URI has to be
 * registered per domain." That was never true — the services edition is www — and it is why every
 * host below has to be registered with Google individually.
 */
const ALLOWED_AUTH_HOSTS = new Set(['eno.vn', 'www.eno.vn', 'eno.forum', 'www.eno.forum'])

export function canonicalAuthOrigin(request: Request): string {
  const host = request.headers.get('host')?.toLowerCase() ?? null
  // Dev and opted-in previews keep the round-trip on localhost. The loopback check is defence in
  // depth: `host` is client-influenceable, so even a build that wrongly carried the flag cannot be
  // talked into pointing the flow off-site.
  if (serverAuthUsesRequestOrigin() && isLoopbackHost(host)) return loopbackOrigin(host!)
  if (process.env.NODE_ENV === 'development') return new URL(request.url).origin
  if (host && ALLOWED_AUTH_HOSTS.has(host)) return `https://${host}`
  // ⚠️ The stored value can carry literal quotes (measured: eno-root-env holds `"https://eno.vn"`),
  // which would make `new URL` throw and take the whole route down. Strip them.
  const configured = (process.env.NEXT_PUBLIC_APP_URL || 'https://eno.vn').replace(/^"|"$/g, '')
  try {
    return new URL(configured).origin
  } catch {
    return 'https://eno.vn'
  }
}

export const googleRedirectUri = (origin: string) => `${origin}/auth/google/callback`

export type Transaction = {
  /** CSRF token echoed by Google in the `state` param. */
  state: string
  /** ⚠️ The RAW nonce. Supabase hashes what we give it and compares to the token claim. */
  nonceRaw: string
  /** What Google is given — the digest of nonceRaw. */
  nonceHash: string
  codeVerifier: string
  codeChallenge: string
}

const b64url = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const sha256 = (s: string) => createHash('sha256').update(s).digest()

export function newTransaction(): Transaction {
  const state = b64url(randomBytes(32))
  const nonceRaw = b64url(randomBytes(32))
  const codeVerifier = b64url(randomBytes(64))
  return {
    state,
    nonceRaw,
    // ⚠️ HEX, NOT base64url. GoTrue does `fmt.Sprintf("%x", sha256.Sum256(nonce))` and compares that
    // string to the token's claim — so the digest handed to Google must be hex or every sign-in
    // fails verification with a "Nonces mismatch" nobody can see from the outside.
    nonceHash: createHash('sha256').update(nonceRaw).digest('hex'),
    codeVerifier,
    codeChallenge: b64url(sha256(codeVerifier)),
  }
}

/**
 * ⛔ ONE COOKIE PER TRANSACTION, KEYED BY THE STATE. A single fixed cookie name means two sign-in
 * tabs overwrite each other's nonce and verifier, and whichever the visitor finishes second fails —
 * a race both reviewers called out. The name carries a prefix of the state so concurrent attempts
 * are independent; the FULL state still has to match what is inside.
 */
export const txCookieName = (state: string) => `eno_g_${state.slice(0, 12)}`

export function buildAuthorizeUrl(tx: Transaction, origin: string): string | null {
  if (!CLIENT_ID) return null
  const u = new URL(GOOGLE_AUTHORIZE)
  u.searchParams.set('client_id', CLIENT_ID)
  u.searchParams.set('redirect_uri', googleRedirectUri(origin))
  u.searchParams.set('response_type', 'code')
  u.searchParams.set('scope', 'openid email profile')
  u.searchParams.set('state', tx.state)
  u.searchParams.set('nonce', tx.nonceHash)
  u.searchParams.set('code_challenge', tx.codeChallenge)
  u.searchParams.set('code_challenge_method', 'S256')
  // The visitor tapped a button asking to choose an account; never sign them into a remembered one
  // behind their back.
  u.searchParams.set('prompt', 'select_account')
  // No refresh token: Supabase owns the session from here, so a Google refresh token would be a
  // long-lived credential we have no use for and would have to protect.
  u.searchParams.set('access_type', 'online')
  return u.toString()
}

/** Constant-time, and false on any length mismatch rather than throwing. */
export function stateMatches(a: string | undefined | null, b: string | undefined | null): boolean {
  if (!a || !b) return false
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

export type ExchangeResult =
  | { ok: true; idToken: string }
  | { ok: false; reason: 'not_configured' | 'http_error' | 'no_id_token' | 'network' }

/**
 * Trade the authorization code for an ID token.
 *
 * ⚠️ NEVER THROWS AND NEVER LOGS THE RESPONSE BODY. Google's error payload can echo request
 * parameters, and this function handles a client secret; a stack trace or a dumped body in the logs
 * is how secrets end up in log storage. The reason codes are enough to tell the two operational
 * failures apart (`http_error` = configuration, `network` = transient).
 */
export async function exchangeCodeForIdToken(
  code: string,
  origin: string,
  codeVerifier: string,
): Promise<ExchangeResult> {
  if (!CLIENT_ID || !CLIENT_SECRET) return { ok: false, reason: 'not_configured' }
  let res: Response
  try {
    res = await fetch(GOOGLE_TOKEN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
        // ⛔ PKCE COMPLETES HERE, AND I OMITTED IT FIRST. `code_challenge` goes to /authorize and
        // `code_verifier` to /token; sending only the first makes Google reject every exchange with
        // invalid_grant — a total sign-in outage that no test of the authorize URL would catch.
        code_verifier: codeVerifier,
        // ⚠️ MUST BE BYTE-IDENTICAL to the one sent to /authorize. Google compares them.
        redirect_uri: googleRedirectUri(origin),
      }),
      cache: 'no-store',
    })
  } catch {
    return { ok: false, reason: 'network' }
  }
  if (!res.ok) return { ok: false, reason: 'http_error' }
  let body: { id_token?: string }
  try {
    body = (await res.json()) as { id_token?: string }
  } catch {
    return { ok: false, reason: 'no_id_token' }
  }
  return body.id_token ? { ok: true, idToken: body.id_token } : { ok: false, reason: 'no_id_token' }
}
