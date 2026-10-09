import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { z } from 'zod'
import type { User } from '@supabase/supabase-js'
import { clientIp } from '@/lib/client-ip'
import { rateLimit } from '@/lib/ratelimit'
import { createSupabaseServer } from '@/lib/supabase/server'
import { finishSignInPath } from '@/lib/auth-finish'
import { safeNextPath } from '@/lib/url'
import { cleanDisplayName } from '@/lib/display-name'
import { logError, logWarn } from '@/lib/log'
import { apiFail } from '@/lib/api/handler'
import { canonicalAuthOrigin } from '@/lib/auth/google-oauth'
import {
  APPLE_ISSUER,
  APPLE_NONCE_COOKIE,
  APPLE_NONCE_PATH,
  decodeJwtPayload,
  exchangeCode,
  hashAppleNonce,
  nativeAppleBundleId,
  storeAppleToken,
} from '@/lib/auth/apple-siwa'

// Step 2 of native Sign in with Apple (iOS build 3 on). The app has run Apple's own sheet with the nonce hash
// from /api/auth/apple/nonce and posts the credential here; this route — same origin, so the session lands in
// the WebView's own cookie jar — does what GoTrue's web flow would, plus the two things it cannot:
//   1. read AND clear the nonce cookie (single use, whatever happens next);
//   2. sanitize `next` (A4 — /signin hands over its raw `next`);
//   3. refuse a token with NO nonce claim (GoTrue's check is "both or neither", so without this a nonce-less
//      token minted anywhere for our bundle would pass) or a foreign `aud`, before GoTrue sees it;
//   4. signInWithIdToken with the RAW nonce (GoTrue compares sha256(raw) with the claim);
//   5. write Apple's name into the session on THE SAME client (updateUser saves the returned user into the
//      cookie) — Apple sends the name only on the first authorization and never in the token, and /onboard
//      prefills from the cookie's user (B1);
//   6. provision the profile and pick the destination (finishSignInPath — onboarding when it is due);
//   7. trade the authorization code for the refresh token kept for revocation (bundle ID, no redirect_uri, 5 s),
//      kept only when Apple's id_token names the same Apple ID that signed in;
//   8. answer { to } — the app navigates there itself.
// Errors and logs carry CODES only — never the token, the code or the nonce.
//
// Branches: 403 bad_origin · 429 rate_limited · 503 not_configured (native Apple not open here — no bundle ID, no `ios`
// in the rollout flag, or eno.forum: nativeAppleBundleId, as /nonce) · 400 invalid_session
// (no nonce cookie: missing, expired or already spent) · 400 bad_request (body) · 400 invalid_token (malformed,
// no nonce claim, nonce mismatch, foreign aud/iss, or refused by GoTrue) · 502 failed (GoTrue unreachable) ·
// 200 { to }. ⚠️ NOT route(), for the nonce route's reasons: origin before the limiter, and cookie writes.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const noStore = { 'Cache-Control': 'private, no-store, max-age=0' }

const name = z.string().max(512).nullish()
const BodySchema = z.object({
  identityToken: z.string().min(20).max(8192),
  authorizationCode: z.string().max(2048).nullish(),
  user: name,
  email: name,
  givenName: name,
  familyName: name,
  fullName: name,
  next: z.string().max(2048).nullish(),
})

/** One audience, ours: a string, or a one-element array holding it. */
function audienceIs(aud: unknown, bundle: string): boolean {
  return aud === bundle || (Array.isArray(aud) && aud.length === 1 && aud[0] === bundle)
}

