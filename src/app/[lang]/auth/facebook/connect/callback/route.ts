import { NextResponse } from 'next/server'
import { canonicalAuthOrigin, stateMatches } from '@/lib/auth/google-oauth'
import { connectedFacebookId, connectFacebookIdentity, FB_CONNECT_APP_RETURN, fbTxCookieName, isConnectState, isNativeConnectState, isPkceVerifier, readFacebookProfile, type FacebookProfile } from '@/lib/auth/facebook-connect'
import { createImportJob } from '@/lib/fb-import/jobs'
import { safeFetch } from '@/lib/ssrf'
import { createHash } from 'node:crypto'
import { createSupabaseServer } from '@/lib/supabase/server'
import { authRedirect } from '@/lib/auth-finish'
import { renderFacebookConnectedEmail } from '@/lib/emails/facebook-connected'
import { logError, logWarn } from '@/lib/log'
import { sendMail } from '@/lib/mail'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** The `fb` values Settings › Privacy turns into a sentence (facebook-connect-row.tsx). */
const OUTCOME_PARAM: Record<string, string> = {
  ok: 'connected',
  already: 'connected',
  other_facebook: 'other',
  held_elsewhere: 'held',
  operator: 'refused',
  no_account: 'failed',
  no_email: 'failed',
  bad_input: 'failed',
}

/**
 * Import from Facebook's half of the round trip: connect if they haven't, insist it is the connected Facebook, and queue the job with a hash of the picture. The picture itself and the token go no
 * further than this function. A default silhouette matches thousands of strangers, so it can't find anyone.
 */
async function queueImport(userId: string, profile: FacebookProfile, connected_: () => Promise<void>): Promise<string> {
  const connected = await connectedFacebookId(userId)
  if (!connected) {
    const outcome = await connectFacebookIdentity(userId, profile)
    if (outcome !== 'ok' && outcome !== 'already') return OUTCOME_PARAM[outcome] ?? 'failed'
    if (outcome === 'ok') await connected_()
  } else if (connected !== profile.id) return 'other'
  if (!profile.picture || profile.pictureIsDefault) return 'no_picture'
  const hashes = await Promise.all((profile.pictures?.length ? profile.pictures : [profile.picture]).map(async (url) => {
    const res = await safeFetch(url, { timeoutMs: 8000 }).catch(() => null)
    return res?.ok ? createHash('sha256').update(Buffer.from(await res.arrayBuffer())).digest('hex') : null
  }))
  const pictureShas = [...new Set(hashes.filter((h): h is string => h !== null))]
  if (!pictureShas.length) { logWarn('[fb-import] no copy of the picture could be fetched', { tried: hashes.length }); return 'failed' }
  const job = await createImportJob(userId, profile.displayName || profile.name, pictureShas)
  return job.ok ? 'queued' : job.reason
}

