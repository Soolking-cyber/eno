import type { EmailOtpType } from '@supabase/supabase-js'
import { createSupabaseServer } from '@/lib/supabase/server'
import { authRedirect, finishSignIn } from '@/lib/auth-finish'
import { safeNextPath } from '@/lib/url'

// Where the emailed magic link lands.
//
// WHY THIS EXISTS AND /auth/callback DOES NOT SUFFICE. `callback` consumes `?code=`, the
// PKCE authorization code produced by OAuth and by supabase.auth.signInWithOtp — which
// works because the BROWSER generated the code_verifier and kept it. The links we now
// send ourselves come from `admin.generateLink()` on the server, where no verifier
// exists, so they carry no code and can never be exchanged that way. Pointing them at
// `callback` would find no `code` and bounce every user to /?auth_error=1.
//
// So we skip Supabase's own /auth/v1/verify hop entirely and verify the token HERE, with
// `verifyOtp({ token_hash })` — the documented path for a project that sends its own auth
// mail. Three things fall out of that, all of them wins:
//   · the link is on eno.vn, not a supabase.co URL — it looks like us, and the recipient
//     can see that before they tap;
//   · the session is established SERVER-side and written straight to our cookies, so
//     nothing depends on a URL fragment surviving a redirect (a fragment never reaches
//     the server at all, which is exactly how the naive version fails);
//   · the native WebView gets a real cookie session like every other client.
//
// ⚠️ SINGLE USE. The token dies on first GET, so a corporate mail scanner or link
// prefetcher that fetches the URL burns it and the real recipient sees "link expired".
// This is not a regression — Supabase's own hosted links behave identically — and the
// fix (an interstitial "confirm sign-in" button, so only a real click spends the token)
// is a deliberate future call, not an oversight. Phone OTP is the escape hatch meanwhile.

export const dynamic = 'force-dynamic'

// Only the types this app actually mints — a caller cannot smuggle in 'recovery' or
// 'email_change' and drive a flow we never send mail for.
const ALLOWED: ReadonlySet<string> = new Set<EmailOtpType>(['magiclink', 'signup', 'email'])

export async function GET(request: Request) {
  const url = new URL(request.url)
  // Same canonical-origin discipline as /auth/callback: the redirect must land on the
  // host whose cookies we just set, never a preview or www host.
  const origin =
    process.env.NODE_ENV === 'development'
      ? url.origin
      : new URL(process.env.NEXT_PUBLIC_APP_URL || 'https://eno.vn').origin

  const tokenHash = url.searchParams.get('token_hash')
  const type = url.searchParams.get('type')
  const next = safeNextPath(url.searchParams.get('next'), origin)

  if (!tokenHash || !type || !ALLOWED.has(type)) {
    return authRedirect(`${origin}/?auth_error=1`)
  }

  const supabase = await createSupabaseServer()
  const { data, error } = await supabase.auth.verifyOtp({ type: type as EmailOtpType, token_hash: tokenHash })
  if (error) {
    // Expired, already used, or tampered with. Never echo the reason — it would tell an
    // attacker probing tokens which guesses were structurally valid.
    console.warn('[auth/confirm] verifyOtp failed', error.message)
    return authRedirect(`${origin}/?auth_error=1`)
  }

  return finishSignIn(data.user, origin, next)
}
