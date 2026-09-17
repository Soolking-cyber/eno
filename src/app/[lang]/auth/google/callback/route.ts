import {
  canonicalAuthOrigin,
  exchangeCodeForIdToken,
  stateMatches,
  txCookieName,
} from '@/lib/auth/google-oauth'
import { createSupabaseServer } from '@/lib/supabase/server'
import { authRedirect, finishSignIn } from '@/lib/auth-finish'
import { safeNextPath } from '@/lib/url'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Tx = { s?: string; n?: string; v?: string; next?: string }

// Where Google returns the visitor. Exchanges the code for an ID token and hands that to Supabase,
// which owns the session exactly as it does on every other path.
//
// ⛔ THIS ROUTE NEVER SHOWS AN ERROR. Every failure — a replayed state, a stale code, Google being
// unreachable, a rejected token — redirects to the sign-in form with `?g=fallback`, which runs the
// old signInWithOAuth. A visitor who has already chosen their Google account and lands on an error
// page is a visitor who does not come back; an unbranded second attempt is a much smaller loss.
export async function GET(request: Request) {
  const url = new URL(request.url)
  const origin = canonicalAuthOrigin(request)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')

  // ⚠️ READ THE COOKIE BEFORE ANY EARLY RETURN, so `next` survives into the fallback and the
  // visitor is returned to the page they started from rather than the home page.
  const cookieName = state ? txCookieName(state) : null
  // ⛔ NO RegExp HERE, AND THE FIRST VERSION BUILT ONE FROM `state`. `state` is whatever the caller
  // put in the query string, so `?state=(` made `new RegExp()` THROW — a 500, which is precisely
  // the error page this route promises never to show, reachable by anyone with a URL bar. Split the
  // header instead; there is no pattern to inject into.
  const raw = cookieName
    ? request.headers.get('cookie')?.split('; ').find((c) => c.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1)
    : null
  let tx: Tx = {}
  try { tx = raw ? (JSON.parse(decodeURIComponent(raw)) as Tx) : {} } catch { tx = {} }
  const next = safeNextPath(tx.next ?? null, origin)

  /** The visitor chose not to continue. Same cleanup, but NO `g=fallback`, so nothing re-fires. */
  const giveUp = () => {
    const res = authRedirect(`${origin}/signin?next=${encodeURIComponent(next)}`)
    if (cookieName) res.cookies.set(cookieName, '', { path: '/', maxAge: 0 })
    return res
  }

  const bail = () => {
    // authRedirect sets `private, no-store` — an auth redirect carries Set-Cookie, and a cached one
    // hands one visitor's session to the next.
    const res = authRedirect(`${origin}/signin?g=fallback&next=${encodeURIComponent(next)}`)
    // Burn the transaction on the way out, whatever went wrong — a cookie that survives a failure
    // is a cookie an attacker can retry against.
    if (cookieName) res.cookies.set(cookieName, '', { path: '/', maxAge: 0 })
    return res
  }

  // ⛔ CANCELLING MUST NOT LOOP. Google returns `error=access_denied` and no code when the visitor
  // backs out. Treating that as a technical failure sent them to /signin?g=fallback, which auto-fires
  // signInWithOAuth, which sends them straight back to Google — they could never get out. Two
  // reviewers found it. A refusal is a DECISION: return them to the form and leave them alone.
  if (url.searchParams.get('error')) return giveUp()
  if (!code || !state) return bail()
  // ⛔ CONSTANT-TIME, AND AGAINST THE COOKIE'S COPY — not against the cookie NAME, which is only a
  // 12-character prefix and is therefore attacker-guessable. The full state has to match.
  if (!stateMatches(state, tx.s)) return bail()
  if (!tx.n || !tx.v) return bail()

  const exchanged = await exchangeCodeForIdToken(code, origin, tx.v)
  if (!exchanged.ok) return bail()

  // ⚠️ SUPABASE STILL OWNS THE SESSION. This route obtains a Google credential and nothing more;
  // createSupabaseServer()'s setAll() writes the same auth cookies the magic-link and phone paths
  // write, so everything downstream — middleware, /api/me, auth-context — is unchanged.
  //
  // ⚠️ THE RAW NONCE, NOT THE HASH. GoTrue hashes what it is given and compares that to the token's
  // `nonce` claim, which carries the hash Google was sent. Passing the hash here would double-hash
  // and fail every sign-in.
  // ⛔ THE WHOLE SUPABASE HALF IS INSIDE A try. createSupabaseServer() and finishSignIn() were
  // outside any catch, so a throw from either — notably AFTER signInWithIdToken had already created
  // a session — returned a 500 and left the transaction cookie behind. Caught by review.
  try {
  const sb = await createSupabaseServer()
  const result = await sb.auth
    .signInWithIdToken({ provider: 'google', token: exchanged.idToken, nonce: tx.n })
    // signInWithIdToken rethrows anything that is not an AuthError — a storage write, or one of our
    // own onAuthStateChange handlers. An escape here would render a 500 to someone mid-sign-in.
    .catch((e: unknown) => ({ data: null, error: { message: e instanceof Error ? e.message : String(e) } }))
  if (result.error) {
    // ⚠️ The MESSAGE only. The id_token and the code are credentials and must never reach a log.
    console.warn('[auth] google id_token rejected by supabase:', result.error.message)
    return bail()
  }

  // ⛔ THE SAME finishSignIn THE REDIRECT FLOW USES. It provisions the app Profile (ensureProfile)
  // and sends an account with no accountType through /onboard. The GIS path could skip it because
  // auth-context re-does both client-side; this route returns a redirect, so doing it here matches
  // the magic-link and OAuth paths exactly instead of relying on a second mechanism.
  const res = await finishSignIn(result.data?.user, origin, next)
  if (cookieName) res.cookies.set(cookieName, '', { path: '/', maxAge: 0 })
  return res
  } catch (e) {
    console.warn('[auth] google callback threw after exchange:', e instanceof Error ? e.message : String(e))
    return bail()
  }
}