// Where Facebook returns the visitor. ⛔ THESE MUST AGREE before anything is read from Facebook: the full state, the httpOnly
// cookie that holds it, and the live signed-in user against the user who started. Together they close link CSRF in both
// directions: a Facebook URL or a callback URL sent to someone else finds no matching cookie in that browser.
export async function GET(request: Request) {
  const url = new URL(request.url)
  const origin = canonicalAuthOrigin(request)
  // Only the shape we mint: a newline in a hand-made state would make setting the cookie throw (commit gate, opus).
  const givenState = url.searchParams.get('state')
  const state = isConnectState(givenState) ? givenState : null
  const code = url.searchParams.get('code')

  const cookieName = state ? fbTxCookieName(state) : null
  // No RegExp from `state`: it is caller-supplied (see the Google callback).
  const raw = cookieName
    ? request.headers.get('cookie')?.split('; ').find((c) => c.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1)
    : null
  // ⚠️ VALID JSON IS NOT AN OBJECT: `null` parses fine, and reading a field of it would be a 500 (commit gate, codex).
  let tx: { s?: unknown; u?: unknown; f?: unknown; v?: unknown } = {}
  try {
    const parsed: unknown = raw ? JSON.parse(decodeURIComponent(raw)) : null
    if (parsed && typeof parsed === 'object') tx = parsed
  } catch { tx = {} }

  // ⛔ THE iOS APP'S RETURN (facebook-connect.ts NATIVE_CONNECT_PREFIX): Facebook brought it to the app's in-app browser sheet, which doesn't hold the
  // app's cookies, so there is no state cookie here to check or burn. Hand code and state to the app on this same phone, where the cookie is, and let this
  // route finish there (`app=1`). Nothing is kept here: a code parked for a cookieless browser could be collected by whoever holds the state (commit gate,
  // opus). A code another app catches from the person's own Connect is useless without the verifier in the app's cookie (what remains: facebook-connect.ts FB_CONNECT_APP_RETURN). Never Facebook's error text (the sign-in hop's rule), and Location ends with `#` so no
  // fragment rides along. A crafted link lands in the app with a state no cookie there matches, and fails like any stray callback.
  // ⛔ NEVER FROM THE APP'S OWN ATTEMPT (`app=1`, native-auth.ts fbConnectPathFromDeepLink): with its cookie gone that one must fail here, not hand off to
  // itself again (commit gate, codex).
  if (state && isNativeConnectState(state) && !raw && url.searchParams.get('app') !== '1') {
    const q = new URLSearchParams()
    // With neither a code nor an error, the app is still told (as a cancel): Settings inside the sheet would be a signed-out page and a dead end
    // (commit gate, opus).
    if (code) q.set('code', code)
    else q.set('error', 'cancel')
    q.set('state', state)
    return new NextResponse(null, { status: 302, headers: { Location: `${FB_CONNECT_APP_RETURN}?${q.toString()}#`, 'Cache-Control': 'private, no-store, max-age=0' } })
  }

  // Whatever happens, the transaction is burned on the way out: one try per cookie.
  const forImport = tx.f === 'import'
  const finish = (fb: string | null) => {
    const res = authRedirect(forImport ? `${origin}/dashboard/listings?tab=facebook${fb ? `&fbi=${fb}` : ''}` : `${origin}/dashboard/settings?tab=privacy${fb ? `&fb=${fb}` : ''}`)
    if (cookieName) res.cookies.set(cookieName, '', { path: '/', maxAge: 0 })
    return res
  }

  // Declining Facebook's dialog is a decision, not a failure: back to the row, no message.
  if (url.searchParams.get('error')) return finish(null)
  // Each way out says which: every one of these used to end in the same silent "failed", and finding this cost a deploy (2026-11-05).
  if (!code || !state || typeof tx.s !== 'string' || typeof tx.u !== 'string') { logWarn('[facebook-connect] callback without its state cookie'); return finish('failed') }
  // ⛔ No verifier, no exchange: a cookie made before PKCE (or edited by hand) never falls back to the secret (facebook-connect.ts newPkceVerifier).
  if (!isPkceVerifier(tx.v)) { logWarn('[facebook-connect] callback without a PKCE verifier'); return finish('failed') }
  if (!stateMatches(state, tx.s)) { logWarn('[facebook-connect] callback state mismatch'); return finish('failed') }

  try {
    const sb = await createSupabaseServer()
    const [{ data }, { data: live }] = await Promise.all([sb.auth.getClaims(), sb.auth.getUser()])
    // getUser asks GoTrue: getClaims alone verifies locally, and would let a session Disconnect just ended keep going until its
    // access token expires (commit gate, opus).
    if (data?.claims?.sub !== tx.u || live?.user?.id !== tx.u) { logWarn('[facebook-connect] callback from a different or ended session'); return finish('failed') }

    const read = await readFacebookProfile(code, origin, { pictureSizes: forImport, verifier: tx.v })
    if (!read.ok) { logWarn('[facebook-connect] could not read the profile', { reason: read.reason }); return finish('failed') }

    // Told to the account's own address. Best effort: the link has happened, and a failed mail must not read as a failed link.
    // GoTrue's answer, not the token's: a token can name an address the account has since left.
    const notifyConnected = async () => {
      const email = live?.user?.email ?? null
      if (!email) return
      const lang = request.headers.get('cookie')?.split('; ').includes('lang=vi') ? 'vi' : 'en'
      // sendMail answers false rather than throwing, and this notice is what a phished owner would recover by: never silently lost.
      const sent = await sendMail({ to: email, ...renderFacebookConnectedEmail({ origin, lang }) }).catch(() => false)
      if (!sent) logError(new Error('notice not sent'), { op: 'facebook-connect.notice' })
    }
    if (forImport) {
      const end = await queueImport(tx.u, read.profile, notifyConnected)
      await sb.auth.refreshSession().catch((e: unknown) => logError(e, { op: 'facebook-connect.refresh' }))
      return finish(end)
    }
    const outcome = await connectFacebookIdentity(tx.u, read.profile)
    // The session's JWT carries app_metadata.providers; a fresh one names Facebook at once. Best effort: the next refresh does it.
    if (outcome === 'ok') {
      await sb.auth.refreshSession().catch((e: unknown) => logError(e, { op: 'facebook-connect.refresh' }))
      await notifyConnected()
    }
    return finish(OUTCOME_PARAM[outcome] ?? 'failed')
  } catch (e) {
    logError(e, { op: 'facebook-connect.callback' })
    return finish('failed')
  }
}
