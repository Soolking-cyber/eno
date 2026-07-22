import 'server-only'

// Server-side Cloudflare Turnstile verification.
//
// Until now the widget's token was only ever handed to Supabase Auth, which verified it
// for us on signInWithOtp. Any endpoint that sends mail or SMS *itself* has to do that
// check on its own — an unverified token is just a string the client made up.
//
// Docs: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

/** True once the secret is set — callers can distinguish "unconfigured" from "failed". */
export function turnstileConfigured(): boolean {
  return Boolean(process.env.TURNSTILE_SECRET_KEY?.trim())
}

/**
 * Verify a Turnstile token.
 *
 * Returns true when the token is genuine, AND when the secret isn't configured at all —
 * matching the widget, which renders nothing and resolves `getToken()` to undefined when
 * NEXT_PUBLIC_TURNSTILE_SITE_KEY is unset. The two halves must agree: if the widget can't
 * mint a token, a route that demanded one would lock every visitor out of sign-in. That is
 * exactly the failure that took email auth down on 2026-07-19, and it is worse than the
 * spam it would prevent. Configure both halves or neither.
 *
 * Once configured, an absent or invalid token is REJECTED — no fallback, no leniency.
 */
export async function verifyTurnstile(token: string | undefined, ip?: string): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY?.trim()
  if (!secret) return true // unconfigured — see above
  if (!token) return false

  const body = new URLSearchParams({ secret, response: token })
  // remoteip is optional and advisory; Cloudflare treats a mismatch as a signal, not a
  // hard fail, so a visitor behind a shifting mobile IP isn't punished for it.
  if (ip) body.set('remoteip', ip)

  try {
    // Never let Cloudflare being slow become sign-in being broken: 5s then decide.
    const res = await fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(5000),
      cache: 'no-store',
    })
    const data = (await res.json()) as { success?: boolean; 'error-codes'?: string[] }
    if (!data.success) {
      // Never log the token itself — it is a single-use credential.
      console.warn('[turnstile] rejected', data['error-codes'])
      return false
    }
    return true
  } catch (e) {
    // Timeout or network failure. FAIL OPEN: the alternative is that a Cloudflare blip
    // locks everyone out of their account. The rate limiter downstream is the backstop
    // that keeps this from being an open relay.
    console.error('[turnstile] verify unreachable — allowing', e)
    return true
  }
}