export async function POST(request: Request) {
  // The site's own origin — the visitor's host from the auth allow-list, the loopback host in a local preview
  // (canonicalAuthOrigin, shared with the first-party Google flow). Same-origin POSTs only, in production.
  const origin = canonicalAuthOrigin(request)
  if (process.env.NODE_ENV === 'production' && request.headers.get('origin') !== origin) return apiFail('bad_origin', 403)
  // ⚠️ NOT strict: the sign-in path — a limiter blip must not lock people out.
  const rl = await rateLimit('apple-native', clientIp(request), 20, '10 m').catch(() => ({ success: true }))
  if (!rl.success) return apiFail('rate_limited', 429)

  try {
    // 1. Read and clear the nonce — one attempt per nonce, whatever happens below.
    const jar = await cookies()
    const rawNonce = jar.get(APPLE_NONCE_COOKIE)?.value || null
    jar.set(APPLE_NONCE_COOKIE, '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: APPLE_NONCE_PATH,
      maxAge: 0,
    })

    const bundle = nativeAppleBundleId()
    if (!bundle) return apiFail('not_configured', 503)
    if (!rawNonce) {
      logWarn('[auth] apple_native_refused', { reason: 'no_nonce_cookie' })
      return apiFail('invalid_session', 400)
    }

    let raw: unknown
    try { raw = await request.json() } catch { return apiFail('bad_request', 400) }
    const parsed = BodySchema.safeParse(raw)
    if (!parsed.success) return apiFail('bad_request', 400)
    const body = parsed.data

    // 2. `next` is the visitor's; sanitize it here, never trust the client to have.
    const next = safeNextPath(body.next ?? null, origin)

    // 3. Pre-check the token. GoTrue verifies the signature, issuer, audience, expiry and nonce again; this is
    //    what makes the nonce MANDATORY rather than "both or neither", and turns a foreign audience into a clear
    //    refusal instead of GoTrue's "Unacceptable audience".
    const claims = decodeJwtPayload(body.identityToken)
    const refuse = (reason: string) => {
      logWarn('[auth] apple_native_refused', { reason })
      return apiFail('invalid_token', 400)
    }
    if (!claims) return refuse('malformed')
    if (typeof claims.nonce !== 'string' || !claims.nonce) return refuse('no_nonce_claim')
    if (claims.nonce !== hashAppleNonce(rawNonce)) return refuse('nonce_mismatch')
    if (!audienceIs(claims.aud, bundle)) return refuse('audience')
    if (claims.iss !== APPLE_ISSUER) return refuse('issuer')
    const appleSub = typeof claims.sub === 'string' && claims.sub ? claims.sub : null
    if (!appleSub) return refuse('no_sub')

    // 4. GoTrue owns the session; createSupabaseServer's setAll writes the same auth cookies every path writes.
    const supabase = await createSupabaseServer()
    const signedIn = await supabase.auth
      .signInWithIdToken({ provider: 'apple', token: body.identityToken, nonce: rawNonce })
      // signInWithIdToken rethrows anything that is not an AuthError (a storage write, a subscriber) — an escape
      // here would be a 500 for someone mid-sign-in.
      .catch((e: unknown) => ({ data: { user: null, session: null }, error: { status: 0, code: (e as Error)?.name } }))
    let user: User | null = signedIn.data?.user ?? null
    if (signedIn.error || !user) {
      const status = Number((signedIn.error as { status?: number } | null)?.status) || 0
      logWarn('[auth] apple_native_refused', { reason: 'gotrue', status, code: (signedIn.error as { code?: string } | null)?.code ?? null })
      return status >= 400 && status < 500 ? apiFail('invalid_token', 400) : apiFail('failed', 502)
    }

    // 5. Apple's name, cleaned (A5), into an EMPTY full_name only — a returning user keeps the name they have.
    const appleName = cleanDisplayName(body.fullName) || cleanDisplayName([body.givenName, body.familyName].filter(Boolean).join(' '))
    if (appleName && !cleanDisplayName(user.user_metadata?.full_name)) {
      const updated = await supabase.auth
        .updateUser({ data: { full_name: appleName, name: appleName } })
        .catch((e: unknown) => ({ data: { user: null }, error: { status: 0, code: (e as Error)?.name } }))
      if (updated.data?.user) user = updated.data.user
      else logWarn('[auth] apple_name_not_written', { status: Number((updated.error as { status?: number } | null)?.status) || 0 })
    }

    // 6 + 7, side by side: the profile and destination, and the token kept for revocation (best effort).
    // ⛔ The keep may not hold the answer (commit gate round 9, codex): past KEEP_WAIT_MS the sign-in is answered and
    // the keep finishes on its own — the session already exists and the nonce is spent, so a timed-out request would
    // read as a failed sign-in that cannot be retried.
    const signedInUser = user
    let keepTimer: ReturnType<typeof setTimeout> | undefined
    const [to] = await Promise.all([
      finishSignInPath(signedInUser, next),
      Promise.race([
        keepNativeToken({ userId: signedInUser.id, appleSub, bundle, code: body.authorizationCode ?? null }),
        new Promise<void>((resolve) => { keepTimer = setTimeout(resolve, KEEP_WAIT_MS) }),
      ]).finally(() => clearTimeout(keepTimer)),
    ])
    // 8.
    return NextResponse.json({ to }, { headers: noStore })
  } catch (e) {
    logError(e, { op: 'apple-native.unhandled' })
    return apiFail('internal_error', 500)
  }
}

/** How long the answer waits for the token keep; the keep itself runs on (it never throws). */
const KEEP_WAIT_MS = 2_500

/**
 * Trade the native authorization code (single use, ~5 minutes) for the refresh token kept for revocation at
 * account deletion. Never throws, never blocks the sign-in: a code that fails here only means the eventual
 * deletion asks the person to remove eno in their Apple Account by hand.
 */
async function keepNativeToken(i: { userId: string; appleSub: string; bundle: string; code: string | null }): Promise<void> {
  if (!i.code) {
    logWarn('[auth] apple_token_not_kept', { reason: 'no_code', flow: 'native' })
    return
  }
  try {
    const ex = await exchangeCode(i.bundle, i.code)
    if (!ex.ok) {
      logWarn('[auth] apple_token_not_kept', { reason: ex.error, flow: 'native' })
      return
    }
    // ⛔ ONLY A TOKEN FOR THE APPLE ID THAT JUST SIGNED IN. A code from another sign-in (or another person)
    // would otherwise let deletion of THIS account revoke someone else's authorization.
    if (ex.sub !== i.appleSub) {
      logWarn('[auth] apple_token_not_kept', { reason: 'sub_mismatch', flow: 'native' })
      return
    }
    if (!ex.refreshToken) {
      logWarn('[auth] apple_token_not_kept', { reason: 'no_refresh_token', flow: 'native' })
      return
    }
    await storeAppleToken({ userId: i.userId, clientId: i.bundle, appleSub: i.appleSub, refreshToken: ex.refreshToken })
  } catch (e) {
    logError(e, { op: 'apple-native.keepToken' })
  }
}
