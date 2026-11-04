import type { SignInMethod } from '@/lib/signup-prompt'

/**
 * "Last used" on the sign-in window (owner, 2026-11-04: "last used quick sing in"), so someone who was signed out finds the way they
 * came in at a glance instead of guessing, and making a second account with another method.
 *
 * ⛔ THE METHOD ONLY, NEVER WHO. No email, no name: on a shared phone this must not tell the next person whose device it was. That is
 * also why sign-out leaves it (it is not in sign-out-storage.ts): it belongs to the device, like the theme, and being signed out is
 * exactly when it is read. /privacy's on-device table says so.
 *
 * ⛔ READ FROM THE SESSION THE AUTH SERVER ISSUED, NOT FROM WHICH BUTTON WAS TAPPED. A first version noted the tap and promoted it when a
 * session arrived, and review found the hole straight away: send yourself a link, tap Google, cancel, open the link, and it says Google.
 * The access token's `amr` claim says how THIS session was made, so every path counts (a code, a link, a password, the first-party Google
 * round trip), and a cancelled tap cannot. Values from GoTrue v2.189: internal/api/external.go and token_oidc.go issue `oauth`,
 * verify.go `otp`, token.go `password`.
 * ⚠️ `oauth` DOES NOT SAY WHICH PROVIDER, so that is the identity signed in with most recently (external.go stamps `last_sign_in_at` on
 * each OAuth sign-in), then `app_metadata.provider`, which is only the account's FIRST provider.
 * ⚠️ THAT TIMESTAMP IS THE ACCOUNT'S, NOT THIS DEVICE'S: sign in with Google here and Facebook elsewhere, and this device can come to say
 * Facebook. Left so: only an account with two providers can see it, and either one opens the same account.
 * ⚠️ UNVERIFIED BY THE TOKEN'S SIGNATURE, ON PURPOSE: this picks a label on this device and decides nothing.
 */
const LAST_KEY = 'eno:signin-last'
const METHODS: readonly SignInMethod[] = ['google', 'apple', 'facebook', 'email']
const EMAIL_AMR = new Set(['otp', 'password', 'magiclink', 'email/signup', 'recovery', 'invite'])

type SessionLike = {
  access_token?: string
  user?: {
    identities?: { provider?: string; last_sign_in_at?: string | null }[] | null
    app_metadata?: { provider?: unknown } | null
  } | null
}

const isMethod = (m: unknown): m is SignInMethod => METHODS.includes(m as SignInMethod)

/** How this session was made, or null when it cannot be said (a method this window does not offer, a damaged token). */
export function methodOfSession(session: SessionLike): SignInMethod | null {
  try {
    const payload = (session.access_token ?? '').split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    const amr = (JSON.parse(atob(payload)) as { amr?: { method?: unknown; timestamp?: unknown }[] }).amr
    if (!Array.isArray(amr) || !amr.length) return null
    const latest = amr.reduce((a, b) => (Number(b.timestamp) > Number(a.timestamp) ? b : a))
    if (latest.method !== 'oauth') return typeof latest.method === 'string' && EMAIL_AMR.has(latest.method) ? 'email' : null
    const newest = [...(session.user?.identities ?? [])]
      .filter((i) => i.provider !== 'email')
      .sort((a, b) => (Date.parse(b.last_sign_in_at ?? '') || 0) - (Date.parse(a.last_sign_in_at ?? '') || 0))[0]?.provider
    const provider = newest ?? session.user?.app_metadata?.provider
    return isMethod(provider) && provider !== 'email' ? provider : null
  } catch {
    return null
  }
}

/** Every auth event with a session: the same session always gives the same answer, and one it cannot read leaves what is remembered. */
export function rememberLastSignIn(session: SessionLike): void {
  const method = methodOfSession(session)
  if (!method) return
  try { localStorage.setItem(LAST_KEY, method) } catch { /* private mode: there is just no label */ }
}

export function lastSignInMethod(): SignInMethod | null {
  try {
    const m = localStorage.getItem(LAST_KEY)
    return isMethod(m) ? m : null
  } catch {
    return null
  }
}
